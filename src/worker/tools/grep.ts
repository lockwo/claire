/**
 * Grep Tool
 *
 * Search for patterns in files.
 */

import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { glob } from "glob";
import type { Tool, ToolContext, ToolResult } from "./types";

const GrepInput = z.object({
  pattern: z.string().describe("Regular expression pattern to search for"),
  path: z.string().nullish().describe("File or directory to search (default: entire work directory)"),
  glob_pattern: z.string().nullish().describe("Glob pattern to filter files (e.g., '*.ts')"),
  case_insensitive: z.boolean().nullish().describe("Case-insensitive search (default: false)"),
});

type GrepInput = z.infer<typeof GrepInput>;

export const GrepTool: Tool<GrepInput> = {
  name: "grep",
  description: "Search for a regex pattern in files. Returns matching lines with file paths and line numbers.",
  parameters: GrepInput,

  async execute(input: GrepInput, ctx: ToolContext): Promise<ToolResult> {
    const searchPath = input.path
      ? path.resolve(ctx.workDir, input.path)
      : ctx.workDir;

    // Security: ensure path is within workDir
    if (!searchPath.startsWith(ctx.workDir)) {
      return {
        output: "",
        error: "Error: Path outside working directory",
      };
    }

    try {
      const regex = new RegExp(input.pattern, input.case_insensitive ? "gi" : "g");

      // Get files to search
      let files: string[];

      const stat = await fs.stat(searchPath).catch(() => null);
      if (stat?.isFile()) {
        files = [searchPath];
      } else {
        const globPattern = input.glob_pattern || "**/*";
        const matches = await glob(globPattern, {
          cwd: searchPath,
          nodir: true,
          ignore: ["node_modules/**", ".git/**", "__pycache__/**", "*.pyc", "**/*.min.js"],
        });
        files = matches.map((f) => path.join(searchPath, f));
      }

      const results: string[] = [];
      let matchCount = 0;
      const maxMatches = 50;
      const maxFilesSearched = 500;

      // Search files
      for (const file of files.slice(0, maxFilesSearched)) {
        if (matchCount >= maxMatches) break;

        try {
          const content = await fs.readFile(file, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length && matchCount < maxMatches; i++) {
            const line = lines[i]!;
            if (regex.test(line)) {
              const relativePath = path.relative(ctx.workDir, file);
              results.push(`${relativePath}:${i + 1}: ${line.trim()}`);
              matchCount++;
              // Reset regex lastIndex for global flag
              regex.lastIndex = 0;
            }
          }
        } catch {
          // Skip binary files or files we can't read
        }
      }

      if (results.length === 0) {
        return {
          output: "No matches found",
          metadata: { matchCount: 0 },
        };
      }

      let output = results.join("\n");
      if (matchCount >= maxMatches) {
        output += `\n... (showing first ${maxMatches} matches)`;
      }

      return {
        output,
        metadata: {
          matchCount,
          filesSearched: Math.min(files.length, maxFilesSearched),
        },
      };
    } catch (e: any) {
      return {
        output: "",
        error: `Error searching: ${e.message}`,
      };
    }
  },
};
