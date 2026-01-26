/**
 * Meet Binding Manager
 *
 * Maps Google Meet URLs to Slack threads for output routing.
 * Bindings have optional TTL for automatic cleanup.
 */

import type { MeetBinding } from "../common/schema";
import { getStorage } from "../storage";

/**
 * Normalize a Meet URL for consistent matching.
 * Strips query params and trailing slashes.
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Meet URLs: meet.google.com/xxx-yyyy-zzz
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, "");
  } catch {
    return url;
  }
}

export const MeetBindingManager = {
  /**
   * Create a new binding between a Meet URL and Slack thread
   */
  async create(params: {
    meetUrl: string;
    channelId: string;
    threadTs: string;
    createdBy: string;
    ttlHours?: number;
  }): Promise<MeetBinding> {
    const storage = await getStorage();
    const normalizedUrl = normalizeUrl(params.meetUrl);

    const binding: MeetBinding = {
      meetUrl: normalizedUrl,
      channelId: params.channelId,
      threadTs: params.threadTs,
      createdBy: params.createdBy,
      createdAt: new Date(),
      expiresAt: params.ttlHours
        ? new Date(Date.now() + params.ttlHours * 60 * 60 * 1000)
        : undefined,
    };

    return storage.meetBindings.create(binding);
  },

  /**
   * Resolve a Meet URL to its bound Slack thread.
   * Returns null if no binding exists or if expired.
   */
  async resolve(meetUrl: string): Promise<MeetBinding | null> {
    const storage = await getStorage();
    const normalizedUrl = normalizeUrl(meetUrl);
    const binding = await storage.meetBindings.findByMeetUrl(normalizedUrl);

    if (!binding) return null;

    // Check expiration
    if (binding.expiresAt && binding.expiresAt < new Date()) {
      await storage.meetBindings.delete(normalizedUrl);
      return null;
    }

    return binding;
  },

  /**
   * Remove a binding
   */
  async remove(meetUrl: string): Promise<void> {
    const storage = await getStorage();
    await storage.meetBindings.delete(normalizeUrl(meetUrl));
  },

  /**
   * List all active bindings
   */
  async list(): Promise<MeetBinding[]> {
    const storage = await getStorage();
    const bindings = await storage.meetBindings.list();

    // Filter out expired bindings
    const now = new Date();
    const active: MeetBinding[] = [];

    for (const binding of bindings) {
      if (binding.expiresAt && binding.expiresAt < now) {
        // Clean up expired binding
        await storage.meetBindings.delete(binding.meetUrl);
      } else {
        active.push(binding);
      }
    }

    return active;
  },

  /**
   * Validate a Meet URL format
   */
  isValidMeetUrl(url: string): boolean {
    const normalized = this.normalizeInputUrl(url);
    try {
      const parsed = new URL(normalized);
      return parsed.host === "meet.google.com" && parsed.pathname.length > 1;
    } catch {
      return false;
    }
  },

  /**
   * Normalize user input URL (add https:// if missing)
   */
  normalizeInputUrl(url: string): string {
    let normalized = url.trim();
    // Add protocol if missing
    if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
      normalized = "https://" + normalized;
    }
    return normalized;
  },
};
