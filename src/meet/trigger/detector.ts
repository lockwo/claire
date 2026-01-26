/**
 * Trigger Detector
 *
 * Identifies utterances that may contain actionable requests.
 * Uses keyword matching for fast first-pass filtering.
 */

export interface TriggerCandidate {
  text: string;
  speaker: string;
  timestamp: Date;
  confidence: number;
  matchedKeywords: string[];
}

// Keywords that suggest an actionable request (passive detection - no "claire" required)
const ACTION_KEYWORDS = [
  // Task indicators - things people say when proposing work
  "let's try",
  "we should",
  "can we",
  "could we",
  "let's add",
  "let's fix",
  "let's update",
  "let's create",
  "let's write",
  "we need to",
  "i'll add",
  "i'll fix",
  "i'll create",
  "let's",
  "we could",
  "what if",
  "maybe we",
  "how about",
  "i wonder",
  "does anyone know",

  // Direct action proposals
  "add a",
  "create a",
  "write a",
  "build a",
  "fix the",
  "update the",
  "change the",
  "implement",
  "refactor",
  "generate",
  "plot",
  "visualize",
  "calculate",
  "compute",
  "analyze",
  "test",
  "run",

  // Code-specific triggers
  "new endpoint",
  "new function",
  "new component",
  "new feature",
  "bug fix",
  "pull request",
  "pr for",
  "commit",
  "deploy",

  // Explicit requests (optional - if someone does say claire)
  "claire",

  // Questions/curiosity - Claire should answer these
  "what is",
  "what's",
  "how do",
  "how does",
  "why is",
  "why does",
  "can you explain",
  "what are",
  "where is",
  "which",
  "capital of",
  "meaning of",
];

// Negative patterns that indicate non-actionable speech
const IGNORE_PATTERNS = [
  /^(um|uh|like|you know|basically|actually|so)\b/i,
  /\?(yes|no|okay|sure|right)\s*$/i, // Questions seeking confirmation
  /^(thanks|thank you|great|perfect|awesome|cool|nice)\b/i, // Acknowledgments
  /^(yeah|yep|yup|mhm|uh-huh)/i, // Affirmations
  /^(i think|i feel|i guess|maybe|probably)\b.*\?$/i, // Uncertain questions
  // Social chit-chat - greetings and status checks
  /how('?s| is| are) everyone( doing)?/i,
  /how('?s| is| are) (it going|things)/i,
  /how are you( doing)?/i,
  /good morning|good afternoon|good evening/i,
  /hope everyone('?s| is) (doing )?(well|good|great)/i,
  /let me share my screen/i,
  /can (everyone|you all) (see|hear)/i,
  /i('?ll| will) be right back/i,
  /sorry i('?m| am) late/i,
  // Meeting logistics - scheduling, syncs, availability
  /maybe we can (sync|meet|connect|catch up) (back )?(next|later|tomorrow)/i,
  /want to meet up/i,
  /schedule a (sync|meeting|call|follow-?up)/i,
  /let('?s| us) (sync|meet|connect) (next|later)/i,
  /does anyone (else )?have anything to add/i,
  /that('?s| is) (it|all) for (today|this meeting)/i,
];

// Minimum text length to consider
const MIN_TEXT_LENGTH = 10;

/**
 * Detect if an utterance is a potential trigger for Claire.
 * Returns null if not a candidate, or a TriggerCandidate with confidence score.
 */
export function detectTrigger(
  text: string,
  speaker: string
): TriggerCandidate | null {
  const normalizedText = text.toLowerCase().trim();

  // Skip very short utterances
  if (normalizedText.length < MIN_TEXT_LENGTH) {
    return null;
  }

  // Skip non-actionable patterns
  for (const pattern of IGNORE_PATTERNS) {
    if (pattern.test(normalizedText)) {
      return null;
    }
  }

  // Check for keyword matches
  const matchedKeywords: string[] = [];
  for (const keyword of ACTION_KEYWORDS) {
    if (normalizedText.includes(keyword.toLowerCase())) {
      matchedKeywords.push(keyword);
    }
  }

  // Check if this is a question (any question mark in substantive text)
  const isQuestion = normalizedText.includes("?") && normalizedText.length > 15;

  // Pass through if: has keyword matches OR is a question
  if (matchedKeywords.length === 0 && !isQuestion) {
    return null;
  }

  // Add "question" as a matched keyword for questions
  if (isQuestion && matchedKeywords.length === 0) {
    matchedKeywords.push("question");
  }

  // Calculate confidence based on matches and text structure
  let confidence = 0.35 + matchedKeywords.length * 0.15;

  // Boost for questions - Claire should answer these
  if (isQuestion) {
    confidence += 0.25;
  }

  // Boost for proposal language ("let's", "we should", "can we")
  if (/\b(let's|we should|can we|could we|we need to)\b/i.test(normalizedText)) {
    confidence += 0.2;
  }

  // Boost for specific action + target ("add a function", "fix the bug")
  if (/\b(add|create|write|fix|update|implement|build)\s+(a|the|an)\s+\w+/i.test(normalizedText)) {
    confidence += 0.15;
  }

  // Boost for code-related nouns
  const codeNouns = [
    "function", "endpoint", "component", "feature", "bug", "test",
    "file", "class", "method", "api", "database", "query",
  ];
  if (codeNouns.some((k) => normalizedText.includes(k))) {
    confidence += 0.15;
  }

  // Slight penalty for very short text (might be incomplete)
  if (normalizedText.length < 30) {
    confidence -= 0.1;
  }

  // Boost if someone explicitly says "claire" (optional but helpful)
  if (normalizedText.includes("claire")) {
    confidence += 0.2;
  }

  // Cap confidence
  confidence = Math.max(0.1, Math.min(confidence, 0.95));

  return {
    text,
    speaker,
    timestamp: new Date(),
    confidence,
    matchedKeywords,
  };
}
