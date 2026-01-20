/**
 * Logger
 *
 * Structured logging with levels, context, and file output.
 * Logs to both console and file simultaneously.
 */

import * as fs from "fs";
import * as path from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Ensure log directory exists
const LOG_DIR = process.env.LOG_DIR || "./logs";
const LOG_FILE = path.join(LOG_DIR, "claire.log");

let fileStream: fs.WriteStream | null = null;

function getFileStream(): fs.WriteStream | null {
  if (fileStream) return fileStream;

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fileStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
    fileStream.on("error", (err) => {
      console.error("Log file write error:", err);
      fileStream = null;
    });
    return fileStream;
  } catch (err) {
    console.error("Failed to create log file:", err);
    return null;
  }
}

class Logger {
  private minLevel: LogLevel;
  private json: boolean;
  private context: Record<string, unknown> = {};

  constructor() {
    this.minLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
    this.json = process.env.LOG_FORMAT === "json";
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Record<string, unknown>): Logger {
    const child = new Logger();
    child.minLevel = this.minLevel;
    child.json = this.json;
    child.context = { ...this.context, ...context };
    return child;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private formatMessage(entry: LogEntry, forFile: boolean): string {
    // Always use JSON for file output (easier to parse later)
    if (this.json || forFile) {
      return JSON.stringify(entry);
    }

    const levelStr = entry.level.toUpperCase().padEnd(5);
    const contextStr =
      entry.context && Object.keys(entry.context).length > 0
        ? ` ${JSON.stringify(entry.context)}`
        : "";

    return `${entry.timestamp} [${levelStr}] ${entry.message}${contextStr}`;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: { ...this.context, ...context },
    };

    // Console output (human-readable or JSON based on LOG_FORMAT)
    const consoleFormatted = this.formatMessage(entry, false);
    if (level === "error") {
      console.error(consoleFormatted);
    } else if (level === "warn") {
      console.warn(consoleFormatted);
    } else {
      console.log(consoleFormatted);
    }

    // File output (always JSON for easy parsing)
    const stream = getFileStream();
    if (stream) {
      const fileFormatted = this.formatMessage(entry, true);
      stream.write(fileFormatted + "\n");
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log("error", message, context);
  }
}

// Global logger instance
export const logger = new Logger();

// Convenience function to create contextual loggers
export function createLogger(context: Record<string, unknown>): Logger {
  return logger.child(context);
}

// Graceful shutdown
export function closeLogger(): void {
  if (fileStream) {
    fileStream.end();
    fileStream = null;
  }
}
