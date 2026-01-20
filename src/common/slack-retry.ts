/**
 * Slack API Retry Wrapper
 *
 * Wraps Slack Web API calls with retry logic for rate limits and transient errors.
 */

import type { WebClient } from "@slack/web-api";
import { retry, isRetryableError, getErrorStatus, getRetryAfterMs } from "./retry";
import { logger } from "./logger";

/**
 * Check if a Slack error is retryable
 */
function isSlackRetryable(error: unknown): boolean {
  // Use general retryable check first
  if (isRetryableError(error)) return true;

  // Check for Slack-specific retryable errors
  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;

    // Slack rate limit error code
    if (err.code === "slack_webapi_rate_limited_error") {
      return true;
    }

    // Platform errors that are transient
    if (err.code === "slack_webapi_platform_error") {
      const data = err.data as Record<string, unknown> | undefined;
      if (data?.error === "ratelimited") {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extract retry-after from Slack errors
 */
function getSlackRetryAfter(error: unknown): number | null {
  // Try standard retry-after first
  const standard = getRetryAfterMs(error);
  if (standard !== null) return standard;

  // Check Slack-specific retry_after field
  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;
    if (typeof err.retryAfter === "number") {
      return err.retryAfter * 1000;
    }
    const data = err.data as Record<string, unknown> | undefined;
    if (data && typeof data.retry_after === "number") {
      return data.retry_after * 1000;
    }
  }

  return null;
}

export interface SlackRetryOptions {
  maxRetries?: number;
  context?: string;
}

/**
 * Post message with retry
 */
export async function postMessageWithRetry(
  client: WebClient,
  params: Parameters<WebClient["chat"]["postMessage"]>[0],
  options: SlackRetryOptions = {}
): Promise<Awaited<ReturnType<WebClient["chat"]["postMessage"]>>> {
  const { maxRetries = 3, context = "postMessage" } = options;

  const result = await retry(
    () => client.chat.postMessage(params),
    {
      maxRetries,
      context: `Slack ${context}`,
      isRetryable: isSlackRetryable,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
    }
  );

  if (!result.success) {
    throw result.error;
  }

  return result.data!;
}

/**
 * Update message with retry
 */
export async function updateMessageWithRetry(
  client: WebClient,
  params: Parameters<WebClient["chat"]["update"]>[0],
  options: SlackRetryOptions = {}
): Promise<Awaited<ReturnType<WebClient["chat"]["update"]>>> {
  const { maxRetries = 3, context = "updateMessage" } = options;

  const result = await retry(
    () => client.chat.update(params),
    {
      maxRetries,
      context: `Slack ${context}`,
      isRetryable: isSlackRetryable,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
    }
  );

  if (!result.success) {
    throw result.error;
  }

  return result.data!;
}

/**
 * Add reaction with retry
 */
export async function addReactionWithRetry(
  client: WebClient,
  params: Parameters<WebClient["reactions"]["add"]>[0],
  options: SlackRetryOptions = {}
): Promise<Awaited<ReturnType<WebClient["reactions"]["add"]>>> {
  const { maxRetries = 2, context = "addReaction" } = options;

  const result = await retry(
    () => client.reactions.add(params),
    {
      maxRetries,
      context: `Slack ${context}`,
      isRetryable: (err) => {
        // Don't retry if reaction already exists
        if (err && typeof err === "object") {
          const data = (err as any).data;
          if (data?.error === "already_reacted") {
            return false;
          }
        }
        return isSlackRetryable(err);
      },
      initialDelayMs: 500,
      maxDelayMs: 5000,
    }
  );

  if (!result.success) {
    // Silently ignore "already_reacted" errors
    const data = (result.error as any)?.data;
    if (data?.error === "already_reacted") {
      return { ok: true } as any;
    }
    throw result.error;
  }

  return result.data!;
}

/**
 * Remove reaction with retry
 */
export async function removeReactionWithRetry(
  client: WebClient,
  params: Parameters<WebClient["reactions"]["remove"]>[0],
  options: SlackRetryOptions = {}
): Promise<Awaited<ReturnType<WebClient["reactions"]["remove"]>>> {
  const { maxRetries = 2, context = "removeReaction" } = options;

  const result = await retry(
    () => client.reactions.remove(params),
    {
      maxRetries,
      context: `Slack ${context}`,
      isRetryable: (err) => {
        // Don't retry if reaction doesn't exist
        if (err && typeof err === "object") {
          const data = (err as any).data;
          if (data?.error === "no_reaction") {
            return false;
          }
        }
        return isSlackRetryable(err);
      },
      initialDelayMs: 500,
      maxDelayMs: 5000,
    }
  );

  if (!result.success) {
    // Silently ignore "no_reaction" errors
    const data = (result.error as any)?.data;
    if (data?.error === "no_reaction") {
      return { ok: true } as any;
    }
    throw result.error;
  }

  return result.data!;
}

/**
 * Upload file with retry
 */
export async function uploadFileWithRetry(
  client: WebClient,
  params: Parameters<WebClient["files"]["uploadV2"]>[0],
  options: SlackRetryOptions = {}
): Promise<Awaited<ReturnType<WebClient["files"]["uploadV2"]>>> {
  const { maxRetries = 3, context = "uploadFile" } = options;

  const result = await retry(
    () => client.files.uploadV2(params),
    {
      maxRetries,
      context: `Slack ${context}`,
      isRetryable: isSlackRetryable,
      initialDelayMs: 2000, // File uploads can be slow
      maxDelayMs: 60000,
    }
  );

  if (!result.success) {
    throw result.error;
  }

  return result.data!;
}

/**
 * Get conversation replies with retry
 */
export async function getConversationRepliesWithRetry(
  client: WebClient,
  params: Parameters<WebClient["conversations"]["replies"]>[0],
  options: SlackRetryOptions = {}
): Promise<Awaited<ReturnType<WebClient["conversations"]["replies"]>>> {
  const { maxRetries = 3, context = "getConversationReplies" } = options;

  const result = await retry(
    () => client.conversations.replies(params),
    {
      maxRetries,
      context: `Slack ${context}`,
      isRetryable: isSlackRetryable,
      initialDelayMs: 1000,
      maxDelayMs: 15000,
    }
  );

  if (!result.success) {
    throw result.error;
  }

  return result.data!;
}

/**
 * Get conversation history with retry
 */
export async function getConversationHistoryWithRetry(
  client: WebClient,
  params: Parameters<WebClient["conversations"]["history"]>[0],
  options: SlackRetryOptions = {}
): Promise<Awaited<ReturnType<WebClient["conversations"]["history"]>>> {
  const { maxRetries = 3, context = "getConversationHistory" } = options;

  const result = await retry(
    () => client.conversations.history(params),
    {
      maxRetries,
      context: `Slack ${context}`,
      isRetryable: isSlackRetryable,
      initialDelayMs: 1000,
      maxDelayMs: 15000,
    }
  );

  if (!result.success) {
    throw result.error;
  }

  return result.data!;
}
