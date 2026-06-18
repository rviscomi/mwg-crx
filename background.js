// Background Service Worker
chrome.runtime.onInstalled.addListener(() => {
  console.log("Modern Web Dino Extension Installed");
  
  // Create context menu item
  chrome.contextMenus.create({
    id: "audit-element",
    title: "Audit element with Dino",
    contexts: ["all"]
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "audit-element" && tab && tab.id) {
    try {
      // Send message to the tab to tag the element
      const response = await chrome.tabs.sendMessage(tab.id, { action: "context-menu-audit" });
      if (response && response.success) {
        // Write the pending audit state
        await chrome.storage.local.set({
          dinoPendingAudit: {
            tabId: tab.id,
            timestamp: Date.now()
          }
        });
      }
    } catch (err) {
      console.error("Failed to tag element for Dino audit:", err);
    }
  }
});

// Listen for screenshot capture requests from DevTools panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "capture-tab") {
    (async () => {
      try {
        const tabId = message.tabId;
        const tab = await chrome.tabs.get(tabId);
        if (!tab) throw new Error(`Tab with ID ${tabId} not found`);
        
        chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, (dataUrl) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else if (!dataUrl) {
            sendResponse({ success: false, error: "Captured image was empty or undefined." });
          } else {
            sendResponse({ success: true, dataUrl });
          }
        });
      } catch (err) {
        console.error("Failed to capture tab:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep message channel open for async response
  }
});
