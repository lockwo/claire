import { z } from "zod";

// Environment configuration schema
const EnvSchema = z.object({
  // Slack
  SLACK_BOT_TOKEN: z.string().startsWith("xoxb-"),
  SLACK_APP_TOKEN: z.string().startsWith("xapp-"),
  SLACK_SIGNING_SECRET: z.string().optional(),

  // LLM Providers
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),

  // Default model (auto-detected from available API keys if not set)
  DEFAULT_MODEL: z.string().optional(),

  // GitHub
  GITHUB_TOKEN: z.string().optional(),

  // Database
  DATABASE_URL: z.string().optional(),

  // Storage
  GCS_BUCKET: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),

  // Local development
  USE_LOCAL_STORAGE: z
    .string()
    .transform((v) => v === "true")
    .default("true"),
  LOCAL_DATA_DIR: z.string().default("./data"),

  // Runtime
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  LOG_FORMAT: z.enum(["text", "json"]).default("text"),

  // Worker config
  WORKER_IDLE_TIMEOUT_MS: z.coerce.number().default(600000), // 10 minutes
  WORKER_MAX_RUNTIME_MS: z.coerce.number().default(1800000), // 30 minutes
  MAX_AGENT_ITERATIONS: z.coerce.number().default(50),
});

export type Env = z.infer<typeof EnvSchema>;

// Parse and validate environment
function loadConfig(): Env {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    console.error("Configuration error:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }

    // In development, continue with defaults for optional fields
    if (process.env.NODE_ENV !== "production") {
      console.warn("Running with partial configuration (development mode)");
      return EnvSchema.parse({
        ...process.env,
        SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || "xoxb-placeholder",
        SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN || "xapp-placeholder",
      });
    }

    throw new Error("Invalid configuration");
  }

  return result.data;
}

// Singleton config instance
let _config: Env | null = null;

export function getConfig(): Env {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

// Model configuration
const FALLBACK_MODEL = "gpt-5.2"; // Best model for coding and agentic tasks

/**
 * Get default model - auto-detects from available API keys if not set
 * Prioritizes gpt-5.2 as it's the best model for coding and agentic tasks
 */
export function getDefaultModel(): string {
  const config = getConfig();

  // Use explicit default if set
  if (config.DEFAULT_MODEL) {
    return config.DEFAULT_MODEL;
  }

  // Auto-detect based on available API keys (prefer OpenAI for coding tasks)
  if (config.OPENAI_API_KEY) {
    return "gpt-5.2";
  }
  if (config.ANTHROPIC_API_KEY) {
    return "claude-sonnet-4-5-20250929";
  }
  if (config.OPENROUTER_API_KEY) {
    return "gpt-4o";
  }

  return FALLBACK_MODEL;
}

export const DEFAULT_MODEL = FALLBACK_MODEL;

export const MODEL_CONFIG = {
  // Claude 4.5 models (latest)
  "claude-sonnet-4-5-20250929": {
    provider: "anthropic" as const,
    maxTokens: 64000,
    temperature: 0,
  },
  "claude-haiku-4-5-20250929": {
    provider: "anthropic" as const,
    maxTokens: 64000,
    temperature: 0,
  },
  "claude-opus-4-5-20250929": {
    provider: "anthropic" as const,
    maxTokens: 64000,
    temperature: 0,
  },
  // Claude 4 models (legacy)
  "claude-sonnet-4-20250514": {
    provider: "anthropic" as const,
    maxTokens: 8192,
    temperature: 0,
  },
  "claude-opus-4-20250514": {
    provider: "anthropic" as const,
    maxTokens: 8192,
    temperature: 0,
  },
  // GPT-5.2 frontier models
  "gpt-5.2": {
    provider: "openai" as const,
    maxTokens: 32768,
    temperature: 0,
  },
  "gpt-5-mini": {
    provider: "openai" as const,
    maxTokens: 32768,
    temperature: 0,
  },
  "gpt-5-nano": {
    provider: "openai" as const,
    maxTokens: 16384,
    temperature: 0,
  },
  "gpt-5.2-pro": {
    provider: "openai" as const,
    maxTokens: 32768,
    temperature: 0,
  },
  // GPT-4.1 models
  "gpt-4.1": {
    provider: "openai" as const,
    maxTokens: 32768,
    temperature: 0,
  },
  "gpt-4.1-mini": {
    provider: "openai" as const,
    maxTokens: 16384,
    temperature: 0,
  },
  // Legacy models
  "gpt-4o": {
    provider: "openai" as const,
    maxTokens: 16384,
    temperature: 0,
  },
  "gpt-4o-mini": {
    provider: "openai" as const,
    maxTokens: 16384,
    temperature: 0,
  },
} as const;

export type ModelId = keyof typeof MODEL_CONFIG;

export function getModelConfig(modelId: string) {
  return MODEL_CONFIG[modelId as ModelId] || MODEL_CONFIG[DEFAULT_MODEL];
}
