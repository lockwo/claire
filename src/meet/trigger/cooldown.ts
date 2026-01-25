/**
 * Cooldown Manager
 *
 * Prevents duplicate triggers and implements rate limiting.
 * Uses fuzzy hashing for similar request detection.
 */

import crypto from "crypto";

interface CooldownEntry {
  hash: string;
  timestamp: number;
  speaker: string;
}

const DEFAULT_COOLDOWN_MS = 15_000; // 15 seconds between similar tasks
const MAX_REQUESTS_PER_MINUTE = 10; // More generous now that we only process new content
const CLEANUP_INTERVAL_MS = 120_000; // Clean up old entries every 2 minutes

export class CooldownManager {
  private recentTriggers: CooldownEntry[] = [];
  private requestCounts = new Map<string, number[]>(); // speaker -> timestamps
  private cooldownMs: number;

  constructor(cooldownMs = DEFAULT_COOLDOWN_MS) {
    this.cooldownMs = cooldownMs;
  }

  /**
   * Check if a trigger should be processed or skipped.
   * Returns allowed=true if processing should proceed.
   */
  shouldProcess(
    text: string,
    speaker: string
  ): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const hash = this.hashText(text);

    // Clean old entries periodically
    this.cleanup(now);

    // Check for duplicate (fuzzy match within cooldown period)
    const duplicate = this.recentTriggers.find(
      (t) => t.hash === hash && now - t.timestamp < this.cooldownMs
    );
    if (duplicate) {
      return {
        allowed: false,
        reason: `Duplicate trigger within ${this.cooldownMs / 1000}s cooldown`,
      };
    }

    // Check rate limit per speaker
    const speakerRequests = this.requestCounts.get(speaker) || [];
    const recentRequests = speakerRequests.filter((ts) => now - ts < 60_000);
    if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
      return {
        allowed: false,
        reason: `Rate limit exceeded for speaker ${speaker} (max ${MAX_REQUESTS_PER_MINUTE}/min)`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a processed trigger.
   * Call this after successfully dispatching a job.
   */
  record(text: string, speaker: string): void {
    const now = Date.now();
    const hash = this.hashText(text);

    this.recentTriggers.push({ hash, timestamp: now, speaker });

    const speakerRequests = this.requestCounts.get(speaker) || [];
    speakerRequests.push(now);
    this.requestCounts.set(speaker, speakerRequests);
  }

  /**
   * Create a fuzzy hash of the text for duplicate detection.
   * Normalizes text to handle minor variations.
   */
  private hashText(text: string): string {
    // Normalize: lowercase, remove punctuation, collapse whitespace
    const normalized = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return crypto
      .createHash("sha256")
      .update(normalized)
      .digest("hex")
      .slice(0, 16);
  }

  /**
   * Clean up old entries to prevent memory growth.
   */
  private cleanup(now: number): void {
    // Remove old triggers
    this.recentTriggers = this.recentTriggers.filter(
      (t) => now - t.timestamp < this.cooldownMs * 2
    );

    // Clean old rate limit entries
    for (const [speaker, timestamps] of this.requestCounts) {
      const recent = timestamps.filter((ts) => now - ts < CLEANUP_INTERVAL_MS);
      if (recent.length === 0) {
        this.requestCounts.delete(speaker);
      } else {
        this.requestCounts.set(speaker, recent);
      }
    }
  }

  /**
   * Reset all cooldowns (useful for testing).
   */
  reset(): void {
    this.recentTriggers = [];
    this.requestCounts.clear();
  }

  /**
   * Get current stats for debugging.
   */
  getStats(): { triggerCount: number; speakerCount: number } {
    return {
      triggerCount: this.recentTriggers.length,
      speakerCount: this.requestCounts.size,
    };
  }
}
