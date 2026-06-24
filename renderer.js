// Opportunity Cards HTML Renderer
function detectLanguage(code) {
  if (!code) return 'html';
  const trimmed = code.trim();
  if (trimmed.startsWith('<')) return 'html';
  if (trimmed.includes('{') || (trimmed.includes(':') && trimmed.includes(';'))) return 'css';
  return 'javascript';
}

function renderOpportunities(container, list, filterTraining = false) {
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

  const renderCard = (opp, index) => {
    if (opp.target) {
      opp.target = normalizeSelector(opp.target);
    }
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

    let diffHtml = "";
    if (opp.changes && opp.changes.length > 0) {
      const changesHtml = opp.changes.map((c, idx) => {
        const lang = detectLanguage(c.originalCode || c.modernizedCode || "");
        const highlightedOriginal = c.originalCode ? highlightCode(c.originalCode, lang) : "// N/A";
        const highlightedModernized = c.modernizedCode ? highlightCode(c.modernizedCode, lang) : "// N/A";
        return `
            <div class="diff-change-item">
              <div class="diff-change-target">Target: ${escapeHtml(c.target || opp.target || "document")}</div>
              <div class="diff-grid">
                <div class="diff-pane">
                  <div class="diff-pane-title">Legacy / Current</div>
                  <pre><code class="code-del language-${lang}">${highlightedOriginal}</code></pre>
                </div>
                <div class="diff-pane">
                  <div class="diff-pane-title">Modernized Solution</div>
                  <pre><code class="code-add language-${lang}">${highlightedModernized}</code></pre>
                </div>
              </div>
            </div>`;
      }).join("");
      
      diffHtml = `
        <div class="diff-container">
          <span class="diff-header">Code Refactoring (Multiple Changes):</span>
          ${changesHtml}
        </div>`;
    } else if (opp.originalCode || opp.modernizedCode) {
      const lang = detectLanguage(opp.originalCode || opp.modernizedCode || "");
      const highlightedOriginal = opp.originalCode ? highlightCode(opp.originalCode, lang) : "// N/A";
      const highlightedModernized = opp.modernizedCode ? highlightCode(opp.modernizedCode, lang) : "// N/A";
      diffHtml = `
        <div class="diff-container">
          <span class="diff-header">Code Refactoring:</span>
          <div class="diff-grid">
            <div class="diff-pane">
              <div class="diff-pane-title">Legacy / Current</div>
              <pre><code class="code-del language-${lang}">${highlightedOriginal}</code></pre>
            </div>
            <div class="diff-pane">
              <div class="diff-pane-title">Modernized Solution</div>
              <pre><code class="code-add language-${lang}">${highlightedModernized}</code></pre>
            </div>
          </div>
        </div>`;
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
        
        ${diffHtml}

        <div class="opp-actions-row">
          ${opp.modernizedCode || (opp.changes && opp.changes.length > 0) ? `
          <button class="btn btn-secondary btn-apply-preview" ${isNetwork ? "disabled title='Cannot apply preview to network assets'" : ""}>
            <span>✨ Apply Preview</span>
          </button>
          <button class="btn btn-secondary btn-save-override" ${(!opp.originalCode && (!opp.changes || opp.changes.length === 0)) ? "disabled title='Original legacy snippet required'" : ""}>
            <span>💾 Save to Overrides</span>
          </button>
          ` : ""}
          <button class="btn btn-secondary btn-ask-dino">
            <span>🦖 Ask Dino</span>
          </button>
        </div>

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

    const btnAskDino = card.querySelector(".btn-ask-dino");
    if (btnAskDino) {
      btnAskDino.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        askDinoAboutOpportunity(opp);
      });
    }

    return card;
  };

  const guideOpps = sortedList.filter(opp => opp.useCaseId);
  const trainingOpps = sortedList.filter(opp => !opp.useCaseId);

  if (filterTraining && trainingOpps.length > 0) {
    if (guideOpps.length === 0) {
      const infoDiv = document.createElement("div");
      infoDiv.className = "opp-card";
      infoDiv.innerHTML = `
        <div class="opp-header" style="cursor: default;">
          <div class="opp-title-group">
            <span class="opp-icon">🎉</span>
            <span class="opp-title">No legacy issues found matching official guides!</span>
          </div>
        </div>
      `;
      container.appendChild(infoDiv);
    } else {
      guideOpps.forEach((opp, index) => {
        const card = renderCard(opp, index);
        container.appendChild(card);
      });
    }

    const btnShowMore = document.createElement("button");
    btnShowMore.className = "btn btn-secondary show-more-training-btn";
    btnShowMore.style.margin = "16px auto";
    btnShowMore.style.display = "block";
    btnShowMore.style.width = "calc(100% - 24px)";
    btnShowMore.style.textAlign = "center";
    btnShowMore.innerHTML = `Show ${trainingOpps.length} more recommendation${trainingOpps.length === 1 ? '' : 's'} from training knowledge`;

    const trainingWrapper = document.createElement("div");
    trainingWrapper.className = "training-opportunities-wrapper hidden";

    trainingOpps.forEach((opp, index) => {
      const card = renderCard(opp, guideOpps.length + index);
      trainingWrapper.appendChild(card);
    });

    btnShowMore.addEventListener("click", () => {
      trainingWrapper.classList.remove("hidden");
      btnShowMore.remove();
    });

    container.appendChild(btnShowMore);
    container.appendChild(trainingWrapper);
  } else {
    sortedList.forEach((opp, index) => {
      const card = renderCard(opp, index);
      container.appendChild(card);
    });
  }

  // Bind interactive code tags for element highlights/inspections inside HTML/code blocks
  bindInteractiveCodeTags(container);
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
  if (!opp.modernizedCode && (!opp.changes || opp.changes.length === 0)) {
    showToast("No modernized code snippet to preview.", "warning");
    return;
  }

  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) {
    showToast("No inspected tab found.", "error");
    return;
  }

  showToast("Applying modernization preview to tab...", "info");

  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (selector, code, originalCode, changes) => {
        const applyOne = (sel, cd, orig) => {
          cd = cd.trim();

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

          // Helper to check if string is a list of HTML attributes
          const isAttributeList = (str) => {
            if (str.startsWith("<") || !str.includes("=") || str.includes("{")) return false;
            try {
              const testDiv = document.createElement("div");
              testDiv.innerHTML = `<span ${str}></span>`;
              const span = testDiv.firstElementChild;
              return span && span.attributes.length > 0 && Array.from(span.attributes).every(attr => attr.name !== "undefined");
            } catch (e) {
              return false;
            }
          };

          try {
            if (isAttributeList(cd) && sel && sel !== "document") {
              const elements = document.querySelectorAll(sel);
              if (elements.length > 0) {
                const testDiv = document.createElement("div");
                testDiv.innerHTML = `<span ${cd}></span>`;
                const attrs = Array.from(testDiv.firstElementChild.attributes);
                elements.forEach(el => {
                  attrs.forEach(attr => {
                    el.setAttribute(attr.name, attr.value);
                  });
                });
                return { success: true, message: `Applied attributes (${attrs.map(a => a.name).join(", ")}) to elements matching "${sel}".` };
              }
            }

            if (isCSS(cd)) {
              // CSS Injection
              if (sel === "document" || cd.includes("{")) {
                const style = document.createElement("style");
                style.className = "mwg-preview-styles";
                style.textContent = cd;
                document.head.appendChild(style);
                return { success: true, message: "Applied CSS preview styling to document!" };
              } else {
                const elements = document.querySelectorAll(sel);
                if (elements.length === 0) return { error: `Selector "${sel}" not found on page.` };
                elements.forEach(el => { el.style.cssText += ";" + cd; });
                return { success: true, message: `Applied inline styles to ${elements.length} element(s).` };
              }
            }

            if (isHTML(cd)) {
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
              if (orig) {
                const matchedEl = findElementByHTML(orig);
                if (matchedEl) {
                  setElementHTML(matchedEl, cd);
                  return { success: true, message: "Successfully replaced legacy element on page!" };
                }
              }

              // 2. Try replacing by selector if it's not "document"
              if (sel && sel !== "document") {
                const elements = document.querySelectorAll(sel);
                if (elements.length > 0) {
                  elements.forEach(el => { setElementHTML(el, cd); });
                  return { success: true, message: `Overrode content of ${elements.length} element(s) matching "${sel}"!` };
                }
              }

              // 3. Try finding tag matching the modernized code root tag (e.g. replacement of header or nav)
              const tagMatch = cd.match(/^<([a-zA-Z0-9:-]+)/);
              if (tagMatch) {
                const tagName = tagMatch[1].toLowerCase();
                if (["header", "nav", "main", "footer"].includes(tagName)) {
                  const existingEl = document.querySelector(tagName);
                  if (existingEl) {
                    setElementHTML(existingEl, cd);
                    return { success: true, message: `Replaced existing <${tagName}> element on the page!` };
                  }
                }
              }

              // 4. Default fallback: prepend to body (useful for accessibility skip links, headers)
              const container = document.createElement("div");
              container.className = "mwg-preview-html";
              container.innerHTML = cd;
              document.body.prepend(container);
              return { success: true, message: "Prepended HTML preview to the top of page body!" };
            }

            // JS fallback
            const script = document.createElement("script");
            script.className = "mwg-preview-script";
            script.textContent = cd;
            document.body.appendChild(script);
            script.remove();
            return { success: true, message: "Executed preview JS script!" };

          } catch (err) {
            return { error: err.message };
          }
        };

        if (changes && Array.isArray(changes) && changes.length > 0) {
          const results = [];
          for (const change of changes) {
            const res = applyOne(change.target || selector, change.modernizedCode, change.originalCode);
            results.push(res);
          }
          const failed = results.find(r => r.error);
          if (failed) return { error: failed.error };
          return { success: true, message: `Applied ${results.length} preview changes successfully!` };
        } else {
          return applyOne(selector, code, originalCode);
        }
      },
      args: [opp.target || "document", opp.modernizedCode || "", opp.originalCode || "", opp.changes || null]
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
  if (!card) return;
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
    let guideContent = "";
    if (opp.useCaseId) {
      try {
        guideContent = await getGuideContent(opp.useCaseId);
      } catch (err) {
        console.warn("Could not load guide content for verification:", err);
      }
    }

    const domInfo = await getPageDOM();
    if (!domInfo) throw new Error("Could not capture page DOM for verification.");

    let verifyPrompt = `You are verifying if a modernization fix was successful.
Original Legacy Issue:
- Title: "${opp.title}"
- Target Element Selector: "${opp.target}"
- Original Legacy Code: \\\`${opp.originalCode || ""}\\\`
- Intended Modernized Solution: \\\`${opp.modernizedCode || ""}\\\`

Current Page DOM state captured:
URL: ${domInfo.url}
DOM HTML Structure (Simplified):
${domInfo.dom}

Your task is to analyze if the specific legacy issue described has been successfully resolved/modernized on the page.`;

    if (guideContent) {
      verifyPrompt += `\n\nOfficial MWG Guide Reference Guidelines for this Use Case:\n===\n${guideContent}\n===`;
    }

    verifyPrompt += `\n\nIf you need to interact with the page to trigger dynamic behavior, check styles, or test elements (e.g. clicking a button, hovering, checking computed styles of the target selector, checking console warnings/errors), you MUST call the appropriate browser tools (click_element, hover_element, type_text, get_element_info, get_console_logs).
If the legacy issue is resolved and everything functions correctly without javascript errors and complies with the guide, mark it as resolved.
If the legacy issue is still active, fails to execute properly, or violates the guide, mark it as not resolved.`;

    const systemInstruction = `You are a strict code verification agent. Analyze the provided DOM state and interact with the page if needed to verify the target legacy issue is resolved.
You have tools to click elements, hover elements, type text, read computed CSS styles/attributes of selectors, and fetch console logs. Use them if the modernization fix requires user interaction, styling verification, or error checks. When inspecting multiple elements, prefer calling get_element_info with a comma-separated selector list to retrieve all details in a single tool call to save tokens and minimize roundtrips.
    
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
      
      let failMessage = `Verification failed: ${verifyResult?.feedback || 'Could not verify fix.'}`;
      if (verifyText) verifyText.innerHTML = failMessage;
      
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
    const changes = opp.changes && opp.changes.length > 0 ? opp.changes : [{
      target: opp.target,
      originalCode: opp.originalCode,
      modernizedCode: opp.modernizedCode
    }];

    const invalidChange = changes.find(c => !c.originalCode || !c.modernizedCode);
    if (invalidChange) {
      showToast("Original and modernized code snippets are required to save overrides.", "warning");
      resolve({ success: false, error: "Original and modernized code snippets are required." });
      return;
    }

    // Create a regex that is flexible with whitespaces, quotes, and self-closing slashes
    const makeFlexibleRegex = (snippet) => {
      let pattern = snippet.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      pattern = pattern.replace(/['\"]/g, '[\'\"]');
      pattern = pattern.replace(/>/g, '\\s*\\/?\\s*>');
      pattern = pattern.replace(/\s+/g, '\\s+');
      return new RegExp(pattern);
    };

    showToast("Scanning page resources...", "info");

    chrome.devtools.inspectedWindow.getResources((resources) => {
      let foundAny = false;
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
          if (!content) {
            if (checkedCount === textResources.length) {
              if (foundAny) {
                resolve({ success: true, message: "Successfully saved overrides!" });
              } else {
                showToast("Could not find any of the legacy code snippets in page resources.", "warning");
                resolve({ success: false, error: "Could not find any legacy code snippets in page resources." });
              }
            }
            return;
          }

          let updatedContent = content;
          let resourceModified = false;

          changes.forEach(change => {
            const legacySnippet = change.originalCode.trim();
            const modernSnippet = change.modernizedCode.trim();
            const regex = makeFlexibleRegex(legacySnippet);
            const regexModern = makeFlexibleRegex(modernSnippet);

            if (regex.test(updatedContent)) {
              updatedContent = updatedContent.replace(regex, modernSnippet);
              resourceModified = true;
              foundAny = true;
            } else if (regexModern.test(updatedContent)) {
              // Already modernized
              resourceModified = true;
              foundAny = true;
            }
          });

          if (resourceModified) {
            res.setContent(updatedContent, true, (error) => {
              if (error && error.code !== "OK") {
                showToast(`Failed to save override to ${res.url.split('/').pop()}: ${error.message || JSON.stringify(error)}`, "error");
              } else {
                showToast(`Successfully saved override to ${res.url.split('/').pop()}!`, "success");
              }

              if (checkedCount === textResources.length) {
                resolve({ success: true, message: "Successfully saved overrides!" });
              }
            });
          } else {
            if (checkedCount === textResources.length) {
              if (foundAny) {
                resolve({ success: true, message: "Successfully saved overrides!" });
              } else {
                showToast("Could not find any of the legacy code snippets in page resources.", "warning");
                resolve({ success: false, error: "Could not find any legacy code snippets in page resources." });
              }
            }
          }
        });
      });
    });
  });
}

function generateMarkdownReport(list) {
  if (!list || list.length === 0) {
    return "# Page Modernization Audit Report\n\n🎉 **No legacy issues found! Your site is looking modern.**\n";
  }

  const guideOpps = list.filter(opp => opp.useCaseId);
  const trainingOpps = list.filter(opp => !opp.useCaseId);

  let md = "# Page Modernization Audit Report\n\n";
  md += `*Generated on ${new Date().toLocaleString()}*\n`;
  md += `*Baseline Compatibility Target*: ${typeof config !== 'undefined' ? (config.baselineTarget || "Not configured") : "Not configured"}\n\n`;

  md += `## Summary\n`;
  md += `Found **${list.length}** modernization opportunit${list.length === 1 ? 'y' : 'ies'} (`;
  md += `**${guideOpps.length}** guide-based, **${trainingOpps.length}** from training knowledge).\n\n`;

  if (guideOpps.length > 0) {
    md += `## Modernization Recommendations (Guide-based)\n\n`;
    md += `| Opportunity | Impact | Target Element | Guide / Use Case |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    
    guideOpps.forEach(opp => {
      const guideLink = opp.useCaseId ? `[${opp.useCaseId}](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/${getGuideCategory(opp.useCaseId)}/${opp.useCaseId}.md${opp.guideAnchor ? '#' + opp.guideAnchor : ''})` : 'Gemini training data';
      md += `| ${opp.title} | **${opp.impact}** | \`${opp.target || 'document'}\` | ${guideLink} |\n`;
    });
    
    md += `\n---\n\n`;

    guideOpps.forEach((opp, index) => {
      md += `### ${index + 1}. ${opp.title}\n\n`;
      md += `- **Impact**: ${opp.impact.toUpperCase()}\n`;
      md += `- **Target Element**: \`${opp.target || 'document'}\`\n`;
      if (opp.useCaseId) {
        const cat = getGuideCategory(opp.useCaseId);
        md += `- **Guide ID**: [${opp.useCaseId}](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/${cat}/${opp.useCaseId}.md${opp.guideAnchor ? '#' + opp.guideAnchor : ''})\n`;
      } else {
        md += `- **Source**: Gemini training data\n`;
      }
      md += `\n#### Description\n${opp.description}\n\n`;

      if (opp.originalCode) {
        let lang = 'html';
        const code = opp.originalCode.trim();
        if (code.startsWith('<')) lang = 'html';
        else if (code.includes('{') || (code.includes(':') && code.includes(';'))) lang = 'css';
        else lang = 'javascript';
        
        md += `#### Legacy / Current Code\n`;
        md += `\`\`\`${lang}\n${opp.originalCode}\n\`\`\`\n\n`;
      }

      if (opp.modernizedCode) {
        let lang = 'html';
        const code = opp.modernizedCode.trim();
        if (code.startsWith('<')) lang = 'html';
        else if (code.includes('{') || (code.includes(':') && code.includes(';'))) lang = 'css';
        else lang = 'javascript';
        
        md += `#### Modernized Solution\n`;
        md += `\`\`\`${lang}\n${opp.modernizedCode}\n\`\`\`\n\n`;
      }

      md += `---\n\n`;
    });
  }

  if (trainingOpps.length > 0) {
    md += `## Recommendations from Training Knowledge\n\n`;
    md += `| Opportunity | Impact | Target Element | Source |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    
    trainingOpps.forEach(opp => {
      md += `| ${opp.title} | **${opp.impact}** | \`${opp.target || 'document'}\` | Gemini training data |\n`;
    });
    
    md += `\n---\n\n`;

    trainingOpps.forEach((opp, index) => {
      md += `### ${index + 1}. ${opp.title}\n\n`;
      md += `- **Impact**: ${opp.impact.toUpperCase()}\n`;
      md += `- **Target Element**: \`${opp.target || 'document'}\`\n`;
      md += `- **Source**: Gemini training data\n`;
      md += `\n#### Description\n${opp.description}\n\n`;

      if (opp.originalCode) {
        let lang = 'html';
        const code = opp.originalCode.trim();
        if (code.startsWith('<')) lang = 'html';
        else if (code.includes('{') || (code.includes(':') && code.includes(';'))) lang = 'css';
        else lang = 'javascript';
        
        md += `#### Legacy / Current Code\n`;
        md += `\`\`\`${lang}\n${opp.originalCode}\n\`\`\`\n\n`;
      }

      if (opp.modernizedCode) {
        let lang = 'html';
        const code = opp.modernizedCode.trim();
        if (code.startsWith('<')) lang = 'html';
        else if (code.includes('{') || (code.includes(':') && code.includes(';'))) lang = 'css';
        else lang = 'javascript';
        
        md += `#### Modernized Solution\n`;
        md += `\`\`\`${lang}\n${opp.modernizedCode}\n\`\`\`\n\n`;
      }

      md += `---\n\n`;
    });
  }

  return md;
}

function getGuideCategory(guideId) {
  let uc = typeof useCasesCache !== 'undefined' ? useCasesCache.find(u => u.id === guideId) : null;
  if (!uc && guideId && typeof useCasesCache !== 'undefined') {
    const matchingUcs = useCasesCache
      .filter(u => guideId.startsWith(u.id))
      .sort((a, b) => b.id.length - a.id.length);
    if (matchingUcs.length > 0) {
      uc = matchingUcs[0];
    }
  }
  return uc ? uc.category : "user-experience";
}
