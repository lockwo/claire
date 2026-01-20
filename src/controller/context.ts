/**
 * Context Gathering
 *
 * Fetches thread/channel messages and attachments from Slack
 * to build context for the agent.
 */

import type { WebClient } from "@slack/web-api";
import type { Session, MessageSnapshot, AttachmentMeta } from "../common/schema";
import { getStorage } from "../storage";

/**
 * Gather all messages from a thread
 */
export async function gatherThreadContext(
  client: WebClient,
  session: Session
): Promise<MessageSnapshot[]> {
  const messages: MessageSnapshot[] = [];

  try {
    const result = await client.conversations.replies({
      channel: session.channelId,
      ts: session.threadTs,
      inclusive: true,
      limit: 1000,
    });

    for (const msg of result.messages || []) {
      if (!msg.ts) continue;

      const attachments: AttachmentMeta[] = [];

      // Process file attachments
      if (msg.files) {
        for (const file of msg.files) {
          attachments.push({
            id: file.id || "",
            name: file.name || "unknown",
            mimetype: file.mimetype || "application/octet-stream",
            url: file.url_private_download || file.url_private || "",
          });
        }
      }

      messages.push({
        id: msg.ts,
        sessionId: session.id,
        ts: msg.ts,
        userId: msg.user || msg.bot_id || "unknown",
        text: msg.text || "",
        attachments,
      });
    }
  } catch (error) {
    console.error("Error gathering thread context:", error);
  }

  // Sort by timestamp (chronological)
  return messages.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
}

/**
 * Gather recent messages from a channel
 */
export async function gatherChannelContext(
  client: WebClient,
  channelId: string,
  limit: number = 200
): Promise<MessageSnapshot[]> {
  const messages: MessageSnapshot[] = [];

  try {
    const result = await client.conversations.history({
      channel: channelId,
      limit,
    });

    for (const msg of result.messages || []) {
      if (!msg.ts) continue;

      const attachments: AttachmentMeta[] = [];

      if (msg.files) {
        for (const file of msg.files) {
          attachments.push({
            id: file.id || "",
            name: file.name || "unknown",
            mimetype: file.mimetype || "application/octet-stream",
            url: file.url_private_download || file.url_private || "",
          });
        }
      }

      messages.push({
        id: msg.ts,
        sessionId: "", // Will be set later
        ts: msg.ts,
        userId: msg.user || msg.bot_id || "unknown",
        text: msg.text || "",
        attachments,
      });
    }
  } catch (error) {
    console.error("Error gathering channel context:", error);
  }

  // Reverse to chronological order
  return messages.reverse();
}

/**
 * Build context based on session scope
 */
export async function gatherContext(
  client: WebClient,
  session: Session
): Promise<MessageSnapshot[]> {
  let messages: MessageSnapshot[];

  if (session.config.scope === "channel") {
    // Gather channel context (default to 100 messages if no limit specified)
    const channelMessages = await gatherChannelContext(
      client,
      session.channelId,
      session.config.channelLimit || 100
    );

    // Set session ID
    messages = channelMessages.map((m) => ({ ...m, sessionId: session.id }));
  } else {
    // Default: thread context only
    messages = await gatherThreadContext(client, session);
  }

  // Store snapshots for persistence
  const storage = await getStorage();
  await storage.messages.upsertBatch(messages);

  return messages;
}

/**
 * Download an attachment from Slack
 */
export async function downloadAttachment(
  botToken: string,
  attachment: AttachmentMeta,
  destPath: string
): Promise<string> {
  const response = await fetch(attachment.url, {
    headers: {
      Authorization: `Bearer ${botToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download attachment: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  await Bun.write(destPath, buffer);

  return destPath;
}
