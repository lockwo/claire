/**
 * Claire Meet Captions - Content Script
 *
 * Runs on Google Meet pages to capture live captions.
 * Uses targeted detection and debouncing for clean caption extraction.
 */

(function () {
  "use strict";

  // === CONFIGURATION ===

  // How long to wait for caption to stabilize before sending (ms)
  // This needs to be long enough for the speaker to finish their complete thought
  const DEBOUNCE_MS = 2000;  // 2 seconds of no changes = speaker finished

  // How often to poll for caption changes (ms)
  const POLL_INTERVAL_MS = 300;

  // Minimum caption length to consider valid
  const MIN_CAPTION_LENGTH = 10;

  // === UI GARBAGE DETECTION ===

  // These patterns indicate UI text, not spoken captions
  const GARBAGE_PATTERNS = [
    // Language names (from language selector)
    /^[A-Z][a-z]+ \([A-Z][a-z]+\)(?:BETA)?$/,  // "English (Australia)BETA"
    /^[A-Z][a-z]+(?:BETA)?$/,  // "EnglishBETA" or "English"
    /BETA$/,

    // UI elements
    /^(arrow_downward|arrow_upward|closed_caption|format_size|circle|settings|language)/i,
    /^Jump to (bottom|top)/i,
    /^(Turn (on|off)|Live|Translated) captions?/i,
    /^(Font (size|color)|Open caption settings)/i,
    /^(Default|Tiny|Small|Medium|Large|Huge|Jumbo)$/i,
    /^(White|Black|Blue|Green|Red|Yellow|Cyan|Magenta)$/i,

    // Language list items
    /^(Afrikaans|Albanian|Amharic|Arabic|Armenian|Azerbaijani|Basque|Bengali|Bulgarian|Burmese|Catalan|Chinese|Czech|Dutch|English|Estonian|Filipino|Finnish|French|Galician|Georgian|German|Greek|Gujarati|Hebrew|Hindi|Hungarian|Icelandic|Indonesian|Italian|Japanese|Javanese|Kannada|Kazakh|Khmer|Kinyarwanda|Korean|Lao|Latvian|Lithuanian|Macedonian|Malay|Malayalam|Marathi|Mongolian|Nepali|Norwegian|Persian|Polish|Portuguese|Romanian|Russian|Serbian|Sesotho|Sinhala|Slovak|Slovenian|Spanish|Sundanese|Swahili|Swati|Swedish|Tamil|Telugu|Thai|Tshivenda|Tswana|Turkish|Ukrainian|Urdu|Uzbek|Vietnamese|Xhosa|Xitsonga|Zulu)/i,

    // Multi-language concatenated strings (the big language lists)
    /English.*French.*German/i,
    /BETA.*BETA.*BETA/,
  ];

  // If text contains any of these substrings, it's garbage
  const GARBAGE_SUBSTRINGS = [
    "arrow_downward",
    "arrow_upward",
    "closed_caption",
    "format_size",
    "Font size",
    "Font color",
    "caption settings",
    "Live captions",
    "Translated captions",
    "BETA",
  ];

  // UI text patterns to strip from captions (not reject, just remove)
  const UI_TEXT_TO_STRIP = [
    /arrow_downward/gi,
    /arrow_upward/gi,
    /Jump to (bottom|top)/gi,
    /closed_caption/gi,
    /format_size/gi,
  ];

  /**
   * Clean UI garbage from caption text
   */
  function cleanCaptionText(text) {
    let cleaned = text;
    for (const pattern of UI_TEXT_TO_STRIP) {
      cleaned = cleaned.replace(pattern, "");
    }
    // Remove trailing numbers/digits (often UI artifacts like participant count)
    cleaned = cleaned.replace(/\s*\d+\s*$/, "");
    // Collapse multiple spaces and trim
    return cleaned.replace(/\s+/g, " ").trim();
  }

  /**
   * Check if two texts are similar enough (>90% match)
   */
  function isSimilarText(text1, text2) {
    if (!text1 || !text2) return false;
    // If one is a prefix of the other (within a few chars), they're similar
    const shorter = text1.length < text2.length ? text1 : text2;
    const longer = text1.length < text2.length ? text2 : text1;
    // Check if shorter is a prefix of longer (allowing for minor differences)
    if (longer.startsWith(shorter)) return true;
    if (shorter.length > 20 && longer.slice(0, shorter.length) === shorter) return true;
    // Check character overlap
    let matches = 0;
    const minLen = Math.min(text1.length, text2.length);
    for (let i = 0; i < minLen; i++) {
      if (text1[i] === text2[i]) matches++;
    }
    return matches / Math.max(text1.length, text2.length) > 0.9;
  }

  // === STATE ===

  let isEnabled = false;
  let pollInterval = null;
  let lastCaptionText = "";
  let lastCaptionTime = 0;
  let debounceTimer = null;
  let pendingCaption = null;

  // Track what we've already processed to handle cumulative captions
  // Google Meet shows the full transcript, not just new words
  let processedTextLength = 0;  // How much of the transcript we've already seen
  let lastProcessedText = "";   // The full text we last processed

  console.log("[claire-ext] Content script loaded on Google Meet");

  // === MESSAGE HANDLING ===

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "TOGGLE_CAPTURE") {
      if (message.enabled) {
        startCapture();
      } else {
        stopCapture();
      }
      sendResponse({ success: true, enabled: isEnabled });
    } else if (message.type === "GET_STATUS") {
      sendResponse({ enabled: isEnabled, onMeetPage: true });
    }
    return true;
  });

  // === CAPTION DETECTION ===

  /**
   * Find the caption overlay element.
   * Google Meet displays captions in a specific overlay structure.
   */
  function findCaptionOverlay() {
    // Method 1: Look for the caption region by aria-label
    const regions = document.querySelectorAll('[role="region"]');
    for (const region of regions) {
      const label = region.getAttribute("aria-label") || "";
      if (label.toLowerCase().includes("caption")) {
        // Make sure it's not a settings panel
        if (!region.closest('[role="dialog"]') &&
            !region.closest('[role="menu"]') &&
            !region.querySelector('input, select, button[aria-haspopup]')) {
          return region;
        }
      }
    }

    // Method 2: Look for the caption display area at bottom of screen
    // Captions are typically in a fixed position container at the bottom
    const fixedElements = document.querySelectorAll('[style*="position: fixed"], [style*="position:fixed"]');
    for (const el of fixedElements) {
      const rect = el.getBoundingClientRect();
      // Caption overlay is typically at the bottom third of the screen
      if (rect.bottom > window.innerHeight * 0.6 && rect.height < 200) {
        // Check if it looks like caption text (has readable content, not buttons)
        const text = el.textContent?.trim() || "";
        if (text.length > 10 && !el.querySelector('button, input, [role="menu"]')) {
          return el;
        }
      }
    }

    return null;
  }

  /**
   * Extract speaker and text from caption overlay
   */
  function extractCaption(overlay) {
    if (!overlay) return null;

    const fullText = overlay.textContent?.trim() || "";
    if (!fullText) return null;

    // Look for speaker name badge (usually has specific styling)
    // Common patterns: "Name: text" or speaker badge followed by text
    let speaker = "Unknown";
    let text = fullText;

    // Try to find speaker badge elements
    const possibleBadges = overlay.querySelectorAll('[class*="speaker"], [class*="name"], .NWpY1d, .xoMHSc');
    for (const badge of possibleBadges) {
      const badgeText = badge.textContent?.trim();
      if (badgeText && badgeText.length < 50) {
        speaker = badgeText;
        // Remove speaker from full text
        text = fullText.replace(badgeText, "").trim();
        break;
      }
    }

    // Fallback: look for "Name:" pattern
    const colonMatch = fullText.match(/^([A-Za-z\s]+):\s*(.+)$/);
    if (colonMatch && speaker === "Unknown") {
      speaker = colonMatch[1].trim();
      text = colonMatch[2].trim();
    }

    return { speaker, text };
  }

  /**
   * Check if text is UI garbage rather than a real caption
   */
  function isGarbage(text) {
    if (!text) {
      console.log("[claire-ext] isGarbage: empty text");
      return true;
    }
    if (text.length < MIN_CAPTION_LENGTH) {
      console.log("[claire-ext] isGarbage: too short", text.length);
      return true;
    }

    // Check against garbage patterns
    for (const pattern of GARBAGE_PATTERNS) {
      if (pattern.test(text)) {
        console.log("[claire-ext] isGarbage: matched pattern", pattern.toString().slice(0, 50));
        return true;
      }
    }

    // Check for garbage substrings
    const lowerText = text.toLowerCase();
    for (const substr of GARBAGE_SUBSTRINGS) {
      if (lowerText.includes(substr.toLowerCase())) {
        console.log("[claire-ext] isGarbage: contains substring", substr);
        return true;
      }
    }

    // If text is mostly non-letter characters, it's probably garbage
    const letterCount = (text.match(/[a-zA-Z]/g) || []).length;
    if (letterCount < text.length * 0.5) {
      console.log("[claire-ext] isGarbage: low letter ratio", letterCount, "/", text.length);
      return true;
    }

    // If text contains too many capital letters in a row (language names), it's garbage
    if (/[A-Z]{3,}/.test(text) && !/I'[A-Z]/.test(text)) {
      const capsRatio = (text.match(/[A-Z]/g) || []).length / text.length;
      if (capsRatio > 0.3) {
        console.log("[claire-ext] isGarbage: high caps ratio", capsRatio);
        return true;
      }
    }

    return false;
  }

  /**
   * Send caption to background script
   */
  function sendCaption(speaker, text) {
    console.log("[claire-ext] Sending caption:", speaker, "-", text.slice(0, 80));

    browser.runtime.sendMessage({
      type: "CAPTION",
      speaker,
      text,
      timestamp: Date.now(),
      url: window.location.href,
    });
  }

  /**
   * Process a potential caption with debouncing.
   * Only sends after the caption has stabilized.
   *
   * IMPORTANT: Google Meet shows cumulative captions (full transcript),
   * so we need to extract only the NEW portion to avoid re-triggering
   * on the same "Claire" mention from earlier in the conversation.
   */
  function processCaption(speaker, fullText) {
    // Clean UI garbage from the text first
    const cleanedText = cleanCaptionText(fullText);

    // Skip very short text only
    if (!cleanedText || cleanedText.length < 20) {
      return;
    }

    const now = Date.now();

    // Use cleaned text from here on
    fullText = cleanedText;

    // Extract only the NEW portion of the transcript
    // If the new text starts with what we've already processed, extract the new part
    let newText = fullText;
    if (lastProcessedText && fullText.startsWith(lastProcessedText)) {
      newText = fullText.slice(lastProcessedText.length).trim();
    } else if (lastProcessedText && fullText.length > lastProcessedText.length) {
      // Sometimes punctuation/formatting changes - find the new portion
      // Look for common prefix and take what's after
      let commonLen = 0;
      const minLen = Math.min(lastProcessedText.length, fullText.length);
      for (let i = 0; i < minLen; i++) {
        if (lastProcessedText[i] === fullText[i]) {
          commonLen = i + 1;
        } else {
          break;
        }
      }
      if (commonLen > lastProcessedText.length * 0.8) {
        // >80% match, extract new portion
        newText = fullText.slice(commonLen).trim();
      }
    }

    // If no new content, skip
    if (!newText || newText.length < 5) {
      return;
    }

    // If this is the same text we already sent, skip
    if (newText === lastCaptionText && now - lastCaptionTime < 5000) {
      return;
    }

    // If we have a pending caption and the new text is very similar, don't reset the timer
    // This prevents dynamic UI elements (like participant counts) from resetting debounce
    if (pendingCaption && isSimilarText(pendingCaption.text, newText)) {
      // Update the text but don't reset timer
      pendingCaption.text = newText;
      pendingCaption.fullText = fullText;
      return;
    }

    // Update pending caption with latest text
    pendingCaption = { speaker, text: newText, fullText: fullText, time: now };
    console.log("[claire-ext] Caption queued, waiting 2s for stabilization:", newText.slice(0, 50));

    // Clear existing debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Set new debounce timer - send after 2 seconds of no NEW updates
    // The key insight: we send whatever pendingCaption has when timer fires,
    // even if fullText changed slightly (punctuation, etc.)
    debounceTimer = setTimeout(() => {
      if (pendingCaption) {
        console.log("[claire-ext] Debounce fired, sending caption:", pendingCaption.text.slice(0, 50));
        sendCaption(pendingCaption.speaker, pendingCaption.text);
        lastCaptionText = pendingCaption.text;
        lastCaptionTime = Date.now();
        // Update what we've processed to the FULL text at time of send
        lastProcessedText = pendingCaption.fullText;
        processedTextLength = pendingCaption.fullText.length;
        pendingCaption = null;
      }
    }, DEBOUNCE_MS);
  }

  /**
   * Poll for caption changes
   */
  let pollCount = 0;
  function pollCaptions() {
    pollCount++;
    const overlay = findCaptionOverlay();
    if (!overlay) {
      if (pollCount % 20 === 0) console.log("[claire-ext] Poll #" + pollCount + ": no overlay");
      return;
    }

    const caption = extractCaption(overlay);
    if (!caption || !caption.text) {
      if (pollCount % 20 === 0) console.log("[claire-ext] Poll #" + pollCount + ": overlay found but no caption text");
      return;
    }

    if (pollCount % 20 === 0) console.log("[claire-ext] Poll #" + pollCount + ": processing caption");
    processCaption(caption.speaker, caption.text);
  }

  // === CAPTURE CONTROL ===

  function startCapture() {
    if (isEnabled) return;

    console.log("[claire-ext] Starting caption capture (polling mode)");
    isEnabled = true;

    // Reset tracking state for fresh start
    processedTextLength = 0;
    lastProcessedText = "";
    lastCaptionText = "";
    lastCaptionTime = 0;
    pendingCaption = null;

    // Debug: Check for caption overlay on start
    const testOverlay = findCaptionOverlay();
    if (testOverlay) {
      console.log("[claire-ext] Found caption overlay:", testOverlay.textContent?.slice(0, 80));
    } else {
      console.log("[claire-ext] No caption overlay found yet - will keep polling");
    }

    // Poll for caption changes
    pollInterval = setInterval(pollCaptions, POLL_INTERVAL_MS);
    console.log("[claire-ext] Poll interval started, ID:", pollInterval);

    // Test immediate poll
    console.log("[claire-ext] Running immediate poll test...");
    pollCaptions();

    browser.runtime.sendMessage({ type: "CAPTURE_STARTED" });
  }

  function stopCapture() {
    if (!isEnabled) return;

    console.log("[claire-ext] Stopping caption capture");
    isEnabled = false;

    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // Reset all tracking state
    pendingCaption = null;
    processedTextLength = 0;
    lastProcessedText = "";
    lastCaptionText = "";
    lastCaptionTime = 0;

    browser.runtime.sendMessage({ type: "CAPTURE_STOPPED" });
  }

  // === AUTO-START ===

  function isInMeeting() {
    const leaveButton = document.querySelector(
      'button[aria-label*="Leave call"], button[aria-label*="Leave meeting"]'
    );
    return !!leaveButton;
  }

  browser.storage.local.get(["captureEnabled"]).then((result) => {
    if (result.captureEnabled) {
      setTimeout(() => {
        if (isInMeeting()) {
          startCapture();
        }
      }, 3000);
    }
  });

  window.addEventListener("beforeunload", () => {
    stopCapture();
  });
})();
