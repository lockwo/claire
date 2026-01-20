/**
 * Error Handling
 *
 * Provides user-friendly error messages and error categorization.
 */

import { logger } from "./logger";

export enum ErrorCategory {
  RATE_LIMIT = "rate_limit",
  AUTH = "auth",
  NETWORK = "network",
  TIMEOUT = "timeout",
  VALIDATION = "validation",
  NOT_FOUND = "not_found",
  PERMISSION = "permission",
  LLM_ERROR = "llm_error",
  TOOL_ERROR = "tool_error",
  INTERNAL = "internal",
  ABORTED = "aborted",
}

export interface ClaireError {
  category: ErrorCategory;
  message: string;
  userMessage: string;
  suggestion?: string;
  retryable: boolean;
  originalError?: Error;
}

/**
 * Categorize an error and generate user-friendly messages
 */
export function categorizeError(error: unknown): ClaireError {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message.toLowerCase();

  // Aborted
  if (err.name === "AbortError" || message.includes("aborted")) {
    return {
      category: ErrorCategory.ABORTED,
      message: err.message,
      userMessage: "Task was cancelled.",
      retryable: false,
      originalError: err,
    };
  }

  // Rate limits
  if (message.includes("rate limit") || message.includes("429") || message.includes("too many requests")) {
    return {
      category: ErrorCategory.RATE_LIMIT,
      message: err.message,
      userMessage: "Hit rate limit. Please wait a moment and try again.",
      suggestion: "The AI service is temporarily limiting requests. This usually resolves in a few seconds.",
      retryable: true,
      originalError: err,
    };
  }

  // Authentication
  if (
    message.includes("unauthorized") ||
    message.includes("401") ||
    message.includes("invalid api key") ||
    message.includes("authentication")
  ) {
    return {
      category: ErrorCategory.AUTH,
      message: err.message,
      userMessage: "Authentication error with AI service.",
      suggestion: "Please check that the API keys are configured correctly.",
      retryable: false,
      originalError: err,
    };
  }

  // Network errors
  if (
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("socket") ||
    message.includes("fetch failed")
  ) {
    return {
      category: ErrorCategory.NETWORK,
      message: err.message,
      userMessage: "Network error connecting to AI service.",
      suggestion: "This is usually temporary. Please try again.",
      retryable: true,
      originalError: err,
    };
  }

  // Timeout
  if (message.includes("timeout") || message.includes("timed out")) {
    return {
      category: ErrorCategory.TIMEOUT,
      message: err.message,
      userMessage: "Request timed out.",
      suggestion: "The task may be too complex. Try breaking it into smaller steps.",
      retryable: true,
      originalError: err,
    };
  }

  // Permission errors (GitHub, file system, etc.)
  if (
    message.includes("permission denied") ||
    message.includes("403") ||
    message.includes("forbidden") ||
    message.includes("access denied")
  ) {
    return {
      category: ErrorCategory.PERMISSION,
      message: err.message,
      userMessage: "Permission denied.",
      suggestion: "Check that Claire has the necessary permissions for this operation.",
      retryable: false,
      originalError: err,
    };
  }

  // Not found errors
  if (message.includes("not found") || message.includes("404") || message.includes("does not exist")) {
    return {
      category: ErrorCategory.NOT_FOUND,
      message: err.message,
      userMessage: "Resource not found.",
      suggestion: "Double-check the repository, branch, or file path.",
      retryable: false,
      originalError: err,
    };
  }

  // LLM-specific errors
  if (
    message.includes("context length") ||
    message.includes("max tokens") ||
    message.includes("content filter") ||
    message.includes("model")
  ) {
    return {
      category: ErrorCategory.LLM_ERROR,
      message: err.message,
      userMessage: "AI model error.",
      suggestion: message.includes("context")
        ? "The conversation is too long. Start a new thread for a fresh context."
        : "Try rephrasing your request or using a different model.",
      retryable: false,
      originalError: err,
    };
  }

  // Validation errors
  if (message.includes("invalid") || message.includes("validation") || message.includes("schema")) {
    return {
      category: ErrorCategory.VALIDATION,
      message: err.message,
      userMessage: "Invalid input.",
      suggestion: "Check the format of your request.",
      retryable: false,
      originalError: err,
    };
  }

  // Default - internal error
  return {
    category: ErrorCategory.INTERNAL,
    message: err.message,
    userMessage: "An unexpected error occurred.",
    suggestion: "Please try again. If the problem persists, contact support.",
    retryable: true,
    originalError: err,
  };
}

/**
 * Format an error for display to users in Slack
 */
export function formatErrorForSlack(error: unknown): string {
  const claireError = categorizeError(error);

  const parts = [`*Error:* ${claireError.userMessage}`];

  if (claireError.suggestion) {
    parts.push(`_${claireError.suggestion}_`);
  }

  // For debugging, include truncated original message if different
  if (claireError.message !== claireError.userMessage) {
    const truncated = claireError.message.slice(0, 200);
    parts.push(`\n\`\`\`${truncated}${claireError.message.length > 200 ? "..." : ""}\`\`\``);
  }

  return parts.join("\n");
}

/**
 * Format a tool error for the LLM
 */
export function formatToolError(toolName: string, error: unknown): string {
  const claireError = categorizeError(error);

  logger.error(`Tool error: ${toolName}`, {
    category: claireError.category,
    message: claireError.message,
  });

  // For LLM context, be concise but informative
  let errorText = `Error in ${toolName}: ${claireError.message}`;

  if (claireError.suggestion) {
    errorText += `\nSuggestion: ${claireError.suggestion}`;
  }

  return errorText;
}

/**
 * Check if an error is retryable
 */
export function isRetryable(error: unknown): boolean {
  return categorizeError(error).retryable;
}

/**
 * Create a custom Claire error
 */
export function createError(
  category: ErrorCategory,
  message: string,
  userMessage?: string,
  suggestion?: string
): ClaireError {
  return {
    category,
    message,
    userMessage: userMessage || message,
    suggestion,
    retryable: [ErrorCategory.RATE_LIMIT, ErrorCategory.NETWORK, ErrorCategory.TIMEOUT].includes(category),
  };
}
