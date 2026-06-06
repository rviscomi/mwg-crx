// Config Management Script
let config = {
  apiKey: "",
  model: "gemini-3.5-flash",
  baseUrl: "https://mwg-cf.rviscomi-555.workers.dev/",
  baselineTarget: "widely-available"
};

async function loadConfig() {
  const data = await chrome.storage.local.get(["apiKey", "model", "baseUrl", "baselineTarget"]);
  if (data.apiKey) {
    config.apiKey = data.apiKey;
    document.getElementById("settings-api-key").value = data.apiKey;
  }
  if (data.model) {
    config.model = data.model;
    document.getElementById("settings-model").value = data.model;
  }
  if (data.baseUrl) {
    config.baseUrl = data.baseUrl;
    document.getElementById("settings-url").value = data.baseUrl;
  }
  if (data.baselineTarget) {
    config.baselineTarget = data.baselineTarget;
    document.getElementById("settings-baseline").value = data.baselineTarget;
  }
}

async function saveConfig(event) {
  event.preventDefault();
  const apiKey = document.getElementById("settings-api-key").value.trim();
  const model = document.getElementById("settings-model").value;
  const baselineTarget = document.getElementById("settings-baseline").value;
  let baseUrl = document.getElementById("settings-url").value.trim();

  if (!baseUrl.endsWith("/")) baseUrl += "/";

  config = { apiKey, model, baseUrl, baselineTarget };
  await chrome.storage.local.set(config);
  showToast("Settings saved successfully!", "success");
  await loadUseCases(true); // force reload use cases with the new URL
}
