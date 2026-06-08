// Config Management Script
let config = {
  apiKey: "",
  model: "gemini-3.5-flash",
  baseUrl: "https://mwg-cf.rviscomi-555.workers.dev/",
  baselineTarget: "widely-available",
  capInteraction: true,
  capLogs: true,
  capPreview: true,
  capOverride: true
};

async function loadConfig() {
  const data = await chrome.storage.local.get([
    "apiKey", "model", "baseUrl", "baselineTarget",
    "capInteraction", "capLogs", "capPreview", "capOverride"
  ]);

  if (data.apiKey) {
    config.apiKey = data.apiKey;
    document.getElementById("settings-api-key").value = data.apiKey;
  }
  if (data.model) {
    config.model = data.model;
    document.getElementById("settings-model").value = data.model;
  }
  if (data.baseUrl) {
    // Migrate legacy raw GitHub baseUrl to the Worker API URL
    if (data.baseUrl.includes("raw.githubusercontent.com")) {
      data.baseUrl = "https://mwg-cf.rviscomi-555.workers.dev/";
      await chrome.storage.local.set({ baseUrl: data.baseUrl });
    }
    config.baseUrl = data.baseUrl;
    document.getElementById("settings-url").value = data.baseUrl;
  }
  if (data.baselineTarget) {
    config.baselineTarget = data.baselineTarget;
    document.getElementById("settings-baseline").value = data.baselineTarget;
  }

  // Capabilities (default to true if undefined)
  config.capInteraction = data.capInteraction !== false;
  config.capLogs = data.capLogs !== false;
  config.capPreview = data.capPreview !== false;
  config.capOverride = data.capOverride !== false;

  document.getElementById("settings-cap-interaction").checked = config.capInteraction;
  document.getElementById("settings-cap-logs").checked = config.capLogs;
  document.getElementById("settings-cap-preview").checked = config.capPreview;
  document.getElementById("settings-cap-override").checked = config.capOverride;
}

async function saveConfig(event) {
  event.preventDefault();
  const apiKey = document.getElementById("settings-api-key").value.trim();
  const model = document.getElementById("settings-model").value;
  const baselineTarget = document.getElementById("settings-baseline").value;
  let baseUrl = document.getElementById("settings-url").value.trim();
  const capInteraction = document.getElementById("settings-cap-interaction").checked;
  const capLogs = document.getElementById("settings-cap-logs").checked;
  const capPreview = document.getElementById("settings-cap-preview").checked;
  const capOverride = document.getElementById("settings-cap-override").checked;

  if (!baseUrl.endsWith("/")) baseUrl += "/";

  config = {
    apiKey, model, baseUrl, baselineTarget,
    capInteraction, capLogs, capPreview, capOverride
  };
  await chrome.storage.local.set(config);
  showToast("Settings saved successfully!", "success");
  await loadUseCases(true); // force reload use cases with the new URL
}
