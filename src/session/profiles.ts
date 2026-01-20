/**
 * User Profile Management
 *
 * Builds and maintains user profiles from interaction history.
 * Profiles store preferences, communication style, and other notes
 * that help Claire personalize responses.
 */

import type { WebClient } from "@slack/web-api";
import type { UserProfile } from "../common/schema";
import { getStorage } from "../storage";
import { callLLM } from "../worker/llm";
import { getDefaultModel } from "../common/config";

const PROFILE_BUILD_PROMPT = `You are analyzing a user's message history to build a profile for a coding assistant called Claire.

Review these messages and extract:
1. **Communication preferences**: Do they prefer concise or detailed responses? Technical or simplified explanations?
2. **Coding preferences**: Languages, frameworks, coding style preferences (e.g., functional vs OOP, naming conventions)
3. **Visual preferences**: Color schemes, plot styles, formatting preferences mentioned
4. **Work patterns**: What kind of tasks do they typically ask for? Any recurring themes?
5. **Personality notes**: Any notable preferences, pet peeves, or interaction patterns

Write a concise profile (under 500 words) that Claire can use to personalize future interactions. Write in second person ("You prefer...", "You tend to...").

User's messages:
`;

const PROFILE_UPDATE_PROMPT = `You are updating a user profile based on a recent interaction with Claire.

Current profile:
{PROFILE}

Recent interaction:
User: {USER_MESSAGE}
Claire: {ASSISTANT_MESSAGE}

If the interaction reveals any new preferences, habits, or important details, update the profile. If nothing new is learned, return the profile unchanged.

Keep the profile under 500 words. Write in second person ("You prefer...", "You tend to...").

Updated profile:`;

const PROFILE_INITIAL_PROMPT = `You are creating an initial user profile based on a recent interaction with Claire, an AI coding assistant.

Recent interaction:
User: {USER_MESSAGE}
Claire: {ASSISTANT_MESSAGE}

Based on this interaction, create a brief initial profile noting any observable preferences, communication style, or technical interests. This is just a starting point - it will be refined over time.

Keep it concise (under 200 words). Write in second person ("You...").

Initial profile:`;

/**
 * Build a profile by scanning channel history for user messages
 */
export async function buildProfile(
  client: WebClient,
  channelId: string,
  userId: string
): Promise<UserProfile> {
  const storage = await getStorage();

  // Get user info for display name
  let displayName = userId;
  try {
    const userInfo = await client.users.info({ user: userId });
    displayName = userInfo.user?.real_name || userInfo.user?.name || userId;
  } catch {
    // Fall back to user ID
  }

  // Fetch channel history
  const messages: string[] = [];
  let cursor: string | undefined;

  // Paginate through channel history to find user's messages
  for (let page = 0; page < 10; page++) {
    const result = await client.conversations.history({
      channel: channelId,
      limit: 200,
      cursor,
    });

    for (const msg of result.messages || []) {
      if (msg.user === userId && msg.text) {
        messages.push(msg.text);
      }
    }

    if (!result.has_more || !result.response_metadata?.next_cursor) break;
    cursor = result.response_metadata.next_cursor;

    // Stop after collecting enough messages
    if (messages.length >= 100) break;
  }

  if (messages.length === 0) {
    throw new Error(`No messages found from user ${displayName} in this channel`);
  }

  // Use LLM to analyze messages and build profile
  const prompt = PROFILE_BUILD_PROMPT + messages.slice(0, 50).join("\n\n---\n\n");

  const response = await callLLM({
    messages: [{ role: "user", content: prompt }],
    model: getDefaultModel(),
    systemPrompt: "You are a helpful assistant that builds user profiles.",
    tools: [],
    maxTokens: 1000,
  });

  const profileText = response.text || "Profile could not be generated";

  // Create or update profile
  const now = new Date();
  const existing = await storage.profiles.get(userId);

  if (existing) {
    return await storage.profiles.update(userId, {
      displayName,
      profile: profileText,
      interactionCount: messages.length,
      updatedAt: now,
    });
  }

  const profile: UserProfile = {
    userId,
    displayName,
    profile: profileText,
    interactionCount: messages.length,
    createdAt: now,
    updatedAt: now,
  };

  return await storage.profiles.create(profile);
}

/**
 * Get a user's profile
 */
export async function getProfile(userId: string): Promise<UserProfile | null> {
  const storage = await getStorage();
  return storage.profiles.get(userId);
}

/**
 * Ensure a profile exists for a user, creating a basic one if not
 */
export async function ensureProfile(userId: string, displayName?: string): Promise<UserProfile> {
  const storage = await getStorage();
  const existing = await storage.profiles.get(userId);

  if (existing) {
    return existing;
  }

  // Create a basic profile
  const now = new Date();
  const profile: UserProfile = {
    userId,
    displayName: displayName || userId,
    profile: "", // Empty profile, will be enriched over time
    interactionCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  return await storage.profiles.create(profile);
}

/**
 * Clear a user's profile
 */
export async function clearProfile(userId: string): Promise<void> {
  const storage = await getStorage();
  const existing = await storage.profiles.get(userId);
  if (existing) {
    // Update with empty profile instead of deleting (keeps the record)
    await storage.profiles.update(userId, {
      profile: "",
      interactionCount: 0,
      updatedAt: new Date(),
    });
  }
}

/**
 * Update profile after an interaction (incremental learning)
 * Creates a profile if none exists and starts building from interactions
 */
export async function updateProfileFromInteraction(
  userId: string,
  userMessage: string,
  assistantMessage: string
): Promise<void> {
  const storage = await getStorage();
  let existing = await storage.profiles.get(userId);

  // Ensure profile exists
  if (!existing) {
    const now = new Date();
    existing = await storage.profiles.create({
      userId,
      displayName: userId,
      profile: "",
      interactionCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Increment interaction count
  const newCount = (existing.interactionCount || 0) + 1;

  // Only update with LLM periodically (every 5 interactions) to avoid excessive calls
  // But always update if profile is empty and we have at least 3 interactions
  const shouldUpdate = newCount % 5 === 0 || (!existing.profile && newCount >= 3);

  if (!shouldUpdate) {
    await storage.profiles.update(userId, {
      interactionCount: newCount,
    });
    return;
  }

  // Use LLM to build or update profile
  const prompt = existing.profile
    ? PROFILE_UPDATE_PROMPT
        .replace("{PROFILE}", existing.profile)
        .replace("{USER_MESSAGE}", userMessage)
        .replace("{ASSISTANT_MESSAGE}", assistantMessage.slice(0, 2000))
    : PROFILE_INITIAL_PROMPT
        .replace("{USER_MESSAGE}", userMessage)
        .replace("{ASSISTANT_MESSAGE}", assistantMessage.slice(0, 2000));

  try {
    const response = await callLLM({
      messages: [{ role: "user", content: prompt }],
      model: getDefaultModel(),
      systemPrompt: "You are a helpful assistant that builds user profiles.",
      tools: [],
      maxTokens: 800,
    });

    const updatedProfile = response.text || existing.profile;

    await storage.profiles.update(userId, {
      profile: updatedProfile,
      interactionCount: newCount,
    });
  } catch {
    // If update fails, just increment count
    await storage.profiles.update(userId, {
      interactionCount: newCount,
    });
  }
}

/**
 * Format profile for display
 */
export function formatProfileForDisplay(profile: UserProfile): string {
  return `*Profile for ${profile.displayName}*
_Last updated: ${profile.updatedAt.toLocaleDateString()}_
_Based on ${profile.interactionCount} interactions_

${profile.profile || "_No profile data yet_"}`;
}
