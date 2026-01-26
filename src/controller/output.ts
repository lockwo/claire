/**
 * Output Handler
 *
 * Abstracts output operations for different input sources.
 * Meet jobs post to bound Slack threads but skip message reactions.
 */

import type { WebClient } from "@slack/web-api";
import type { Session, Job } from "../common/schema";
import { postToThread, updateReaction, uploadToThread } from "./slack";

export interface OutputContext {
  session: Session;
  job: Job;
}

export interface OutputHandler {
  /** Post a text message to the thread */
  postMessage(text: string, blocks?: unknown[]): Promise<void>;

  /** Update status reaction on the prompt message */
  updateStatus(oldEmoji: string, newEmoji: string): Promise<void>;

  /** Upload a file to the thread */
  uploadFile(filePath: string, filename: string, comment?: string): Promise<string | undefined>;

  /** Whether reactions are supported (false for Meet synthetic messages) */
  supportsReactions: boolean;
}

/**
 * Create an output handler for a job.
 * Handles both Slack and Meet sources.
 */
export function createOutputHandler(
  client: WebClient,
  ctx: OutputContext
): OutputHandler {
  const { session, job } = ctx;

  // Meet jobs have synthetic message timestamps - can't add reactions
  const isMeetSource = job.source === "meet" || job.promptMessageTs.startsWith("meet-");
  const supportsReactions = !isMeetSource;

  return {
    supportsReactions,

    async postMessage(text: string, blocks?: unknown[]): Promise<void> {
      await postToThread(
        client,
        session.channelId,
        session.threadTs,
        text,
        blocks
      );
    },

    async updateStatus(oldEmoji: string, newEmoji: string): Promise<void> {
      if (!supportsReactions) return;

      await updateReaction(
        client,
        session.channelId,
        job.promptMessageTs,
        oldEmoji,
        newEmoji
      );
    },

    async uploadFile(
      filePath: string,
      filename: string,
      comment?: string
    ): Promise<string | undefined> {
      return uploadToThread(
        client,
        session.channelId,
        session.threadTs,
        filePath,
        filename,
        comment
      );
    },
  };
}
