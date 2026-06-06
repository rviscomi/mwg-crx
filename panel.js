// Main DevTools Panel Controller
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  await loadConfig();
  await loadUseCases();
  bindUIEvents();
});

// Navigation / Tabs Setup
function setupTabs() {
  const tabs = document.querySelectorAll(".tab-item");
  const views = document.querySelectorAll(".tab-view");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      views.forEach(v => v.classList.remove("active"));

      tab.classList.add("active");
      const targetView = document.getElementById(`view-${tab.dataset.tab}`);
      if (targetView) targetView.classList.add("active");
    });
  });
}

// Bind UI Click Handlers
function bindUIEvents() {
  document.getElementById("settings-form").addEventListener("submit", saveConfig);
  document.getElementById("btn-reset-db").addEventListener("click", async () => {
    await chrome.storage.local.clear();
    await loadConfig();
    await loadUseCases(true);
    showToast("Cache cleared and guides re-fetched successfully!", "success");
  });

  document.getElementById("btn-run-audit").addEventListener("click", runAudit);
  document.getElementById("btn-run-inspect").addEventListener("click", runInspect);
  document.getElementById("btn-run-interactive").addEventListener("click", runInteractiveAudit);
  
  document.getElementById("btn-stop-audit").addEventListener("click", abortAnalysis);
  document.getElementById("btn-stop-inspect").addEventListener("click", abortAnalysis);
  document.getElementById("btn-stop-interactive").addEventListener("click", abortAnalysis);
}

function abortAnalysis() {
  isAborted = true;
  if (currentAbortController) {
    currentAbortController.abort();
  }
  showToast("Analysis stopped by user.", "warning");
}

// Action: Full/Focused Page Audit
async function runAudit() {
  const logger = document.getElementById("audit-logger");
  const results = document.getElementById("audit-results");
  const btn = document.getElementById("btn-run-audit");
  const stopBtn = document.getElementById("btn-stop-audit");

  if (!config.apiKey) {
    showToast("Please set your Gemini API Key in the Settings tab first!", "warning");
    return;
  }

  isAborted = false;
  currentAbortController = new AbortController();

  btn.disabled = true;
  stopBtn.classList.remove("hidden");
  logger.classList.remove("hidden");
  logger.classList.remove("completed");
  logger.querySelector(".logger-header span:last-child").textContent = "Running analysis...";
  results.classList.add("hidden");

  const focus = document.getElementById("audit-type").value;
  let focusConstraint = "";
  let focusInstructions = "";

  if (focus === "accessibility") {
    focusConstraint = "\nCategory constraint: 'accessibility'";
    focusInstructions = "\n- You MUST perform a targeted Accessibility Audit. Start by calling list_use_cases to list all guidelines in the 'accessibility' category, get their guide contents using get_guide_content, and then audit the page DOM against those guidelines.";
  } else if (focus === "performance") {
    focusConstraint = "\nCategory constraint: 'performance'";
    focusInstructions = "\n- You MUST perform a targeted Performance Audit. Start by calling list_use_cases to list all guidelines in the 'performance' category, get their guide contents using get_guide_content, and then audit the page DOM against those guidelines.";
  } else if (focus === "security-privacy") {
    focusConstraint = "\nCategory constraint: 'security' or 'privacy'";
    focusInstructions = "\n- You MUST perform a targeted Security and Privacy Audit. Start by listing and reading all guidelines in the 'security' and 'privacy' categories using list_use_cases and get_guide_content, and then audit the page DOM against those guidelines.";
  }

  try {
    const startPrompt = `Please perform a Page Audit.${focusInstructions}
Use your tools to check the page structure and find matching use cases and guidelines to recommend modern solutions.
${focusConstraint}

Current Browser Support Policy (Baseline Target): ${config.baselineTarget}

Rules for browser compatibility:
- If the target is 'widely-available', you MUST check if the recommended features are Baseline widely available. If a feature is NOT widely available (such as Invoker Commands or Popovers), you MUST recommend and include the fallback code or polyfill instructions specified in the matching guides.
- If the target is 'newly-available', you only need to include fallbacks for features that are experimental/non-standard.
- If the target is 'none', you do not need to include any fallback code.`;

    const systemInstruction = (focus === "full") ? GENERIC_SYSTEM_INSTRUCTION : FOCUSED_SYSTEM_INSTRUCTION;
    const report = await runGeminiAgent("audit", startPrompt, systemInstruction);

    renderOpportunities(results, report);
    results.classList.remove("hidden");
    logger.classList.add("completed");
    logger.querySelector(".logger-header span:last-child").textContent = "Analysis completed!";
    showToast("Page audit completed successfully!", "success");
  } catch (err) {
    appendLog("audit", `Error: ${err.message}`, "system");
    showToast(`Audit failed: ${err.message}`, "error");
    logger.classList.add("completed");
    logger.querySelector(".logger-header span:last-child").textContent = "Analysis failed";
  } finally {
    btn.disabled = false;
    stopBtn.classList.add("hidden");
  }
}

// Action: DevTools Element Inspector Analysis
async function runInspect() {
  const logger = document.getElementById("inspect-logger");
  const results = document.getElementById("inspect-results");
  const btn = document.getElementById("btn-run-inspect");
  const stopBtn = document.getElementById("btn-stop-inspect");
  const preview = document.getElementById("inspect-preview");
  const previewCode = document.getElementById("inspect-target-name");

  if (!config.apiKey) {
    showToast("Please set your Gemini API Key in the Settings tab first!", "warning");
    return;
  }

  try {
    const inspected = await getInspectedElement();
    if (!inspected) {
      showToast("No element is currently selected in DevTools. Please select an element first!", "warning");
      return;
    }

    isAborted = false;
    currentAbortController = new AbortController();

    btn.disabled = true;
    stopBtn.classList.remove("hidden");
    logger.classList.remove("hidden");
    logger.classList.remove("completed");
    logger.querySelector(".logger-header span:last-child").textContent = "Analyzing element...";
    results.classList.add("hidden");
    preview.classList.remove("hidden");
    previewCode.textContent = `<${inspected.tagName}${inspected.class ? ' class="' + inspected.class + '"' : ""}>`;

    const startPrompt = `You are analyzing a single element selected by the user in DevTools.
Selected Element:
HTML: ${inspected.outerHTML}
Tag Name: ${inspected.tagName}
ID: ${inspected.id || "None"}
Class Name: ${inspected.class || "None"}
Computed Style: ${JSON.stringify(inspected.computedStyle)}

Identify if there are any modernization opportunities that directly apply to this specific element.
CRITICAL: Only recommend use cases that are relevant to this element's purpose, HTML tag, or styling. If no guidance applies, return an empty array [].

Current Browser Support Policy (Baseline Target): ${config.baselineTarget}

Rules for browser compatibility:
- If the target is 'widely-available', you MUST check if the recommended features are Baseline widely available. If a feature is NOT widely available (such as Invoker Commands or Popovers), you MUST recommend and include the fallback code or polyfill instructions specified in the matching guides.
- If the target is 'newly-available', you only need to include fallbacks for features that are experimental/non-standard.
- If the target is 'none', you do not need to include any fallback code.`;

    const report = await runGeminiAgent("inspect", startPrompt, INSPECT_SYSTEM_INSTRUCTION);

    renderOpportunities(results, report);
    results.classList.remove("hidden");
    logger.classList.add("completed");
    logger.querySelector(".logger-header span:last-child").textContent = "Analysis completed!";
    showToast("Selected element analysis completed!", "success");
  } catch (err) {
    appendLog("inspect", `Error: ${err.message}`, "system");
    showToast(`Inspect failed: ${err.message}`, "error");
    logger.classList.add("completed");
    logger.querySelector(".logger-header span:last-child").textContent = "Analysis failed";
  } finally {
    btn.disabled = false;
    stopBtn.classList.add("hidden");
  }
}

// Action: Targeted Interactive Audit
async function runInteractiveAudit() {
  const logger = document.getElementById("interactive-logger");
  const results = document.getElementById("interactive-results");
  const btn = document.getElementById("btn-run-interactive");
  const stopBtn = document.getElementById("btn-stop-interactive");
  const queryInput = document.getElementById("interactive-query");
  
  const query = queryInput.value.trim();
  if (!query) {
    showToast("Please enter a custom audit request.", "warning");
    return;
  }

  if (!config.apiKey) {
    showToast("Please set your Gemini API Key in the Settings tab first!", "warning");
    return;
  }

  isAborted = false;
  currentAbortController = new AbortController();

  btn.disabled = true;
  stopBtn.classList.remove("hidden");
  logger.classList.remove("hidden");
  logger.classList.remove("completed");
  logger.querySelector(".logger-header span:last-child").textContent = "Running custom analysis...";
  results.classList.add("hidden");

  try {
    const startPrompt = `The user has requested a targeted modernization audit for a specific part or aspect of the page.
User Request: "${query}"

Your task is to:
1. Inspect the page DOM structure or target element.
2. Locate the specific parts, elements, or systems of the page relevant to the User's Request.
3. Use semantic search (search_use_cases) to locate guidelines that address modernizing these elements.
4. Generate a modernization report containing opportunities only for the systems/elements matching the user's request.
If you find no relevant legacy implementations matching the request, or no guidelines apply, return an empty array [].

Current Browser Support Policy (Baseline Target): ${config.baselineTarget}

Rules for browser compatibility:
- If the target is 'widely-available', you MUST check if the recommended features are Baseline widely available. If a feature is NOT widely available (such as Invoker Commands or Popovers), you MUST recommend and include the fallback code or polyfill instructions specified in the matching guides.
- If the target is 'newly-available', you only need to include fallbacks for features that are experimental/non-standard.
- If the target is 'none', you do not need to include any fallback code.`;

    const report = await runGeminiAgent("interactive", startPrompt, GENERIC_SYSTEM_INSTRUCTION);

    renderOpportunities(results, report);
    results.classList.remove("hidden");
    logger.classList.add("completed");
    logger.querySelector(".logger-header span:last-child").textContent = "Analysis completed!";
    showToast("Custom audit completed successfully!", "success");
  } catch (err) {
    appendLog("interactive", `Error: ${err.message}`, "system");
    showToast(`Audit failed: ${err.message}`, "error");
    logger.classList.add("completed");
    logger.querySelector(".logger-header span:last-child").textContent = "Analysis failed";
  } finally {
    btn.disabled = false;
    stopBtn.classList.add("hidden");
  }
}
