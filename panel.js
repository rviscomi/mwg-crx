// Global drawer variables
let drawer, openBtn, scroller, sheet;
let latestReports = {
  audit: null,
  inspect: null
};
let activeChecklistTasks = {
  audit: [],
  inspect: []
};
let activeLoggerId = null;

const AUDIT_PLANS = {
  full: [
    { id: "gather-context", title: "Gather page structure & active guides", status: "pending" },
    { id: "match-guidelines", title: "Identify relevant modernization guidelines", status: "pending" },
    { id: "audit-layout", title: "Check semantic layout & CSS compatibility", status: "pending" },
    { id: "audit-accessibility", title: "Verify accessibility & keyboard navigation", status: "pending" },
    { id: "audit-performance", title: "Analyze performance & Core Web Vitals", status: "pending" },
    { id: "compile-report", title: "Compiling modernization recommendations", status: "pending" }
  ],
  accessibility: [
    { id: "gather-context", title: "Gather page structure & accessibility tree", status: "pending" },
    { id: "match-guidelines", title: "Identify relevant accessibility guidelines", status: "pending" },
    { id: "audit-accessibility", title: "Verify accessibility & keyboard navigation", status: "pending" },
    { id: "compile-report", title: "Compiling accessibility recommendations", status: "pending" }
  ],
  performance: [
    { id: "gather-context", title: "Gather page structure & network logs", status: "pending" },
    { id: "match-guidelines", title: "Identify relevant performance guidelines", status: "pending" },
    { id: "audit-performance", title: "Analyze performance & Core Web Vitals", status: "pending" },
    { id: "compile-report", title: "Compiling performance recommendations", status: "pending" }
  ],
  "security-privacy": [
    { id: "gather-context", title: "Gather page structure & security headers", status: "pending" },
    { id: "match-guidelines", title: "Identify relevant security & privacy guidelines", status: "pending" },
    { id: "audit-security", title: "Check security, privacy & browser headers", status: "pending" },
    { id: "compile-report", title: "Compiling security & privacy recommendations", status: "pending" }
  ]
};

const INSPECT_PLAN = [
  { id: "inspect-element", title: "Analyze selected element structure & styles", status: "pending" },
  { id: "match-guidelines", title: "Identify matching design patterns & guidelines", status: "pending" },
  { id: "formulate-fix", title: "Formulating refactoring code & tips", status: "pending" }
];

// Main DevTools Panel Controller
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupDrawer();
  await loadConfig();
  await loadUseCases();
  bindUIEvents();
  await renderAuditHistoryList();

  // Check for pending context menu audit on startup
  await checkPendingAudit();

  // Listen for storage changes to trigger dynamic audits
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.dinoPendingAudit) {
      const newVal = changes.dinoPendingAudit.newValue;
      if (newVal) {
        checkPendingAudit(newVal);
      }
    }
  });
});

function switchTab(tabName) {
  const tabs = document.querySelectorAll(".tab-item");
  const views = document.querySelectorAll(".tab-view");

  tabs.forEach(t => t.classList.remove("active"));
  views.forEach(v => v.classList.remove("active"));

  const targetTab = Array.from(tabs).find(t => t.dataset.tab === tabName);
  if (targetTab) {
    targetTab.classList.add("active");
  }

  const targetView = document.getElementById(`view-${tabName}`);
  if (targetView) {
    targetView.classList.add("active");
  }
}

// Navigation / Tabs Setup
function setupTabs() {
  const tabs = document.querySelectorAll(".tab-item");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      switchTab(tab.dataset.tab);
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
  const settingsForm = document.getElementById("settings-form");
  if (settingsForm) {
    settingsForm.addEventListener("submit", (e) => e.preventDefault());
    settingsForm.querySelectorAll("input, select, textarea").forEach(field => {
      field.addEventListener("change", () => saveConfig());
    });
  }

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

  document.getElementById("btn-answer-now-audit").addEventListener("click", () => {
    earlyCompleteAnalysis();
    showToast("Compiling partial report...", "info");
  });
  document.getElementById("btn-answer-now-inspect").addEventListener("click", () => {
    earlyCompleteAnalysis();
    showToast("Compiling partial report...", "info");
  });

  document.getElementById("btn-export-audit").addEventListener("click", () => handleCopyReport("audit"));
  document.getElementById("btn-export-inspect").addEventListener("click", () => handleCopyReport("inspect"));

  document.getElementById("btn-clear-all-audits").addEventListener("click", async () => {
    if (confirm("Are you sure you want to delete all saved audits for this page?")) {
      await clearAllAudits();
      showToast("Page audit history cleared.", "info");
    }
  });
}

function abortAnalysis() {
  isAborted = true;
  if (currentAbortController) {
    currentAbortController.abort();
  }
  showToast("Analysis stopped by user.", "warning");
}

function startLoggerTimer(timerId) {
  const timerEl = document.getElementById(timerId);
  if (!timerEl) return null;
  if (timerEl._timerInterval) {
    clearInterval(timerEl._timerInterval);
  }
  timerEl.textContent = "0.0s";
  const startTime = Date.now();
  const interval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    timerEl.textContent = `${elapsed.toFixed(1)}s`;
  }, 100);
  timerEl._timerInterval = interval;
  return interval;
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
  isEarlyCompletionRequested = false;
  currentAbortController = new AbortController();

  btn.disabled = true;
  stopBtn.classList.remove("hidden");
  document.getElementById("btn-answer-now-audit").classList.remove("hidden");
  logger.classList.remove("hidden");
  logger.classList.remove("completed");
  logger.querySelector(".logger-status-text").textContent = "Running analysis...";
  
  // Clear checklist
  activeChecklistTasks.audit = [];
  const checklistEl = document.getElementById("audit-checklist");
  if (checklistEl) {
    checklistEl.classList.add("hidden");
    checklistEl.innerHTML = "";
  }

  results.classList.add("hidden");
  document.getElementById("btn-export-audit").classList.add("hidden");
  latestReports.audit = null;

  const focus = document.getElementById("audit-type").value;

  // Pre-populate checklist instantly
  activeChecklistTasks.audit = JSON.parse(JSON.stringify(AUDIT_PLANS[focus] || AUDIT_PLANS.full));
  activeLoggerId = "audit";
  updateChecklistUI();

  let focusConstraint = "";
  let focusInstructions = "";

  if (focus === "full") {
    focusInstructions = "\n- You MUST perform a Full Page Audit. In your first turn, call list_use_cases, get_page_dom, get_accessibility_tree, get_console_logs, get_lcp_element, and get_viewport_images in parallel to discover relevant guidelines and audit targets.";
  } else if (focus === "accessibility") {
    focusConstraint = "\nCategory constraint: 'accessibility'";
    focusInstructions = "\n- You MUST perform a targeted Accessibility Audit. Since accessibility best practices are also embedded within other use case categories (e.g., forms, CSS layout, media), you MUST retrieve the entire list of guidelines in your first turn by calling list_use_cases (without a category filter), along with get_page_dom, get_accessibility_tree, get_console_logs, get_lcp_element, and get_viewport_images in parallel. Do not restrict yourself only to files labeled as the accessibility category; evaluate the page against any guideline that has accessibility implications.";
  } else if (focus === "performance") {
    focusConstraint = "\nCategory constraint: 'performance'";
    focusInstructions = "\n- You MUST perform a targeted Performance Audit. In your first turn, call list_use_cases (filtering for 'performance' category), get_page_dom, get_console_logs, get_lcp_element, and get_viewport_images in parallel to discover relevant guidelines and audit targets.";
  } else if (focus === "security-privacy") {
    focusConstraint = "\nCategory constraint: 'security' or 'privacy'";
    focusInstructions = "\n- You MUST perform a targeted Security and Privacy Audit. In your first turn, call list_use_cases, get_page_dom, get_console_logs, get_lcp_element, and get_viewport_images in parallel to discover relevant guidelines and audit targets.";
  }

  let timerInterval = startLoggerTimer("audit-timer");
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
    completeAllChecklistTasks("audit", true);

    latestReports.audit = report;
    renderOpportunities(results, report, true);
    results.classList.remove("hidden");
    document.getElementById("btn-export-audit").classList.remove("hidden");
    logger.classList.add("completed");
    logger.querySelector(".logger-status-text").textContent = "Analysis completed!";
    showToast("Page audit completed successfully!", "success");

    // Persist audit results in history
    try {
      const currentUrl = await getInspectedTabUrl();
      if (currentUrl) {
        await saveAuditToHistory(currentUrl, focus, report);
      }
    } catch (e) {
      console.error("Failed to save audit to history:", e);
    }
  } catch (err) {
    completeAllChecklistTasks("audit", false);
    appendLog("audit", `Error: ${err.message}`, "system");
    showToast(`Audit failed: ${err.message}`, "error");
    logger.classList.add("completed");
    logger.querySelector(".logger-status-text").textContent = "Analysis failed";
  } finally {
    if (timerInterval) clearInterval(timerInterval);
    btn.disabled = false;
    stopBtn.classList.add("hidden");
    document.getElementById("btn-answer-now-audit").classList.add("hidden");
  }
}

// Action: DevTools Element Inspector Analysis
async function runInspect(selector = null) {
  if (selector && typeof selector !== "string") {
    selector = null;
  }

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

  const tabId = chrome.devtools.inspectedWindow.tabId;
  let timerInterval = null;

  try {
    const inspected = selector
      ? await getInspectedElementBySelector(selector)
      : await getInspectedElement();

    if (!inspected) {
      if (selector) {
        showToast("Tagged element could not be found on the page.", "warning");
      } else {
        showToast("No element is currently selected in DevTools. Please select an element first!", "warning");
      }
      return;
    }

    if (selector) {
      removeInspectTag(selector);
    }

    // Notify tab content script that the audit has started
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: "audit-started" }).catch(() => {});
    }

    const screenshotContainer = document.getElementById("inspect-screenshot-container");
    const screenshotImg = document.getElementById("inspect-screenshot-img");
    if (screenshotContainer) {
      screenshotContainer.classList.add("hidden");
      if (screenshotImg) screenshotImg.src = "";
    }

    isAborted = false;
    isEarlyCompletionRequested = false;
    currentAbortController = new AbortController();

    btn.disabled = true;
    stopBtn.classList.remove("hidden");
    document.getElementById("btn-answer-now-inspect").classList.remove("hidden");
    logger.classList.remove("hidden");
    logger.classList.remove("completed");
    logger.querySelector(".logger-status-text").textContent = "Analyzing element...";

    // Pre-populate checklist instantly
    activeChecklistTasks.inspect = JSON.parse(JSON.stringify(INSPECT_PLAN));
    activeLoggerId = "inspect";
    updateChecklistUI();

    results.classList.add("hidden");
    document.getElementById("btn-export-inspect").classList.add("hidden");
    latestReports.inspect = null;
    preview.classList.remove("hidden");
    previewCode.textContent = `<${inspected.tagName}${inspected.class ? ' class="' + inspected.class + '"' : ""}>`;

    let screenshotData = null;
    if (config.capScreenshot !== false) {
      try {
        let screenshotSelector = selector;
        if (!screenshotSelector) {
          await new Promise((resolve) => {
            chrome.devtools.inspectedWindow.eval(
              `if ($0) { $0.setAttribute('data-dino-screenshot-target', 'true'); }`,
              () => resolve()
            );
          });
          screenshotSelector = "[data-dino-screenshot-target='true']";
        }
        
        appendLog("inspect", "Capturing element screenshot...", "system");
        const res = await takeScreenshot(screenshotSelector);
        if (res && res.screenshot) {
          screenshotData = res.screenshot;
          if (screenshotImg && screenshotContainer) {
            screenshotImg.src = screenshotData;
            screenshotContainer.classList.remove("hidden");
            screenshotContainer.onclick = () => {
              const w = window.open();
              w.document.write(`<img src="${screenshotData}" style="max-width:100%;" />`);
            };
          }
        }

        if (screenshotSelector === "[data-dino-screenshot-target='true']") {
          chrome.devtools.inspectedWindow.eval(
            `if ($0) { $0.removeAttribute('data-dino-screenshot-target'); }`
          );
        }
      } catch (screenshotErr) {
        console.warn("Failed to capture inspect element screenshot:", screenshotErr);
        appendLog("inspect", `Screenshot capture skipped: ${screenshotErr.message}`, "system");
      }
    }

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

    timerInterval = startLoggerTimer("inspect-timer");
    const report = await runGeminiAgent("inspect", startPrompt, INSPECT_SYSTEM_INSTRUCTION, null, screenshotData);
    completeAllChecklistTasks("inspect", true);

    latestReports.inspect = report;
    renderOpportunities(results, report);
    results.classList.remove("hidden");
    document.getElementById("btn-export-inspect").classList.remove("hidden");
    logger.classList.add("completed");
    logger.querySelector(".logger-status-text").textContent = "Analysis completed!";
    showToast("Selected element analysis completed!", "success");

    // Notify tab content script that the audit has completed
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: "audit-completed" }).catch(() => {});
    }
  } catch (err) {
    completeAllChecklistTasks("inspect", false);
    appendLog("inspect", `Error: ${err.message}`, "system");
    showToast(`Inspect failed: ${err.message}`, "error");
    logger.classList.add("completed");
    logger.querySelector(".logger-status-text").textContent = "Analysis failed";

    // Also notify on error/failure
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: "audit-completed" }).catch(() => {});
    }
  } finally {
    if (timerInterval) clearInterval(timerInterval);
    btn.disabled = false;
    stopBtn.classList.add("hidden");
    document.getElementById("btn-answer-now-inspect").classList.add("hidden");
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

// --- Audit History Persistence & Formatting ---

function formatRelativeTime(createdTimeIso) {
  const runDateFallback = () => {
    try {
      const now = new Date();
      const created = new Date(createdTimeIso);
      const diffMs = now - created;
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return "just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) return `${diffDays}d ago`;
      return created.toLocaleDateString();
    } catch (e) {
      console.error("Date fallback formatting error:", e);
      return "unknown time";
    }
  };

  if (typeof Temporal === 'undefined') {
    return runDateFallback();
  }

  try {
    const now = Temporal.Now.zonedDateTimeISO();
    const tz = now.timeZoneId;
    const created = Temporal.Instant.from(createdTimeIso).toZonedDateTimeISO(tz);
    const diff = now.since(created, { largestUnit: 'day', smallestUnit: 'minute' });
    
    if (diff.days > 7) {
      return created.toPlainDate().toString();
    }
    
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    
    if (diff.days > 0) {
      return rtf.format(-diff.days, 'day');
    }
    if (diff.hours > 0) {
      return rtf.format(-diff.hours, 'hour');
    }
    if (diff.minutes > 0) {
      return rtf.format(-diff.minutes, 'minute');
    }
    return "just now";
  } catch (e) {
    console.warn("Temporal formatting failed, falling back to Date:", e);
    return runDateFallback();
  }
}

function getIconForAuditType(type) {
  switch (type) {
    case 'accessibility': return '♿';
    case 'performance': return '⚡';
    case 'security-privacy': return '🛡️';
    default: return '🔍';
  }
}

function shortenUrl(rawUrl) {
  if (!rawUrl) return "unknown page";
  try {
    const urlObj = new URL(rawUrl);
    let path = urlObj.pathname;
    if (path.length > 20) {
      path = path.substring(0, 10) + "..." + path.substring(path.length - 10);
    }
    return `${urlObj.host}${path === '/' ? '' : path}`;
  } catch (e) {
    return rawUrl;
  }
}

function normalizeUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const urlObj = new URL(rawUrl);
    urlObj.hash = "";
    return urlObj.href;
  } catch (e) {
    return rawUrl;
  }
}

async function renderAuditHistoryList() {
  const historyList = document.getElementById("audit-history-list");
  if (!historyList) return;

  const currentUrl = await getInspectedTabUrl();
  const normalizedCurrent = normalizeUrl(currentUrl);

  const indexData = await chrome.storage.local.get("mwg_audit_history_index");
  const index = indexData.mwg_audit_history_index || [];

  // Filter index for the current page only
  const filteredIndex = index.filter(entry => normalizeUrl(entry.url) === normalizedCurrent);

  if (filteredIndex.length === 0) {
    historyList.innerHTML = `<li style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 13px;">No past audits found for this page.</li>`;
    const clearBtn = document.getElementById("btn-clear-all-audits");
    if (clearBtn) clearBtn.style.display = "none";
    return;
  }

  const clearBtn = document.getElementById("btn-clear-all-audits");
  if (clearBtn) {
    clearBtn.style.display = "block";
    clearBtn.textContent = "Clear Page History";
  }

  historyList.innerHTML = filteredIndex.map(entry => `
    <li class="history-item" data-id="${entry.id}">
      <div class="history-item-body">
        <span class="history-item-icon">${getIconForAuditType(entry.type)}</span>
        <div class="history-item-details">
          <div class="history-item-url" title="${entry.url}">${shortenUrl(entry.url)}</div>
          <div class="history-item-meta">
            <span class="history-item-findings">${entry.opportunityCount} findings</span>
            <span class="history-item-dot">•</span>
            <span class="history-item-time">${formatRelativeTime(entry.timestamp)}</span>
          </div>
        </div>
      </div>
      <button class="btn-delete-audit" title="Delete audit" data-id="${entry.id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </li>
  `).join("");

  // Setup click listeners for loading audit details
  historyList.querySelectorAll(".history-item").forEach(item => {
    item.addEventListener("click", async (e) => {
      if (e.target.closest(".btn-delete-audit")) return;

      const id = item.dataset.id;
      const report = await getSavedAuditDetails(id);
      if (report) {
        latestReports.audit = report;
        const results = document.getElementById("audit-results");
        renderOpportunities(results, report, true);
        results.classList.remove("hidden");
        document.getElementById("btn-export-audit").classList.remove("hidden");
        
        document.getElementById("audit-logger").classList.add("hidden");
        showToast("Loaded audit from history.", "success");
      }
    });
  });

  // Setup click listeners for deleting individual audits
  historyList.querySelectorAll(".btn-delete-audit").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      await deleteSavedAudit(id);
      showToast("Audit deleted.", "info");
    });
  });
}

async function getSavedAuditDetails(id) {
  const key = `mwg_audit_details_${id}`;
  const data = await chrome.storage.local.get(key);
  return data[key];
}

async function saveAuditToHistory(url, type, report) {
  const timestamp = new Date().toISOString();
  const id = `audit_${Date.now()}`;
  
  const indexData = await chrome.storage.local.get("mwg_audit_history_index");
  const index = indexData.mwg_audit_history_index || [];
  
  const entry = {
    id,
    url,
    timestamp,
    type,
    opportunityCount: report.length
  };
  index.unshift(entry);
  
  await chrome.storage.local.set({
    "mwg_audit_history_index": index,
    [`mwg_audit_details_${id}`]: report
  });
  
  await renderAuditHistoryList();
}

async function deleteSavedAudit(id) {
  const indexData = await chrome.storage.local.get("mwg_audit_history_index");
  const index = indexData.mwg_audit_history_index || [];
  
  const updatedIndex = index.filter(entry => entry.id !== id);
  
  await chrome.storage.local.remove(`mwg_audit_details_${id}`);
  await chrome.storage.local.set({
    "mwg_audit_history_index": updatedIndex
  });
  
  await renderAuditHistoryList();
}

async function clearAllAudits() {
  const currentUrl = await getInspectedTabUrl();
  const normalizedCurrent = normalizeUrl(currentUrl);

  const indexData = await chrome.storage.local.get("mwg_audit_history_index");
  const index = indexData.mwg_audit_history_index || [];
  
  const toRemove = index.filter(entry => normalizeUrl(entry.url) === normalizedCurrent);
  const toKeep = index.filter(entry => normalizeUrl(entry.url) !== normalizedCurrent);
  
  const keysToRemove = toRemove.map(entry => `mwg_audit_details_${entry.id}`);
  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
  
  await chrome.storage.local.set({
    "mwg_audit_history_index": toKeep
  });
  
  await renderAuditHistoryList();
}

// Listen to Chrome tab changes/navigation to update audit history list contextually
if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (tabId === chrome.devtools.inspectedWindow.tabId && changeInfo.url) {
      await renderAuditHistoryList();
    }
  });

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (activeInfo.tabId === chrome.devtools.inspectedWindow.tabId) {
      await renderAuditHistoryList();
    }
  });
}

async function checkPendingAudit(pending = null) {
  try {
    if (!pending) {
      const data = await chrome.storage.local.get("dinoPendingAudit");
      pending = data.dinoPendingAudit;
    }

    if (!pending) return;

    // Check if the pending audit is for the current tab we are inspecting
    const currentTabId = chrome.devtools.inspectedWindow.tabId;
    if (pending.tabId === currentTabId) {
      // Clear the storage so we don't trigger it again
      await chrome.storage.local.remove("dinoPendingAudit");

      // Switch to the Element Inspector tab
      switchTab("inspect");

      // Start the analysis on the tagged element
      runInspect("[data-dino-inspecting]");
    }
  } catch (err) {
    console.error("Error checking pending audit:", err);
  }
}

// Automatically update remaining checklist tasks to completed or failed when run finishes
function completeAllChecklistTasks(loggerId, success = true) {
  const currentTasks = activeChecklistTasks[loggerId] || [];
  currentTasks.forEach(task => {
    if (task.status !== "completed" && task.status !== "failed") {
      task.status = success ? "completed" : "failed";
    }
  });
  // Re-render
  updateChecklistUI();
}

// Global checklist renderer used by update_audit_checklist tool
function updateChecklistUI() {
  if (!activeLoggerId) return;
  const checklistEl = document.getElementById(`${activeLoggerId}-checklist`);
  if (!checklistEl) return;

  const currentTasks = activeChecklistTasks[activeLoggerId] || [];

  if (currentTasks.length > 0) {
    checklistEl.classList.remove("hidden");
  } else {
    checklistEl.classList.add("hidden");
    checklistEl.innerHTML = "";
    return;
  }

  checklistEl.innerHTML = currentTasks.map(task => {
    let stateClass = task.status || "pending";
    
    return `
      <div class="checklist-item ${stateClass}">
        <span class="checklist-icon"></span>
        <div class="checklist-details">
          <span class="checklist-title">${escapeHTML(task.title)}</span>
          ${task.details ? `<span class="checklist-status-desc">${escapeHTML(task.details)}</span>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

// Automatically progress checklist task statuses in real-time based on the tool named, args and turn count (loopCount)
function autoProgressChecklist(name, args, loopCount) {
  if (!activeLoggerId) return;
  const currentTasks = activeChecklistTasks[activeLoggerId] || [];
  if (currentTasks.length === 0) return;

  const setTaskStatus = (id, status, details = "") => {
    const task = currentTasks.find(t => t.id === id);
    if (task && task.status !== status) {
      // Guard: once completed or failed, cannot go back to running or pending
      if ((task.status === "completed" || task.status === "failed") && (status === "running" || status === "pending")) {
        return;
      }
      task.status = status;
      if (details) task.details = details;
      updateChecklistUI();
    }
  };

  const completeBefore = (id) => {
    const targetIndex = currentTasks.findIndex(t => t.id === id);
    if (targetIndex === -1) return;
    for (let i = 0; i < targetIndex; i++) {
      if (currentTasks[i].status !== "completed" && currentTasks[i].status !== "failed") {
        currentTasks[i].status = "completed";
      }
    }
  };

  // Inspector check
  const isInspector = currentTasks.some(t => t.id === "inspect-element");

  if (loopCount === 1) {
    if (isInspector) {
      setTaskStatus("inspect-element", "running", `Analyzing element details via ${name}...`);
    } else {
      setTaskStatus("gather-context", "running", `Gathering initial page context (DOM, console)...`);
    }
  } else if (loopCount === 2) {
    completeBefore("match-guidelines");
    if (isInspector) {
      setTaskStatus("inspect-element", "completed");
    } else {
      setTaskStatus("gather-context", "completed");
    }
    setTaskStatus("match-guidelines", "running", `Matching patterns & loading guidelines...`);
  } else {
    // Turn 3+: Auditing / Formulating phase
    setTaskStatus("match-guidelines", "completed");

    if (isInspector) {
      completeBefore("formulate-fix");
      setTaskStatus("formulate-fix", "running", `Formulating modernization recommendations...`);
    } else {
      completeBefore("audit-layout");

      const argString = JSON.stringify(args || {}).toLowerCase();
      const codeString = (args.code || "").toLowerCase();

      const isA11y = name === "get_accessibility_tree" ||
        argString.includes("aria") ||
        argString.includes("role") ||
        argString.includes("tabindex") ||
        argString.includes("alt") ||
        argString.includes("label") ||
        argString.includes("keyboard") ||
        argString.includes("focus");

      const isPerf = name === "get_lcp_element" ||
        name === "get_viewport_images" ||
        name === "check_bfcache_reasons" ||
        argString.includes("performance") ||
        argString.includes("lcp") ||
        argString.includes("image") ||
        argString.includes("cache") ||
        codeString.includes("lodash") ||
        codeString.includes("libraries") ||
        codeString.includes("jquery") ||
        codeString.includes("load") ||
        codeString.includes("performance");

      const runDescription = (name === "execute_js" && args.purpose)
        ? args.purpose
        : `Auditing page structure via ${name}...`;
      const a11yDescription = (name === "execute_js" && args.purpose)
        ? args.purpose
        : `Verifying accessibility via ${name}...`;
      const perfDescription = (name === "execute_js" && args.purpose)
        ? args.purpose
        : `Analyzing performance via ${name}...`;

      if (isA11y && currentTasks.some(t => t.id === "audit-accessibility")) {
        completeBefore("audit-accessibility");
        setTaskStatus("audit-accessibility", "running", a11yDescription);
      } else if (isPerf && currentTasks.some(t => t.id === "audit-performance")) {
        completeBefore("audit-performance");
        setTaskStatus("audit-performance", "running", perfDescription);
      } else {
        const activeAuditTask = currentTasks.find(t => t.id.startsWith("audit-") && t.status === "pending");
        if (activeAuditTask) {
          setTaskStatus(activeAuditTask.id, "running", runDescription);
        } else {
          const runningAuditTask = currentTasks.find(t => t.id.startsWith("audit-") && t.status === "running");
          if (runningAuditTask) {
            runningAuditTask.details = runDescription;
            updateChecklistUI();
          } else {
            const firstAuditTask = currentTasks.find(t => t.id.startsWith("audit-"));
            if (firstAuditTask) {
              setTaskStatus(firstAuditTask.id, "running", runDescription);
            }
          }
        }
      }
    }
  }
}

// Automatically transition to the compiling report stage
function autoProgressChecklistFinal(loggerId) {
  const currentTasks = activeChecklistTasks[loggerId] || [];
  currentTasks.forEach(task => {
    if (task.id === "compile-report" || task.id === "formulate-fix") {
      task.status = "running";
      task.details = "Compiling and validating JSON report...";
    } else if (task.status !== "completed" && task.status !== "failed") {
      task.status = "completed";
    }
  });
  updateChecklistUI();
}

function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
}
