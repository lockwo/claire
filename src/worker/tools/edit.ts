/**
 * Edit Tool
 *
 * Edit files by replacing text. Supports exact string replacement.
 */

import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolContext, ToolResult } from "./types";

const EditInput = z.object({
  path: z.string().describe("Path to the file to edit (relative to work directory)"),
  old_string: z.string().describe("The exact string to find and replace"),
  new_string: z.string().describe("The string to replace it with"),
  replace_all: z.boolean().nullish().describe("Replace all occurrences (default: false, replace first only)"),
});

type EditInput = z.infer<typeof EditInput>;

export const EditTool: Tool<EditInput> = {
  name: "edit",
  description: "Edit a file by replacing an exact string with a new string. The old_string must match exactly (including whitespace and indentation).",
  parameters: EditInput,

  async execute(input: EditInput, ctx: ToolContext): Promise<ToolResult> {
    if (ctx.mode === "chat") {
      return {
        output: "",
        error: "Edit operations not allowed in chat mode",
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
      // Read current content
      const content = await fs.readFile(filePath, "utf-8");

      // Check if old_string exists
      if (!content.includes(input.old_string)) {
        return {
          output: "",
          error: `String not found in file. Make sure the old_string matches exactly including whitespace.`,
        };
      }

      // Count occurrences
      const occurrences = content.split(input.old_string).length - 1;

      // Replace
      let newContent: string;
      let replaced: number;

      if (input.replace_all) {
        newContent = content.replaceAll(input.old_string, input.new_string);
        replaced = occurrences;
      } else {
        newContent = content.replace(input.old_string, input.new_string);
        replaced = 1;
      }

      // Write back
      await fs.writeFile(filePath, newContent, "utf-8");

      return {
        output: `Successfully replaced ${replaced} occurrence(s) in ${input.path}`,
        metadata: {
          occurrencesFound: occurrences,
          occurrencesReplaced: replaced,
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
        error: `Error editing file: ${e.message}`,
      };
    }
  },
};
