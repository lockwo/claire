/**
 * LLM Provider Abstraction
 *
 * Handles communication with Anthropic (direct) and OpenRouter.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { Tool, AnthropicTool } from "./tools";
import { ToolRegistry } from "./tools";
import { getConfig, getModelConfig, DEFAULT_MODEL } from "../common/config";
import { retryOrThrow, isRetryableError } from "../common/retry";
import { logger } from "../common/logger";

export interface LLMMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

export interface ToolUse {
  id: string;
  name: string;
  input: unknown;
}

export interface LLMResponse {
  text: string;
  toolCalls: ToolUse[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
}

export interface LLMStreamEvent {
  type: "text" | "tool_start" | "tool_input" | "tool_end" | "done";
  text?: string;
  toolId?: string;
  toolName?: string;
  toolInput?: string;
}

export interface LLMConfig {
  model: string;
  systemPrompt: string;
  messages: LLMMessage[];
  tools: Tool[];
  abort?: AbortSignal;
  maxTokens?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "auto";
  verbosity?: "low" | "medium" | "high"; // Output verbosity for GPT-5.2
  enableWebSearch?: boolean;
  enableCodeInterpreter?: boolean;
  previousResponseId?: string; // For passing chain-of-thought between turns
}

// Extended response type for Responses API
export interface LLMResponseExtended extends LLMResponse {
  responseId?: string; // For chain-of-thought continuation
  webSearchResults?: WebSearchResult[];
  codeInterpreterResults?: CodeInterpreterResult[];
  reasoningSummary?: string[];
}

export interface WebSearchResult {
  url: string;
  title: string;
  snippet?: string;
}

export interface CodeInterpreterResult {
  code: string;
  output: string;
  error?: string;
}

/**
 * Call LLM and get complete response
 */
export async function callLLM(config: LLMConfig): Promise<LLMResponse> {
  const modelConfig = getModelConfig(config.model);
  const envConfig = getConfig();

  if (modelConfig.provider === "anthropic") {
    return callAnthropic(config, envConfig);
  } else if (modelConfig.provider === "openai") {
    return callOpenAI(config, envConfig);
  } else {
    return callOpenRouter(config, envConfig);
  }
}

/**
 * Stream LLM response
 */
export async function* streamLLM(config: LLMConfig): AsyncGenerator<LLMStreamEvent> {
  const modelConfig = getModelConfig(config.model);
  const envConfig = getConfig();

  if (modelConfig.provider === "anthropic") {
    yield* streamAnthropic(config, envConfig);
  } else if (modelConfig.provider === "openai") {
    yield* streamOpenAI(config, envConfig);
  } else {
    yield* streamOpenRouter(config, envConfig);
  }
}

// Anthropic implementation
async function callAnthropic(config: LLMConfig, envConfig: any): Promise<LLMResponse> {
  const client = new Anthropic({
    apiKey: envConfig.ANTHROPIC_API_KEY,
  });

  const modelConfig = getModelConfig(config.model);
  const tools = ToolRegistry.toAnthropicFormat(config.tools);

  const response = await retryOrThrow(
    () => client.messages.create({
      model: config.model || DEFAULT_MODEL,
      max_tokens: config.maxTokens || modelConfig.maxTokens,
      system: config.systemPrompt,
      messages: config.messages.map(convertToAnthropicMessage),
      tools: tools.length > 0 ? (tools as any) : undefined,
    }, {
      signal: config.abort,
    }),
    {
      maxRetries: 3,
      context: "Anthropic API call",
      signal: config.abort,
    }
  );

  // Extract text and tool calls
  let text = "";
  const toolCalls: ToolUse[] = [];

  for (const block of response.content) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input,
      });
    }
  }

  return {
    text,
    toolCalls,
    stopReason: response.stop_reason as LLMResponse["stopReason"],
  };
}

async function* streamAnthropic(config: LLMConfig, envConfig: any): AsyncGenerator<LLMStreamEvent> {
  const client = new Anthropic({
    apiKey: envConfig.ANTHROPIC_API_KEY,
  });

  const modelConfig = getModelConfig(config.model);
  const tools = ToolRegistry.toAnthropicFormat(config.tools);

  const stream = await client.messages.stream({
    model: config.model || DEFAULT_MODEL,
    max_tokens: config.maxTokens || modelConfig.maxTokens,
    system: config.systemPrompt,
    messages: config.messages.map(convertToAnthropicMessage),
    tools: tools.length > 0 ? (tools as any) : undefined,
  }, {
    signal: config.abort,
  });

  let currentToolId: string | undefined;
  let currentToolName: string | undefined;
  let currentToolInput = "";

  for await (const event of stream) {
    if (config.abort?.aborted) {
      break;
    }

    if (event.type === "content_block_start") {
      const block = event.content_block;
      if (block.type === "tool_use") {
        currentToolId = block.id;
        currentToolName = block.name;
        currentToolInput = "";
        yield { type: "tool_start", toolId: block.id, toolName: block.name };
      }
    } else if (event.type === "content_block_delta") {
      const delta = event.delta;
      if (delta.type === "text_delta") {
        yield { type: "text", text: delta.text };
      } else if (delta.type === "input_json_delta") {
        currentToolInput += delta.partial_json;
        yield { type: "tool_input", toolInput: delta.partial_json };
      }
    } else if (event.type === "content_block_stop") {
      if (currentToolId && currentToolName) {
        yield {
          type: "tool_end",
          toolId: currentToolId,
          toolName: currentToolName,
          toolInput: currentToolInput,
        };
        currentToolId = undefined;
        currentToolName = undefined;
        currentToolInput = "";
      }
    } else if (event.type === "message_stop") {
      yield { type: "done" };
    }
  }
}

// OpenAI implementation using Responses API for GPT-5.x with web search & code interpreter
async function callOpenAI(config: LLMConfig, envConfig: any): Promise<LLMResponse> {
  const client = new OpenAI({
    apiKey: envConfig.OPENAI_API_KEY,
  });

  const modelConfig = getModelConfig(config.model);
  const isGPT5 = config.model.startsWith("gpt-5");
  const isO1Model = config.model.startsWith("o1");

  // For GPT-5.x models, use the Responses API with built-in tools
  if (isGPT5) {
    return callOpenAIResponses(config, envConfig, client);
  }

  // Fall back to Chat Completions for older models
  return callOpenAIChatCompletions(config, envConfig, client, isO1Model, modelConfig);
}

// GPT-5.x using Responses API with web search and code interpreter
async function callOpenAIResponses(config: LLMConfig, envConfig: any, client: OpenAI): Promise<LLMResponseExtended> {
  const modelConfig = getModelConfig(config.model);

  // Build tools array with built-in tools and custom function tools
  const tools: any[] = [];

  // Add web search tool (enabled by default for GPT-5.x)
  if (config.enableWebSearch !== false) {
    tools.push({ type: "web_search" });
  }

  // Add code interpreter tool (enabled by default for GPT-5.x)
  if (config.enableCodeInterpreter !== false) {
    tools.push({
      type: "code_interpreter",
      container: { type: "auto", memory_limit: "4g" },
    });
  }

  // Add custom function tools (using proper OpenAI Responses API format with strict mode)
  const functionTools = ToolRegistry.toOpenAIResponsesFormat(config.tools);
  tools.push(...functionTools);

  // Convert messages to Responses API input format
  const input: any[] = [];
  for (const msg of config.messages) {
    if (typeof msg.content === "string") {
      input.push({ role: msg.role, content: msg.content });
    } else {
      // Handle complex content blocks
      const textParts: string[] = [];
      const functionCalls: any[] = [];

      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          textParts.push(block.text);
        } else if (block.type === "tool_use" && block.id && block.name) {
          // Convert tool_use to function_call format for Responses API
          functionCalls.push({
            type: "function_call",
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
          });
        } else if (block.type === "tool_result" && block.tool_use_id) {
          // Tool results need special handling in Responses API
          input.push({
            type: "function_call_output",
            call_id: block.tool_use_id,
            output: block.content || "",
          });
        }
      }

      // Add assistant message with any function calls
      if (msg.role === "assistant" && functionCalls.length > 0) {
        if (textParts.length > 0) {
          input.push({ role: "assistant", content: textParts.join("\n") });
        }
        // Function calls are separate items in Responses API
        for (const fc of functionCalls) {
          input.push(fc);
        }
      } else if (textParts.length > 0) {
        input.push({ role: msg.role, content: textParts.join("\n") });
      }
    }
  }

  // Build request options
  const requestOptions: any = {
    model: config.model,
    instructions: config.systemPrompt,
    input,
    tools: tools.length > 0 ? tools : undefined,
    max_output_tokens: config.maxTokens || modelConfig.maxTokens,
  };

  // Add reasoning effort (default to medium for GPT-5.x)
  const reasoningEffort = config.reasoningEffort || "medium";
  if (reasoningEffort !== "none") {
    requestOptions.reasoning = { effort: reasoningEffort };
  }

  // Add verbosity for GPT-5.2 (controls output token generation)
  if (config.verbosity) {
    requestOptions.text = { verbosity: config.verbosity };
  }

  // Add previous response ID for chain-of-thought continuation
  if (config.previousResponseId) {
    requestOptions.previous_response_id = config.previousResponseId;
  }

  try {
    const response = await retryOrThrow(
      () => (client as any).responses.create(requestOptions),
      {
        maxRetries: 3,
        context: "OpenAI Responses API call",
        signal: config.abort,
      }
    ) as any;

    // Extract text, tool calls, and other outputs from response
    let text = "";
    const toolCalls: ToolUse[] = [];
    const webSearchResults: WebSearchResult[] = [];
    const codeInterpreterResults: CodeInterpreterResult[] = [];
    const reasoningSummary: string[] = [];

    // Parse output items
    if (response.output) {
      for (const item of response.output) {
        switch (item.type) {
          case "message":
            // Extract text from message content
            if (item.content) {
              for (const content of item.content) {
                if (content.type === "output_text" && content.text) {
                  text += content.text;
                  // Extract URL citations
                  if (content.annotations) {
                    for (const ann of content.annotations) {
                      if (ann.type === "url_citation") {
                        webSearchResults.push({
                          url: ann.url,
                          title: ann.title || "",
                          snippet: content.text.slice(ann.start_index, ann.end_index),
                        });
                      }
                    }
                  }
                }
              }
            }
            break;

          case "function_call":
            // Custom function tool call
            toolCalls.push({
              id: item.call_id || item.id,
              name: item.name,
              input: typeof item.arguments === "string" ? JSON.parse(item.arguments) : item.arguments,
            });
            break;

          case "web_search_call":
            // Web search was performed - results are in the message text
            console.log(`[llm] Web search performed: ${item.status || "completed"}`);
            break;

          case "code_interpreter_call":
            // Code interpreter was used
            if (item.code || item.output) {
              codeInterpreterResults.push({
                code: item.code || "",
                output: item.output || "",
                error: item.error,
              });
            }
            break;

          case "reasoning":
            // Reasoning tokens (chain-of-thought)
            if (item.summary && Array.isArray(item.summary)) {
              for (const s of item.summary) {
                if (s.text) {
                  reasoningSummary.push(s.text);
                }
              }
            }
            break;
        }
      }
    }

    // Fall back to output_text helper if no text extracted
    if (!text && response.output_text) {
      text = response.output_text;
    }

    return {
      text,
      toolCalls,
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
      responseId: response.id,
      webSearchResults: webSearchResults.length > 0 ? webSearchResults : undefined,
      codeInterpreterResults: codeInterpreterResults.length > 0 ? codeInterpreterResults : undefined,
      reasoningSummary: reasoningSummary.length > 0 ? reasoningSummary : undefined,
    };
  } catch (err: any) {
    // If Responses API fails (e.g., not available), fall back to Chat Completions
    console.log(`[llm] Responses API error, falling back to Chat Completions: ${err.message}`);
    return callOpenAIChatCompletions(config, envConfig, client, false, getModelConfig(config.model));
  }
}

// Legacy Chat Completions implementation for older models
async function callOpenAIChatCompletions(
  config: LLMConfig,
  envConfig: any,
  client: OpenAI,
  isO1Model: boolean,
  modelConfig: any
): Promise<LLMResponse> {
  // Convert tools to OpenAI function format
  const tools = config.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: ToolRegistry.toAnthropicFormat([t])[0]!.input_schema,
    },
  }));

  // o1 models don't support system messages - prepend to first user message
  const messages = isO1Model
    ? [
        { role: "user" as const, content: `${config.systemPrompt}\n\n---\n\n` },
        ...convertToOpenAIMessages(config.messages),
      ]
    : [
        { role: "system" as const, content: config.systemPrompt },
        ...convertToOpenAIMessages(config.messages),
      ];

  // Build request options
  const requestOptions: any = {
    model: config.model,
    max_completion_tokens: config.maxTokens || modelConfig.maxTokens,
    messages,
    tools: tools.length > 0 && !isO1Model ? tools : undefined,
  };

  const response = await retryOrThrow(
    () => client.chat.completions.create(requestOptions, {
      signal: config.abort,
    }),
    {
      maxRetries: 3,
      context: "OpenAI Chat Completions API call",
      signal: config.abort,
    }
  );

  const choice = response.choices[0];
  const toolCalls: ToolUse[] = [];

  if (choice?.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      toolCalls.push({
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      });
    }
  }

  return {
    text: choice?.message.content || "",
    toolCalls,
    stopReason: choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
  };
}

async function* streamOpenAI(config: LLMConfig, envConfig: any): AsyncGenerator<LLMStreamEvent> {
  const client = new OpenAI({
    apiKey: envConfig.OPENAI_API_KEY,
  });

  const modelConfig = getModelConfig(config.model);
  const isGPT5 = config.model.startsWith("gpt-5");
  const isO1Model = config.model.startsWith("o1");

  // GPT-5.x uses Responses API streaming
  if (isGPT5) {
    yield* streamOpenAIResponses(config, envConfig, client);
    return;
  }

  // o1 models don't support streaming - use non-streaming call
  if (isO1Model) {
    const response = await callOpenAI(config, envConfig);
    if (response.text) {
      yield { type: "text", text: response.text };
    }
    for (const tc of response.toolCalls) {
      yield { type: "tool_start", toolId: tc.id, toolName: tc.name };
      yield { type: "tool_end", toolId: tc.id, toolName: tc.name, toolInput: JSON.stringify(tc.input) };
    }
    yield { type: "done" };
    return;
  }

  // Legacy Chat Completions streaming for older models
  const tools = config.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: ToolRegistry.toAnthropicFormat([t])[0]!.input_schema,
    },
  }));

  const streamOptions: any = {
    model: config.model,
    max_completion_tokens: config.maxTokens || modelConfig.maxTokens,
    messages: [
      { role: "system", content: config.systemPrompt },
      ...convertToOpenAIMessages(config.messages),
    ],
    tools: tools.length > 0 ? tools : undefined,
    stream: true,
  };

  const stream = await client.chat.completions.create(streamOptions as any, {
    signal: config.abort,
  }) as unknown as AsyncIterable<OpenAI.ChatCompletionChunk>;

  const toolInputs = new Map<number, { id: string; name: string; args: string }>();

  for await (const chunk of stream) {
    if (config.abort?.aborted) break;

    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      yield { type: "text", text: delta.content };
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.id) {
          toolInputs.set(tc.index, { id: tc.id, name: tc.function?.name || "", args: "" });
          yield { type: "tool_start", toolId: tc.id, toolName: tc.function?.name };
        }

        const existing = toolInputs.get(tc.index);
        if (existing && tc.function?.arguments) {
          existing.args += tc.function.arguments;
          yield { type: "tool_input", toolInput: tc.function.arguments };
        }
      }
    }

    if (chunk.choices[0]?.finish_reason) {
      for (const tool of toolInputs.values()) {
        yield { type: "tool_end", toolId: tool.id, toolName: tool.name, toolInput: tool.args };
      }
      yield { type: "done" };
    }
  }
}

// GPT-5.x Responses API streaming
async function* streamOpenAIResponses(config: LLMConfig, envConfig: any, client: OpenAI): AsyncGenerator<LLMStreamEvent> {
  const modelConfig = getModelConfig(config.model);

  // Build tools array
  const tools: any[] = [];

  if (config.enableWebSearch !== false) {
    tools.push({ type: "web_search" });
  }

  if (config.enableCodeInterpreter !== false) {
    tools.push({
      type: "code_interpreter",
      container: { type: "auto", memory_limit: "4g" },
    });
  }

  // Add custom function tools (using proper OpenAI Responses API format with strict mode)
  const functionTools = ToolRegistry.toOpenAIResponsesFormat(config.tools);
  tools.push(...functionTools);

  // Convert messages to Responses API input format
  const input: any[] = [];
  for (const msg of config.messages) {
    if (typeof msg.content === "string") {
      input.push({ role: msg.role, content: msg.content });
    } else {
      const textParts: string[] = [];
      const functionCalls: any[] = [];

      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          textParts.push(block.text);
        } else if (block.type === "tool_use" && block.id && block.name) {
          functionCalls.push({
            type: "function_call",
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
          });
        } else if (block.type === "tool_result" && block.tool_use_id) {
          input.push({
            type: "function_call_output",
            call_id: block.tool_use_id,
            output: block.content || "",
          });
        }
      }

      if (msg.role === "assistant" && functionCalls.length > 0) {
        if (textParts.length > 0) {
          input.push({ role: "assistant", content: textParts.join("\n") });
        }
        for (const fc of functionCalls) {
          input.push(fc);
        }
      } else if (textParts.length > 0) {
        input.push({ role: msg.role, content: textParts.join("\n") });
      }
    }
  }

  // Build request options
  const requestOptions: any = {
    model: config.model,
    instructions: config.systemPrompt,
    input,
    tools: tools.length > 0 ? tools : undefined,
    max_output_tokens: config.maxTokens || modelConfig.maxTokens,
    stream: true,
  };

  const reasoningEffort = config.reasoningEffort || "medium";
  if (reasoningEffort !== "none") {
    requestOptions.reasoning = { effort: reasoningEffort };
  }

  if (config.verbosity) {
    requestOptions.text = { verbosity: config.verbosity };
  }

  if (config.previousResponseId) {
    requestOptions.previous_response_id = config.previousResponseId;
  }

  try {
    const stream = await (client as any).responses.create(requestOptions);

    const functionCalls = new Map<string, { id: string; name: string; args: string }>();

    for await (const event of stream) {
      if (config.abort?.aborted) break;

      // Handle different Responses API streaming events
      switch (event.type) {
        case "response.output_item.added":
          // New output item started
          if (event.item?.type === "function_call") {
            functionCalls.set(event.item.id, {
              id: event.item.call_id || event.item.id,
              name: event.item.name || "",
              args: "",
            });
            yield { type: "tool_start", toolId: event.item.call_id || event.item.id, toolName: event.item.name };
          }
          break;

        case "response.output_text.delta":
        case "response.text.delta":
          // Text content streaming
          if (event.delta) {
            yield { type: "text", text: event.delta };
          }
          break;

        case "response.function_call_arguments.delta":
          // Function call arguments streaming
          if (event.delta && event.item_id) {
            const fc = functionCalls.get(event.item_id);
            if (fc) {
              fc.args += event.delta;
              yield { type: "tool_input", toolInput: event.delta };
            }
          }
          break;

        case "response.function_call_arguments.done":
          // Function call completed
          if (event.item_id) {
            const fc = functionCalls.get(event.item_id);
            if (fc) {
              yield { type: "tool_end", toolId: fc.id, toolName: fc.name, toolInput: fc.args };
            }
          }
          break;

        case "response.output_item.done":
          // Output item completed
          if (event.item?.type === "function_call" && event.item.id) {
            const fc = functionCalls.get(event.item.id);
            if (fc && event.item.arguments) {
              fc.args = event.item.arguments;
              yield { type: "tool_end", toolId: fc.id, toolName: fc.name, toolInput: fc.args };
            }
          }
          break;

        case "response.done":
        case "response.completed":
          // Stream completed
          yield { type: "done" };
          break;
      }
    }
  } catch (err: any) {
    console.log(`[llm] Responses API streaming error: ${err.message}`);
    // Fallback to non-streaming
    const response = await callOpenAIResponses(config, envConfig, client);
    if (response.text) {
      yield { type: "text", text: response.text };
    }
    for (const tc of response.toolCalls) {
      yield { type: "tool_start", toolId: tc.id, toolName: tc.name };
      yield { type: "tool_end", toolId: tc.id, toolName: tc.name, toolInput: JSON.stringify(tc.input) };
    }
    yield { type: "done" };
  }
}

// OpenRouter implementation (OpenAI-compatible)
async function callOpenRouter(config: LLMConfig, envConfig: any): Promise<LLMResponse> {
  const client = new OpenAI({
    apiKey: envConfig.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const modelConfig = getModelConfig(config.model);

  // Convert tools to OpenAI format
  const tools = config.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: ToolRegistry.toAnthropicFormat([t])[0]!.input_schema,
    },
  }));

  const response = await retryOrThrow(
    () => client.chat.completions.create({
      model: config.model,
      max_tokens: config.maxTokens || modelConfig.maxTokens,
      messages: [
        { role: "system", content: config.systemPrompt },
        ...convertToOpenAIMessages(config.messages),
      ],
      tools: tools.length > 0 ? tools : undefined,
    }, {
      signal: config.abort,
    }),
    {
      maxRetries: 3,
      context: "OpenRouter API call",
      signal: config.abort,
    }
  );

  const choice = response.choices[0];
  const toolCalls: ToolUse[] = [];

  if (choice?.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      toolCalls.push({
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      });
    }
  }

  return {
    text: choice?.message.content || "",
    toolCalls,
    stopReason: choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
  };
}

async function* streamOpenRouter(config: LLMConfig, envConfig: any): AsyncGenerator<LLMStreamEvent> {
  const client = new OpenAI({
    apiKey: envConfig.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const modelConfig = getModelConfig(config.model);

  const tools = config.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: ToolRegistry.toAnthropicFormat([t])[0]!.input_schema,
    },
  }));

  const stream = await client.chat.completions.create({
    model: config.model,
    max_tokens: config.maxTokens || modelConfig.maxTokens,
    messages: [
      { role: "system", content: config.systemPrompt },
      ...convertToOpenAIMessages(config.messages),
    ],
    tools: tools.length > 0 ? tools : undefined,
    stream: true,
  }, {
    signal: config.abort,
  });

  const toolInputs = new Map<number, { id: string; name: string; args: string }>();

  for await (const chunk of stream) {
    if (config.abort?.aborted) break;

    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      yield { type: "text", text: delta.content };
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.id) {
          toolInputs.set(tc.index, { id: tc.id, name: tc.function?.name || "", args: "" });
          yield { type: "tool_start", toolId: tc.id, toolName: tc.function?.name };
        }

        const existing = toolInputs.get(tc.index);
        if (existing && tc.function?.arguments) {
          existing.args += tc.function.arguments;
          yield { type: "tool_input", toolInput: tc.function.arguments };
        }
      }
    }

    if (chunk.choices[0]?.finish_reason) {
      for (const tool of toolInputs.values()) {
        yield { type: "tool_end", toolId: tool.id, toolName: tool.name, toolInput: tool.args };
      }
      yield { type: "done" };
    }
  }
}

// Conversion helpers
function convertToAnthropicMessage(msg: LLMMessage): Anthropic.MessageParam {
  if (typeof msg.content === "string") {
    return { role: msg.role, content: msg.content };
  }

  // Convert content blocks
  const content: Anthropic.ContentBlock[] = [];
  for (const block of msg.content) {
    if (block.type === "text" && block.text) {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use" && block.id && block.name) {
      content.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      });
    } else if (block.type === "tool_result" && block.tool_use_id) {
      content.push({
        type: "tool_result",
        tool_use_id: block.tool_use_id,
        content: block.content || "",
      } as any);
    }
  }

  return { role: msg.role, content };
}

/**
 * Convert messages to OpenAI format
 * Returns an array because tool results need to be expanded into separate messages
 */
function convertToOpenAIMessages(messages: LLMMessage[]): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    // Check what types of blocks we have
    const textParts: string[] = [];
    const toolUses: { id: string; name: string; input: unknown }[] = [];
    const toolResults: { tool_call_id: string; content: string }[] = [];

    for (const block of msg.content) {
      if (block.type === "text" && block.text) {
        textParts.push(block.text);
      } else if (block.type === "tool_use" && block.id && block.name) {
        toolUses.push({
          id: block.id,
          name: block.name,
          input: block.input,
        });
      } else if (block.type === "tool_result" && block.tool_use_id) {
        toolResults.push({
          tool_call_id: block.tool_use_id,
          content: block.content || "",
        });
      }
    }

    // Handle assistant message with tool calls
    if (msg.role === "assistant" && toolUses.length > 0) {
      result.push({
        role: "assistant",
        content: textParts.join("\n") || null,
        tool_calls: toolUses.map((tu) => ({
          id: tu.id,
          type: "function" as const,
          function: {
            name: tu.name,
            arguments: JSON.stringify(tu.input),
          },
        })),
      });
      continue;
    }

    // Handle tool results - each becomes a separate message
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        result.push({
          role: "tool",
          tool_call_id: tr.tool_call_id,
          content: tr.content,
        });
      }
      continue;
    }

    // Regular message
    result.push({ role: msg.role, content: textParts.join("\n") });
  }

  return result;
}

// Legacy single-message converter (not used for OpenAI anymore)
function convertToOpenAIMessage(msg: LLMMessage): OpenAI.ChatCompletionMessageParam {
  const converted = convertToOpenAIMessages([msg]);
  return converted[0] || { role: msg.role, content: "" };
}
