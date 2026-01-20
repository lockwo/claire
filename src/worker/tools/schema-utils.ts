/**
 * Schema Utilities
 *
 * Convert Zod schemas to JSON Schema for Anthropic tool definitions.
 */

import type { z } from "zod";

export interface JsonSchema {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  [key: string]: unknown;  // Allow additional properties for Record<string, unknown> compatibility
}

/**
 * Convert a Zod schema to JSON Schema format
 * This is a simplified converter that handles common types.
 */
export function zodToJsonSchema(schema: z.ZodType): JsonSchema {
  const def = (schema as any)._def;

  if (!def) {
    return { type: "object" };
  }

  switch (def.typeName) {
    case "ZodString":
      return {
        type: "string",
        description: def.description,
      };

    case "ZodNumber":
      return {
        type: "number",
        description: def.description,
      };

    case "ZodBoolean":
      return {
        type: "boolean",
        description: def.description,
      };

    case "ZodArray":
      return {
        type: "array",
        items: zodToJsonSchema(def.type),
        description: def.description,
      };

    case "ZodEnum":
      return {
        type: "string",
        enum: def.values,
        description: def.description,
      };

    case "ZodOptional":
      return zodToJsonSchema(def.innerType);

    case "ZodDefault":
      return zodToJsonSchema(def.innerType);

    case "ZodObject": {
      const shape = def.shape();
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value as z.ZodType);

        // Check if field is required (not optional)
        const fieldDef = (value as any)._def;
        if (fieldDef.typeName !== "ZodOptional" && fieldDef.typeName !== "ZodDefault") {
          required.push(key);
        }
      }

      return {
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined,
        description: def.description,
      };
    }

    default:
      // Fallback for unknown types
      return { type: "string" };
  }
}
