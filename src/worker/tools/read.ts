/**
 * Read Tool
 *
 * Read files from the filesystem.
 */

import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolContext, ToolResult } from "./types";

const ReadInput = z.object({
  path: z.string().describe("Path to the file to read (relative to work directory)"),
  offset: z.number().nullish().describe("Line number to start reading from (1-indexed)"),
  limit: z.number().nullish().describe("Maximum number of lines to read"),
});

type ReadInput = z.infer<typeof ReadInput>;

export const ReadTool: Tool<ReadInput> = {
  name: "read",
  description: "Read a file from the filesystem. Returns the file contents with line numbers.",
  parameters: ReadInput,

  async execute(input: ReadInput, ctx: ToolContext): Promise<ToolResult> {
    const filePath = path.resolve(ctx.workDir, input.path);

    // Security: ensure path is within workDir
    if (!filePath.startsWith(ctx.workDir)) {
      return {
        output: "",
        error: "Error: Path outside working directory",
      };
    }

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");

      const offset = Math.max(0, (input.offset || 1) - 1);
      const limit = input.limit || lines.length;

      const selected = lines.slice(offset, offset + limit);
      const output = selected
        .map((line, i) => `${offset + i + 1}\t${line}`)
        .join("\n");

      return {
        output: output || "(empty file)",
        metadata: {
          totalLines: lines.length,
          readFrom: offset + 1,
          readTo: Math.min(offset + limit, lines.length),
        },
      };
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return {
          output: "",
          error: `File not found: ${input.path}`,
        };
      }
      return {
        output: "",
        error: `Error reading file: ${e.message}`,
      };
    }
  },
};
