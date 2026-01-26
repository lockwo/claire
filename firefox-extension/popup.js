/**
 * Claire Meet Captions - Popup Script
 */

document.addEventListener("DOMContentLoaded", async () => {
  const statusEl = document.getElementById("status");
  const enableToggle = document.getElementById("enableToggle");
  const apiUrlInput = document.getElementById("apiUrl");
  const channelIdInput = document.getElementById("channelId");
  const threadTsInput = document.getElementById("threadTs");
  const meetingContextInput = document.getElementById("meetingContext");
  const saveBtn = document.getElementById("saveBtn");
  const testBtn = document.getElementById("testBtn");

  // Load saved config
  const response = await browser.runtime.sendMessage({ type: "GET_CONFIG" });
  if (response?.config) {
    apiUrlInput.value = response.config.apiUrl || "http://localhost:3000";
    channelIdInput.value = response.config.channelId || "";
    threadTsInput.value = response.config.threadTs || "";
    meetingContextInput.value = response.config.meetingContext || "";
    enableToggle.checked = response.config.enabled || false;
  }

  // Load capture state
  const storage = await browser.storage.local.get(["captureEnabled"]);
  enableToggle.checked = storage.captureEnabled || false;

  // Check if we're on a Meet page and get status
  try {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tab = tabs[0];

    if (tab?.url?.includes("meet.google.com")) {
      const contentResponse = await browser.tabs.sendMessage(tab.id, {
        type: "GET_STATUS",
      });

      if (contentResponse?.enabled) {
        updateStatus("capturing", "Capturing captions...");
      } else {
        updateStatus("connected", "On Meet page - ready to capture");
      }
    } else {
      updateStatus("disconnected", "Open a Google Meet to capture captions");
    }
  } catch (err) {
    updateStatus("disconnected", "Open a Google Meet to capture captions");
  }

  // Toggle capture
  enableToggle.addEventListener("change", async () => {
    const enabled = enableToggle.checked;

    // Save state
    await browser.storage.local.set({ captureEnabled: enabled });

    // Tell content script
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      const tab = tabs[0];

      if (tab?.url?.includes("meet.google.com")) {
        await browser.tabs.sendMessage(tab.id, {
          type: "TOGGLE_CAPTURE",
          enabled,
        });

        if (enabled) {
          updateStatus("capturing", "Capturing captions...");
        } else {
          updateStatus("connected", "Capture paused");
        }
      }
    } catch (err) {
      console.error("Error toggling capture:", err);
    }

    // Update background config
    await browser.runtime.sendMessage({
      type: "UPDATE_CONFIG",
      config: { enabled },
    });
  });

  // Save settings
  saveBtn.addEventListener("click", async () => {
    const config = {
      apiUrl: apiUrlInput.value.trim(),
      channelId: channelIdInput.value.trim(),
      threadTs: threadTsInput.value.trim(),
      meetingContext: meetingContextInput.value.trim(),
    };

    await browser.runtime.sendMessage({
      type: "UPDATE_CONFIG",
      config,
    });

    saveBtn.textContent = "Saved!";
    setTimeout(() => {
      saveBtn.textContent = "Save Settings";
    }, 1500);
  });

  // Test connection
  testBtn.addEventListener("click", async () => {
    testBtn.textContent = "Testing...";
    testBtn.disabled = true;

    const result = await browser.runtime.sendMessage({
      type: "TEST_CONNECTION",
    });

    if (result?.success) {
      updateStatus("connected", result.message);
    } else {
      updateStatus("disconnected", result?.message || "Connection failed");
    }

    testBtn.textContent = "Test Connection";
    testBtn.disabled = false;
  });

  function updateStatus(type, message) {
    statusEl.className = `status ${type}`;
    statusEl.textContent = message;
  }
});
