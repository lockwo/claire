/**
 * Retry Utility
 *
 * Exponential backoff retry logic for API calls.
 * Handles transient failures and rate limits.
 */

import { logger } from "./logger";

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in ms (default: 30000) */
  maxDelayMs?: number;
  /** Exponential backoff factor (default: 2) */
  backoffFactor?: number;
  /** Add jitter to prevent thundering herd (default: true) */
  jitter?: boolean;
  /** Function to determine if error is retryable (default: checks for rate limits and transient errors) */
  isRetryable?: (error: unknown) => boolean;
  /** Optional abort signal */
  signal?: AbortSignal;
  /** Context for logging */
  context?: string;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
}

/**
 * Default retryable error checker
 * Retries on: rate limits (429), server errors (5xx), network errors
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  // Check for abort - never retry
  if (error instanceof Error && error.name === "AbortError") {
    return false;
  }

  // Check HTTP status codes
  const status = getErrorStatus(error);
  if (status !== null) {
    // Rate limit - always retry
    if (status === 429) return true;
    // Server errors - retry
    if (status >= 500 && status < 600) return true;
    // Client errors (except 429) - don't retry
    if (status >= 400 && status < 500) return false;
  }

  // Network errors - retry
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("network") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("etimedout") ||
      message.includes("socket hang up") ||
      message.includes("fetch failed")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Extract HTTP status from various error formats
 */
export function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;

  // Direct status property
  if ("status" in error && typeof error.status === "number") {
    return error.status;
  }

  // Response object
  if ("response" in error && error.response && typeof error.response === "object") {
    const response = error.response as Record<string, unknown>;
    if ("status" in response && typeof response.status === "number") {
      return response.status;
    }
  }

  // OpenAI SDK error format
  if ("error" in error && error.error && typeof error.error === "object") {
    const innerError = error.error as Record<string, unknown>;
    if ("status" in innerError && typeof innerError.status === "number") {
      return innerError.status;
    }
  }

  return null;
}

/**
 * Extract retry-after header value (in ms)
 */
export function getRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;

  // Check headers
  let headers: Record<string, unknown> | null = null;

  if ("headers" in error && error.headers && typeof error.headers === "object") {
    headers = error.headers as Record<string, unknown>;
  } else if ("response" in error && error.response && typeof error.response === "object") {
    const response = error.response as Record<string, unknown>;
    if ("headers" in response && response.headers && typeof response.headers === "object") {
      headers = response.headers as Record<string, unknown>;
    }
  }

  if (!headers) return null;

  // Look for retry-after header (case-insensitive)
  const retryAfter =
    headers["retry-after"] || headers["Retry-After"] || headers["x-ratelimit-reset-after"];

  if (typeof retryAfter === "number") {
    return retryAfter * 1000; // Assume seconds, convert to ms
  }

  if (typeof retryAfter === "string") {
    const parsed = parseInt(retryAfter, 10);
    if (!isNaN(parsed)) {
      return parsed * 1000;
    }
  }

  return null;
}

/**
 * Sleep with optional abort signal
 */
async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }

    const timeout = setTimeout(resolve, ms);

    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new Error("Aborted"));
    });
  });
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffFactor: number,
  jitter: boolean
): number {
  let delay = initialDelayMs * Math.pow(backoffFactor, attempt);
  delay = Math.min(delay, maxDelayMs);

  if (jitter) {
    // Add random jitter between 0-25% of delay
    delay = delay * (1 + Math.random() * 0.25);
  }

  return Math.round(delay);
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffFactor = 2,
    jitter = true,
    isRetryable = isRetryableError,
    signal,
    context = "operation",
  } = options;

  let lastError: Error | undefined;
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;

    // Check abort before attempting
    if (signal?.aborted) {
      return {
        success: false,
        error: new Error("Aborted"),
        attempts,
      };
    }

    try {
      const result = await fn();
      return {
        success: true,
        data: result,
        attempts,
      };
    } catch (error) {
      // Convert non-Error objects to Error, preserving message property if available
      if (error instanceof Error) {
        lastError = error;
      } else if (error && typeof error === "object" && "message" in error) {
        lastError = new Error(String((error as { message: unknown }).message));
      } else {
        lastError = new Error(String(error));
      }

      // Check if we should retry
      if (attempt >= maxRetries || !isRetryable(error)) {
        logger.error(`${context} failed after ${attempts} attempts`, {
          error: lastError.message,
          retryable: isRetryable(error),
        });
        return {
          success: false,
          error: lastError,
          attempts,
        };
      }

      // Calculate delay
      let delay = calculateDelay(attempt, initialDelayMs, maxDelayMs, backoffFactor, jitter);

      // Check for retry-after header (rate limits)
      const retryAfter = getRetryAfterMs(error);
      if (retryAfter !== null && retryAfter > 0) {
        delay = Math.min(retryAfter, maxDelayMs);
        logger.warn(`${context} rate limited, waiting ${delay}ms`, {
          attempt: attempts,
          retryAfter,
        });
      } else {
        logger.warn(`${context} failed, retrying in ${delay}ms`, {
          attempt: attempts,
          error: lastError.message,
        });
      }

      // Wait before retrying
      try {
        await sleep(delay, signal);
      } catch {
        // Aborted during sleep
        return {
          success: false,
          error: new Error("Aborted"),
          attempts,
        };
      }
    }
  }

  return {
    success: false,
    error: lastError || new Error("Unknown error"),
    attempts,
  };
}

/**
 * Convenience wrapper that throws on failure
 */
export async function retryOrThrow<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const result = await retry(fn, options);

  if (!result.success) {
    throw result.error || new Error("Operation failed");
  }

  return result.data!;
}
