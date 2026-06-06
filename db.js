// Guidance Use Cases and Database Loader
let useCasesCache = [];
let guidesCache = {}; // id -> markdown content

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
