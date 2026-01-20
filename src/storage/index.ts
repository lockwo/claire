/**
 * Storage abstraction layer
 *
 * Provides a unified interface for persisting sessions, jobs, artifacts, etc.
 * Supports both local file storage (development) and PostgreSQL (production).
 */

import type {
  Session,
  Job,
  Artifact,
  GitAction,
  MessageSnapshot,
  ChannelConfig,
  UserProfile,
} from "../common/schema";
import { getConfig } from "../common/config";
import { createLocalStorage } from "./local";
import type { LocalStorage } from "./local";

// Storage interface
export interface Storage {
  // Sessions
  sessions: {
    create(session: Session): Promise<Session>;
    findById(id: string): Promise<Session | null>;
    findByThread(params: { channelId: string; threadTs: string }): Promise<Session | null>;
    update(id: string, updates: Partial<Session>): Promise<Session>;
    delete(id: string): Promise<void>;
  };

  // Jobs
  jobs: {
    create(job: Job): Promise<Job>;
    findById(id: string): Promise<Job | null>;
    findBySession(sessionId: string): Promise<Job[]>;
    findNextQueued(sessionId: string): Promise<Job | null>;
    update(id: string, updates: Partial<Job>): Promise<Job>;
    clearQueued(sessionId: string): Promise<number>;
  };

  // Artifacts
  artifacts: {
    create(artifact: Artifact): Promise<Artifact>;
    findById(id: string): Promise<Artifact | null>;
    findByJob(jobId: string): Promise<Artifact[]>;
    findBySession(sessionId: string): Promise<Artifact[]>;
  };

  // Git Actions
  gitActions: {
    create(action: GitAction): Promise<GitAction>;
    findByJob(jobId: string): Promise<GitAction[]>;
    findBySession(sessionId: string): Promise<GitAction[]>;
  };

  // Message Snapshots
  messages: {
    create(message: MessageSnapshot): Promise<MessageSnapshot>;
    findBySession(sessionId: string): Promise<MessageSnapshot[]>;
    upsertBatch(messages: MessageSnapshot[]): Promise<void>;
  };

  // Channel Config (for last-used repo per channel)
  channelConfig: {
    get(channelId: string): Promise<ChannelConfig | null>;
    set(config: ChannelConfig): Promise<ChannelConfig>;
  };

  // User Profiles (persistent memory of user preferences)
  profiles: {
    get(userId: string): Promise<UserProfile | null>;
    create(profile: UserProfile): Promise<UserProfile>;
    update(userId: string, updates: Partial<UserProfile>): Promise<UserProfile>;
    list(): Promise<UserProfile[]>;
  };
}

// Singleton storage instance
let _storage: Storage | null = null;

export async function getStorage(): Promise<Storage> {
  if (_storage) return _storage;

  const config = getConfig();

  if (config.USE_LOCAL_STORAGE) {
    _storage = await createLocalStorage(config.LOCAL_DATA_DIR);
  } else {
    // TODO: Implement PostgreSQL storage
    throw new Error("PostgreSQL storage not yet implemented. Set USE_LOCAL_STORAGE=true");
  }

  return _storage;
}

// Re-export for convenience
export { createLocalStorage };
export type { LocalStorage };
