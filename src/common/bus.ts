/**
 * Event Bus - Adapted from OpenCode
 *
 * Provides pub/sub for internal events like session updates,
 * job status changes, tool executions, and abort signals.
 */

type EventCallback<T = unknown> = (payload: T) => void | Promise<void>;

interface EventDefinition<T> {
  type: string;
  _phantom?: T;
}

// Define all event types
export const Events = {
  // Session events
  "session.created": { type: "session.created" } as EventDefinition<{
    sessionId: string;
    channelId: string;
    threadTs: string;
  }>,

  "session.updated": { type: "session.updated" } as EventDefinition<{
    sessionId: string;
    changes: Record<string, unknown>;
  }>,

  "session.config.updated": { type: "session.config.updated" } as EventDefinition<{
    sessionId: string;
    key: string;
    value: unknown;
  }>,

  "session.abort": { type: "session.abort" } as EventDefinition<{
    sessionId: string;
  }>,

  "session.stop": { type: "session.stop" } as EventDefinition<{
    sessionId: string;
  }>,

  // Job events
  "job.queued": { type: "job.queued" } as EventDefinition<{
    jobId: string;
    sessionId: string;
    promptText: string;
  }>,

  "job.started": { type: "job.started" } as EventDefinition<{
    jobId: string;
    sessionId: string;
  }>,

  "job.progress": { type: "job.progress" } as EventDefinition<{
    jobId: string;
    sessionId: string;
    message: string;
  }>,

  "job.completed": { type: "job.completed" } as EventDefinition<{
    jobId: string;
    sessionId: string;
    summary: string;
  }>,

  "job.failed": { type: "job.failed" } as EventDefinition<{
    jobId: string;
    sessionId: string;
    error: string;
  }>,

  // Tool events
  "tool.executing": { type: "tool.executing" } as EventDefinition<{
    sessionId: string;
    jobId: string;
    tool: string;
    input: Record<string, unknown>;
  }>,

  "tool.completed": { type: "tool.completed" } as EventDefinition<{
    sessionId: string;
    jobId: string;
    tool: string;
    output: string;
  }>,

  "tool.error": { type: "tool.error" } as EventDefinition<{
    sessionId: string;
    jobId: string;
    tool: string;
    error: string;
  }>,

  // Artifact events
  "artifact.created": { type: "artifact.created" } as EventDefinition<{
    artifactId: string;
    sessionId: string;
    jobId: string;
    type: string;
    filename: string;
  }>,

  // Git events
  "git.operation": { type: "git.operation" } as EventDefinition<{
    sessionId: string;
    jobId: string;
    operation: string;
    repo: string;
    branch: string;
    commit?: string;
  }>,
} as const;

type EventTypes = typeof Events;
type EventKey = keyof EventTypes;
type EventPayload<K extends EventKey> = EventTypes[K] extends EventDefinition<infer T>
  ? T
  : never;

class EventBus {
  private subscribers = new Map<string, Set<EventCallback>>();

  /**
   * Subscribe to an event type
   */
  subscribe<K extends EventKey>(
    event: K | EventDefinition<EventPayload<K>>,
    callback: EventCallback<EventPayload<K>>
  ): () => void {
    const eventType = typeof event === "string" ? event : event.type;
    let subs = this.subscribers.get(eventType);

    if (!subs) {
      subs = new Set();
      this.subscribers.set(eventType, subs);
    }

    subs.add(callback as EventCallback);

    // Return unsubscribe function
    return () => {
      subs?.delete(callback as EventCallback);
    };
  }

  /**
   * Subscribe to all events (wildcard)
   */
  subscribeAll(callback: EventCallback<{ type: string; payload: unknown }>): () => void {
    return this.subscribe("*" as any, callback as any);
  }

  /**
   * Publish an event - use Events["event.name"] as the first parameter
   */
  async publish<T>(
    event: EventDefinition<T>,
    payload: T
  ): Promise<void> {
    const eventType = typeof event === "string" ? event : event.type;

    // Notify specific subscribers
    const subs = this.subscribers.get(eventType);
    if (subs) {
      for (const callback of subs) {
        try {
          await callback(payload);
        } catch (err) {
          console.error(`Event handler error for ${eventType}:`, err);
        }
      }
    }

    // Notify wildcard subscribers
    const wildcardSubs = this.subscribers.get("*");
    if (wildcardSubs) {
      for (const callback of wildcardSubs) {
        try {
          await callback({ type: eventType, payload });
        } catch (err) {
          console.error(`Wildcard event handler error:`, err);
        }
      }
    }
  }

  /**
   * Clear all subscribers (for testing)
   */
  clear(): void {
    this.subscribers.clear();
  }
}

// Singleton instance
export const Bus = new EventBus();
