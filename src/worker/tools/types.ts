/**
 * Tool Type Definitions
 *
 * Defines the interface for tools that the agent can use.
 */

import type { z } from "zod";

export interface ToolContext {
  workDir: string;
  sessionId: string;
  jobId: string;
  abort: AbortSignal;
  mode: "code" | "chat";
}

export interface ToolResult {
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface Tool<TInput = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<TInput>;
  execute(input: TInput, ctx: ToolContext): Promise<ToolResult>;
}

// Tool call from LLM
export interface ToolCallRequest {
  id: string;
  name: string;
  input: unknown;
}

// For Anthropic tool format
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}
