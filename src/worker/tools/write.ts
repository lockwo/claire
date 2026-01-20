/**
 * Write Tool
 *
 * Write content to a file (creates or overwrites).
 */

import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolContext, ToolResult } from "./types";

const WriteInput = z.object({
  path: z.string().describe("Path to the file to write (relative to work directory)"),
  content: z.string().describe("Content to write to the file"),
});

type WriteInput = z.infer<typeof WriteInput>;

export const WriteTool: Tool<WriteInput> = {
  name: "write",
  description: "Write content to a file. Creates the file if it doesn't exist, or overwrites if it does. Creates parent directories as needed.",
  parameters: WriteInput,

  async execute(input: WriteInput, ctx: ToolContext): Promise<ToolResult> {
    if (ctx.mode === "chat") {
      return {
        output: "",
        error: "Write operations not allowed in chat mode",
      };
    }

    const filePath = path.resolve(ctx.workDir, input.path);

    // Security: ensure path is within workDir
    if (!filePath.startsWith(ctx.workDir)) {
      return {
        output: "",
        error: "Error: Path outside working directory",
      };
    }

    try {
      // Create parent directories
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Write file
      await fs.writeFile(filePath, input.content, "utf-8");

      const lines = input.content.split("\n").length;

      return {
        output: `Successfully wrote ${lines} lines to ${input.path}`,
        metadata: {
          bytesWritten: input.content.length,
          linesWritten: lines,
        },
      };
    } catch (e: any) {
      return {
        output: "",
        error: `Error writing file: ${e.message}`,
      };
    }
  },
};
