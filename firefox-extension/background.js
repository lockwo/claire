/**
 * Claire Meet Captions - Background Script
 *
 * Handles communication between content script and Claire backend.
 * Batches captions and sends them to the API.
 */

// Configuration
const DEFAULT_API_URL = "http://localhost:3000";
const BATCH_INTERVAL_MS = 1000; // Send captions every second
const MAX_BATCH_SIZE = 20;
const MAX_CAPTION_AGE_MS = 10000; // Discard captions older than 10 seconds

// State
let captionBuffer = [];
let batchTimer = null;
let config = {
  apiUrl: DEFAULT_API_URL,
  channelId: "",
  threadTs: "",
  meetingContext: "",
  enabled: false,
};

// Load saved config
browser.storage.local.get(["claireConfig"]).then((result) => {
  if (result.claireConfig) {
    config = { ...config, ...result.claireConfig };
    console.log("[claire-ext] Loaded config:", config);
  }
});

// Listen for messages from content script and popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "CAPTION":
      handleCaption(message);
      break;

    case "CAPTURE_STARTED":
      console.log("[claire-ext] Capture started");
      startBatching();
      break;

    case "CAPTURE_STOPPED":
      console.log("[claire-ext] Capture stopped");
      stopBatching();
      break;

    case "UPDATE_CONFIG":
      config = { ...config, ...message.config };
      browser.storage.local.set({ claireConfig: config });
      console.log("[claire-ext] Config updated:", config);
      sendResponse({ success: true });
      break;

    case "GET_CONFIG":
      sendResponse({ config });
      break;

    case "TEST_CONNECTION":
      testConnection().then((result) => sendResponse(result));
      return true; // async response
  }
});

// Handle incoming caption
function handleCaption(message) {
  captionBuffer.push({
    speaker: message.speaker,
    text: message.text,
    timestamp: message.timestamp,
    meetUrl: message.url,
  });

  // Flush if buffer is getting large
  if (captionBuffer.length >= MAX_BATCH_SIZE) {
    flushCaptions();
  }
}

// Start batching timer
function startBatching() {
  // Clear any old buffered captions when starting fresh
  if (captionBuffer.length > 0) {
    console.log(`[claire-ext] Clearing ${captionBuffer.length} old buffered captions`);
    captionBuffer = [];
  }

  if (batchTimer) return;

  batchTimer = setInterval(() => {
    if (captionBuffer.length > 0) {
      flushCaptions();
    }
  }, BATCH_INTERVAL_MS);
}

// Stop batching timer
function stopBatching() {
  if (batchTimer) {
    clearInterval(batchTimer);
    batchTimer = null;
  }

  // Clear buffer instead of final flush - we don't want stale captions
  if (captionBuffer.length > 0) {
    console.log(`[claire-ext] Clearing ${captionBuffer.length} captions on stop`);
    captionBuffer = [];
  }
}

// Send batched captions to Claire API
async function flushCaptions() {
  if (captionBuffer.length === 0) return;
  if (!config.apiUrl) {
    console.warn("[claire-ext] No API URL configured");
    return;
  }

  const now = Date.now();
  let batch = captionBuffer.splice(0, captionBuffer.length);

  // Filter out old captions
  const freshBatch = batch.filter((c) => now - c.timestamp < MAX_CAPTION_AGE_MS);
  if (freshBatch.length < batch.length) {
    console.log(
      `[claire-ext] Discarded ${batch.length - freshBatch.length} old captions`
    );
  }

  if (freshBatch.length === 0) {
    return;
  }

  try {
    const response = await fetch(`${config.apiUrl}/api/meet/captions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        captions: freshBatch,
        channelId: config.channelId,
        threadTs: config.threadTs,
        meetingContext: config.meetingContext,
      }),
    });

    if (!response.ok) {
      console.error(
        "[claire-ext] Failed to send captions:",
        response.status,
        await response.text()
      );
      // Don't re-add failed captions - just drop them
    }
  } catch (err) {
    console.error("[claire-ext] Error sending captions:", err);
    // Don't re-add failed captions - they'll just pile up and cause more problems
  }
}

// Test connection to Claire API
async function testConnection() {
  try {
    const response = await fetch(`${config.apiUrl}/api/health`, {
      method: "GET",
    });

    if (response.ok) {
      return { success: true, message: "Connected to Claire" };
    } else {
      return {
        success: false,
        message: `HTTP ${response.status}: ${await response.text()}`,
      };
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

console.log("[claire-ext] Background script loaded");
