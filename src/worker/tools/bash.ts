/**
 * Bash Tool
 *
 * Execute shell commands with timeout and output capture.
 */

import { z } from "zod";
import { spawn } from "child_process";
import type { Tool, ToolContext, ToolResult } from "./types";

const BashInput = z.object({
  command: z.string().describe("The shell command to execute"),
  timeout: z.number().nullish().describe("Timeout in milliseconds (default: 120000 = 2 minutes)"),
});

type BashInput = z.infer<typeof BashInput>;

export const BashTool: Tool<BashInput> = {
  name: "bash",
  description: "Execute a shell command. Use this for git operations, running scripts, installing packages, compiling code, etc.",
  parameters: BashInput,

  async execute(input: BashInput, ctx: ToolContext): Promise<ToolResult> {
    if (ctx.mode === "chat") {
      return {
        output: "",
        error: "Bash execution not allowed in chat mode",
      };
    }

    const timeout = input.timeout || 120000;
    const maxOutput = 30000; // Max characters to capture

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let killed = false;

      // Spawn shell process
      const proc = spawn("bash", ["-c", input.command], {
        cwd: ctx.workDir,
        env: {
          ...process.env,
          HOME: process.env.HOME,
          PATH: process.env.PATH,
        },
        timeout,
      });

      // Handle abort signal
      const abortHandler = () => {
        killed = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill("SIGKILL");
          }
        }, 5000);
      };

      ctx.abort.addEventListener("abort", abortHandler);

      // Capture stdout
      proc.stdout.on("data", (data) => {
        const str = data.toString();
        if (stdout.length + str.length <= maxOutput) {
          stdout += str;
        } else if (stdout.length < maxOutput) {
          stdout += str.slice(0, maxOutput - stdout.length);
          stdout += "\n... (output truncated)";
        }
      });

      // Capture stderr
      proc.stderr.on("data", (data) => {
        const str = data.toString();
        if (stderr.length + str.length <= maxOutput) {
          stderr += str;
        } else if (stderr.length < maxOutput) {
          stderr += str.slice(0, maxOutput - stderr.length);
          stderr += "\n... (output truncated)";
        }
      });

      // Handle completion
      proc.on("close", (code) => {
        ctx.abort.removeEventListener("abort", abortHandler);

        let output = "";
        if (stdout) output += stdout;
        if (stderr) output += (output ? "\n" : "") + `[stderr]\n${stderr}`;

        if (killed) {
          resolve({
            output: output || "(no output)",
            error: "Command was aborted",
            metadata: { exitCode: code, killed: true },
          });
        } else if (code !== 0) {
          resolve({
            output: output || "(no output)",
            error: `Command exited with code ${code}`,
            metadata: { exitCode: code },
          });
        } else {
          resolve({
            output: output || "(no output)",
            metadata: { exitCode: 0 },
          });
        }
      });

      proc.on("error", (err) => {
        ctx.abort.removeEventListener("abort", abortHandler);
        resolve({
          output: "",
          error: `Failed to execute command: ${err.message}`,
        });
      });
    });
  },
};
