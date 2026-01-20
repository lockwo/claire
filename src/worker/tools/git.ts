/**
 * Git Tool
 *
 * Provides structured git operations with better error handling
 * than raw bash commands.
 */

import { z } from "zod";
import { spawn } from "child_process";
import * as path from "path";
import type { Tool, ToolContext, ToolResult } from "./types";

const GitInput = z.object({
  operation: z.enum([
    "clone",
    "checkout",
    "branch",
    "add",
    "commit",
    "push",
    "pull",
    "status",
    "log",
    "diff",
    "pr",
  ]).describe("Git operation to perform"),
  repo: z.string().nullish().describe("Repository URL or owner/repo for clone"),
  branch: z.string().nullish().describe("Branch name for checkout/branch operations"),
  message: z.string().nullish().describe("Commit message for commit operation"),
  files: z.array(z.string()).nullish().describe("Files to add (default: all)"),
  args: z.string().nullish().describe("Additional arguments for the operation"),
  title: z.string().nullish().describe("PR title (for pr operation)"),
  body: z.string().nullish().describe("PR body/description (for pr operation)"),
  base: z.string().nullish().describe("Base branch for PR (default: main)"),
});

type GitInput = z.infer<typeof GitInput>;

async function runGit(
  args: string[],
  cwd: string,
  abort: AbortSignal
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });

    let stdout = "";
    let stderr = "";

    const abortHandler = () => {
      proc.kill("SIGTERM");
    };
    abort.addEventListener("abort", abortHandler);

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      abort.removeEventListener("abort", abortHandler);
      resolve({ stdout, stderr, exitCode: code || 0 });
    });

    proc.on("error", (err) => {
      abort.removeEventListener("abort", abortHandler);
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });
  });
}

export const GitTool: Tool<GitInput> = {
  name: "git",
  description: "Perform git operations like clone, checkout, commit, push, and create pull requests. Provides structured access to git commands.",
  parameters: GitInput,

  async execute(input: GitInput, ctx: ToolContext): Promise<ToolResult> {
    if (ctx.mode === "chat" && !["status", "log", "diff"].includes(input.operation)) {
      return {
        output: "",
        error: "Write git operations not allowed in chat mode",
      };
    }

    const repoDir = path.join(ctx.workDir, "repo");

    switch (input.operation) {
      case "clone": {
        if (!input.repo) {
          return { output: "", error: "Repository URL required for clone" };
        }

        // Build clone URL
        let repoUrl = input.repo;
        if (!repoUrl.includes("://") && !repoUrl.startsWith("git@")) {
          // Assume GitHub owner/repo format
          const token = process.env.GITHUB_TOKEN;
          if (token) {
            repoUrl = `https://x-access-token:${token}@github.com/${input.repo}.git`;
          } else {
            repoUrl = `https://github.com/${input.repo}.git`;
          }
        }

        const cloneArgs = ["clone", repoUrl, "repo"];
        if (input.branch) {
          cloneArgs.push("-b", input.branch);
        }

        const result = await runGit(cloneArgs, ctx.workDir, ctx.abort);

        if (result.exitCode !== 0) {
          return {
            output: result.stdout,
            error: `Clone failed: ${result.stderr}`,
          };
        }

        return {
          output: `Successfully cloned ${input.repo} to ./repo/\n${result.stdout}`,
          metadata: { repo: input.repo, branch: input.branch },
        };
      }

      case "checkout": {
        if (!input.branch) {
          return { output: "", error: "Branch name required for checkout" };
        }

        // First try to checkout existing branch
        let result = await runGit(["checkout", input.branch], repoDir, ctx.abort);

        if (result.exitCode !== 0) {
          // Try creating a new branch
          result = await runGit(["checkout", "-b", input.branch], repoDir, ctx.abort);
        }

        if (result.exitCode !== 0) {
          return {
            output: result.stdout,
            error: `Checkout failed: ${result.stderr}`,
          };
        }

        return {
          output: `Switched to branch '${input.branch}'\n${result.stdout}`,
          metadata: { branch: input.branch },
        };
      }

      case "branch": {
        const args = ["branch"];
        if (input.args) {
          args.push(...input.args.split(" ").filter(Boolean));
        }

        const result = await runGit(args, repoDir, ctx.abort);
        return {
          output: result.stdout || result.stderr,
          error: result.exitCode !== 0 ? `Branch command failed` : undefined,
        };
      }

      case "add": {
        const files = input.files || ["."];
        const result = await runGit(["add", ...files], repoDir, ctx.abort);

        if (result.exitCode !== 0) {
          return {
            output: result.stdout,
            error: `Add failed: ${result.stderr}`,
          };
        }

        return {
          output: `Staged files: ${files.join(", ")}\n${result.stdout}`,
        };
      }

      case "commit": {
        if (!input.message) {
          return { output: "", error: "Commit message required" };
        }

        // First add all changes
        await runGit(["add", "."], repoDir, ctx.abort);

        const result = await runGit(
          ["commit", "-m", input.message],
          repoDir,
          ctx.abort
        );

        if (result.exitCode !== 0) {
          // Check if it's just "nothing to commit"
          if (result.stdout.includes("nothing to commit") || result.stderr.includes("nothing to commit")) {
            return { output: "Nothing to commit, working tree clean" };
          }
          return {
            output: result.stdout,
            error: `Commit failed: ${result.stderr}`,
          };
        }

        // Extract commit hash
        const hashMatch = result.stdout.match(/\[[\w-]+ ([a-f0-9]+)\]/);
        const commitHash = hashMatch?.[1] || "unknown";

        return {
          output: `Created commit ${commitHash}: ${input.message}\n${result.stdout}`,
          metadata: { commitHash },
        };
      }

      case "push": {
        const args = ["push"];

        // Get current branch
        const branchResult = await runGit(["branch", "--show-current"], repoDir, ctx.abort);
        const currentBranch = branchResult.stdout.trim();

        if (input.args) {
          args.push(...input.args.split(" ").filter(Boolean));
        } else {
          // Default: push with upstream tracking
          args.push("-u", "origin", currentBranch);
        }

        const result = await runGit(args, repoDir, ctx.abort);

        if (result.exitCode !== 0) {
          return {
            output: result.stdout,
            error: `Push failed: ${result.stderr}`,
          };
        }

        return {
          output: `Successfully pushed to origin/${currentBranch}\n${result.stdout}${result.stderr}`,
          metadata: { branch: currentBranch },
        };
      }

      case "pull": {
        const args = ["pull"];
        if (input.args) {
          args.push(...input.args.split(" ").filter(Boolean));
        }

        const result = await runGit(args, repoDir, ctx.abort);

        if (result.exitCode !== 0) {
          return {
            output: result.stdout,
            error: `Pull failed: ${result.stderr}`,
          };
        }

        return {
          output: `Successfully pulled changes\n${result.stdout}`,
        };
      }

      case "status": {
        const result = await runGit(["status"], repoDir, ctx.abort);
        return {
          output: result.stdout || result.stderr,
          error: result.exitCode !== 0 ? "Status command failed" : undefined,
        };
      }

      case "log": {
        const args = ["log", "--oneline", "-20"];
        if (input.args) {
          args.push(...input.args.split(" ").filter(Boolean));
        }

        const result = await runGit(args, repoDir, ctx.abort);
        return {
          output: result.stdout || result.stderr,
          error: result.exitCode !== 0 ? "Log command failed" : undefined,
        };
      }

      case "diff": {
        const args = ["diff"];
        if (input.args) {
          args.push(...input.args.split(" ").filter(Boolean));
        }

        const result = await runGit(args, repoDir, ctx.abort);
        return {
          output: result.stdout || "(no changes)",
          error: result.exitCode !== 0 ? "Diff command failed" : undefined,
        };
      }

      case "pr": {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
          return { output: "", error: "GITHUB_TOKEN required for PR creation" };
        }

        // Get current branch
        const branchResult = await runGit(["branch", "--show-current"], repoDir, ctx.abort);
        const currentBranch = branchResult.stdout.trim();

        if (!currentBranch) {
          return { output: "", error: "Could not determine current branch" };
        }

        // Get remote URL to extract owner/repo
        const remoteResult = await runGit(["remote", "get-url", "origin"], repoDir, ctx.abort);
        const remoteUrl = remoteResult.stdout.trim();

        // Parse owner/repo from remote URL
        let repoPath: string | null = null;
        const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
        const sshMatch = remoteUrl.match(/git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);

        if (httpsMatch?.[1]) {
          repoPath = httpsMatch[1];
        } else if (sshMatch?.[1]) {
          repoPath = sshMatch[1];
        }

        if (!repoPath) {
          return { output: "", error: `Could not parse repository from remote URL: ${remoteUrl}` };
        }

        // Remove .git suffix if present
        repoPath = repoPath.replace(/\.git$/, "");

        const prTitle = input.title || `Changes from ${currentBranch}`;
        const prBody = input.body || "Created by Claire";
        const baseBranch = input.base || "main";

        try {
          const response = await fetch(`https://api.github.com/repos/${repoPath}/pulls`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github.v3+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title: prTitle,
              body: prBody,
              head: currentBranch,
              base: baseBranch,
            }),
          });

          const data = await response.json() as any;

          if (!response.ok) {
            // Check for common errors
            if (data.errors?.[0]?.message?.includes("A pull request already exists")) {
              return {
                output: `A pull request already exists for ${currentBranch}`,
                error: "PR already exists",
              };
            }
            return {
              output: JSON.stringify(data, null, 2),
              error: `GitHub API error: ${data.message || response.statusText}`,
            };
          }

          return {
            output: `Successfully created PR #${data.number}: ${data.html_url}`,
            metadata: {
              prNumber: data.number,
              prUrl: data.html_url,
              repo: repoPath,
              head: currentBranch,
              base: baseBranch,
            },
          };
        } catch (err: any) {
          return {
            output: "",
            error: `Failed to create PR: ${err.message}`,
          };
        }
      }

      default:
        return { output: "", error: `Unknown git operation: ${input.operation}` };
    }
  },
};
