// Dynamic DevTools Panel Script for MWG Auditor

// State
let config = {
  apiKey: "",
  model: "gemini-3.5-flash",
  baseUrl: "https://mwg-cf.rviscomi-555.workers.dev/",
  baselineTarget: "widely-available"
};
let useCasesCache = [];
let guidesCache = {}; // id -> markdown content
let isAborted = false;
let currentAbortController = null;

// Initialize
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  await loadConfig();
  await loadUseCases();
  bindUIEvents();
});

// Navigation / Tabs
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

// Config management
async function loadConfig() {
  const data = await chrome.storage.local.get(["apiKey", "model", "baseUrl"]);
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

// Guidance DB Management
async function loadUseCases(forceFetch = false) {
  const dbStatus = document.getElementById("db-status");
  dbStatus.textContent = "DB: Loading...";
  dbStatus.className = "status-badge offline";

  try {
    if (!forceFetch) {
      const cached = await chrome.storage.local.get("useCasesList");
      if (cached.useCasesList && cached.useCasesList.length > 0) {
        useCasesCache = cached.useCasesList;
        dbStatus.textContent = `DB: Ready (${useCasesCache.length} guides)`;
        dbStatus.className = "status-badge online";
        return;
      }
    }

    let response;
    try {
      // 1. Try Worker API list endpoint first
      response = await fetch(`${config.baseUrl}list`);
      if (!response.ok) {
        // 2. Try raw GitHub structure (use-cases.json)
        response = await fetch(`${config.baseUrl}use-cases.json`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      console.warn("Failed to fetch use cases list from remote. Loading bundled file.", err);
      response = await fetch(chrome.runtime.getURL("use-cases.json"));
      if (!response.ok) throw new Error(`Bundled fallback failed: HTTP ${response.status}`);
    }

    const list = await response.json();
    useCasesCache = list;
    await chrome.storage.local.set({ useCasesList: list });

    dbStatus.textContent = `DB: Ready (${useCasesCache.length} guides)`;
    dbStatus.className = "status-badge online";
  } catch (err) {
    console.error("Failed to load use cases database:", err);
    dbStatus.textContent = "DB: Error";
    dbStatus.className = "status-badge offline";
  }
}

async function getGuideContent(useCaseId) {
  if (guidesCache[useCaseId]) return guidesCache[useCaseId];
  const storageKey = `guide_${useCaseId}`;
  const stored = await chrome.storage.local.get(storageKey);
  if (stored[storageKey]) {
    guidesCache[useCaseId] = stored[storageKey];
    return stored[storageKey];
  }

  let response;
  try {
    // 1. Try the new REST API first: base_url/guides/{id}
    response = await fetch(`${config.baseUrl}guides/${useCaseId}`);
    if (!response.ok) throw new Error("Worker API returned non-OK");
  } catch (err) {
    console.warn("Worker API fetch failed, trying raw GitHub layout...", err);
    // 2. Try raw GitHub: base_url/guides/{category}/{id}.md
    const uc = useCasesCache.find(u => u.id === useCaseId);
    const category = uc ? uc.category : "user-experience";
    const url = `${config.baseUrl}guides/${category}/${useCaseId}.md`;
    response = await fetch(url);
  }

  if (!response.ok) throw new Error(`Failed to fetch guide content for ${useCaseId}`);
  const md = await response.text();

  guidesCache[useCaseId] = md;
  await chrome.storage.local.set({ [storageKey]: md });
  return md;
}

async function searchUseCases(query) {
  const url = config.baseUrl.endsWith("/") ? config.baseUrl : config.baseUrl + "/";
  const response = await fetch(`${url}search?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error(`Search request failed: HTTP ${response.status}`);
  return await response.json();
}

async function listCategories() {
  try {
    const url = config.baseUrl.endsWith("/") ? config.baseUrl : config.baseUrl + "/";
    const response = await fetch(`${url}categories`);
    if (response.ok) return await response.json();
  } catch (err) {
    console.warn("Worker API categories failed, using local fallback...", err);
  }
  const cats = [...new Set(useCasesCache.map(u => u.category))];
  return cats.length > 0 ? cats : ["user-experience", "performance", "security", "accessibility"];
}

async function listUseCases(category) {
  try {
    const url = config.baseUrl.endsWith("/") ? config.baseUrl : config.baseUrl + "/";
    const endpoint = category ? `${url}list?category=${encodeURIComponent(category)}` : `${url}list`;
    const response = await fetch(endpoint);
    if (response.ok) return await response.json();
  } catch (err) {
    console.warn("Worker API list failed, using local fallback...", err);
  }
  if (category) {
    return useCasesCache.filter(u => u.category === category).map(u => ({
      id: u.id,
      description: u.description,
      category: u.category
    }));
  }
  return useCasesCache.map(u => ({
    id: u.id,
    description: u.description,
    category: u.category
  }));
}

// Inspection Tools
async function getPageDOM() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab found");

  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const simplify = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return null;
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = node.tagName.toLowerCase();
          if (["script", "style", "iframe", "noscript", "svg", "link"].includes(tag)) return null;

          const info = { tag };
          if (node.id) info.id = node.id;
          if (node.className) info.class = node.className;
          if (node.getAttribute("role")) info.role = node.getAttribute("role");
          if (node.getAttribute("type")) info.type = node.getAttribute("type");
          if (node.getAttribute("popover") !== null) info.popover = "";
          
          const children = Array.from(node.childNodes)
            .map(simplify)
            .filter(Boolean);
          if (children.length > 0) info.children = children;
          return info;
        }
        return null;
      };

      return {
        dom: simplify(document.body),
        url: window.location.href,
        title: document.title,
        cookieConfig: document.cookie
      };
    }
  });

  return result[0].result;
}

function getInspectedElement() {
  return new Promise((resolve, reject) => {
    chrome.devtools.inspectedWindow.eval(
      `(() => {
        const el = $0;
        if (!el) return null;
        return {
          outerHTML: el.outerHTML,
          tagName: el.tagName.toLowerCase(),
          id: el.id,
          class: el.className,
          computedStyle: {
            display: window.getComputedStyle(el).display,
            position: window.getComputedStyle(el).position,
            overflow: window.getComputedStyle(el).overflow,
            scrollbarColor: window.getComputedStyle(el).scrollbarColor,
            scrollbarWidth: window.getComputedStyle(el).scrollbarWidth
          }
        };
      })()`,
      (result, isException) => {
        if (isException) reject(new Error("Failed to evaluate inspected element"));
        else resolve(result);
      }
    );
  });
}

// UI Binding & Action Handlers
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
}

function abortAnalysis() {
  isAborted = true;
  if (currentAbortController) {
    currentAbortController.abort();
  }
  showToast("Analysis stopped by user.", "warning");
}

// Custom Toast notification system
function showToast(message, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  let icon = "💡";
  if (type === "success") icon = "✅";
  else if (type === "error") icon = "❌";
  else if (type === "warning") icon = "⚠️";

  toast.innerHTML = `
    <span>${icon}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
    if (container.children.length === 0) {
      container.remove();
    }
  }, 3000);
}

// Logging helper for the progress panels
function appendLog(loggerId, message, sender = "system") {
  const logDiv = document.getElementById(`${loggerId}-log-lines`);
  const line = document.createElement("div");
  line.className = `log-line ${sender}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logDiv.appendChild(line);
  logDiv.scrollTop = logDiv.scrollHeight;
}

// System instructions for the Gemini agent
const SYSTEM_INSTRUCTION = `
You are a Senior Frontend Architect and an expert Auditor specializing in modernizing legacy web codebases.
Your task is to audit a production website's DOM structure and console warnings, identify modernization opportunities, and recommend best practices using exclusively the tools provided to discover and load matching Modern Web Guidance (MWG) guides.

Guidelines:
1. Inspect the page DOM structure or target element to identify potential legacy web patterns, and then use semantic search (search_use_cases) with natural language queries to discover matching guidelines.
2. You MUST retrieve the guide content for the relevant use cases you want to recommend using get_guide_content. DO NOT hallucinate best practices. Only use recommendations and patterns defined inside the guides you retrieved.
3. Keep suggestions actionable. If you identify a modernization opportunity, you must provide:
   - The element or file targeted.
   - The specific issue (e.g. "Uses custom JS scroll listener for scrollbar adjustments").
   - The MWG guide ID matches.
   - The modern recommended solution (e.g. "Use scrollbar-color CSS property").
   - A side-by-side code diff (original legacy vs modernized). Both originalCode and modernizedCode MUST use the same language and syntax context (e.g. HTML vs HTML, CSS vs CSS, JS vs JS). Do not mix HTML on one side and CSS on the other.
4. Output your final report STRICTLY as a JSON array of opportunity objects. DO NOT wrap the JSON in Markdown code fences except if required by the schema, and do not write conversational text.

Output JSON Format Schema:
[
  {
    "title": "Short title describing opportunity",
    "impact": "high" | "medium" | "low",
    "useCaseId": "matching-use-case-id",
    "description": "Explanatory text showing why this is an issue and how the modern API solves it.",
    "target": "CSS Selector or descriptive label of the target element/module",
    "originalCode": "Original/legacy HTML/CSS/JS snippet",
    "modernizedCode": "Modernized implementation snippet"
  }
]
`;

// Gemini API REST Orchestrator
async function runGeminiAgent(loggerId, startPrompt) {
  if (isAborted) {
    throw new Error("Analysis aborted by user.");
  }
  if (!config.apiKey) {
    throw new Error("Gemini API Key is missing. Please set it in the Settings tab.");
  }

  const logLines = document.getElementById(`${loggerId}-log-lines`);
  logLines.innerHTML = ""; // Clear logs

  appendLog(loggerId, "Initializing Gemini Audit Agent...", "system");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;

  // Build list of tools (functions)
  const tools = [
    {
      functionDeclarations: [
        {
          name: "list_use_cases",
          description: "Retrieve a list of available Modern Web Guidance use case IDs, categories, and descriptions. Can optionally filter by category.",
          parameters: {
            type: "OBJECT",
            properties: {
              category: {
                type: "STRING",
                description: "Optional category to filter by (e.g., 'user-experience', 'performance', 'accessibility', etc.)."
              }
            }
          }
        },
        {
          name: "list_categories",
          description: "Retrieve a list of all supported category names in the catalog."
        },
        {
          name: "search_use_cases",
          description: "Perform a semantic vector search across the guide catalog using a natural language query describing a target topic or legacy pattern.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: {
                type: "STRING",
                description: "Natural language query describing the legacy code pattern or feature (e.g., 'lazy load images' or 'custom modal')."
              }
            },
            required: ["query"]
          }
        },
        {
          name: "get_guide_content",
          description: "Get the full compiled markdown guide containing the best practices and code snippets for a specific use case ID.",
          parameters: {
            type: "OBJECT",
            properties: {
              useCaseId: {
                type: "STRING",
                description: "The unique ID of the use case (e.g. 'deprioritize-background-fetches')."
              }
            },
            required: ["useCaseId"]
          }
        },
        {
          name: "get_page_dom",
          description: "Retrieve the simplified DOM tree structure, URL, and page title of the currently active document."
        },
        {
          name: "get_inspected_element",
          description: "Retrieve the outerHTML and critical computed styling of the element currently selected in DevTools."
        }
      ]
    }
  ];

  const history = [
    {
      role: "user",
      parts: [{ text: startPrompt }]
    }
  ];

  let loopCount = 0;
  const maxLoops = 15;

  while (loopCount < maxLoops) {
    if (isAborted) {
      throw new Error("Analysis aborted by user.");
    }
    loopCount++;
    appendLog(loggerId, `Calling Gemini API (Turn ${loopCount})...`, "system");

    const requestBody = {
      contents: history,
      tools: tools,
      systemInstruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }]
      },
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: currentAbortController.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API returned error: ${response.status} - ${errorText}`);
    }

    const resJson = await response.json();
    const candidate = resJson.candidates[0];
    const modelContent = candidate.content;

    history.push(modelContent);
    const part = modelContent.parts[0];

    // Check if the model called a function
    if (part.functionCall) {
      if (isAborted) {
        throw new Error("Analysis aborted by user.");
      }
      const { name, args } = part.functionCall;
      appendLog(loggerId, `Model requested tool execution: ${name}(${JSON.stringify(args)})`, "agent");

      let toolResult;
      try {
        if (name === "search_use_cases") {
          toolResult = await searchUseCases(args.query);
          appendLog(loggerId, `Tool output: Found ${toolResult.length} matching guides for query "${args.query}".`, "tool");
        } else if (name === "list_categories") {
          toolResult = await listCategories();
          appendLog(loggerId, `Tool output: Returned ${toolResult.length} categories.`, "tool");
        } else if (name === "list_use_cases") {
          toolResult = await listUseCases(args.category);
          appendLog(loggerId, `Tool output: Returned ${toolResult.length} use cases.`, "tool");
        } else if (name === "get_guide_content") {
          toolResult = await getGuideContent(args.useCaseId);
          appendLog(loggerId, `Tool output: Loaded guide content for "${args.useCaseId}".`, "tool");
        } else if (name === "get_page_dom") {
          toolResult = await getPageDOM();
          appendLog(loggerId, `Tool output: Captured active page DOM.`, "tool");
        } else if (name === "get_inspected_element") {
          toolResult = await getInspectedElement();
          appendLog(loggerId, `Tool output: Captured DevTools selected element.`, "tool");
        } else {
          throw new Error(`Unknown function call: ${name}`);
        }
      } catch (err) {
        console.error("Tool execution failed:", err);
        toolResult = { error: err.message };
        appendLog(loggerId, `Tool output: Execution failed (${err.message})`, "system");
      }

      history.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: name,
              response: { result: toolResult }
            }
          }
        ]
      });
    } else {
      // Final text response reached
      appendLog(loggerId, "Analysis completed! Parsing results...", "system");
      try {
        const text = part.text.trim();
        
        // Robust extraction of JSON data block to ignore conversational markers or markdown wrapping
        const firstBracket = text.indexOf("[");
        const firstBrace = text.indexOf("{");
        
        let startIdx = -1;
        let endChar = "";
        
        if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
          startIdx = firstBracket;
          endChar = "]";
        } else if (firstBrace !== -1) {
          startIdx = firstBrace;
          endChar = "}";
        }
        
        if (startIdx === -1) {
          throw new Error("No JSON structure found in output text");
        }
        
        const endIdx = text.lastIndexOf(endChar);
        if (endIdx <= startIdx) {
          throw new Error("Mismatched brackets or braces in output");
        }
        
        const jsonText = text.substring(startIdx, endIdx + 1);
        const parsed = JSON.parse(jsonText);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch (err) {
        console.error("Failed to parse Gemini output text to JSON:", part.text, err);
        throw new Error("Final report did not conform to JSON format");
      }
    }
  }

  throw new Error("Exceeded maximum execution turn limit.");
}

// Audit Page View Actions
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

  try {
    const startPrompt = `Please perform a Full Page Audit. Use your tools to check the page structure and find matching use cases and guidelines to recommend modern solutions.

Current Browser Support Policy (Baseline Target): ${config.baselineTarget}

Rules for browser compatibility:
- If the target is 'widely-available', you MUST check if the recommended features are Baseline widely available. If a feature is NOT widely available (such as Invoker Commands or Popovers), you MUST recommend and include the fallback code or polyfill instructions specified in the matching guides.
- If the target is 'newly-available', you only need to include fallbacks for features that are experimental/non-standard.
- If the target is 'none', you do not need to include any fallback code.`;

    const report = await runGeminiAgent("audit", startPrompt);

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

// Inspector View Actions
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

    const report = await runGeminiAgent("inspect", startPrompt);

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

// Rendering HTML Output Cards
function renderOpportunities(container, list) {
  container.innerHTML = "";

  if (!list || list.length === 0) {
    container.innerHTML = `
      <div class="opp-card">
        <div class="opp-header">
          <div class="opp-title-group">
            <span class="opp-icon">🎉</span>
            <span class="opp-title">No legacy issues found! Your site is looking modern.</span>
          </div>
        </div>
      </div>
    `;
    return;
  }

  list.forEach(opp => {
    const card = document.createElement("div");
    card.className = "opp-card";

    let icon = "💡";
    if (opp.useCaseId?.includes("scrollbar")) icon = "📜";
    else if (opp.useCaseId?.includes("analytics") || opp.useCaseId?.includes("fetch")) icon = "⚡";
    else if (opp.useCaseId?.includes("dialog") || opp.useCaseId?.includes("popover")) icon = "🖼️";
    else if (opp.useCaseId?.includes("passkey")) icon = "🔑";

    card.innerHTML = `
      <div class="opp-header">
        <div class="opp-title-group">
          <span class="opp-icon">${icon}</span>
          <span class="opp-title">${escapeHtml(opp.title)}</span>
          <span class="badge badge-${opp.impact}">${opp.impact} Impact</span>
        </div>
        <span class="opp-arrow">▶</span>
      </div>
      <div class="opp-body">
        <p class="opp-description">${escapeHtml(opp.description)}</p>
        
        <div class="opp-meta-row">
          <span>Target Element: <code>${escapeHtml(opp.target || "document")}</code></span>
          ${opp.useCaseId ? `<span>Guide ID: <a class="guide-link-btn" href="#" data-guide="${opp.useCaseId}">${opp.useCaseId} ↗</a></span>` : ""}
        </div>

        ${opp.originalCode || opp.modernizedCode ? `
        <div class="diff-container">
          <span class="diff-header">Code Refactoring:</span>
          <div class="diff-grid">
            <div class="diff-pane">
              <div class="diff-pane-title">Legacy / Current</div>
              <pre><code class="code-del">${escapeHtml(opp.originalCode || "// N/A")}</code></pre>
            </div>
            <div class="diff-pane">
              <div class="diff-pane-title">Modernized Solution</div>
              <pre><code class="code-add">${escapeHtml(opp.modernizedCode || "// N/A")}</code></pre>
            </div>
          </div>
        </div>
        ` : ""}
      </div>
    `;

    const header = card.querySelector(".opp-header");
    header.addEventListener("click", () => {
      card.classList.toggle("expanded");
    });

    const link = card.querySelector(".guide-link-btn");
    if (link) {
      link.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          const category = useCasesCache.find(u => u.id === link.dataset.guide)?.category || "user-experience";
          // Direct developers to GitHub directly for readable rendering
          const url = `https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/${category}/${link.dataset.guide}.md`;
          chrome.tabs.create({ url });
          showToast(`Opening GitHub guide for ${link.dataset.guide}...`, "success");
        } catch (err) {
          showToast(`Failed to open guide: ${err.message}`, "error");
        }
      });
    }

    container.appendChild(card);
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
