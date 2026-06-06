// Background Service Worker
// Keep worker active if needed for messaging
chrome.runtime.onInstalled.addListener(() => {
  console.log("Modern Web Guidance Auditor Extension Installed");
});
