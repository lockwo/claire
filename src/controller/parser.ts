/**
 * Control Parser
 *
 * Parses control commands and task text from user messages.
 * Supports: repo=, branch=, model=, scope=, mode=, stop, abort, save, load=, profile=
 */

import type { ControlUpdate } from "../common/schema";

// Control patterns - order matters (more specific first)
const CONTROL_PATTERNS: Array<{
  type: ControlUpdate["type"];
  pattern: RegExp;
  hasValue: boolean;
}> = [
  { type: "repo", pattern: /repo=(\S+)/i, hasValue: true },
  { type: "branch", pattern: /branch=(\S+)/i, hasValue: true },
  { type: "model", pattern: /model=(\S+)/i, hasValue: true },
  { type: "scope", pattern: /scope=(thread|channel(?::last_\d+[dh]?)?)/i, hasValue: true },
  { type: "mode", pattern: /mode=(code|chat)/i, hasValue: true },
  { type: "reasoning", pattern: /reasoning=(none|low|medium|high|xhigh|auto)/i, hasValue: true },
  { type: "verbosity", pattern: /verbosity=(low|medium|high)/i, hasValue: true },
  { type: "websearch", pattern: /websearch=(on|off|true|false)/i, hasValue: true },
  { type: "codeinterpreter", pattern: /codeinterpreter=(on|off|true|false)/i, hasValue: true },
  { type: "load", pattern: /load=([a-f0-9-]+)/i, hasValue: true },
  { type: "profile", pattern: /profile=(build|show|clear)(?::<@([A-Z0-9]+)>|:(\S+))?/i, hasValue: true },
  { type: "abort", pattern: /\babort\b/i, hasValue: false },
  { type: "stop", pattern: /\bstop\b/i, hasValue: false },
  { type: "save", pattern: /\bsave\b/i, hasValue: false },
  { type: "help", pattern: /\bhelp\b/i, hasValue: false },
];

// Special keyword that triggers maximum reasoning (xhigh)
const ULTRATHINK_PATTERN = /\bultrathink\b/i;

export interface ParseResult {
  controls: ControlUpdate[];
  taskText: string;
  hasMention: boolean;
  ultrathink: boolean; // True if "ultrathink" keyword was found
}

/**
 * Parse controls and task text from a message
 */
export function parseMessage(text: string, botUserId?: string): ParseResult {
  const controls: ControlUpdate[] = [];
  let taskText = text;

  // Check for and remove @claire mention
  const mentionPattern = botUserId
    ? new RegExp(`<@${botUserId}>`, "gi")
    : /<@[A-Z0-9]+>/gi;

  const hasMention = mentionPattern.test(taskText);
  taskText = taskText.replace(mentionPattern, "").trim();

  // Check for "ultrathink" keyword (triggers xhigh reasoning)
  const ultrathink = ULTRATHINK_PATTERN.test(taskText);
  if (ultrathink) {
    // Add reasoning=xhigh control and remove the keyword from text
    controls.push({ type: "reasoning", value: "xhigh" });
    taskText = taskText.replace(ULTRATHINK_PATTERN, "").trim();
  }

  // Extract controls
  for (const { type, pattern, hasValue } of CONTROL_PATTERNS) {
    const match = taskText.match(pattern);
    if (match) {
      // Don't add duplicate reasoning control if ultrathink already added it
      if (type === "reasoning" && ultrathink) {
        taskText = taskText.replace(pattern, "").trim();
        continue;
      }

      // Special handling for profile command with target user
      if (type === "profile") {
        const command = match[1]; // build, show, or clear
        const targetUser = match[2] || match[3]; // Slack user ID or username
        controls.push({
          type,
          value: targetUser ? `${command}:${targetUser}` : command,
        });
      } else {
        controls.push({
          type,
          value: hasValue && match[1] ? match[1] : undefined,
        });
      }
      taskText = taskText.replace(pattern, "").trim();
    }
  }

  // Clean up extra whitespace
  taskText = taskText.replace(/\s+/g, " ").trim();

  return { controls, taskText, hasMention, ultrathink };
}

/**
 * Check if a message contains only control commands (no task)
 */
export function isControlOnly(result: ParseResult): boolean {
  return result.controls.length > 0 && result.taskText === "";
}

/**
 * Check if message is an abort request
 */
export function isAbort(result: ParseResult): boolean {
  return result.controls.some((c) => c.type === "abort");
}

/**
 * Check if message is a stop request
 */
export function isStop(result: ParseResult): boolean {
  return result.controls.some((c) => c.type === "stop");
}

/**
 * Extract repo from various formats:
 * - owner/repo
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/tree/main
 * - git@github.com:owner/repo.git
 */
export function normalizeRepo(repo: string): string {
  // Already in owner/repo format
  if (/^[\w-]+\/[\w.-]+$/.test(repo)) {
    return repo;
  }

  // HTTPS URL (handles extra path segments like /tree/main, /blob/main/file.ts, etc.)
  const httpsMatch = repo.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git|\/|$)/);
  if (httpsMatch?.[1] && httpsMatch?.[2]) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  // SSH URL
  const sshMatch = repo.match(/git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch?.[1]) {
    return sshMatch[1];
  }

  return repo;
}

/**
 * Generate branch name from task description
 */
export function generateBranchName(taskText: string): string {
  const timestamp = Date.now().toString(36);
  const slug = taskText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);

  return `claire/${slug || "task"}-${timestamp}`;
}
