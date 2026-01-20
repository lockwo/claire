/**
 * Test Setup
 *
 * Common setup and utilities for tests.
 */

import { beforeAll, afterAll, mock } from "bun:test";

// Set test environment
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error"; // Suppress logs during tests

// Mock environment variables for tests
process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
process.env.SLACK_APP_TOKEN = "xapp-test-token";
process.env.OPENAI_API_KEY = "sk-test-key";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

/**
 * Create a mock function that can be used to track calls
 */
export function createMockFn<T extends (...args: any[]) => any>(): jest.Mock<T> {
  const calls: Parameters<T>[] = [];
  const fn = ((...args: Parameters<T>) => {
    calls.push(args);
    return undefined as ReturnType<T>;
  }) as jest.Mock<T>;

  fn.mock = { calls } as any;
  fn.mockReturnValue = (value: ReturnType<T>) => {
    return Object.assign(fn, {
      ...fn,
      apply: () => value,
    });
  };
  fn.mockResolvedValue = (value: Awaited<ReturnType<T>>) => {
    const newFn = ((...args: Parameters<T>) => {
      calls.push(args);
      return Promise.resolve(value) as ReturnType<T>;
    }) as jest.Mock<T>;
    newFn.mock = { calls } as any;
    return newFn;
  };
  fn.mockRejectedValue = (error: Error) => {
    const newFn = ((...args: Parameters<T>) => {
      calls.push(args);
      return Promise.reject(error) as ReturnType<T>;
    }) as jest.Mock<T>;
    newFn.mock = { calls } as any;
    return newFn;
  };

  return fn;
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 5000,
  intervalMs: number = 50
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/**
 * Create a deferred promise for testing async behavior
 */
export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

// Type declaration for Jest-like mock (Bun compatible)
declare global {
  namespace jest {
    interface Mock<T extends (...args: any[]) => any> {
      (...args: Parameters<T>): ReturnType<T>;
      mock: { calls: Parameters<T>[] };
      mockReturnValue(value: ReturnType<T>): Mock<T>;
      mockResolvedValue(value: Awaited<ReturnType<T>>): Mock<T>;
      mockRejectedValue(error: Error): Mock<T>;
    }
  }
}
