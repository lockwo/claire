/**
 * Tool Registry
 *
 * Central registry for all available tools. Resolves tools based on mode.
 */

import type { Tool, ToolContext, ToolResult, AnthropicTool, ToolCallRequest } from "./types";
import { ReadTool } from "./read";
import { WriteTool } from "./write";
import { EditTool } from "./edit";
import { GlobTool } from "./glob";
import { GrepTool } from "./grep";
import { BashTool } from "./bash";
import { GitTool } from "./git";
import { zodToJsonSchema } from "./schema-utils";

// All available tools
const ALL_TOOLS: Tool[] = [
  ReadTool,
  WriteTool,
  EditTool,
  GlobTool,
  GrepTool,
  BashTool,
  GitTool,
];

// Read-only tools for chat mode
const CHAT_MODE_TOOLS: Tool[] = [
  ReadTool,
  GlobTool,
  GrepTool,
  GitTool, // git status/log/diff are read-only
];

export const ToolRegistry = {
  /**
   * Get tools available for the given mode
   */
  resolve(mode: "code" | "chat"): Tool[] {
    if (mode === "chat") {
      return CHAT_MODE_TOOLS;
    }
    return ALL_TOOLS;
  },

  /**
   * Convert tools to Anthropic format
   */
  toAnthropicFormat(tools: Tool[]): AnthropicTool[] {
    return tools.map((tool) => {
      const schema = zodToJsonSchema(tool.parameters);
      return {
        name: tool.name,
        description: tool.description,
        input_schema: {
          type: "object" as const,
          properties: schema.properties,
          required: schema.required,
          additionalProperties: false,
        },
      };
    });
  },

  /**
   * Convert tools to OpenAI Responses API format (with strict mode)
   * Strict mode requires:
   * - additionalProperties: false at every object level
   * - ALL properties must be in required array
   * - Optional properties should use nullable types like ["string", "null"]
   */
  toOpenAIResponsesFormat(tools: Tool[]): any[] {
    return tools.map((tool) => {
      const schema = zodToJsonSchema(tool.parameters);
      const properties = schema.properties || {};
      const originalRequired = new Set(schema.required || []);

      // Process property to make it strict-mode compliant
      const processProperty = (key: string, prop: any, isRequired: boolean): any => {
        if (!prop || typeof prop !== "object") return prop;

        let processed = { ...prop };

        // For optional properties, make them nullable
        if (!isRequired) {
          if (processed.type && !Array.isArray(processed.type)) {
            processed.type = [processed.type, "null"];
          }
        }

        // Handle nested objects
        if (processed.type === "object" && processed.properties) {
          const nestedRequired = new Set(processed.required || []);
          processed = {
            ...processed,
            additionalProperties: false,
            properties: Object.fromEntries(
              Object.entries(processed.properties).map(([k, v]) => [
                k,
                processProperty(k, v, nestedRequired.has(k)),
              ])
            ),
            required: Object.keys(processed.properties),
          };
        }

        // Handle arrays with object items
        if (processed.items && processed.items.type === "object") {
          processed.items = processProperty("", processed.items, true);
        }

        return processed;
      };

      // Process all properties and make them all required
      const processedProperties = Object.fromEntries(
        Object.entries(properties).map(([k, v]) => [
          k,
          processProperty(k, v, originalRequired.has(k)),
        ])
      );

      return {
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: processedProperties,
          required: Object.keys(properties), // ALL properties must be required in strict mode
          additionalProperties: false,
        },
        strict: true,
      };
    });
  },

  /**
   * Coerce input values to expected types
   * LLMs sometimes send numbers as strings ("200" instead of 200) or booleans as strings ("true" instead of true)
   */
  coerceInput(input: unknown): unknown {
    if (input === null || input === undefined) return input;
    if (typeof input !== "object") return input;
    if (Array.isArray(input)) return input.map((v) => this.coerceInput(v));

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (value === "true") {
        result[key] = true;
      } else if (value === "false") {
        result[key] = false;
      } else if (value === "null" || value === null) {
        result[key] = null;
      } else if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
        // Coerce numeric strings to numbers
        result[key] = parseFloat(value);
      } else if (typeof value === "object" && value !== null) {
        result[key] = this.coerceInput(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  },

  /**
   * Execute a tool call
   */
  async execute(
    toolCall: ToolCallRequest,
    tools: Tool[],
    ctx: ToolContext
  ): Promise<ToolResult> {
    const tool = tools.find((t) => t.name === toolCall.name);

    if (!tool) {
      return {
        output: "",
        error: `Unknown tool: ${toolCall.name}`,
      };
    }

    // Coerce input types (LLMs often send numbers/booleans as strings)
    const coercedInput = this.coerceInput(toolCall.input);

    // Validate input
    const parseResult = tool.parameters.safeParse(coercedInput);
    if (!parseResult.success) {
      return {
        output: "",
        error: `Invalid input for ${toolCall.name}: ${parseResult.error.message}`,
      };
    }

    // Execute tool
    try {
      return await tool.execute(parseResult.data, ctx);
    } catch (e: any) {
      return {
        output: "",
        error: `Tool execution error: ${e.message}`,
      };
    }
  },
};

// Re-export types
export type { Tool, ToolContext, ToolResult, ToolCallRequest, AnthropicTool };
