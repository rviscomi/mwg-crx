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

  const impactWeights = {
    high: 3,
    medium: 2,
    low: 1
  };

  const sortedList = [...list].sort((a, b) => {
    const weightA = impactWeights[a.impact?.toLowerCase()] || 0;
    const weightB = impactWeights[b.impact?.toLowerCase()] || 0;
    return weightB - weightA;
  });

  sortedList.forEach((opp, index) => {
    const card = document.createElement("div");
    card.className = "opp-card";
    card.dataset.oppIndex = index;
    opp.id = index;

    let icon = "💡";
    if (opp.useCaseId?.includes("scrollbar")) icon = "📜";
    else if (opp.useCaseId?.includes("analytics") || opp.useCaseId?.includes("fetch")) icon = "⚡";
    else if (opp.useCaseId?.includes("dialog") || opp.useCaseId?.includes("popover")) icon = "🖼️";
    else if (opp.useCaseId?.includes("passkey")) icon = "🔑";

    const targetLower = (opp.target || "").toLowerCase();
    const isNetwork = targetLower === "network" || 
                      targetLower.includes("set-cookie") || 
                      targetLower.includes("http header") ||
                      targetLower.includes("network panel") ||
                      targetLower.includes("cookie script");

    let targetHtml = `<code>document</code>`;
    if (isNetwork) {
      targetHtml = `<code>Network Panel</code>`;
    } else if (opp.target && opp.target !== "document") {
      targetHtml = `<a class="target-link-btn" href="#" data-target="${escapeHtml(opp.target)}"><code>${escapeHtml(opp.target)}</code></a>`;
    }

    card.innerHTML = `
      <div class="opp-header">
        <div class="opp-title-group">
          <span class="opp-icon">${icon}</span>
          <span class="opp-title">${escapeHtml(opp.title)}</span>
          <span class="badge badge-${opp.impact}">${opp.impact} Impact</span>
          <span class="badge badge-verify hidden"></span>
        </div>
        <span class="opp-arrow">▶</span>
      </div>
      <div class="opp-body">
        <p class="opp-description">${escapeHtml(opp.description)}</p>
        
        <div class="opp-verification-banner hidden">
          <span class="verify-icon"></span>
          <span class="verify-text"></span>
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

        ${opp.modernizedCode ? `
        <div class="opp-actions-row">
          <button class="btn btn-secondary btn-apply-preview" ${isNetwork ? "disabled title='Cannot apply preview to network assets'" : ""}>
            <span>✨ Apply Preview</span>
          </button>
          <button class="btn btn-secondary btn-save-override" ${!opp.originalCode ? "disabled title='Original legacy snippet required'" : ""}>
            <span>💾 Save to Overrides</span>
          </button>
        </div>
        ` : ""}

        <div class="opp-meta-row">
          <span>Target: ${targetHtml}</span>
          ${opp.useCaseId ? `<span>Guide ID: <a class="guide-link-btn" href="#" data-guide="${opp.useCaseId}" data-anchor="${escapeHtml(opp.guideAnchor || '')}">${opp.useCaseId} ↗</a></span>` : `<span>Source: Gemini training data</span>`}
        </div>
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
          let guideId = link.dataset.guide;
          let anchor = link.dataset.anchor ? `#${link.dataset.anchor}` : "";
          
          let uc = useCasesCache.find(u => u.id === guideId);
          if (!uc && guideId) {
            // Self-healing: Check if the guideId starts with any valid use case ID
            const matchingUcs = useCasesCache
              .filter(u => guideId.startsWith(u.id))
              .sort((a, b) => b.id.length - a.id.length);
            if (matchingUcs.length > 0) {
              const matchingUc = matchingUcs[0];
              uc = matchingUc;
              const rest = guideId.substring(matchingUc.id.length);
              anchor = `#${rest.replace(/^[-_]+/, "")}`;
              guideId = matchingUc.id;
            }
          }

          const category = uc ? uc.category : "user-experience";
          // Direct developers to GitHub directly for readable rendering
          const url = `https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/${category}/${guideId}.md${anchor}`;
          chrome.tabs.create({ url });
          showToast(`Opening GitHub guide for ${guideId}...`, "success");
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
            const selector = ${JSON.stringify(selector)};
            try {
              const el = document.querySelector(selector);
              if (el) {
                inspect(el);
                return { found: true };
              }
              return { found: false };
            } catch (e) {
              return { error: e.message };
            }
          })()`,
          (result, isException) => {
            if (isException || (result && result.error)) {
              showToast(`This target is a descriptive label: "${selector}"`, "info");
            } else if (result && !result.found) {
              showToast(`Could not find element matching "${selector}" on active page.`, "warning");
            }
          }
        );
      });

      targetLink.addEventListener("mouseenter", () => {
        highlightElementOnPage(targetLink.dataset.target);
      });
      targetLink.addEventListener("mouseleave", () => {
        removeHighlightFromPage();
      });
    }

    const btnApply = card.querySelector(".btn-apply-preview");
    if (btnApply) {
      btnApply.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyPreview(opp, card);
      });
    }

    const btnSave = card.querySelector(".btn-save-override");
    if (btnSave) {
      btnSave.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        saveOverride(opp);
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

async function applyPreview(opp, card) {
  if (!opp.modernizedCode) {
    showToast("No modernized code snippet to preview.", "warning");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    showToast("No active tab found.", "error");
    return;
  }

  showToast("Applying modernization preview to tab...", "info");

  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (selector, code, originalCode) => {
        code = code.trim();

        const setElementHTML = (el, htmlCode) => {
          if (el.parentNode === document) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlCode, "text/html");
            const newHtmlEl = doc.documentElement;
            if (newHtmlEl) {
              while (el.attributes.length > 0) el.removeAttribute(el.attributes[0].name);
              for (const attr of newHtmlEl.attributes) {
                el.setAttribute(attr.name, attr.value);
              }
              el.innerHTML = newHtmlEl.innerHTML;
            }
          } else {
            el.outerHTML = htmlCode;
          }
        };

        // Helper to check if string is probably CSS
        const isCSS = (str) => {
          if (str.startsWith("<")) return false;
          return str.includes("{") || (str.includes(":") && str.includes(";"));
        };

        // Helper to check if string is probably HTML
        const isHTML = (str) => {
          return str.startsWith("<");
        };

        try {
          if (isCSS(code)) {
            // CSS Injection
            if (selector === "document" || code.includes("{")) {
              const style = document.createElement("style");
              style.className = "mwg-preview-styles";
              style.textContent = code;
              document.head.appendChild(style);
              return { success: true, message: "Applied CSS preview styling to document!" };
            } else {
              const elements = document.querySelectorAll(selector);
              if (elements.length === 0) return { error: `Selector "${selector}" not found on page.` };
              elements.forEach(el => { el.style.cssText += ";" + code; });
              return { success: true, message: `Applied inline styles to ${elements.length} element(s).` };
            }
          }

          if (isHTML(code)) {
            // HTML Injection / Overriding

            // Helper to match elements by outerHTML string
            const findElementByHTML = (htmlSnippet) => {
              if (!htmlSnippet) return null;
              const clean = (h) => h.replace(/\s+/g, ' ').trim();
              const targetClean = clean(htmlSnippet);
              const all = document.body.querySelectorAll('*');
              for (const el of all) {
                if (clean(el.outerHTML) === targetClean) return el;
              }
              return null;
            };

            // 1. Try finding by originalCode match
            if (originalCode) {
              const matchedEl = findElementByHTML(originalCode);
              if (matchedEl) {
                setElementHTML(matchedEl, code);
                return { success: true, message: "Successfully replaced legacy element on page!" };
              }
            }

            // 2. Try replacing by selector if it's not "document"
            if (selector && selector !== "document") {
              const elements = document.querySelectorAll(selector);
              if (elements.length > 0) {
                elements.forEach(el => { setElementHTML(el, code); });
                return { success: true, message: `Overrode content of ${elements.length} element(s) matching "${selector}"!` };
              }
            }

            // 3. Try finding tag matching the modernized code root tag (e.g. replacement of header or nav)
            const tagMatch = code.match(/^<([a-zA-Z0-9:-]+)/);
            if (tagMatch) {
              const tagName = tagMatch[1].toLowerCase();
              if (["header", "nav", "main", "footer"].includes(tagName)) {
                const existingEl = document.querySelector(tagName);
                if (existingEl) {
                  setElementHTML(existingEl, code);
                  return { success: true, message: `Replaced existing <${tagName}> element on the page!` };
                }
              }
            }

            // 4. Default fallback: prepend to body (useful for accessibility skip links, headers)
            const container = document.createElement("div");
            container.className = "mwg-preview-html";
            container.innerHTML = code;
            document.body.prepend(container);
            return { success: true, message: "Prepended HTML preview to the top of page body!" };
          }

          // JS fallback
          const script = document.createElement("script");
          script.className = "mwg-preview-script";
          script.textContent = code;
          document.body.appendChild(script);
          script.remove();
          return { success: true, message: "Executed preview JS script!" };

        } catch (err) {
          return { error: err.message };
        }
      },
      args: [opp.target || "document", opp.modernizedCode, opp.originalCode || ""]
    });

    const res = result[0]?.result;
    if (res?.error) {
      showToast(res.error, "error");
      return { success: false, error: res.error };
    } else if (res?.success) {
      showToast(res.message, "success");
      verifyOpportunity(opp, card);
      return { success: true, message: res.message };
    }
  } catch (err) {
    showToast(`Failed to execute preview script: ${err.message}`, "error");
    return { success: false, error: err.message };
  }
}

async function verifyOpportunity(opp, card) {
  const badgeVerify = card.querySelector(".badge-verify");
  const banner = card.querySelector(".opp-verification-banner");
  
  if (!badgeVerify || !banner) return;
  
  const verifyIcon = banner.querySelector(".verify-icon");
  const verifyText = banner.querySelector(".verify-text");

  // Show status in UI
  badgeVerify.className = "badge badge-verify verifying";
  badgeVerify.textContent = "Verifying...";
  badgeVerify.classList.remove("hidden");

  banner.className = "opp-verification-banner verifying";
  if (verifyIcon) verifyIcon.textContent = "🔄";
  if (verifyText) verifyText.textContent = "Verifying modernization fix on active tab...";
  banner.classList.remove("hidden");

  try {
    const domInfo = await getPageDOM();
    if (!domInfo) throw new Error("Could not capture page DOM for verification.");

    const verifyPrompt = `You are verifying if a modernization fix was successful.
Original Legacy Issue:
- Title: "${opp.title}"
- Target Element Selector: "${opp.target}"
- Original Legacy Code: \\\`${opp.originalCode || ""}\\\`
- Intended Modernized Solution: \\\`${opp.modernizedCode || ""}\\\`

Current Page DOM state captured:
URL: ${domInfo.url}
DOM HTML Structure (Simplified):
${domInfo.dom}

Your task is to analyze if the specific legacy issue described has been successfully resolved/modernized on the page.
If the original code or issue (e.g. role="menu" or legacy element) has been replaced by the modernized code or patterns (or if the specific issue is no longer present), mark it as resolved.
If the legacy issue is still active (e.g., if you still find elements matching the legacy pattern in the DOM), mark it as not resolved.`;

    const systemInstruction = `You are a strict code verification agent. Analyze the provided DOM state against the target legacy issue.
    
Output your verification report STRICTLY as a JSON object matching this schema:
{
  "resolved": true | false,
  "feedback": "Short explanation of your finding (e.g. 'Successfully replaced legacy header tag' or 'The element is still using role=menu')"
}`;

    const responseSchema = {
      type: "OBJECT",
      properties: {
        resolved: { type: "BOOLEAN" },
        feedback: { type: "STRING" }
      },
      required: ["resolved", "feedback"]
    };

    const silentLoggerId = `verify-${opp.id || Math.floor(Math.random() * 1000000)}`;
    const results = await runGeminiAgent(silentLoggerId, verifyPrompt, systemInstruction, responseSchema);

    const verifyResult = results[0];
    if (verifyResult && verifyResult.resolved) {
      badgeVerify.className = "badge badge-verify resolved";
      badgeVerify.textContent = "Verified";
      
      banner.className = "opp-verification-banner resolved";
      if (verifyIcon) verifyIcon.textContent = "✅";
      if (verifyText) verifyText.textContent = `Verified: ${verifyResult.feedback}`;
      
      card.classList.add("resolved");
    } else {
      badgeVerify.className = "badge badge-verify failed";
      badgeVerify.textContent = "Verification Failed";
      
      banner.className = "opp-verification-banner failed";
      if (verifyIcon) verifyIcon.textContent = "❌";
      if (verifyText) verifyText.textContent = `Verification failed: ${verifyResult?.feedback || 'Could not verify fix.'}`;
      
      card.classList.remove("resolved");
    }
  } catch (err) {
    console.error("Verification failed:", err);
    badgeVerify.className = "badge badge-verify failed";
    badgeVerify.textContent = "Verification Error";
    
    banner.className = "opp-verification-banner failed";
    if (verifyIcon) verifyIcon.textContent = "⚠️";
    if (verifyText) verifyText.textContent = `Verification error: ${err.message}`;
  }
}

function saveOverride(opp) {
  return new Promise((resolve) => {
    if (!opp.originalCode || !opp.modernizedCode) {
      showToast("Original and modernized code snippets are required to save overrides.", "warning");
      resolve({ success: false, error: "Original and modernized code snippets are required." });
      return;
    }

    const legacySnippet = opp.originalCode.trim();
    const modernSnippet = opp.modernizedCode.trim();

    // Create a regex that is flexible with whitespaces, quotes, and self-closing slashes
    const makeFlexibleRegex = (snippet) => {
      let pattern = snippet.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      pattern = pattern.replace(/['\"]/g, '[\'\"]');
      pattern = pattern.replace(/>/g, '\\s*\\/?\\s*>');
      pattern = pattern.replace(/\s+/g, '\\s+');
      return new RegExp(pattern);
    };

    const regex = makeFlexibleRegex(legacySnippet);
    const regexModern = makeFlexibleRegex(modernSnippet);

    showToast("Scanning page resources...", "info");

    chrome.devtools.inspectedWindow.getResources((resources) => {
      let found = false;
      let checkedCount = 0;
      
      // Filter to scripts, stylesheets, and document
      const textResources = resources.filter(res => 
        res.type === "document" || res.type === "stylesheet" || res.type === "script"
      );

      if (textResources.length === 0) {
        showToast("No text resources found to override.", "warning");
        resolve({ success: false, error: "No text resources found to override." });
        return;
      }

      textResources.forEach(res => {
        res.getContent((content) => {
          checkedCount++;
          if (found) return;

          if (content && regex.test(content)) {
            found = true;
            const updatedContent = content.replace(regex, modernSnippet);
            res.setContent(updatedContent, true, (error) => {
              if (error) {
                showToast(`Failed to save override: ${error.message || JSON.stringify(error)}`, "error");
                resolve({ success: false, error: error.message || JSON.stringify(error) });
              } else {
                showToast(`Successfully saved override to ${res.url.split('/').pop()}!`, "success");
                resolve({ success: true, message: `Successfully saved override to ${res.url.split('/').pop()}!` });
              }
            });
          } else if (content && regexModern.test(content)) {
            found = true;
            res.setContent(content, true, (error) => {
              if (error) {
                showToast(`Failed to save override: ${error.message || JSON.stringify(error)}`, "error");
                resolve({ success: false, error: error.message || JSON.stringify(error) });
              } else {
                showToast(`Successfully saved override (committed preview) to ${res.url.split('/').pop()}!`, "success");
                resolve({ success: true, message: `Successfully saved override (committed preview) to ${res.url.split('/').pop()}!` });
              }
            });
          }

          if (checkedCount === textResources.length && !found) {
            showToast("Could not find the exact legacy code snippet in any page resources.", "warning");
            resolve({ success: false, error: "Could not find the exact legacy code snippet in any page resources." });
          }
        });
      });
    });
  });
}
