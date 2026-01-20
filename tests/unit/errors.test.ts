/**
 * Error Handling Tests
 */

import { describe, test, expect } from "bun:test";
import {
  categorizeError,
  formatErrorForSlack,
  ErrorCategory,
  isRetryable,
} from "../../src/common/errors";

describe("categorizeError", () => {
  test("categorizes rate limit errors", () => {
    const error = new Error("rate limit exceeded");
    const result = categorizeError(error);

    expect(result.category).toBe(ErrorCategory.RATE_LIMIT);
    expect(result.retryable).toBe(true);
    expect(result.userMessage).toContain("rate limit");
  });

  test("categorizes 429 errors", () => {
    const error = new Error("Error 429: Too Many Requests");
    const result = categorizeError(error);

    expect(result.category).toBe(ErrorCategory.RATE_LIMIT);
    expect(result.retryable).toBe(true);
  });

  test("categorizes authentication errors", () => {
    const error = new Error("Invalid API key");
    const result = categorizeError(error);

    expect(result.category).toBe(ErrorCategory.AUTH);
    expect(result.retryable).toBe(false);
    expect(result.userMessage).toContain("Authentication");
  });

  test("categorizes 401 errors", () => {
    const error = new Error("401 Unauthorized");
    const result = categorizeError(error);

    expect(result.category).toBe(ErrorCategory.AUTH);
    expect(result.retryable).toBe(false);
  });

  test("categorizes network errors", () => {
    const error = new Error("ECONNRESET");
    const result = categorizeError(error);

    expect(result.category).toBe(ErrorCategory.NETWORK);
    expect(result.retryable).toBe(true);
    expect(result.userMessage).toContain("Network");
  });

  test("categorizes timeout errors", () => {
    const error = new Error("Request timed out");
    const result = categorizeError(error);

    expect(result.category).toBe(ErrorCategory.TIMEOUT);
    expect(result.retryable).toBe(true);
    expect(result.suggestion).toBeDefined();
  });

  test("categorizes permission errors", () => {
    const error = new Error("403 Forbidden");
    const result = categorizeError(error);

    expect(result.category).toBe(ErrorCategory.PERMISSION);
    expect(result.retryable).toBe(false);
  });

  test("categorizes not found errors", () => {
    const error = new Error("404 Not Found");
    const result = categorizeError(error);

    expect(result.category).toBe(ErrorCategory.NOT_FOUND);
    expect(result.retryable).toBe(false);
    expect(result.suggestion).toContain("Double-check");
  });

  test("categorizes LLM context length errors", () => {
    const error = new Error("context length exceeded");
    const result = categorizeError(error);

    expect(result.category).toBe(ErrorCategory.LLM_ERROR);
    expect(result.retryable).toBe(false);
    expect(result.suggestion).toContain("too long");
  });

  test("categorizes abort errors", () => {
    const error = new Error("Aborted");
    error.name = "AbortError";
    const result = categorizeError(error);

    expect(result.category).toBe(ErrorCategory.ABORTED);
    expect(result.retryable).toBe(false);
    expect(result.userMessage).toContain("cancelled");
  });

  test("defaults to internal error for unknown errors", () => {
    const error = new Error("Something weird happened");
    const result = categorizeError(error);

    expect(result.category).toBe(ErrorCategory.INTERNAL);
    expect(result.retryable).toBe(true); // Default to retryable
    expect(result.userMessage).toContain("unexpected");
  });

  test("handles non-Error objects", () => {
    const result = categorizeError("string error");
    expect(result.category).toBe(ErrorCategory.INTERNAL);
    expect(result.message).toBe("string error");
  });
});

describe("formatErrorForSlack", () => {
  test("formats rate limit error with suggestion", () => {
    const error = new Error("Rate limit exceeded");
    const formatted = formatErrorForSlack(error);

    expect(formatted).toContain("*Error:*");
    expect(formatted).toContain("rate limit");
  });

  test("formats authentication error", () => {
    const error = new Error("Invalid API key provided");
    const formatted = formatErrorForSlack(error);

    expect(formatted).toContain("Authentication");
    expect(formatted).toContain("API keys");
  });

  test("includes original error message for debugging", () => {
    const error = new Error("Detailed technical error message");
    const formatted = formatErrorForSlack(error);

    expect(formatted).toContain("```");
    expect(formatted).toContain("Detailed technical error");
  });

  test("truncates long error messages", () => {
    const longMessage = "x".repeat(300);
    const error = new Error(longMessage);
    const formatted = formatErrorForSlack(error);

    expect(formatted).toContain("...");
    expect(formatted.length).toBeLessThan(longMessage.length + 200);
  });
});

describe("isRetryable", () => {
  test("returns true for rate limit errors", () => {
    expect(isRetryable(new Error("rate limit"))).toBe(true);
  });

  test("returns true for network errors", () => {
    expect(isRetryable(new Error("ECONNRESET"))).toBe(true);
  });

  test("returns true for timeout errors", () => {
    expect(isRetryable(new Error("timed out"))).toBe(true);
  });

  test("returns false for auth errors", () => {
    expect(isRetryable(new Error("unauthorized"))).toBe(false);
  });

  test("returns false for not found errors", () => {
    expect(isRetryable(new Error("not found"))).toBe(false);
  });

  test("returns false for abort errors", () => {
    const error = new Error("Aborted");
    error.name = "AbortError";
    expect(isRetryable(error)).toBe(false);
  });
});
