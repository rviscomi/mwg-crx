// Global drawer variables
let drawer, openBtn, scroller, sheet;
let latestReports = {
  audit: null,
  inspect: null
};

// Main DevTools Panel Controller
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupDrawer();
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

      // Close the drawer automatically when a tab is selected
      if (drawer) {
        closeDrawer();
      }
    });
  });
}

// Setup the Navigation Drawer
function setupDrawer() {
  drawer = document.getElementById("sidebar-drawer");
  openBtn = document.getElementById("btn-open-sidebar");
  scroller = drawer.querySelector(".Drawer-scroller");
  sheet = drawer.querySelector(".sidebar");

  // Treat "any pixel of the sheet visible inside the popover root" as open/not closed.
  const visibleThreshold = 1 / window.innerWidth;

  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries.at(-1);
      if (entry.intersectionRatio < visibleThreshold) {
        onDrawerClosed();
      }
      if (entry.intersectionRatio === 1) {
        onDrawerOpened();
      }
    },
    { root: drawer, threshold: [visibleThreshold, 1] }
  );
  observer.observe(sheet);

  // Open trigger
  openBtn.addEventListener("click", openDrawer);

  // Light-dismiss: click outside the sheet (on the dimmed backdrop/spacer area) closes the drawer
  drawer.addEventListener("click", (event) => {
    if (!sheet.contains(event.target)) {
      closeDrawer();
    }
  });

  // Escape key dismissal
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawer.matches && drawer.matches(":popover-open")) {
      closeDrawer();
    }
  });

  // Scroll-driven animation fallback (for Firefox/older engines without CSS scroll timelines)
  if (!CSS.supports("animation-timeline: scroll()")) {
    scroller.addEventListener("scroll", () => {
      const ratio = 1 - scroller.scrollLeft / sheet.offsetWidth;
      drawer.style.setProperty("--drawer-backdrop", ratio);
    });
  }
}

async function openDrawer() {
  // Show popover first
  drawer.showPopover();

  // Fallback for scroll-initial-target support
  if (!CSS.supports("scroll-initial-target", "nearest")) {
    scroller.scrollTo({ left: scroller.offsetWidth, behavior: "instant" });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  // Smoothly scroll the sheet into view
  scroller.scrollTo({ left: 0, behavior: "auto" });
}

function closeDrawer() {
  if (drawer && drawer.matches && !drawer.matches(":popover-open")) return;
  // Scroll back to the spacer stop (closed)
  scroller.scrollTo({ left: scroller.offsetWidth, behavior: "auto" });
}

function onDrawerOpened() {
  const workspace = document.querySelector(".workspace");
  if (workspace) workspace.inert = true;
  if (openBtn) {
    openBtn.setAttribute("aria-expanded", "true");
  }
  if (sheet) sheet.focus();
}

function onDrawerClosed() {
  if (drawer) drawer.hidePopover();
  const workspace = document.querySelector(".workspace");
  if (workspace) workspace.inert = false;
  if (openBtn) {
    openBtn.setAttribute("aria-expanded", "false");
  }
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
  
  document.getElementById("btn-stop-audit").addEventListener("click", abortAnalysis);
  document.getElementById("btn-stop-inspect").addEventListener("click", abortAnalysis);

  document.getElementById("btn-export-audit").addEventListener("click", () => handleCopyReport("audit"));
  document.getElementById("btn-export-inspect").addEventListener("click", () => handleCopyReport("inspect"));
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
  document.getElementById("btn-export-audit").classList.add("hidden");
  latestReports.audit = null;

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

    latestReports.audit = report;
    renderOpportunities(results, report, true);
    results.classList.remove("hidden");
    document.getElementById("btn-export-audit").classList.remove("hidden");
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
    document.getElementById("btn-export-inspect").classList.add("hidden");
    latestReports.inspect = null;
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

    latestReports.inspect = report;
    renderOpportunities(results, report);
    results.classList.remove("hidden");
    document.getElementById("btn-export-inspect").classList.remove("hidden");
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


async function handleCopyReport(type) {
  const report = latestReports[type];
  if (!report) {
    showToast("No report available to copy.", "warning");
    return;
  }
  
  const markdown = generateMarkdownReport(report);
  const success = await copyToClipboard(markdown);
  if (success) {
    showToast("Modernization report copied to clipboard!", "success");
  } else {
    showToast("Failed to copy report to clipboard.", "error");
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error("Clipboard copy failed, trying document.execCommand:", err);
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      return success;
    } catch (err2) {
      console.error("Fallback copy failed:", err2);
      return false;
    }
  }
}
