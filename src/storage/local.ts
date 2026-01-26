/**
 * Local file-based storage for development
 *
 * Stores data as JSON files in a local directory structure.
 * Not recommended for production - use PostgreSQL instead.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { Storage } from "./index";
import type {
  Session,
  Job,
  Artifact,
  GitAction,
  MessageSnapshot,
  ChannelConfig,
  UserProfile,
  MeetBinding,
} from "../common/schema";

export type LocalStorage = Storage;

interface DataStore {
  sessions: Map<string, Session>;
  jobs: Map<string, Job>;
  artifacts: Map<string, Artifact>;
  gitActions: Map<string, GitAction>;
  messages: Map<string, MessageSnapshot>;
  channelConfig: Map<string, ChannelConfig>;
  profiles: Map<string, UserProfile>;
  meetBindings: Map<string, MeetBinding>;
}

export async function createLocalStorage(dataDir: string): Promise<LocalStorage> {
  // Ensure data directory exists
  await fs.mkdir(dataDir, { recursive: true });

  const dataFile = path.join(dataDir, "store.json");

  // Load existing data or initialize empty
  let store: DataStore;
  try {
    const data = await fs.readFile(dataFile, "utf-8");
    const parsed = JSON.parse(data);
    store = {
      sessions: new Map(Object.entries(parsed.sessions || {})),
      jobs: new Map(Object.entries(parsed.jobs || {})),
      artifacts: new Map(Object.entries(parsed.artifacts || {})),
      gitActions: new Map(Object.entries(parsed.gitActions || {})),
      messages: new Map(Object.entries(parsed.messages || {})),
      channelConfig: new Map(Object.entries(parsed.channelConfig || {})),
      profiles: new Map(Object.entries(parsed.profiles || {})),
      meetBindings: new Map(Object.entries(parsed.meetBindings || {})),
    };
  } catch {
    store = {
      sessions: new Map(),
      jobs: new Map(),
      artifacts: new Map(),
      gitActions: new Map(),
      messages: new Map(),
      channelConfig: new Map(),
      profiles: new Map(),
      meetBindings: new Map(),
    };
  }

  // Persist helper
  async function persist() {
    const data = {
      sessions: Object.fromEntries(store.sessions),
      jobs: Object.fromEntries(store.jobs),
      artifacts: Object.fromEntries(store.artifacts),
      gitActions: Object.fromEntries(store.gitActions),
      messages: Object.fromEntries(store.messages),
      channelConfig: Object.fromEntries(store.channelConfig),
      profiles: Object.fromEntries(store.profiles),
      meetBindings: Object.fromEntries(store.meetBindings),
    };
    await fs.writeFile(dataFile, JSON.stringify(data, null, 2));
  }

  return {
    sessions: {
      async create(session: Session): Promise<Session> {
        store.sessions.set(session.id, session);
        await persist();
        return session;
      },

      async findById(id: string): Promise<Session | null> {
        return store.sessions.get(id) || null;
      },

      async findByThread({ channelId, threadTs }): Promise<Session | null> {
        for (const session of store.sessions.values()) {
          if (session.channelId === channelId && session.threadTs === threadTs) {
            return session;
          }
        }
        return null;
      },

      async update(id: string, updates: Partial<Session>): Promise<Session> {
        const session = store.sessions.get(id);
        if (!session) throw new Error(`Session ${id} not found`);

        const updated = { ...session, ...updates, updatedAt: new Date() };
        store.sessions.set(id, updated);
        await persist();
        return updated;
      },

      async delete(id: string): Promise<void> {
        store.sessions.delete(id);
        await persist();
      },
    },

    jobs: {
      async create(job: Job): Promise<Job> {
        store.jobs.set(job.id, job);
        await persist();
        return job;
      },

      async findById(id: string): Promise<Job | null> {
        return store.jobs.get(id) || null;
      },

      async findBySession(sessionId: string): Promise<Job[]> {
        return Array.from(store.jobs.values()).filter((j) => j.sessionId === sessionId);
      },

      async findNextQueued(sessionId: string): Promise<Job | null> {
        const jobs = Array.from(store.jobs.values())
          .filter((j) => j.sessionId === sessionId && j.status === "queued")
          .sort((a, b) => a.promptMessageTs.localeCompare(b.promptMessageTs));
        return jobs[0] || null;
      },

      async update(id: string, updates: Partial<Job>): Promise<Job> {
        const job = store.jobs.get(id);
        if (!job) throw new Error(`Job ${id} not found`);

        const updated = { ...job, ...updates };
        store.jobs.set(id, updated);
        await persist();
        return updated;
      },

      async clearQueued(sessionId: string): Promise<number> {
        let count = 0;
        for (const [id, job] of store.jobs.entries()) {
          if (job.sessionId === sessionId && job.status === "queued") {
            store.jobs.delete(id);
            count++;
          }
        }
        await persist();
        return count;
      },
    },

    artifacts: {
      async create(artifact: Artifact): Promise<Artifact> {
        store.artifacts.set(artifact.id, artifact);
        await persist();
        return artifact;
      },

      async findById(id: string): Promise<Artifact | null> {
        return store.artifacts.get(id) || null;
      },

      async findByJob(jobId: string): Promise<Artifact[]> {
        return Array.from(store.artifacts.values()).filter((a) => a.jobId === jobId);
      },

      async findBySession(sessionId: string): Promise<Artifact[]> {
        return Array.from(store.artifacts.values()).filter((a) => a.sessionId === sessionId);
      },
    },

    gitActions: {
      async create(action: GitAction): Promise<GitAction> {
        store.gitActions.set(action.id, action);
        await persist();
        return action;
      },

      async findByJob(jobId: string): Promise<GitAction[]> {
        return Array.from(store.gitActions.values()).filter((a) => a.jobId === jobId);
      },

      async findBySession(sessionId: string): Promise<GitAction[]> {
        return Array.from(store.gitActions.values()).filter((a) => a.sessionId === sessionId);
      },
    },

    messages: {
      async create(message: MessageSnapshot): Promise<MessageSnapshot> {
        store.messages.set(message.id, message);
        await persist();
        return message;
      },

      async findBySession(sessionId: string): Promise<MessageSnapshot[]> {
        return Array.from(store.messages.values())
          .filter((m) => m.sessionId === sessionId)
          .sort((a, b) => a.ts.localeCompare(b.ts));
      },

      async upsertBatch(messages: MessageSnapshot[]): Promise<void> {
        for (const msg of messages) {
          store.messages.set(msg.id, msg);
        }
        await persist();
      },
    },

    channelConfig: {
      async get(channelId: string): Promise<ChannelConfig | null> {
        return store.channelConfig.get(channelId) || null;
      },

      async set(config: ChannelConfig): Promise<ChannelConfig> {
        store.channelConfig.set(config.channelId, config);
        await persist();
        return config;
      },
    },

    profiles: {
      async get(userId: string): Promise<UserProfile | null> {
        return store.profiles.get(userId) || null;
      },

      async create(profile: UserProfile): Promise<UserProfile> {
        store.profiles.set(profile.userId, profile);
        await persist();
        return profile;
      },

      async update(userId: string, updates: Partial<UserProfile>): Promise<UserProfile> {
        const existing = store.profiles.get(userId);
        if (!existing) throw new Error(`Profile for ${userId} not found`);

        const updated = { ...existing, ...updates, updatedAt: new Date() };
        store.profiles.set(userId, updated);
        await persist();
        return updated;
      },

      async list(): Promise<UserProfile[]> {
        return Array.from(store.profiles.values());
      },
    },

    meetBindings: {
      async create(binding: MeetBinding): Promise<MeetBinding> {
        store.meetBindings.set(binding.meetUrl, binding);
        await persist();
        return binding;
      },

      async findByMeetUrl(meetUrl: string): Promise<MeetBinding | null> {
        return store.meetBindings.get(meetUrl) || null;
      },

      async findByThread({ channelId, threadTs }): Promise<MeetBinding | null> {
        for (const binding of store.meetBindings.values()) {
          if (binding.channelId === channelId && binding.threadTs === threadTs) {
            return binding;
          }
        }
        return null;
      },

      async delete(meetUrl: string): Promise<void> {
        store.meetBindings.delete(meetUrl);
        await persist();
      },

      async list(): Promise<MeetBinding[]> {
        return Array.from(store.meetBindings.values());
      },
    },
  };
}
