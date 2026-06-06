// Opportunity Cards HTML Renderer
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
          <span>Target Element: ${opp.target && opp.target !== "document" ? `<a class="target-link-btn" href="#" data-target="${escapeHtml(opp.target)}"><code>${escapeHtml(opp.target)}</code></a>` : `<code>document</code>`}</span>
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

    const targetLink = card.querySelector(".target-link-btn");
    if (targetLink && targetLink.dataset.target) {
      targetLink.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const selector = targetLink.dataset.target;
        chrome.devtools.inspectedWindow.eval(
          `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (el) {
              inspect(el);
              return true;
            }
            return false;
          })()`,
          (result, isException) => {
            if (isException || !result) {
              showToast(`Could not find element matching "${selector}" on active page.`, "warning");
            } else {
              showToast(`Revealed "${selector}" in Elements panel!`, "success");
            }
          }
        );
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
