/**
 * Agent Loop
 *
 * The core agent execution loop. Handles:
 * - Building context from thread messages
 * - Calling LLM with tools
 * - Executing tool calls
 * - Iterating until completion or max iterations
 */

import type { WebClient } from "@slack/web-api";
import type { Session, Job, MessageSnapshot } from "../common/schema";
import { ToolRegistry, type Tool, type ToolContext, type ToolResult } from "./tools";
import { callLLM, type LLMMessage, type ContentBlock, type ToolUse } from "./llm";
import { Bus, Events } from "../common/bus";
import { getConfig } from "../common/config";
import { detectGPU, getGPUSummary, type GPUInfo } from "../common/gpu";
import { ensureProfile } from "../session/profiles";
import * as fs from "fs/promises";
import * as path from "path";

export interface AgentContext {
  session: Session;
  job: Job;
  messages: MessageSnapshot[];
  abort: AbortSignal;
  slackClient: WebClient;
}

export interface AgentResult {
  summary: string;
  toolsUsed: string[];
  iterations: number;
}

/**
 * Build the system prompt for Claire
 */
function buildSystemPrompt(session: Session, gpuInfo: GPUInfo, userProfile?: string): string {
  const parts: string[] = [
    `You are Claire, an AI coding assistant operating in a Slack thread.`,
    ``,
    `Your job is to help the user with software engineering tasks by reading, writing, and executing code.`,
    ``,
    `IMPORTANT: You have FULL ACCESS to Slack thread attachments. Files shared in the thread (PDFs, .tex, .py, images, etc.) have been automatically downloaded and their text content is included in the conversation below. When users ask "can you see X file?" the answer is YES if it appears in the [Attachments:] blocks. You can work directly with this content.`,
    ``,
  ];

  // Add user profile if available
  if (userProfile) {
    parts.push(
      `== USER PROFILE ==`,
      `The following profile describes this user's preferences and interaction style. Use it to personalize your responses:`,
      ``,
      userProfile,
      ``,
      `== END PROFILE ==`,
      ``
    );
  }

  parts.push(
    `Current configuration:`,
    `- Repository: ${session.config.repo || "Not specified (use bash to clone if needed)"}`,
    `- Branch: ${session.config.branch || "auto (will create a new branch)"}`,
    `- Mode: ${session.config.mode}`,
    `- Compute: ${getGPUSummary(gpuInfo)}`,
    ``
  );

  if (session.config.mode === "code") {
    parts.push(
      `You have FULL ROOT ACCESS to this dedicated worker node. You can do anything:`,
      `- Run any command with sudo (no password required)`,
      `- Install system packages (apt, yum, brew, etc.)`,
      `- Modify system files, configure services`,
      `- Access the network, download files, make API calls`,
      `- This is YOUR sandbox - use it freely`,
      ``,
      `For running code, plotting, or data analysis:`,
      `- Use the bash tool to run code locally on this machine`,
      `- Python, pip, Node.js, npm, and common dev tools are pre-installed`,
      `- Try "python3" if "python" doesn't work (and "pip3" instead of "pip")`,
      `- Install any packages you need: pip install, npm install, apt install, etc.`,
      `- Save output files (images, PDFs) to the current directory`,
      `- Generated files will be automatically uploaded to Slack`,
      ``,
      `Example for plotting:`,
      `  bash: pip3 install matplotlib && python3 -c "import matplotlib.pyplot as plt; plt.plot([1,2,3],[10,20,30]); plt.savefig('plot.png')"`,
      ``,
      gpuInfo.available
        ? `GPU acceleration is available (${gpuInfo.type.toUpperCase()}). Use CUDA/PyTorch/TensorFlow for compute-intensive tasks.`
        : `No GPU available. Use CPU-only implementations for ML/compute tasks.`,
      ``,
      `When working with git repositories:`,
      `1. Clone the repo if not already present: git clone https://github.com/{owner}/{repo}.git repo`,
      `2. Navigate into the repo directory: all paths should be relative to ./repo/`,
      `3. Checkout or create the specified branch`,
      `4. Make your changes using the edit/write tools`,
      `5. Commit with clear, descriptive messages`,
      `6. Push when done`,
      ``
    );
  } else {
    parts.push(
      `You are in chat mode - read-only access. You can read files and search but not modify anything.`,
      ``
    );
  }

  parts.push(
    `Important guidelines:`,
    `- Be concise but thorough in your responses`,
    `- Show your work - explain what you're doing before doing it`,
    `- If something fails, explain why and try a different approach`,
    `- Always confirm what you've done at the end`,
  );

  return parts.join("\n");
}

/**
 * Convert thread messages to LLM conversation format
 */
function buildConversation(
  messages: MessageSnapshot[],
  currentTask: string,
  botUserId?: string
): LLMMessage[] {
  const conversation: LLMMessage[] = [];

  // Add thread context
  for (const msg of messages) {
    // Skip the message that contains the current task (we'll add it at the end)
    if (msg.text.includes(currentTask.slice(0, 50))) {
      continue;
    }

    // Determine if this is from the bot (assistant) or user
    const isBot = botUserId && msg.userId === botUserId;
    const role = isBot ? "assistant" : "user";

    // Build content including any attachments
    let content = msg.text || "";

    if (msg.attachments.length > 0) {
      content += "\n\n[Attachments:";
      for (const att of msg.attachments) {
        content += `\n- ${att.name} (${att.mimetype})`;
        if (att.extractedText) {
          // Include full attachment text - GPT-5.2 has 128k+ context
          content += `\n\`\`\`\n${att.extractedText}\n\`\`\``;
        }
      }
      content += "]";
    }

    if (content.trim()) {
      conversation.push({ role, content });
    }
  }

  // Add current task
  conversation.push({ role: "user", content: currentTask });

  return conversation;
}

/**
 * Run the agent loop
 */
export async function runAgentLoop(ctx: AgentContext): Promise<AgentResult> {
  const config = getConfig();
  const { session, job, messages, abort } = ctx;

  // Set up work directory
  const workDir = `/tmp/claire/${session.id}`;
  await fs.mkdir(workDir, { recursive: true });

  // Record job start time for artifact collection
  const jobStartTime = Date.now();

  // Detect GPU for system prompt
  const gpuInfo = await detectGPU();

  // Look up or create user profile for personalization
  let userProfileText: string | undefined;
  try {
    const userProfile = await ensureProfile(job.userId);
    if (userProfile.profile) {
      userProfileText = userProfile.profile;
    }
  } catch {
    // Profile lookup failed, continue without it
  }

  // Resolve tools based on mode
  const tools = ToolRegistry.resolve(session.config.mode);

  // Build tool context
  const toolCtx: ToolContext = {
    workDir,
    sessionId: session.id,
    jobId: job.id,
    abort,
    mode: session.config.mode,
  };

  // Build system prompt and conversation
  const systemPrompt = buildSystemPrompt(session, gpuInfo, userProfileText);
  const conversation = buildConversation(messages, job.promptText);

  // Track state
  const toolsUsed = new Set<string>();
  let iterations = 0;
  let assistantText = "";

  // Agent loop
  while (iterations < config.MAX_AGENT_ITERATIONS) {
    abort.throwIfAborted();
    iterations++;

    console.log(`[agent] Iteration ${iterations}, ${conversation.length} messages`);

    // Call LLM
    const response = await callLLM({
      model: session.config.model,
      systemPrompt,
      messages: conversation,
      tools,
      abort,
      reasoningEffort: session.config.reasoningEffort,
      verbosity: session.config.verbosity,
      enableWebSearch: session.config.enableWebSearch,
      enableCodeInterpreter: session.config.enableCodeInterpreter,
    });

    assistantText = response.text;

    // If no tool calls, we're done
    if (response.toolCalls.length === 0 || response.stopReason === "end_turn") {
      console.log(`[agent] Completed with stop_reason=${response.stopReason}`);
      break;
    }

    // Build assistant message with tool uses
    const assistantContent: ContentBlock[] = [];

    if (response.text) {
      assistantContent.push({ type: "text", text: response.text });
    }

    for (const tc of response.toolCalls) {
      assistantContent.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.input,
      });
    }

    conversation.push({ role: "assistant", content: assistantContent });

    // Execute tool calls
    const toolResults: ContentBlock[] = [];

    for (const tc of response.toolCalls) {
      abort.throwIfAborted();

      console.log(`[agent] Executing tool: ${tc.name}`);
      toolsUsed.add(tc.name);

      await Bus.publish(Events["tool.executing"], {
        sessionId: session.id,
        jobId: job.id,
        tool: tc.name,
        input: tc.input as Record<string, unknown>,
      });

      const result = await ToolRegistry.execute(
        { id: tc.id, name: tc.name, input: tc.input },
        tools,
        toolCtx
      );

      // Build result content
      let resultContent = result.output;
      if (result.error) {
        resultContent = `Error: ${result.error}\n${result.output}`;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: tc.id,
        content: resultContent.slice(0, 50000), // Truncate very long outputs
      });

      await Bus.publish(Events["tool.completed"], {
        sessionId: session.id,
        jobId: job.id,
        tool: tc.name,
        output: resultContent.slice(0, 500),
      });
    }

    // Add tool results as user message
    conversation.push({ role: "user", content: toolResults });
  }

  // Check for generated artifacts (only files created during this job)
  await collectArtifacts(workDir, session.id, job.id, jobStartTime);

  return {
    summary: assistantText || "Task completed.",
    toolsUsed: Array.from(toolsUsed),
    iterations,
  };
}

/**
 * Collect any generated artifacts (images, PDFs, etc.)
 * Only collects files created/modified after jobStartTime to avoid duplicates
 */
async function collectArtifacts(
  workDir: string,
  sessionId: string,
  jobId: string,
  jobStartTime: number
): Promise<void> {
  const { getStorage } = await import("../storage");
  const storage = await getStorage();

  // Look for common output files (exclude attachments subdirectory)
  const patterns = [
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.svg",
    "*.pdf",
  ];

  const { glob } = await import("glob");

  // Get existing artifacts for this session to avoid duplicates
  const existingArtifacts = await storage.artifacts.findBySession(sessionId);
  const existingPaths = new Set(existingArtifacts.map((a) => a.storageKey));

  // Pattern to detect Slack attachment ID prefixed files (e.g., F0A9XEJ7V8S_filename.png)
  const slackAttachmentPattern = /^F[A-Z0-9]{10,}_/;

  for (const pattern of patterns) {
    const files = await glob(pattern, {
      cwd: workDir,
      nodir: true,
      ignore: ["attachments/**"], // Ignore downloaded attachments directory
    });

    for (const file of files) {
      const basename = path.basename(file);

      // Skip files that look like Slack attachment copies
      if (slackAttachmentPattern.test(basename)) {
        console.log(`[agent] Skipping attachment copy: ${file}`);
        continue;
      }

      const filePath = path.join(workDir, file);

      // Skip if already collected in a previous job
      if (existingPaths.has(filePath)) {
        continue;
      }

      const stat = await fs.stat(filePath);

      // Only include files created/modified AFTER this job started
      if (stat.mtimeMs < jobStartTime) {
        continue;
      }

      // Determine type
      const ext = path.extname(file).toLowerCase();
      const type = ext === ".pdf" ? "pdf" : "image";

      await storage.artifacts.create({
        id: crypto.randomUUID(),
        sessionId,
        jobId,
        type,
        filename: basename,
        storageKey: filePath,
        createdAt: new Date(),
      });

      console.log(`[agent] Collected artifact: ${file}`);
    }
  }
}
