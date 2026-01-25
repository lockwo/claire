/**
 * Job Scheduler
 *
 * Manages worker execution for sessions. Ensures one job runs at a time
 * per session, handles abort/stop signals, and schedules queued jobs.
 */

import type { WebClient } from "@slack/web-api";
import type { Session, Job, MessageSnapshot } from "../common/schema";
import { SessionManager, JobManager } from "../session";
import { gatherContext } from "./context";
import { postToThread, updateReaction, uploadToThread } from "./slack";
import { runAgentLoop, AgentResult } from "../worker/agent";
import { Bus, Events } from "../common/bus";
import { getStorage } from "../storage";
import { getConfig } from "../common/config";
import { processAllAttachments } from "../attachments";
import { formatErrorForSlack, categorizeError, ErrorCategory } from "../common/errors";
import { logger } from "../common/logger";
import { updateProfileFromInteraction } from "../session/profiles";
import { extractLatex, compileLatexToPdf, cleanupLatexFiles } from "../common/latex";

interface ActiveWorker {
  sessionId: string;
  jobId: string;
  abort: AbortController;
  startTime: number;
}

// Track active workers by session ID
const activeWorkers = new Map<string, ActiveWorker>();

// Idle timers for cleanup
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const Scheduler = {
  client: null as WebClient | null,

  /**
   * Initialize scheduler with Slack client
   */
  init(client: WebClient) {
    this.client = client;

    // Listen for abort events
    Bus.subscribe(Events["session.abort"], async ({ sessionId }) => {
      this.abort(sessionId);
    });

    // Listen for stop events
    Bus.subscribe(Events["session.stop"], async ({ sessionId }) => {
      this.stop(sessionId);
    });

    // Listen for new jobs to schedule
    Bus.subscribe(Events["job.queued"], async ({ sessionId }) => {
      await this.scheduleNext(sessionId);
    });

    // Listen for job completion to schedule next
    Bus.subscribe(Events["job.completed"], async ({ sessionId }) => {
      await this.scheduleNext(sessionId);
    });

    Bus.subscribe(Events["job.failed"], async ({ sessionId }) => {
      await this.scheduleNext(sessionId);
    });
  },

  /**
   * Try to schedule the next queued job for a session
   */
  async scheduleNext(sessionId: string): Promise<void> {
    // Check if worker already running
    if (activeWorkers.has(sessionId)) {
      console.log(`[scheduler] Session ${sessionId} already has active worker`);
      return;
    }

    // Get next queued job
    const job = await JobManager.getNext(sessionId);
    if (!job) {
      console.log(`[scheduler] No queued jobs for session ${sessionId}`);
      return;
    }

    console.log(`[scheduler] Starting job ${job.id} for session ${sessionId}`);

    // Start worker
    const abort = new AbortController();
    activeWorkers.set(sessionId, {
      sessionId,
      jobId: job.id,
      abort,
      startTime: Date.now(),
    });

    // Clear any idle timer
    const timer = idleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      idleTimers.delete(sessionId);
    }

    // Run worker async
    this.runWorker(sessionId, job, abort).catch((err) => {
      console.error(`[scheduler] Worker error for session ${sessionId}:`, err);
    });
  },

  /**
   * Run a worker for a job
   */
  async runWorker(sessionId: string, job: Job, abortController: AbortController): Promise<void> {
    const config = getConfig();
    const storage = await getStorage();

    if (!this.client) {
      throw new Error("Scheduler not initialized with Slack client");
    }

    // Check if this is a Meet-sourced job (synthetic thread)
    const isMeetJob = job.promptMessageTs.startsWith("meet-");

    try {
      // Mark job as started
      await JobManager.start(job.id);

      // Update session status
      await SessionManager.setStatus(sessionId, "running");

      // Get session
      let session = await SessionManager.findById(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // For Meet jobs with synthetic threadTs, we'll post directly to channel (no thread)
      // The session.threadTs will be used for tracking but messages go to channel root

      // Update reaction to show running (skip for Meet jobs - no original message)
      if (!isMeetJob) {
        await updateReaction(this.client, session.channelId, job.promptMessageTs, "eyes", "hourglass_flowing_sand");
      }

      // Gather context (for Meet jobs, create synthetic context with just the prompt)
      let messages: MessageSnapshot[] = [];
      if (isMeetJob) {
        // Create a synthetic message from the Meet prompt
        messages = [{
          id: `meet-msg-${Date.now()}`,
          sessionId: session.id,
          ts: job.promptMessageTs,
          userId: job.userId,
          text: job.promptText,
          attachments: [],
        }];
      } else {
        messages = await gatherContext(this.client, session);
      }
      console.log(`[scheduler] Gathered ${messages.length} messages for context`);

      // Process attachments
      const workDir = `/tmp/claire/${sessionId}`;
      const processedAttachments = await processAllAttachments(
        config.SLACK_BOT_TOKEN,
        messages,
        workDir
      );

      // Update messages with processed attachment data
      const enrichedMessages: MessageSnapshot[] = messages.map((msg) => ({
        ...msg,
        attachments: msg.attachments.map((att) => processedAttachments.get(att.id) || att),
      }));

      // Log attachment details for debugging
      for (const [id, att] of processedAttachments) {
        console.log(`[scheduler] Attachment: ${att.name} (${att.mimetype}) - extracted ${att.extractedText?.length || 0} chars`);
      }
      console.log(`[scheduler] Processed ${processedAttachments.size} attachments`);

      // Set up max runtime timeout
      const runtimeTimeout = setTimeout(() => {
        console.log(`[scheduler] Job ${job.id} exceeded max runtime, aborting`);
        abortController.abort();
      }, config.WORKER_MAX_RUNTIME_MS);

      try {
        // Run agent loop
        const result = await runAgentLoop({
          session,
          job,
          messages: enrichedMessages,
          abort: abortController.signal,
          slackClient: this.client,
        });

        // Clear runtime timeout
        clearTimeout(runtimeTimeout);

        // Mark job completed
        await JobManager.complete(job.id, result.summary);

        // Post results to Slack
        await this.postResults(session, job, result, isMeetJob);

        // Update reaction to show success (skip for Meet jobs)
        if (!isMeetJob) {
          await updateReaction(this.client, session.channelId, job.promptMessageTs, "hourglass_flowing_sand", "white_check_mark");
        }

        // Update user profile based on this interaction (async, don't await)
        updateProfileFromInteraction(job.userId, job.promptText, result.summary).catch(() => {
          // Silently ignore profile update failures
        });

      } catch (err: any) {
        clearTimeout(runtimeTimeout);

        if (err.name === "AbortError" || abortController.signal.aborted) {
          await JobManager.fail(job.id, "Aborted by user");
          if (!isMeetJob) {
            await updateReaction(this.client, session.channelId, job.promptMessageTs, "hourglass_flowing_sand", "octagonal_sign");
          }
        } else {
          throw err;
        }
      }

    } catch (err: any) {
      const claireError = categorizeError(err);
      logger.error(`Job ${job.id} failed`, {
        category: claireError.category,
        message: claireError.message,
        sessionId,
      });

      // Mark job failed with categorized message
      await JobManager.fail(job.id, claireError.userMessage);

      // Get session for posting error
      const session = await SessionManager.findById(sessionId);
      if (session && this.client) {
        // Use different emoji based on error type (skip for Meet jobs)
        if (!isMeetJob) {
          const errorEmoji = claireError.category === ErrorCategory.RATE_LIMIT
            ? "hourglass"
            : claireError.retryable
            ? "warning"
            : "x";

          await updateReaction(this.client, session.channelId, job.promptMessageTs, "hourglass_flowing_sand", errorEmoji);
        }

        // Post user-friendly error message (to channel for Meet jobs, to thread otherwise)
        if (isMeetJob) {
          await this.client.chat.postMessage({
            channel: session.channelId,
            text: formatErrorForSlack(err),
          });
        } else {
          await postToThread(
            this.client,
            session.channelId,
            session.threadTs,
            formatErrorForSlack(err)
          );
        }
      }

    } finally {
      // Clean up
      activeWorkers.delete(sessionId);

      // Update session status
      await SessionManager.setStatus(sessionId, "idle");

      // Set idle timer for cleanup
      const timer = setTimeout(() => {
        idleTimers.delete(sessionId);
        console.log(`[scheduler] Session ${sessionId} idle timeout`);
      }, config.WORKER_IDLE_TIMEOUT_MS);
      idleTimers.set(sessionId, timer);

      // Schedule next job if any
      await this.scheduleNext(sessionId);
    }
  },

  /**
   * Convert GitHub-flavored markdown to Slack mrkdwn format
   */
  convertToSlackMarkdown(text: string): string {
    return text
      // Convert **bold** to *bold* (do this first to avoid conflicts)
      .replace(/\*\*([^*]+)\*\*/g, "*$1*")
      // Convert __bold__ to *bold*
      .replace(/__([^_]+)__/g, "*$1*")
      // Convert ~~strikethrough~~ to ~strikethrough~
      .replace(/~~([^~]+)~~/g, "~$1~")
      // Convert [text](url) to <url|text>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
      // Convert headers (### Header -> *Header*)
      .replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
  },

  /**
   * Post results to Slack
   */
  async postResults(session: Session, job: Job, result: AgentResult, isMeetJob: boolean = false): Promise<void> {
    if (!this.client) return;

    const storage = await getStorage();
    const workDir = `/tmp/claire/${session.id}`;
    const MAX_BLOCK_TEXT = 2900; // Slack limit is 3000, leave some buffer

    // Check if response contains substantial LaTeX that should be rendered
    const latex = extractLatex(result.summary);
    if (latex) {
      console.log(`[scheduler] Detected LaTeX in response, rendering PDF...`);
      const pdfPath = await compileLatexToPdf(latex, workDir, `response_${job.id.slice(0, 8)}`);
      if (pdfPath) {
        try {
          if (isMeetJob) {
            await this.client.files.uploadV2({
              channel_id: session.channelId,
              file: pdfPath,
              filename: "response.pdf",
              initial_comment: "Here's the rendered LaTeX:",
            });
          } else {
            await uploadToThread(
              this.client,
              session.channelId,
              session.threadTs,
              pdfPath,
              "response.pdf",
              "Here's the rendered LaTeX:"
            );
          }
          console.log(`[scheduler] Uploaded rendered PDF`);
          // Clean up temp files
          await cleanupLatexFiles(workDir, `response_${job.id.slice(0, 8)}`);
        } catch (err) {
          console.error(`[scheduler] Failed to upload rendered PDF:`, err);
        }
      }
    }

    // Split long text into chunks for Slack blocks
    const splitIntoChunks = (text: string, maxLen: number): string[] => {
      if (text.length <= maxLen) return [text];

      const chunks: string[] = [];
      let remaining = text;

      while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
          chunks.push(remaining);
          break;
        }

        // Find a good break point (newline or space)
        let breakPoint = remaining.lastIndexOf("\n", maxLen);
        if (breakPoint < maxLen / 2) {
          breakPoint = remaining.lastIndexOf(" ", maxLen);
        }
        if (breakPoint < maxLen / 2) {
          breakPoint = maxLen; // Force break if no good point
        }

        chunks.push(remaining.slice(0, breakPoint));
        remaining = remaining.slice(breakPoint).trim();
      }

      return chunks;
    };

    // Build message blocks
    const blocks: any[] = [];

    // Convert markdown and split summary into multiple blocks if needed
    const slackSummary = this.convertToSlackMarkdown(result.summary);
    const summaryChunks = splitIntoChunks(slackSummary, MAX_BLOCK_TEXT);
    for (const chunk of summaryChunks) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: chunk,
        },
      });
    }

    // Add git info if available
    const gitActions = await storage.gitActions.findByJob(job.id);
    if (gitActions.length > 0) {
      const action = gitActions[0]!;
      const gitText = [
        "*Git Changes:*",
        `• Repo: \`${action.repo}\``,
        `• Branch: \`${action.branch}\``,
        action.commits.length > 0
          ? `• Commits: ${action.commits.map((c) => `\`${c.slice(0, 7)}\``).join(", ")}`
          : null,
        action.prUrl ? `• PR: ${action.prUrl}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: gitText,
        },
      });
    }

    // Post main message (to channel for Meet jobs, to thread otherwise)
    if (isMeetJob) {
      await this.client.chat.postMessage({
        channel: session.channelId,
        text: slackSummary.slice(0, 4000),
        blocks,
      });
    } else {
      await postToThread(this.client, session.channelId, session.threadTs, slackSummary.slice(0, 4000), blocks);
    }

    // Upload artifacts
    const artifacts = await storage.artifacts.findByJob(job.id);
    for (const artifact of artifacts) {
      if (artifact.type === "image" || artifact.type === "pdf") {
        try {
          // For Meet jobs, upload to channel; otherwise to thread
          const fileId = isMeetJob
            ? await this.client.files.uploadV2({
                channel_id: session.channelId,
                file: artifact.storageKey,
                filename: artifact.filename,
                initial_comment: `Output: ${artifact.filename}`,
              }).then(r => (r as any).file?.id)
            : await uploadToThread(
                this.client,
                session.channelId,
                session.threadTs,
                artifact.storageKey,
                artifact.filename,
                `Output: ${artifact.filename}`
              );

          // Update artifact with Slack file ID
          if (fileId) {
            // Would update artifact here if we had that method
          }
        } catch (err) {
          console.error(`[scheduler] Failed to upload artifact ${artifact.filename}:`, err);
        }
      }
    }
  },

  /**
   * Abort a running worker
   */
  abort(sessionId: string): void {
    const worker = activeWorkers.get(sessionId);
    if (worker) {
      console.log(`[scheduler] Aborting worker for session ${sessionId}`);
      worker.abort.abort();
    }
  },

  /**
   * Request graceful stop (same as abort for now)
   */
  stop(sessionId: string): void {
    this.abort(sessionId);
  },

  /**
   * Check if a session has an active worker
   */
  isRunning(sessionId: string): boolean {
    return activeWorkers.has(sessionId);
  },

  /**
   * Get all active workers
   */
  getActiveWorkers(): ActiveWorker[] {
    return Array.from(activeWorkers.values());
  },
};
