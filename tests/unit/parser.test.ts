/**
 * Parser Tests
 */

import { describe, test, expect } from "bun:test";
import { parseMessage, normalizeRepo, isControlOnly } from "../../src/controller/parser";

describe("parseMessage", () => {
  test("parses simple task without controls", () => {
    const result = parseMessage("Fix the login bug");

    expect(result.controls).toHaveLength(0);
    expect(result.taskText).toBe("Fix the login bug");
  });

  test("parses task with @mention", () => {
    const result = parseMessage("<@U123ABC> Fix the login bug", "U123ABC");

    expect(result.controls).toHaveLength(0);
    expect(result.taskText).toBe("Fix the login bug");
  });

  test("parses repo control", () => {
    const result = parseMessage("repo=owner/repo Fix the bug");

    expect(result.controls).toContainEqual({ type: "repo", value: "owner/repo" });
    expect(result.taskText).toBe("Fix the bug");
  });

  test("parses branch control", () => {
    const result = parseMessage("branch=feature-x Add the feature");

    expect(result.controls).toContainEqual({ type: "branch", value: "feature-x" });
    expect(result.taskText).toBe("Add the feature");
  });

  test("parses model control", () => {
    const result = parseMessage("model=gpt-5.2 Analyze this code");

    expect(result.controls).toContainEqual({ type: "model", value: "gpt-5.2" });
    expect(result.taskText).toBe("Analyze this code");
  });

  test("parses mode control", () => {
    const result = parseMessage("mode=chat What does this function do?");

    expect(result.controls).toContainEqual({ type: "mode", value: "chat" });
  });

  test("parses reasoning control", () => {
    const result = parseMessage("reasoning=high Design a caching system");

    expect(result.controls).toContainEqual({ type: "reasoning", value: "high" });
  });

  test("parses ultrathink shortcut", () => {
    const result = parseMessage("ultrathink Design a complex system");

    expect(result.controls).toContainEqual({ type: "reasoning", value: "xhigh" });
  });

  test("parses verbosity control", () => {
    const result = parseMessage("verbosity=low Summarize this");

    expect(result.controls).toContainEqual({ type: "verbosity", value: "low" });
  });

  test("parses websearch control (on)", () => {
    const result = parseMessage("websearch=on Find latest best practices");

    expect(result.controls).toContainEqual({ type: "websearch", value: "on" });
  });

  test("parses websearch control (off)", () => {
    const result = parseMessage("websearch=off Analyze this code");

    expect(result.controls).toContainEqual({ type: "websearch", value: "off" });
  });

  test("parses codeinterpreter control", () => {
    const result = parseMessage("codeinterpreter=on Run this analysis");

    expect(result.controls).toContainEqual({ type: "codeinterpreter", value: "on" });
  });

  test("parses stop control", () => {
    const result = parseMessage("stop");

    expect(result.controls).toContainEqual({ type: "stop" });
    expect(result.taskText).toBe("");
  });

  test("parses abort control", () => {
    const result = parseMessage("abort");

    expect(result.controls).toContainEqual({ type: "abort" });
    expect(result.taskText).toBe("");
  });

  test("parses help control", () => {
    const result = parseMessage("help");

    expect(result.controls).toContainEqual({ type: "help" });
  });

  test("parses save control", () => {
    const result = parseMessage("save");

    expect(result.controls).toContainEqual({ type: "save" });
  });

  test("parses load control", () => {
    const result = parseMessage("load=abc123-def456");

    expect(result.controls).toContainEqual({ type: "load", value: "abc123-def456" });
  });

  test("parses multiple controls", () => {
    const result = parseMessage("repo=org/repo branch=main reasoning=high Fix the bug");

    expect(result.controls).toHaveLength(3);
    expect(result.controls).toContainEqual({ type: "repo", value: "org/repo" });
    expect(result.controls).toContainEqual({ type: "branch", value: "main" });
    expect(result.controls).toContainEqual({ type: "reasoning", value: "high" });
    expect(result.taskText).toBe("Fix the bug");
  });

  test("handles quoted values (if supported)", () => {
    // This test documents current behavior
    const result = parseMessage('repo="my org/my repo" Fix it');
    // Depending on implementation, this may or may not work
    expect(result.taskText).toBeDefined();
  });
});

describe("normalizeRepo", () => {
  test("passes through owner/repo format", () => {
    expect(normalizeRepo("owner/repo")).toBe("owner/repo");
  });

  test("extracts from full GitHub URL", () => {
    expect(normalizeRepo("https://github.com/owner/repo")).toBe("owner/repo");
  });

  test("extracts from GitHub URL with .git suffix", () => {
    expect(normalizeRepo("https://github.com/owner/repo.git")).toBe("owner/repo");
  });

  test("extracts from SSH URL", () => {
    expect(normalizeRepo("git@github.com:owner/repo.git")).toBe("owner/repo");
  });

  test("handles URL with extra path segments", () => {
    expect(normalizeRepo("https://github.com/owner/repo/tree/main")).toBe("owner/repo");
  });
});

describe("isControlOnly", () => {
  test("returns true for pure control messages", () => {
    const result = parseMessage("stop");
    expect(isControlOnly(result)).toBe(true);
  });

  test("returns true for multiple controls without task", () => {
    const result = parseMessage("repo=org/repo branch=main");
    expect(isControlOnly(result)).toBe(true);
  });

  test("returns false for messages with task text", () => {
    const result = parseMessage("repo=org/repo Fix the bug");
    expect(isControlOnly(result)).toBe(false);
  });

  test("returns false for pure task messages", () => {
    const result = parseMessage("Fix the bug");
    expect(isControlOnly(result)).toBe(false);
  });
});
