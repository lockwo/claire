/**
 * Streaming Message Handler
 *
 * Handles streaming LLM responses to Slack with batched updates
 * to avoid rate limits while providing real-time feedback.
 */

import type { WebClient } from "@slack/web-api";
import { updateMessageWithRetry, postMessageWithRetry } from "../common/slack-retry";
import { logger } from "../common/logger";

export interface StreamingMessageConfig {
  client: WebClient;
  channelId: string;
  threadTs: string;
  /** Minimum interval between Slack updates (ms) */
  updateIntervalMs?: number;
  /** Show typing indicator */
  showTyping?: boolean;
}

export class StreamingMessage {
  private client: WebClient;
  private channelId: string;
  private threadTs: string;
  private messageTs: string | null = null;
  private buffer: string = "";
  private lastUpdate: number = 0;
  private updateIntervalMs: number;
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private isFinished: boolean = false;
  private currentToolName: string | null = null;

  constructor(config: StreamingMessageConfig) {
    this.client = config.client;
    this.channelId = config.channelId;
    this.threadTs = config.threadTs;
    this.updateIntervalMs = config.updateIntervalMs ?? 1000; // Default 1 second between updates
  }

  /**
   * Start the streaming message with an initial placeholder
   */
  async start(): Promise<void> {
    try {
      const result = await postMessageWithRetry(this.client, {
        channel: this.channelId,
        thread_ts: this.threadTs,
        text: "_Thinking..._",
      });

      this.messageTs = result.ts || null;
      this.lastUpdate = Date.now();
    } catch (err) {
      logger.error("Failed to start streaming message", { error: (err as Error).message });
    }
  }

  /**
   * Append text to the buffer and schedule an update
   */
  appendText(text: string): void {
    if (this.isFinished) return;

    this.buffer += text;
    this.scheduleUpdate();
  }

  /**
   * Show that a tool is being executed
   */
  showToolExecution(toolName: string): void {
    if (this.isFinished) return;

    this.currentToolName = toolName;
    this.scheduleUpdate();
  }

  /**
   * Clear tool execution indicator
   */
  clearToolExecution(): void {
    this.currentToolName = null;
    this.scheduleUpdate();
  }

  /**
   * Schedule a batched update to Slack
   */
  private scheduleUpdate(): void {
    // Already have an update pending
    if (this.updateTimer) return;

    const timeSinceLastUpdate = Date.now() - this.lastUpdate;
    const delay = Math.max(0, this.updateIntervalMs - timeSinceLastUpdate);

    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      this.flushUpdate();
    }, delay);
  }

  /**
   * Flush pending updates to Slack
   */
  private async flushUpdate(): Promise<void> {
    if (!this.messageTs) return;

    let text = this.buffer || "_Thinking..._";

    // Add tool execution indicator
    if (this.currentToolName) {
      text += `\n\n_Running: ${this.currentToolName}..._`;
    }

    // Truncate if too long for a single message update
    if (text.length > 3900) {
      text = text.slice(-3900);
      text = "...\n" + text;
    }

    try {
      await updateMessageWithRetry(this.client, {
        channel: this.channelId,
        ts: this.messageTs,
        text,
      });
      this.lastUpdate = Date.now();
    } catch (err) {
      logger.warn("Failed to update streaming message", { error: (err as Error).message });
    }
  }

  /**
   * Finish the streaming message with final content
   */
  async finish(finalText?: string): Promise<string | null> {
    this.isFinished = true;

    // Cancel any pending update
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }

    if (!this.messageTs) return null;

    const text = finalText || this.buffer || "Done.";

    try {
      await updateMessageWithRetry(this.client, {
        channel: this.channelId,
        ts: this.messageTs,
        text: text.slice(0, 4000), // Slack limit
      });
    } catch (err) {
      logger.error("Failed to finish streaming message", { error: (err as Error).message });
    }

    return this.messageTs;
  }

  /**
   * Cancel the streaming message (delete it)
   */
  async cancel(): Promise<void> {
    this.isFinished = true;

    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }

    if (!this.messageTs) return;

    try {
      await this.client.chat.delete({
        channel: this.channelId,
        ts: this.messageTs,
      });
    } catch (err) {
      // May not have permission to delete
      logger.warn("Failed to cancel streaming message", { error: (err as Error).message });
    }
  }

  /**
   * Get the current message timestamp
   */
  getMessageTs(): string | null {
    return this.messageTs;
  }

  /**
   * Get the current buffer content
   */
  getContent(): string {
    return this.buffer;
  }
}

/**
 * Helper to convert GitHub markdown to Slack mrkdwn
 */
export function convertToSlackMarkdown(text: string): string {
  return text
    // Convert **bold** to *bold*
    .replace(/\*\*([^*]+)\*\*/g, "*$1*")
    // Convert __bold__ to *bold*
    .replace(/__([^_]+)__/g, "*$1*")
    // Convert ~~strikethrough~~ to ~strikethrough~
    .replace(/~~([^~]+)~~/g, "~$1~")
    // Convert [text](url) to <url|text>
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
    // Convert headers to bold
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
}
