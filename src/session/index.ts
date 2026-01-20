/**
 * Session Management
 *
 * Handles session lifecycle: creation, resolution, updates, abort/stop.
 * Each session maps 1:1 to a Slack thread.
 */

import { v4 as uuid } from "uuid";
import type { WebClient } from "@slack/web-api";
import { Session, SessionConfig, ControlUpdate, Job } from "../common/schema";
import { Bus, Events } from "../common/bus";
import { getStorage } from "../storage";
import { getDefaultModel } from "../common/config";
import {
  buildProfile,
  getProfile,
  clearProfile,
  formatProfileForDisplay,
} from "./profiles";

// Context for control operations that need Slack access
export interface ControlContext {
  client?: WebClient;
  userId?: string;
  channelId?: string;
}

export const SessionManager = {
  /**
   * Find existing session or create new one for a thread
   */
  async resolveOrCreate(params: {
    channelId: string;
    threadTs: string;
  }): Promise<Session> {
    const storage = await getStorage();

    // Check if session exists
    let session = await storage.sessions.findByThread(params);

    if (!session) {
      // Get channel config for defaults
      const channelConfig = await storage.channelConfig.get(params.channelId);

      session = await storage.sessions.create({
        id: uuid(),
        channelId: params.channelId,
        threadTs: params.threadTs,
        config: {
          repo: channelConfig?.lastRepo,
          branch: channelConfig?.lastBranch,
          model: getDefaultModel(),
          scope: "thread",
          mode: "code",
          reasoningEffort: "medium",
          enableWebSearch: true,
          enableCodeInterpreter: false, // Use local bash instead
        },
        status: "idle",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await Bus.publish(Events["session.created"], {
        sessionId: session.id,
        channelId: session.channelId,
        threadTs: session.threadTs,
      });
    }

    return session;
  },

  /**
   * Find session by thread
   */
  async findByThread(params: { channelId: string; threadTs: string }): Promise<Session | null> {
    const storage = await getStorage();
    return storage.sessions.findByThread(params);
  },

  /**
   * Find session by ID
   */
  async findById(id: string): Promise<Session | null> {
    const storage = await getStorage();
    return storage.sessions.findById(id);
  },

  /**
   * Apply a control update to a session
   * Returns a response message if the control requires one (e.g., save returns session ID)
   */
  async applyControl(
    sessionId: string,
    control: ControlUpdate,
    ctx: ControlContext = {}
  ): Promise<string | null> {
    const storage = await getStorage();
    const session = await storage.sessions.findById(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Handle stop/abort immediately
    if (control.type === "abort") {
      await this.abort(sessionId);
      return null;
    }

    if (control.type === "stop") {
      await this.stop(sessionId);
      return null;
    }

    // Handle help - returns usage information
    if (control.type === "help") {
      return `*Claire Help* - Slack-native AI coding assistant powered by GPT-5.2

*Basic Usage:*
\`@claire <your task>\` - Ask Claire to do something

*Configuration Options:*
• \`repo=owner/repo\` - Set GitHub repository
• \`branch=name\` - Set branch to use/create
• \`model=gpt-5.2\` - Set model (gpt-5.2, gpt-5.2-pro, gpt-5-mini, gpt-5-nano)
• \`mode=code|chat\` - code (full access) or chat (read-only)
• \`scope=channel\` - Include channel history (not just thread)
• \`scope=channel:last_50\` - Include last 50 channel messages

*Reasoning & Output:*
• \`reasoning=none|low|medium|high|xhigh|auto\` - Set reasoning effort (default: medium)
• \`verbosity=low|medium|high\` - Control response length
• \`ultrathink\` - Shortcut for maximum reasoning (xhigh)

*Built-in Tools:*
• \`websearch=on|off\` - Toggle web search (default: on)
• \`codeinterpreter=on|off\` - Toggle code execution (default: on)

*Session Management:*
• \`save\` - Save session for later (returns ID)
• \`load=<id>\` - Load a previous session

*Profiles:* (auto-created on first interaction)
• \`profile=build\` - Build your profile from channel history
• \`profile=build:<@user>\` - Build profile for another user
• \`profile=show\` - Show your profile (or \`profile=show:<@user>\`)
• \`profile=clear\` - Clear your profile (or \`profile=clear:<@user>\`)

*Control:*
• \`stop\` or \`abort\` - Cancel current task

*Examples:*
\`@claire repo=myorg/myrepo fix the login bug\`
\`@claire ultrathink design a distributed cache system\`
\`@claire scope=channel summarize this channel\`
\`@claire scope=channel:last_200 what were the main topics discussed?\``;
    }

    // Handle save - returns session ID
    if (control.type === "save") {
      return `Session saved. ID: \`${sessionId}\`\nUse \`load=${sessionId}\` to restore this session in a new thread.`;
    }

    // Handle load - loads context from another session
    if (control.type === "load" && control.value) {
      const sourceSession = await storage.sessions.findById(control.value);
      if (!sourceSession) {
        return `Error: Session \`${control.value}\` not found.`;
      }

      // Copy config from source session
      const newConfig: SessionConfig = {
        ...session.config,
        repo: sourceSession.config.repo,
        branch: sourceSession.config.branch,
        model: sourceSession.config.model,
        mode: sourceSession.config.mode,
      };

      await storage.sessions.update(sessionId, { config: newConfig });

      // Copy messages from source session for context
      const sourceMessages = await storage.messages.findBySession(control.value);
      if (sourceMessages.length > 0) {
        // Update messages to belong to new session
        const newMessages = sourceMessages.map((msg) => ({
          ...msg,
          id: `${sessionId}-${msg.ts}`,
          sessionId,
        }));
        await storage.messages.upsertBatch(newMessages);
      }

      return `Loaded session \`${control.value}\` (${sourceMessages.length} messages, repo: ${sourceSession.config.repo || "none"}, branch: ${sourceSession.config.branch || "auto"})`;
    }

    // Handle profile commands
    if (control.type === "profile") {
      const { client, userId, channelId } = ctx;

      // Parse command and optional target user (format: "command" or "command:targetUserId")
      const [command, targetUserId] = (control.value || "").split(":");
      const effectiveUserId = targetUserId || userId;

      if (command === "build") {
        if (!client || !effectiveUserId || !channelId) {
          return "Error: Cannot build profile - missing context. Try again.";
        }
        try {
          const profile = await buildProfile(client, channelId, effectiveUserId);
          return `Profile built for *${profile.displayName}*\n\n${profile.profile}`;
        } catch (err) {
          return `Error building profile: ${err instanceof Error ? err.message : "Unknown error"}`;
        }
      }

      if (command === "show") {
        if (!effectiveUserId) {
          return "Error: Cannot show profile - user not identified.";
        }
        const profile = await getProfile(effectiveUserId);
        if (!profile || !profile.profile) {
          return targetUserId
            ? `No profile found for <@${targetUserId}>. Use \`profile=build:<@${targetUserId}>\` to create one.`
            : "No profile found. Use `profile=build` to create one.";
        }
        return formatProfileForDisplay(profile);
      }

      if (command === "clear") {
        if (!effectiveUserId) {
          return "Error: Cannot clear profile - user not identified.";
        }
        await clearProfile(effectiveUserId);
        return targetUserId
          ? `Profile cleared for <@${targetUserId}>.`
          : "Profile cleared.";
      }

      return "Unknown profile command. Use: `profile=build`, `profile=show`, or `profile=clear`. Add `:<@user>` to target another user.";
    }

    // Update config
    const newConfig: SessionConfig = { ...session.config };

    switch (control.type) {
      case "repo":
        newConfig.repo = control.value;
        // Also update channel config for last-used
        await storage.channelConfig.set({
          channelId: session.channelId,
          lastRepo: control.value,
          lastBranch: newConfig.branch,
          updatedAt: new Date(),
        });
        break;

      case "branch":
        newConfig.branch = control.value;
        // Also update channel config
        const currentChannelConfig = await storage.channelConfig.get(session.channelId);
        await storage.channelConfig.set({
          channelId: session.channelId,
          lastRepo: currentChannelConfig?.lastRepo || newConfig.repo,
          lastBranch: control.value,
          updatedAt: new Date(),
        });
        break;

      case "model":
        newConfig.model = control.value || newConfig.model;
        break;

      case "scope":
        if (control.value?.startsWith("channel:last_")) {
          newConfig.scope = "channel";
          const limitMatch = control.value.match(/last_(\d+)/);
          if (limitMatch) {
            newConfig.channelLimit = parseInt(limitMatch[1]!, 10);
          }
        } else if (control.value === "channel") {
          newConfig.scope = "channel";
          newConfig.channelLimit = newConfig.channelLimit || 100; // Default to last 100 messages
        } else if (control.value === "thread") {
          newConfig.scope = "thread";
        }
        break;

      case "mode":
        if (control.value === "code" || control.value === "chat") {
          newConfig.mode = control.value;
        }
        break;

      case "reasoning":
        if (["none", "low", "medium", "high", "xhigh", "auto"].includes(control.value || "")) {
          newConfig.reasoningEffort = control.value as any;
        }
        break;

      case "verbosity":
        if (["low", "medium", "high"].includes(control.value || "")) {
          newConfig.verbosity = control.value as any;
        }
        break;

      case "websearch":
        newConfig.enableWebSearch = control.value === "on" || control.value === "true";
        break;

      case "codeinterpreter":
        newConfig.enableCodeInterpreter = control.value === "on" || control.value === "true";
        break;
    }

    await storage.sessions.update(sessionId, { config: newConfig });

    await Bus.publish(Events["session.config.updated"], {
      sessionId,
      key: control.type,
      value: control.value,
    });

    return null;
  },

  /**
   * Abort a session - cancel current job, clear queue
   */
  async abort(sessionId: string): Promise<void> {
    const storage = await getStorage();

    // Signal abort to running worker
    await Bus.publish(Events["session.abort"], { sessionId });

    // Clear job queue
    const cleared = await storage.jobs.clearQueued(sessionId);
    console.log(`Cleared ${cleared} queued jobs for session ${sessionId}`);

    // Update session status
    await storage.sessions.update(sessionId, { status: "aborted" });
  },

  /**
   * Request graceful stop
   */
  async stop(sessionId: string): Promise<void> {
    await Bus.publish(Events["session.stop"], { sessionId });
  },

  /**
   * Update session status
   */
  async setStatus(sessionId: string, status: Session["status"]): Promise<void> {
    const storage = await getStorage();
    await storage.sessions.update(sessionId, { status });
  },
};

// Job management
export const JobManager = {
  /**
   * Add a job to the queue
   */
  async enqueue(params: {
    sessionId: string;
    promptMessageTs: string;
    promptText: string;
    userId: string;
  }): Promise<Job> {
    const storage = await getStorage();

    const job: Job = {
      id: uuid(),
      sessionId: params.sessionId,
      promptMessageTs: params.promptMessageTs,
      promptText: params.promptText,
      userId: params.userId,
      status: "queued",
    };

    await storage.jobs.create(job);

    await Bus.publish(Events["job.queued"], {
      jobId: job.id,
      sessionId: job.sessionId,
      promptText: job.promptText,
    });

    return job;
  },

  /**
   * Mark job as started
   */
  async start(jobId: string): Promise<void> {
    const storage = await getStorage();
    await storage.jobs.update(jobId, {
      status: "running",
      startedAt: new Date(),
    });

    const job = await storage.jobs.findById(jobId);
    if (job) {
      await Bus.publish(Events["job.started"], {
        jobId,
        sessionId: job.sessionId,
      });
    }
  },

  /**
   * Mark job as completed
   */
  async complete(jobId: string, summary: string): Promise<void> {
    const storage = await getStorage();
    const job = await storage.jobs.findById(jobId);

    await storage.jobs.update(jobId, {
      status: "succeeded",
      endedAt: new Date(),
      resultSummary: summary,
    });

    if (job) {
      await Bus.publish(Events["job.completed"], {
        jobId,
        sessionId: job.sessionId,
        summary,
      });
    }
  },

  /**
   * Mark job as failed
   */
  async fail(jobId: string, error: string): Promise<void> {
    const storage = await getStorage();
    const job = await storage.jobs.findById(jobId);

    await storage.jobs.update(jobId, {
      status: "failed",
      endedAt: new Date(),
      resultSummary: error,
    });

    if (job) {
      await Bus.publish(Events["job.failed"], {
        jobId,
        sessionId: job.sessionId,
        error,
      });
    }
  },

  /**
   * Get next queued job for a session
   */
  async getNext(sessionId: string): Promise<Job | null> {
    const storage = await getStorage();
    return storage.jobs.findNextQueued(sessionId);
  },

  /**
   * Find job by ID
   */
  async findById(jobId: string): Promise<Job | null> {
    const storage = await getStorage();
    return storage.jobs.findById(jobId);
  },
};
