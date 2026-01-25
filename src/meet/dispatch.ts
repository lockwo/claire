/**
 * Meet Job Dispatcher
 *
 * Creates synthetic jobs from meeting triggers and routes them
 * through Claire's existing job infrastructure.
 */

import { SessionManager, JobManager } from "../session";
import { MeetBindingManager } from "./binding";
import type { DistilledTask } from "./trigger/distiller";
import type { TriggerCandidate } from "./trigger/detector";

export interface DispatchResult {
  success: boolean;
  jobId?: string;
  sessionId?: string;
  error?: string;
}

/**
 * Dispatch a Meet trigger as a Claire job.
 * Creates a synthetic job that routes through the existing scheduler.
 */
export async function dispatchMeetTrigger(
  meetUrl: string,
  trigger: TriggerCandidate,
  distilled: DistilledTask,
  overrideTarget?: { channelId: string; threadTs: string },
  meetingContext?: string
): Promise<DispatchResult> {
  let channelId: string;
  let threadTs: string;

  // Use override target if provided, otherwise resolve from binding
  if (overrideTarget) {
    channelId = overrideTarget.channelId;
    threadTs = overrideTarget.threadTs;
  } else {
    // Resolve binding to find target Slack thread
    const binding = await MeetBindingManager.resolve(meetUrl);
    if (!binding) {
      return {
        success: false,
        error: `No binding found for Meet URL: ${meetUrl}`,
      };
    }
    channelId = binding.channelId;
    threadTs = binding.threadTs;
  }

  // Resolve or create session for the bound thread
  const session = await SessionManager.resolveOrCreate({
    channelId,
    threadTs,
  });

  // Build the prompt text
  // Include context about where this came from and where responses go
  const promptText = buildPromptText(trigger, distilled, meetingContext, channelId);

  // Create synthetic job
  // Use "meet-" prefix for timestamp to identify Meet source
  // Use "meet:<speaker>" for userId
  const job = await JobManager.enqueue({
    sessionId: session.id,
    promptMessageTs: `meet-${Date.now()}`,
    promptText,
    userId: `meet:${trigger.speaker}`,
  });

  console.log(`[dispatch] Created job ${job.id} from Meet trigger`);
  console.log(`[dispatch] Speaker: ${trigger.speaker}`);
  console.log(`[dispatch] Task: ${distilled.task}`);

  return {
    success: true,
    jobId: job.id,
    sessionId: session.id,
  };
}

/**
 * Build the prompt text from trigger and distilled task.
 * Provides context for the agent about the source.
 */
function buildPromptText(
  trigger: TriggerCandidate,
  distilled: DistilledTask,
  meetingContext?: string,
  channelId?: string
): string {
  const parts: string[] = [];

  // Add context header
  parts.push(`[From Google Meet - ${trigger.speaker}]`);
  parts.push("");

  // Add important context about where responses go
  if (channelId) {
    parts.push(`Note: Your response will automatically be posted to Slack channel ${channelId}. If you create any files (plots, images, code), they will be automatically uploaded to Slack. Just create the file and mention it in your response.`);
    parts.push("");
  }

  // Add meeting context if provided
  if (meetingContext) {
    parts.push(`Meeting context: ${meetingContext}`);
    parts.push("");
  }

  // Use distilled task if available, otherwise use raw trigger text
  if (distilled.task) {
    parts.push(distilled.task);
  } else {
    parts.push(trigger.text);
  }

  // Add operation hint if available
  if (distilled.operation && distilled.targetFile) {
    parts.push("");
    parts.push(`(Suggested: ${distilled.operation} on ${distilled.targetFile})`);
  }

  return parts.join("\n");
}
