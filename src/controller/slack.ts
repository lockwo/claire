/**
 * Slack Event Handler
 *
 * Uses Slack Bolt in socket mode to handle app mentions and thread replies.
 * Resolves sessions, parses controls, and schedules jobs.
 */

import { App, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { SessionManager, JobManager } from "../session";
import { parseMessage, isControlOnly, normalizeRepo } from "./parser";
import { Bus, Events } from "../common/bus";
import type { Env } from "../common/config";
import {
  postMessageWithRetry,
  addReactionWithRetry,
  removeReactionWithRetry,
  uploadFileWithRetry,
} from "../common/slack-retry";
import { MeetController, MeetBindingManager } from "../meet";

export interface SlackHandler {
  app: App;
  client: WebClient;
  botUserId: string | null;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createSlackHandler(config: Env): Promise<SlackHandler> {
  const app = new App({
    token: config.SLACK_BOT_TOKEN,
    appToken: config.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: config.LOG_LEVEL === "debug" ? LogLevel.DEBUG : LogLevel.INFO,
  });

  let botUserId: string | null = null;

  // Track recently processed messages to avoid duplicates
  // (app_mention and message events can both fire for the same message)
  const processedMessages = new Set<string>();
  const cleanupInterval = setInterval(() => {
    // Clear old entries every 5 minutes
    processedMessages.clear();
  }, 5 * 60 * 1000);

  // Get bot user ID on startup
  const authResult = await app.client.auth.test();
  botUserId = authResult.user_id || null;
  console.log(`Bot user ID: ${botUserId}`);

  // Handle @claire mentions in channels
  app.event("app_mention", async ({ event, client }) => {
    const messageKey = `${event.channel}:${event.ts}`;

    // Skip if already processed
    if (processedMessages.has(messageKey)) {
      console.log(`[app_mention] skipping duplicate ${event.ts}`);
      return;
    }
    processedMessages.add(messageKey);

    console.log(`[app_mention] channel=${event.channel} ts=${event.ts}`);

    const { channel, thread_ts, ts, user, text } = event;

    // Determine thread timestamp (if not in thread, this message starts one)
    const threadTs = thread_ts || ts;

    // Parse the message
    const parsed = parseMessage(text, botUserId || undefined);
    console.log(`[parsed] controls=${JSON.stringify(parsed.controls)} task="${parsed.taskText}"`);

    // Resolve or create session
    const session = await SessionManager.resolveOrCreate({
      channelId: channel,
      threadTs,
    });

    // Apply control updates
    const controlResponses: string[] = [];
    for (const control of parsed.controls) {
      // Normalize repo if provided
      if (control.type === "repo" && control.value) {
        control.value = normalizeRepo(control.value);
      }
      const response = await SessionManager.applyControl(session.id, control, {
        client,
        userId: user,
        channelId: channel,
      });
      if (response) {
        controlResponses.push(response);
      }
    }

    // Post any control responses (e.g., save/load messages)
    if (controlResponses.length > 0) {
      await postToThread(client, channel, threadTs, controlResponses.join("\n"));
    }

    // If there's a task (not just controls), queue it
    if (parsed.taskText) {
      await JobManager.enqueue({
        sessionId: session.id,
        promptMessageTs: ts,
        promptText: parsed.taskText,
        userId: user || "unknown",
      });

      // React to acknowledge
      try {
        await addReactionWithRetry(client, {
          channel,
          timestamp: ts,
          name: "eyes",
        });
      } catch (e) {
        // Handled by retry wrapper
      }
    } else if (parsed.controls.length > 0) {
      // Control-only message - acknowledge with checkmark
      try {
        await addReactionWithRetry(client, {
          channel,
          timestamp: ts,
          name: "white_check_mark",
        });
      } catch (e) {
        // Handled by retry wrapper
      }
    }
  });

  // Handle thread replies (for mid-run updates and follow-up tasks)
  app.event("message", async ({ event, client }) => {
    // Skip bot messages, message changes, etc.
    if (
      !("thread_ts" in event) ||
      !event.thread_ts ||
      ("subtype" in event && event.subtype) ||
      !("text" in event) ||
      !event.text
    ) {
      return;
    }

    const messageKey = `${event.channel}:${event.ts}`;

    // Skip if already processed (by app_mention handler)
    if (processedMessages.has(messageKey)) {
      return;
    }

    // Skip if this message mentions the bot (app_mention handler will process it)
    if (botUserId && event.text.includes(`<@${botUserId}>`)) {
      return;
    }

    processedMessages.add(messageKey);

    // Check if this is a thread we're tracking
    const session = await SessionManager.findByThread({
      channelId: event.channel,
      threadTs: event.thread_ts,
    });

    if (!session) {
      // Not a Claire thread, ignore
      return;
    }

    console.log(`[thread_reply] session=${session.id} ts=${event.ts}`);

    // Parse the message
    const parsed = parseMessage(event.text, botUserId || undefined);

    // Apply control updates immediately
    const controlResponses: string[] = [];
    for (const control of parsed.controls) {
      if (control.type === "repo" && control.value) {
        control.value = normalizeRepo(control.value);
      }
      const response = await SessionManager.applyControl(session.id, control, {
        client,
        userId: event.user,
        channelId: event.channel,
      });
      if (response) {
        controlResponses.push(response);
      }
    }

    // Post any control responses (e.g., save/load messages)
    if (controlResponses.length > 0) {
      await postToThread(client, event.channel, event.thread_ts, controlResponses.join("\n"));
    }

    // Queue task if present (mention not required in existing thread)
    if (parsed.taskText) {
      await JobManager.enqueue({
        sessionId: session.id,
        promptMessageTs: event.ts,
        promptText: parsed.taskText,
        userId: event.user || "unknown",
      });

      // React to acknowledge
      try {
        await addReactionWithRetry(client, {
          channel: event.channel,
          timestamp: event.ts,
          name: "eyes",
        });
      } catch (e) {
        // Handled by retry wrapper
      }
    }
  });

  // Handle /claire slash commands
  app.command("/claire", async ({ command, ack, respond, client }) => {
    await ack();

    const args = command.text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase() || "";

    switch (subcommand) {
      case "bind-meet": {
        const rawUrl = args[1];
        if (!rawUrl) {
          await respond({
            text: "Usage: `/claire bind-meet <meet-url>`\nExample: `/claire bind-meet https://meet.google.com/abc-defg-hij`",
            response_type: "ephemeral",
          });
          return;
        }

        // Normalize and validate Meet URL
        const meetUrl = MeetBindingManager.normalizeInputUrl(rawUrl);
        if (!MeetBindingManager.isValidMeetUrl(meetUrl)) {
          await respond({
            text: "Invalid Meet URL. Please provide a valid Google Meet link (e.g., meet.google.com/abc-defg-hij)",
            response_type: "ephemeral",
          });
          return;
        }

        try {
          // Create a thread for Meet results
          const thread = await client.chat.postMessage({
            channel: command.channel_id,
            text: `:satellite: *Claire Meet Binding*\nMeeting: ${meetUrl}\nBound by: <@${command.user_id}>\n\n_I'll post results from this meeting here. Say "Claire, [task]" in the meeting to trigger actions._`,
          });

          if (!thread.ts) {
            await respond({
              text: "Failed to create thread for Meet binding.",
              response_type: "ephemeral",
            });
            return;
          }

          // Create binding
          await MeetBindingManager.create({
            meetUrl,
            channelId: command.channel_id,
            threadTs: thread.ts,
            createdBy: command.user_id,
            ttlHours: 8, // Binding expires after 8 hours
          });

          // Start the Meet bot
          await MeetController.startBot(meetUrl);

          await respond({
            text: `:white_check_mark: Meet binding created!\nMeeting: ${meetUrl}\n\nThe Claire bot will join the meeting shortly. Say "Claire, [task]" during the meeting to trigger actions.`,
            response_type: "ephemeral",
          });
        } catch (err) {
          console.error(`[slack] bind-meet error:`, err);
          await respond({
            text: `Failed to create Meet binding: ${err}`,
            response_type: "ephemeral",
          });
        }
        break;
      }

      case "unbind-meet": {
        const rawUrl = args[1];
        if (!rawUrl) {
          await respond({
            text: "Usage: `/claire unbind-meet <meet-url>`",
            response_type: "ephemeral",
          });
          return;
        }

        const meetUrl = MeetBindingManager.normalizeInputUrl(rawUrl);
        try {
          await MeetController.stopBot(meetUrl);
          await MeetBindingManager.remove(meetUrl);

          await respond({
            text: `:wave: Meet binding removed and bot disconnected.`,
            response_type: "ephemeral",
          });
        } catch (err) {
          console.error(`[slack] unbind-meet error:`, err);
          await respond({
            text: `Failed to remove Meet binding: ${err}`,
            response_type: "ephemeral",
          });
        }
        break;
      }

      case "meet-status": {
        const activeCount = MeetController.getActiveCount();
        const activeUrls = MeetController.getActiveUrls();
        const stats = MeetController.getCooldownStats();

        let statusText = `:satellite: *Meet Status*\nActive bots: ${activeCount}`;
        if (activeUrls.length > 0) {
          statusText += `\n\nActive meetings:\n${activeUrls.map((u) => `• ${u}`).join("\n")}`;
        }
        statusText += `\n\nCooldown: ${stats.triggerCount} triggers, ${stats.speakerCount} speakers tracked`;

        await respond({
          text: statusText,
          response_type: "ephemeral",
        });
        break;
      }

      case "help":
      default:
        await respond({
          text: `*Claire Commands*\n\n` +
            `\`/claire bind-meet <url>\` - Connect a Google Meet to this channel\n` +
            `\`/claire unbind-meet <url>\` - Disconnect a Google Meet\n` +
            `\`/claire meet-status\` - Show active Meet connections\n` +
            `\`/claire help\` - Show this help message\n\n` +
            `Or just mention \`@claire\` in a thread to start a coding session!`,
          response_type: "ephemeral",
        });
    }
  });

  return {
    app,
    client: app.client,
    botUserId,

    async start() {
      await app.start();
      console.log("Slack socket mode started");
    },

    async stop() {
      clearInterval(cleanupInterval);
      // Stop all Meet bots on shutdown
      await MeetController.stopAll();
      await app.stop();
      console.log("Slack socket mode stopped");
    },
  };
}

/**
 * Post a message to a thread
 */
export async function postToThread(
  client: WebClient,
  channelId: string,
  threadTs: string,
  text: string,
  blocks?: unknown[]
): Promise<void> {
  await postMessageWithRetry(client, {
    channel: channelId,
    thread_ts: threadTs,
    text,
    blocks: blocks as any,
  });
}

/**
 * Update a reaction on a message
 */
export async function updateReaction(
  client: WebClient,
  channelId: string,
  ts: string,
  oldEmoji: string,
  newEmoji: string
): Promise<void> {
  try {
    await removeReactionWithRetry(client, {
      channel: channelId,
      timestamp: ts,
      name: oldEmoji,
    });
  } catch (e) {
    // May not exist - already handled by retry wrapper
  }

  try {
    await addReactionWithRetry(client, {
      channel: channelId,
      timestamp: ts,
      name: newEmoji,
    });
  } catch (e) {
    // May already exist - already handled by retry wrapper
  }
}

/**
 * Upload a file to a thread
 */
export async function uploadToThread(
  client: WebClient,
  channelId: string,
  threadTs: string,
  filePath: string,
  filename: string,
  comment?: string
): Promise<string | undefined> {
  const result = await uploadFileWithRetry(client, {
    channel_id: channelId,
    thread_ts: threadTs,
    file: filePath,
    filename,
    initial_comment: comment,
  });

  // Return file ID if available
  const files = (result as any).files;
  if (files && files[0]) {
    return files[0].id;
  }
  return undefined;
}
