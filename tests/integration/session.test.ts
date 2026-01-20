/**
 * Session Integration Tests
 *
 * Tests session management with mocked storage.
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import { SessionManager, JobManager } from "../../src/session";

// Mock the storage module
const mockStorage = {
  sessions: {
    findByThread: mock(() => Promise.resolve(null)),
    findById: mock(() => Promise.resolve(null)),
    create: mock((session: any) => Promise.resolve(session)),
    update: mock(() => Promise.resolve()),
  },
  channelConfig: {
    get: mock(() => Promise.resolve(null)),
    set: mock(() => Promise.resolve()),
  },
  jobs: {
    create: mock((job: any) => Promise.resolve(job)),
    findById: mock(() => Promise.resolve(null)),
    findNextQueued: mock(() => Promise.resolve(null)),
    update: mock(() => Promise.resolve()),
    clearQueued: mock(() => Promise.resolve(0)),
  },
  messages: {
    findBySession: mock(() => Promise.resolve([])),
    upsertBatch: mock(() => Promise.resolve()),
  },
};

// Mock getStorage
mock.module("../../src/storage", () => ({
  getStorage: () => Promise.resolve(mockStorage),
}));

// Mock Bus
mock.module("../../src/common/bus", () => ({
  Bus: {
    publish: mock(() => Promise.resolve()),
    subscribe: mock(() => () => {}),
  },
  Events: {
    "session.created": "session.created",
    "session.config.updated": "session.config.updated",
    "session.abort": "session.abort",
    "session.stop": "session.stop",
    "job.queued": "job.queued",
    "job.started": "job.started",
    "job.completed": "job.completed",
    "job.failed": "job.failed",
  },
}));

describe("SessionManager", () => {
  beforeEach(() => {
    // Reset mocks
    mockStorage.sessions.findByThread.mockReset();
    mockStorage.sessions.findById.mockReset();
    mockStorage.sessions.create.mockReset();
    mockStorage.channelConfig.get.mockReset();
  });

  describe("resolveOrCreate", () => {
    test("creates new session when none exists", async () => {
      mockStorage.sessions.findByThread.mockImplementation(() => Promise.resolve(null));
      mockStorage.sessions.create.mockImplementation((session: any) => Promise.resolve(session));

      const session = await SessionManager.resolveOrCreate({
        channelId: "C123",
        threadTs: "1234567890.123456",
      });

      expect(session).toBeDefined();
      expect(session.channelId).toBe("C123");
      expect(session.threadTs).toBe("1234567890.123456");
      expect(session.status).toBe("idle");
    });

    test("returns existing session when found", async () => {
      const existingSession = {
        id: "existing-id",
        channelId: "C123",
        threadTs: "1234567890.123456",
        config: { mode: "code" },
        status: "idle",
      };

      mockStorage.sessions.findByThread.mockImplementation(() => Promise.resolve(existingSession));

      const session = await SessionManager.resolveOrCreate({
        channelId: "C123",
        threadTs: "1234567890.123456",
      });

      expect(session.id).toBe("existing-id");
      expect(mockStorage.sessions.create).not.toHaveBeenCalled();
    });
  });

  describe("applyControl", () => {
    test("updates repo in session config", async () => {
      const session = {
        id: "test-id",
        channelId: "C123",
        threadTs: "1234567890.123456",
        config: { mode: "code" },
        status: "idle",
      };

      mockStorage.sessions.findById.mockImplementation(() => Promise.resolve(session));
      mockStorage.sessions.update.mockImplementation(() => Promise.resolve());

      const result = await SessionManager.applyControl("test-id", {
        type: "repo",
        value: "owner/repo",
      });

      expect(result).toBeNull(); // No response message for repo update
      expect(mockStorage.sessions.update).toHaveBeenCalled();
    });

    test("returns help text for help control", async () => {
      const session = {
        id: "test-id",
        channelId: "C123",
        threadTs: "1234567890.123456",
        config: { mode: "code" },
        status: "idle",
      };

      mockStorage.sessions.findById.mockImplementation(() => Promise.resolve(session));

      const result = await SessionManager.applyControl("test-id", { type: "help" });

      expect(result).toBeDefined();
      expect(result).toContain("Claire Help");
    });

    test("returns save confirmation for save control", async () => {
      const session = {
        id: "test-id",
        channelId: "C123",
        threadTs: "1234567890.123456",
        config: { mode: "code" },
        status: "idle",
      };

      mockStorage.sessions.findById.mockImplementation(() => Promise.resolve(session));

      const result = await SessionManager.applyControl("test-id", { type: "save" });

      expect(result).toContain("Session saved");
      expect(result).toContain("test-id");
    });
  });
});

describe("JobManager", () => {
  beforeEach(() => {
    mockStorage.jobs.create.mockReset();
    mockStorage.jobs.update.mockReset();
    mockStorage.jobs.findById.mockReset();
  });

  describe("enqueue", () => {
    test("creates a new job", async () => {
      mockStorage.jobs.create.mockImplementation((job: any) => Promise.resolve(job));

      const job = await JobManager.enqueue({
        sessionId: "session-123",
        promptMessageTs: "1234567890.123456",
        promptText: "Fix the bug",
        userId: "U123",
      });

      expect(job).toBeDefined();
      expect(job.sessionId).toBe("session-123");
      expect(job.promptText).toBe("Fix the bug");
      expect(job.status).toBe("queued");
    });
  });

  describe("start", () => {
    test("marks job as running", async () => {
      const job = {
        id: "job-123",
        sessionId: "session-123",
        status: "queued",
      };

      mockStorage.jobs.findById.mockImplementation(() => Promise.resolve(job));
      mockStorage.jobs.update.mockImplementation(() => Promise.resolve());

      await JobManager.start("job-123");

      expect(mockStorage.jobs.update).toHaveBeenCalledWith(
        "job-123",
        expect.objectContaining({ status: "running" })
      );
    });
  });

  describe("complete", () => {
    test("marks job as succeeded", async () => {
      const job = {
        id: "job-123",
        sessionId: "session-123",
        status: "running",
      };

      mockStorage.jobs.findById.mockImplementation(() => Promise.resolve(job));
      mockStorage.jobs.update.mockImplementation(() => Promise.resolve());

      await JobManager.complete("job-123", "Task completed successfully");

      expect(mockStorage.jobs.update).toHaveBeenCalledWith(
        "job-123",
        expect.objectContaining({
          status: "succeeded",
          resultSummary: "Task completed successfully",
        })
      );
    });
  });

  describe("fail", () => {
    test("marks job as failed", async () => {
      const job = {
        id: "job-123",
        sessionId: "session-123",
        status: "running",
      };

      mockStorage.jobs.findById.mockImplementation(() => Promise.resolve(job));
      mockStorage.jobs.update.mockImplementation(() => Promise.resolve());

      await JobManager.fail("job-123", "Something went wrong");

      expect(mockStorage.jobs.update).toHaveBeenCalledWith(
        "job-123",
        expect.objectContaining({
          status: "failed",
          resultSummary: "Something went wrong",
        })
      );
    });
  });
});
