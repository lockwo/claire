/**
 * LLM Distiller
 *
 * Takes raw meeting utterances and extracts structured tasks.
 * Uses gpt-5-nano for fast, cheap classification.
 */

import { z } from "zod";
import OpenAI from "openai";
import { getConfig } from "../../common/config";

// Structured output schema - nullable to handle LLM returning null for optional fields
export const DistilledTask = z.object({
  isActionable: z.boolean(),
  confidence: z.number().min(0).max(1),
  task: z.string().nullable().optional(),
  targetFile: z.string().nullable().optional(),
  operation: z
    .enum(["create", "edit", "delete", "search", "execute", "other"])
    .nullable()
    .optional(),
  reasoning: z.string().nullable().optional(),
});
export type DistilledTask = z.infer<typeof DistilledTask>;

const DISTILLER_PROMPT = `You are a task extraction system for an AI assistant called Claire who is listening to a meeting.

Claire is a "fly on the wall" - she should proactively help by:
1. Answering ANY questions asked in the meeting (even if not directed at her)
2. Implementing ideas or suggestions when people express them
3. Running code, creating visualizations, or doing analysis when discussed

Context: Claire can read/write files, run bash commands, interact with git, execute code, create plots, send messages to Slack, and answer questions.

BE VERY INCLUSIVE. If there's ANY way Claire could be helpful, mark it actionable.

ACTIONABLE (Claire should act):
- Direct requests: "Claire, do X" -> always actionable
- Any question: "What's the capital of France?" -> Claire should answer
- "I wonder how..." or "Does anyone know..." -> Claire should answer
- Suggestions: "We should try X" -> Claire should do X
- Ideas: "Maybe we could plot this" -> Claire should create the plot
- Proposals: "What if we generated sample data" -> Claire should generate it
- Technical discussion: "We need a function that validates emails" -> Claire should write it
- Math/analysis: "Let's multiply these Gaussian variables" -> Claire should compute it
- Exploration: "How would a transformer work here?" -> Claire should explain/prototype

NOT ACTIONABLE (ignore these):
- Pure logistics: "Let me share my screen", "Can everyone see this?"
- Meeting scheduling: "Let's sync next week", "Maybe we can meet up later", "Schedule a follow-up"
- Personal status: "I'll be right back", "Sorry I'm late"
- Social chit-chat: "How's everyone doing?", "Hope everyone is well"
- Simple acknowledgments with no substance: "Yeah", "Okay", "Got it", "Sounds good"
- Meeting wrap-up: "Does anyone have anything to add?", "That's all for today"

When in doubt, mark it actionable. Claire would rather help too much than miss an opportunity.

Respond with JSON only. Schema:
{
  "isActionable": boolean,
  "confidence": number (0-1),
  "task": string | null,
  "targetFile": string | null,
  "operation": "create" | "edit" | "delete" | "search" | "execute" | "other" | null,
  "reasoning": string
}

Respond with JSON only. Schema:
{
  "isActionable": boolean,
  "confidence": number (0-1),
  "task": string | null,
  "targetFile": string | null,
  "operation": "create" | "edit" | "delete" | "search" | "execute" | "other" | null,
  "reasoning": string
}`;

/**
 * Distill an utterance into a structured task using LLM.
 * Returns whether the utterance is actionable and the extracted task.
 */
export async function distillUtterance(
  utterance: string,
  speaker: string,
  recentContext?: string[]
): Promise<DistilledTask> {
  const config = getConfig();

  const client = new OpenAI({
    apiKey: config.OPENAI_API_KEY,
  });

  // Build context message
  let contextMsg = `Speaker: ${speaker}\nUtterance: "${utterance}"`;
  if (recentContext && recentContext.length > 0) {
    contextMsg += `\n\nRecent conversation context:\n${recentContext.slice(-5).join("\n")}`;
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-5-nano", // Fast and cheap
      messages: [
        { role: "system", content: DISTILLER_PROMPT },
        { role: "user", content: contextMsg },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 512,
      reasoning_effort: "low",
    });

    const content = response.choices[0]?.message.content;
    if (!content) {
      return { isActionable: false, confidence: 0, reasoning: "No response" };
    }

    const parsed = JSON.parse(content);
    return DistilledTask.parse(parsed);
  } catch (err) {
    console.error(`[distiller] Error:`, err);
    return {
      isActionable: false,
      confidence: 0,
      reasoning: `Distillation failed: ${err}`,
    };
  }
}
