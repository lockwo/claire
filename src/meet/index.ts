/**
 * Meet Module
 *
 * Orchestrates the Meet bot, trigger detection, and job dispatch.
 * Entry point for Google Meet integration.
 */

import { MeetBot, type CaptionEvent, type MeetBotConfig } from "./puppeteer/bot";
import { detectTrigger } from "./trigger/detector";
import { distillUtterance } from "./trigger/distiller";
import { CooldownManager } from "./trigger/cooldown";
import { dispatchMeetTrigger } from "./dispatch";
import { MeetBindingManager } from "./binding";
import { getConfig } from "../common/config";

export { MeetBindingManager } from "./binding";
export { MeetBot } from "./puppeteer/bot";

interface MeetControllerConfig {
  displayName?: string;
  headless?: boolean;
  minConfidence?: number;
  cooldownMs?: number;
}

// Track active bots by Meet URL
const activeBots = new Map<string, MeetBot>();

// Shared cooldown manager (across all bots)
const cooldown = new CooldownManager();

// Track stable threadTs per meeting URL (so all captions from same meeting use same session)
const meetingThreads = new Map<string, string>();

// Track recent captions for deduplication (speakerUrl -> {text, time})
const recentCaptions = new Map<string, { text: string; time: number }>();

// Track recently dispatched TASKS to prevent duplicate jobs for same distilled task
// Key: normalized task text, Value: timestamp
const recentTasks = new Map<string, number>();
const TASK_DEDUP_WINDOW_MS = 60_000; // 60 seconds - don't repeat same task

// Track processed transcript per meeting to extract only NEW content for trigger detection
// Key: meetUrl, Value: the full text that has already been scanned for triggers
const processedTranscripts = new Map<string, string>();

// Patterns that indicate incomplete sentences (don't process these)
const INCOMPLETE_PATTERNS = [
  /,\s*$/,           // Ends with comma
  /\s+(if|and|but|or|to|the|a|an|I|you|we|they|it|is|are|was|were|have|has|had|do|does|did|will|would|could|should|can|may|might|must)\s*$/i,
  /\s+I\s+(want|need|think|believe|hope|wish)\s*$/i,  // "I want", "I need" etc without object
  /\s+(want|need|going)\s+to\s*$/i,  // "want to", "need to", "going to" without verb
  /\s+you\s+to\s*$/i,  // "you to" without verb
  /^\s*okay[,.]?\s*$/i,  // Just "okay"
  /^\s*(okay|ok|hey|hi)[,.]?\s+\w+[,.]?\s*$/i,  // Just "okay/hi NAME"
];

/**
 * Check if caption text appears to be an incomplete sentence.
 */
function isIncomplete(text: string): boolean {
  const trimmed = text.trim();

  // Too short
  if (trimmed.length < 15) return true;

  // Matches incomplete patterns
  for (const pattern of INCOMPLETE_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  return false;
}

/**
 * Extract only the NEW portion of a transcript that hasn't been processed yet.
 * This is crucial because Google Meet shows cumulative captions - if someone said
 * "Claire" 5 minutes ago, it's still in the transcript and would trigger on every update.
 */
function extractNewContent(fullText: string, meetUrl: string): string | null {
  const previousText = processedTranscripts.get(meetUrl) || "";

  if (!previousText) {
    // First caption for this meeting - but don't process the ENTIRE backlog
    // Only look at the last ~150 chars to avoid triggering on old "Claire" mentions
    const recentPortion = fullText.length > 150 ? fullText.slice(-150) : fullText;
    processedTranscripts.set(meetUrl, fullText);
    return recentPortion;
  }

  // If the new text starts with the previous text, extract just the new part
  if (fullText.startsWith(previousText)) {
    const newContent = fullText.slice(previousText.length).trim();
    if (newContent.length >= 5) {
      processedTranscripts.set(meetUrl, fullText);
      return newContent;
    }
    return null; // Not enough new content
  }

  // Text changed in an unexpected way (editing, speaker change, etc.)
  // Find common prefix and extract new portion
  let commonLen = 0;
  const minLen = Math.min(previousText.length, fullText.length);
  for (let i = 0; i < minLen; i++) {
    if (previousText[i] === fullText[i]) {
      commonLen = i + 1;
    } else {
      break;
    }
  }

  if (commonLen > previousText.length * 0.7) {
    // Mostly the same, extract new portion
    const newContent = fullText.slice(commonLen).trim();
    processedTranscripts.set(meetUrl, fullText);
    if (newContent.length >= 5) {
      return newContent;
    }
  }

  // Significant change - treat last 150 chars as new
  processedTranscripts.set(meetUrl, fullText);
  return fullText.length > 150 ? fullText.slice(-150) : fullText;
}

/**
 * Normalize task text for deduplication.
 * Removes punctuation, lowercases, collapses whitespace.
 */
function normalizeTask(task: string): string {
  return task
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if we've already dispatched this task recently.
 * This catches duplicate triggers from cumulative transcripts.
 */
function isTaskDuplicate(task: string, meetUrl: string): boolean {
  const normalized = normalizeTask(task);
  const key = `${meetUrl}:${normalized}`;
  const lastTime = recentTasks.get(key);
  const now = Date.now();

  // Clean old entries
  for (const [k, t] of recentTasks) {
    if (now - t > TASK_DEDUP_WINDOW_MS) {
      recentTasks.delete(k);
    }
  }

  if (lastTime && now - lastTime < TASK_DEDUP_WINDOW_MS) {
    return true;
  }

  return false;
}

/**
 * Record a dispatched task.
 */
function recordTask(task: string, meetUrl: string): void {
  const normalized = normalizeTask(task);
  const key = `${meetUrl}:${normalized}`;
  recentTasks.set(key, Date.now());
}

/**
 * Check if this caption is too similar to a recent one (deduplication).
 */
function isDuplicate(text: string, speaker: string, meetUrl: string): boolean {
  const key = `${meetUrl}:${speaker}`;
  const recent = recentCaptions.get(key);
  const now = Date.now();

  if (!recent) {
    recentCaptions.set(key, { text, time: now });
    return false;
  }

  // If less than 3 seconds since last caption from same speaker...
  if (now - recent.time < 3000) {
    // Check if current text is a prefix of previous (going backwards - shouldn't happen)
    // or if previous text is a prefix of current (normal progression)
    if (recent.text.startsWith(text) || text.startsWith(recent.text)) {
      // This is just an update to the same utterance
      recentCaptions.set(key, { text, time: now });
      // Only process if this is significantly longer than previous
      if (text.length <= recent.text.length + 10) {
        return true;  // Not different enough
      }
    }
  }

  recentCaptions.set(key, { text, time: now });
  return false;
}

/**
 * Generate a stable threadTs for a meeting URL.
 * Uses the meeting code from the URL to ensure consistency.
 */
function getStableThreadTs(meetUrl: string): string {
  // Check cache first
  const cached = meetingThreads.get(meetUrl);
  if (cached) return cached;

  // Extract meeting code from URL (e.g., "abc-defg-hij" from "https://meet.google.com/abc-defg-hij?...")
  let meetCode = "unknown";
  try {
    const url = new URL(meetUrl);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const lastPart = pathParts[pathParts.length - 1];
    if (lastPart) {
      meetCode = lastPart;
    }
  } catch {
    // If URL parsing fails, hash the whole URL
    meetCode = meetUrl.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 20);
  }

  // Create stable threadTs using meeting code
  const threadTs = `meet-${meetCode}`;
  meetingThreads.set(meetUrl, threadTs);

  console.log(`[meet] Assigned stable threadTs "${threadTs}" for ${meetUrl}`);
  return threadTs;
}

export const MeetController = {
  /**
   * Start a Meet bot for a bound meeting.
   * The bot will join, enable captions, and begin monitoring for triggers.
   */
  async startBot(
    meetUrl: string,
    config: MeetControllerConfig = {}
  ): Promise<void> {
    // Check if bot already running
    if (activeBots.has(meetUrl)) {
      console.log(`[meet] Bot already running for ${meetUrl}`);
      return;
    }

    const appConfig = getConfig();

    const botConfig: MeetBotConfig = {
      meetUrl,
      displayName: config.displayName || appConfig.MEET_BOT_DISPLAY_NAME || "Claire Bot",
      headless: config.headless ?? (appConfig.MEET_BOT_HEADLESS ?? true),
    };

    const minConfidence = config.minConfidence ?? appConfig.MEET_MIN_TRIGGER_CONFIDENCE ?? 0.6;
    const recentContext: string[] = [];

    const bot = new MeetBot(botConfig);

    // Handle caption events
    bot.on("caption", async (event: CaptionEvent) => {
      // Only process final captions (complete utterances)
      if (!event.isFinal) {
        // Still track for context
        recentContext.push(`${event.speaker}: ${event.text}`);
        if (recentContext.length > 10) recentContext.shift();
        return;
      }

      console.log(`[meet] Caption (final): ${event.speaker}: ${event.text}`);

      // Stage 1: Fast keyword detection
      const trigger = detectTrigger(event.text, event.speaker);
      if (!trigger) {
        // Add to context anyway
        recentContext.push(`${event.speaker}: ${event.text}`);
        if (recentContext.length > 10) recentContext.shift();
        return;
      }

      console.log(
        `[meet] Trigger candidate (confidence: ${trigger.confidence.toFixed(2)}, keywords: ${trigger.matchedKeywords.join(", ")})`
      );

      // Check cooldown before expensive LLM call
      const { allowed, reason } = cooldown.shouldProcess(event.text, event.speaker);
      if (!allowed) {
        console.log(`[meet] Skipping: ${reason}`);
        return;
      }

      // Stage 2: LLM distillation for structured extraction
      console.log(`[meet] Distilling utterance...`);
      const distilled = await distillUtterance(
        event.text,
        event.speaker,
        recentContext
      );

      if (!distilled.isActionable) {
        console.log(`[meet] Not actionable: ${distilled.reasoning}`);
        return;
      }

      if (distilled.confidence < minConfidence) {
        console.log(
          `[meet] Below confidence threshold (${distilled.confidence.toFixed(2)} < ${minConfidence})`
        );
        return;
      }

      console.log(`[meet] Actionable task: ${distilled.task}`);
      console.log(`[meet] Operation: ${distilled.operation || "unknown"}`);

      // Check if we've already dispatched this exact task recently
      if (distilled.task && isTaskDuplicate(distilled.task, meetUrl)) {
        console.log(`[meet] Skipping duplicate task: "${distilled.task.slice(0, 50)}..."`);
        return;
      }

      // Record in cooldown before dispatch
      cooldown.record(event.text, event.speaker);

      // Dispatch job
      const result = await dispatchMeetTrigger(meetUrl, trigger, distilled);
      if (result.success) {
        console.log(`[meet] Dispatched job ${result.jobId}`);
        if (distilled.task) {
          recordTask(distilled.task, meetUrl);
        }
      } else {
        console.error(`[meet] Dispatch failed: ${result.error}`);
      }
    });

    bot.on("joined", () => {
      console.log(`[meet] Joined meeting: ${meetUrl}`);
    });

    bot.on("captionsEnabled", () => {
      console.log(`[meet] Captions enabled for: ${meetUrl}`);
    });

    bot.on("error", (err) => {
      console.error(`[meet] Bot error for ${meetUrl}:`, err);
    });

    bot.on("stopped", () => {
      activeBots.delete(meetUrl);
      console.log(`[meet] Bot stopped for ${meetUrl}`);
    });

    // Track and start
    activeBots.set(meetUrl, bot);
    await bot.start();
  },

  /**
   * Stop a Meet bot
   */
  async stopBot(meetUrl: string): Promise<void> {
    const bot = activeBots.get(meetUrl);
    if (bot) {
      await bot.stop();
      activeBots.delete(meetUrl);
    }
  },

  /**
   * Check if a bot is running for a URL
   */
  isRunning(meetUrl: string): boolean {
    return activeBots.has(meetUrl);
  },

  /**
   * Get count of active bots
   */
  getActiveCount(): number {
    return activeBots.size;
  },

  /**
   * Get list of active Meet URLs
   */
  getActiveUrls(): string[] {
    return Array.from(activeBots.keys());
  },

  /**
   * Stop all bots (for shutdown)
   */
  async stopAll(): Promise<void> {
    console.log(`[meet] Stopping all bots (${activeBots.size} active)`);
    const promises = Array.from(activeBots.values()).map((bot) => bot.stop());
    await Promise.all(promises);
    activeBots.clear();
  },

  /**
   * Get cooldown stats for debugging
   */
  getCooldownStats(): { triggerCount: number; speakerCount: number } {
    return cooldown.getStats();
  },

  /**
   * Process a caption from the Firefox extension.
   * This bypasses the Puppeteer bot and goes directly to trigger detection.
   */
  async processExtensionCaption(params: {
    meetUrl: string;
    speaker: string;
    text: string;
    timestamp: Date;
    channelId?: string;
    threadTs?: string;
    meetingContext?: string;
  }): Promise<void> {
    const appConfig = getConfig();
    const minConfidence = appConfig.MEET_MIN_TRIGGER_CONFIDENCE ?? 0.6;

    console.log(`[meet-ext] Caption received (${params.text.length} chars)`);
    console.log(`[meet-ext] Text: "${params.text.slice(0, 100)}${params.text.length > 100 ? '...' : ''}"`);
    console.log(`[meet-ext] Config: channelId="${params.channelId || ''}", threadTs="${params.threadTs || ''}"`);

    // The extension already extracts "new" content from cumulative transcript
    // and debounces for 2 seconds. Trust what it sends - don't double-process.
    const captionText = params.text.trim();

    if (!captionText || captionText.length < 15) {
      console.log(`[meet-ext] Caption too short (${captionText.length} chars)`);
      return;
    }

    // Pre-filter: Check if this looks like an incomplete sentence
    if (isIncomplete(captionText)) {
      console.log(`[meet-ext] Skipping incomplete: "${captionText.slice(0, 50)}..."`);
      return;
    }

    // Pre-filter: Check for duplicates/similar recent captions
    if (isDuplicate(captionText, params.speaker, params.meetUrl)) {
      console.log(`[meet-ext] Skipping duplicate/similar caption`);
      return;
    }

    // Stage 1: Fast keyword detection
    const trigger = detectTrigger(captionText, params.speaker);
    if (!trigger) {
      return;
    }

    console.log(
      `[meet-ext] Trigger candidate (confidence: ${trigger.confidence.toFixed(2)}, keywords: ${trigger.matchedKeywords.join(", ")})`
    );

    // Check cooldown before expensive LLM call
    const { allowed, reason } = cooldown.shouldProcess(captionText, params.speaker);
    if (!allowed) {
      console.log(`[meet-ext] Skipping: ${reason}`);
      return;
    }

    // Stage 2: LLM distillation for structured extraction
    console.log(`[meet-ext] Distilling utterance...`);
    const distilled = await distillUtterance(captionText, params.speaker, []);

    if (!distilled.isActionable) {
      console.log(`[meet-ext] Not actionable: ${distilled.reasoning}`);
      return;
    }

    if (distilled.confidence < minConfidence) {
      console.log(
        `[meet-ext] Below confidence threshold (${distilled.confidence.toFixed(2)} < ${minConfidence})`
      );
      return;
    }

    console.log(`[meet-ext] Actionable task: ${distilled.task}`);

    // Check if we've already dispatched this exact task recently
    // This catches duplicates from cumulative transcripts
    if (distilled.task && isTaskDuplicate(distilled.task, params.meetUrl)) {
      console.log(`[meet-ext] Skipping duplicate task: "${distilled.task.slice(0, 50)}..."`);
      return;
    }

    // Record in cooldown before dispatch
    cooldown.record(captionText, params.speaker);

    // Dispatch job - use provided channel/thread or resolve from binding
    // Note: channelId alone is enough - we'll create a synthetic thread if threadTs not provided
    if (!params.channelId) {
      console.error(`[meet-ext] No channelId configured in extension. Please configure a Slack channel ID in the extension popup.`);
      return;
    }

    // Use stable threadTs for this meeting URL (so all captions from same meeting use same session)
    const threadTs = params.threadTs || getStableThreadTs(params.meetUrl);

    const result = await dispatchMeetTrigger(
      params.meetUrl,
      trigger,
      distilled,
      { channelId: params.channelId, threadTs },
      params.meetingContext
    );

    if (result.success) {
      console.log(`[meet-ext] Dispatched job ${result.jobId}`);
      // Record the task to prevent duplicate dispatch
      if (distilled.task) {
        recordTask(distilled.task, params.meetUrl);
      }
    } else {
      console.error(`[meet-ext] Dispatch failed: ${result.error}`);
    }
  },
};
