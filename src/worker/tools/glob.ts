/**
 * Glob Tool
 *
 * Find files matching a glob pattern.
 */

import { z } from "zod";
import * as path from "path";
import { glob } from "glob";
import type { Tool, ToolContext, ToolResult } from "./types";

const GlobInput = z.object({
  pattern: z.string().describe("Glob pattern to match files (e.g., '**/*.ts', 'src/**/*.py')"),
  path: z.string().nullish().describe("Directory to search in (relative to work directory, default: current directory)"),
});

type GlobInput = z.infer<typeof GlobInput>;

export const GlobTool: Tool<GlobInput> = {
  name: "glob",
  description: "Find files matching a glob pattern. Returns a list of matching file paths.",
  parameters: GlobInput,

  async execute(input: GlobInput, ctx: ToolContext): Promise<ToolResult> {
    const searchDir = input.path
      ? path.resolve(ctx.workDir, input.path)
      : ctx.workDir;

    // Security: ensure path is within workDir
    if (!searchDir.startsWith(ctx.workDir)) {
      return {
        output: "",
        error: "Error: Path outside working directory",
      };
    }

    try {
      const matches = await glob(input.pattern, {
        cwd: searchDir,
        nodir: true,
        ignore: ["node_modules/**", ".git/**", "__pycache__/**", "*.pyc"],
      });

      if (matches.length === 0) {
        return {
          output: "No files found matching pattern",
          metadata: { matchCount: 0 },
        };
      }

      // Sort by path
      matches.sort();

      // Limit output
      const maxResults = 100;
      const truncated = matches.length > maxResults;
      const displayed = matches.slice(0, maxResults);

      let output = displayed.join("\n");
      if (truncated) {
        output += `\n... and ${matches.length - maxResults} more files`;
      }

      return {
        output,
        metadata: {
          matchCount: matches.length,
          truncated,
        },
      };
    } catch (e: any) {
      return {
        output: "",
        error: `Error searching files: ${e.message}`,
      };
    }
  },
};
