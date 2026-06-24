// Config Management Script
let config = {
  apiKey: "",
  model: "gemini-3.5-flash",
  maxRpm: 1000,
  maxTpm: 1000000,
  baseUrl: "https://mwg-cf.rviscomi-555.workers.dev/",
  baselineTarget: "widely-available",
  capInteraction: true,
  capLogs: true,
  capPreview: true,
  capOverride: true,
  capScreenshot: true,
  capScripting: true,
  capNetwork: true
};

async function loadConfig() {
  const data = await chrome.storage.local.get([
    "apiKey", "model", "maxRpm", "maxTpm", "baseUrl", "baselineTarget",
    "capInteraction", "capLogs", "capPreview", "capOverride", "capScreenshot",
    "capScripting", "capNetwork"
  ]);

  if (data.maxRpm) config.maxRpm = data.maxRpm;
  if (data.maxTpm) config.maxTpm = data.maxTpm;

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
  config.capScreenshot = data.capScreenshot !== false;
  config.capScripting = data.capScripting !== false;
  config.capNetwork = data.capNetwork !== false;

  document.getElementById("settings-cap-interaction").checked = config.capInteraction;
  document.getElementById("settings-cap-logs").checked = config.capLogs;
  document.getElementById("settings-cap-preview").checked = config.capPreview;
  document.getElementById("settings-cap-override").checked = config.capOverride;
  document.getElementById("settings-cap-screenshot").checked = config.capScreenshot;
  document.getElementById("settings-cap-scripting").checked = config.capScripting;
  document.getElementById("settings-cap-network").checked = config.capNetwork;
}

async function saveConfig(event) {
  if (event) event.preventDefault();
  const apiKey = document.getElementById("settings-api-key").value.trim();
  const model = document.getElementById("settings-model").value;
  const baselineTarget = document.getElementById("settings-baseline").value;
  let baseUrl = document.getElementById("settings-url").value.trim();
  const capInteraction = document.getElementById("settings-cap-interaction").checked;
  const capLogs = document.getElementById("settings-cap-logs").checked;
  const capPreview = document.getElementById("settings-cap-preview").checked;
  const capOverride = document.getElementById("settings-cap-override").checked;
  const capScreenshot = document.getElementById("settings-cap-screenshot").checked;
  const capScripting = document.getElementById("settings-cap-scripting").checked;
  const capNetwork = document.getElementById("settings-cap-network").checked;

  if (!baseUrl.endsWith("/")) baseUrl += "/";

  config = {
    apiKey, model, maxRpm: config.maxRpm, maxTpm: config.maxTpm, baseUrl, baselineTarget,
    capInteraction, capLogs, capPreview, capOverride, capScreenshot, capScripting, capNetwork
  };
  await chrome.storage.local.set(config);
  showToast("Settings saved successfully!", "success");
  await loadUseCases(true); // force reload use cases with the new URL
}
