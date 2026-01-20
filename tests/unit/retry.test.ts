/**
 * Retry Utility Tests
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  retry,
  retryOrThrow,
  isRetryableError,
  getErrorStatus,
  getRetryAfterMs,
} from "../../src/common/retry";

describe("isRetryableError", () => {
  test("returns true for 429 rate limit errors", () => {
    const error = { status: 429, message: "Too Many Requests" };
    expect(isRetryableError(error)).toBe(true);
  });

  test("returns true for 500 server errors", () => {
    const error = { status: 500, message: "Internal Server Error" };
    expect(isRetryableError(error)).toBe(true);
  });

  test("returns true for 502 bad gateway", () => {
    const error = { status: 502, message: "Bad Gateway" };
    expect(isRetryableError(error)).toBe(true);
  });

  test("returns true for 503 service unavailable", () => {
    const error = { status: 503, message: "Service Unavailable" };
    expect(isRetryableError(error)).toBe(true);
  });

  test("returns false for 400 bad request", () => {
    const error = { status: 400, message: "Bad Request" };
    expect(isRetryableError(error)).toBe(false);
  });

  test("returns false for 401 unauthorized", () => {
    const error = { status: 401, message: "Unauthorized" };
    expect(isRetryableError(error)).toBe(false);
  });

  test("returns false for 404 not found", () => {
    const error = { status: 404, message: "Not Found" };
    expect(isRetryableError(error)).toBe(false);
  });

  test("returns true for network errors", () => {
    const error = new Error("ECONNRESET");
    expect(isRetryableError(error)).toBe(true);
  });

  test("returns true for fetch failed", () => {
    const error = new Error("fetch failed");
    expect(isRetryableError(error)).toBe(true);
  });

  test("returns true for socket hang up", () => {
    const error = new Error("socket hang up");
    expect(isRetryableError(error)).toBe(true);
  });

  test("returns false for AbortError", () => {
    const error = new Error("Aborted");
    error.name = "AbortError";
    expect(isRetryableError(error)).toBe(false);
  });
});

describe("getErrorStatus", () => {
  test("extracts status from direct property", () => {
    expect(getErrorStatus({ status: 429 })).toBe(429);
  });

  test("extracts status from response object", () => {
    expect(getErrorStatus({ response: { status: 500 } })).toBe(500);
  });

  test("extracts status from error.error object", () => {
    expect(getErrorStatus({ error: { status: 401 } })).toBe(401);
  });

  test("returns null for missing status", () => {
    expect(getErrorStatus({ message: "error" })).toBe(null);
  });

  test("returns null for non-object", () => {
    expect(getErrorStatus("error")).toBe(null);
    expect(getErrorStatus(null)).toBe(null);
    expect(getErrorStatus(undefined)).toBe(null);
  });
});

describe("getRetryAfterMs", () => {
  test("extracts retry-after from headers", () => {
    expect(getRetryAfterMs({ headers: { "retry-after": 30 } })).toBe(30000);
  });

  test("extracts Retry-After from headers (case variation)", () => {
    expect(getRetryAfterMs({ headers: { "Retry-After": "60" } })).toBe(60000);
  });

  test("extracts from response.headers", () => {
    expect(getRetryAfterMs({ response: { headers: { "retry-after": 10 } } })).toBe(10000);
  });

  test("returns null when no retry-after", () => {
    expect(getRetryAfterMs({ headers: {} })).toBe(null);
    expect(getRetryAfterMs({})).toBe(null);
  });
});

describe("retry", () => {
  test("returns success on first try when function succeeds", async () => {
    const fn = async () => "success";
    const result = await retry(fn, { maxRetries: 3 });

    expect(result.success).toBe(true);
    expect(result.data).toBe("success");
    expect(result.attempts).toBe(1);
  });

  test("retries on retryable errors", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) {
        throw { status: 500, message: "Server Error" };
      }
      return "success";
    };

    const result = await retry(fn, {
      maxRetries: 5,
      initialDelayMs: 10,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe("success");
    expect(result.attempts).toBe(3);
  });

  test("fails after max retries", async () => {
    const fn = async () => {
      throw { status: 500, message: "Server Error" };
    };

    const result = await retry(fn, {
      maxRetries: 2,
      initialDelayMs: 10,
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("Server Error");
    expect(result.attempts).toBe(3); // Initial + 2 retries
  });

  test("does not retry non-retryable errors", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw { status: 400, message: "Bad Request" };
    };

    const result = await retry(fn, {
      maxRetries: 3,
      initialDelayMs: 10,
    });

    expect(result.success).toBe(false);
    expect(attempts).toBe(1);
  });

  test("respects abort signal", async () => {
    const controller = new AbortController();
    let attempts = 0;

    const fn = async () => {
      attempts++;
      throw { status: 500, message: "Server Error" };
    };

    // Abort after a short delay
    setTimeout(() => controller.abort(), 50);

    const result = await retry(fn, {
      maxRetries: 10,
      initialDelayMs: 100,
      signal: controller.signal,
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe("Aborted");
    expect(attempts).toBeLessThan(10);
  });

  test("uses custom isRetryable function", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error("Custom error");
    };

    const result = await retry(fn, {
      maxRetries: 3,
      initialDelayMs: 10,
      isRetryable: (err) => (err as Error).message === "Custom error",
    });

    expect(result.success).toBe(false);
    expect(attempts).toBe(4); // Initial + 3 retries
  });
});

describe("retryOrThrow", () => {
  test("returns data on success", async () => {
    const fn = async () => "success";
    const result = await retryOrThrow(fn);
    expect(result).toBe("success");
  });

  test("throws on failure", async () => {
    const fn = async () => {
      throw { status: 400, message: "Bad Request" };
    };

    await expect(retryOrThrow(fn, { maxRetries: 1, initialDelayMs: 10 })).rejects.toThrow();
  });
});
