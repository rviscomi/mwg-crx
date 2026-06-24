// Dino Chat Panel Controller
let chatHistory = [];
let isChatGenerating = false;
let isListening = false;
let voiceWindowId = null;
let historyIndex = -1;
let tempInput = "";

// --- Persistence Helpers ---

function normalizeUrlForStorage(rawUrl) {
  if (!rawUrl) return "";
  try {
    const urlObj = new URL(rawUrl);
    urlObj.hash = "";
    return `dino_chat_${urlObj.href}`;
  } catch (e) {
    return `dino_chat_${rawUrl}`;
  }
}

async function persistCurrentChatHistory() {
  const rawUrl = await getInspectedTabUrl();
  if (!rawUrl) return;
  const storageKey = normalizeUrlForStorage(rawUrl);
  await chrome.storage.session.set({
    [storageKey]: {
      url: rawUrl,
      lastUpdated: Date.now(),
      history: chatHistory
    }
  });
}

async function loadAndRestoreChat() {
  const rawUrl = await getInspectedTabUrl();
  if (!rawUrl) return false;
  const storageKey = normalizeUrlForStorage(rawUrl);
  const data = await chrome.storage.session.get(storageKey);
  const savedSession = data[storageKey];
  
  if (savedSession && savedSession.history && savedSession.history.length > 0) {
    chatHistory = savedSession.history;
    
    const chatMessages = document.getElementById("chat-messages");
    if (chatMessages) {
      chatMessages.innerHTML = "";
    }
    
    chatHistory.forEach((msg) => {
      if (msg.hidden || (msg.role === "user" && msg.content && msg.content.startsWith("I have a question about this modernization audit result:"))) {
        return;
      }
      const bubble = appendChatMessage(msg.role, msg.content);
      if (msg.role === "model") {
        if (msg.screenshot) {
          appendScreenshotAttachment(msg.screenshot, bubble);
        }
        if (msg.citations && msg.citations.length > 0) {
          renderGreetingCitations(msg.citations, bubble);
        }
      }
    });
    
    return true;
  }
  return false;
}

function appendScreenshotAttachment(screenshotObj, bubble) {
  if (!screenshotObj || !screenshotObj.screenshot || !bubble) return;
  
  const screenshotDiv = document.createElement("div");
  screenshotDiv.className = "chat-screenshot-attachment";
  screenshotDiv.style.marginTop = "12px";
  screenshotDiv.style.borderTop = "1px solid rgba(255, 255, 255, 0.1)";
  screenshotDiv.style.paddingTop = "12px";
  screenshotDiv.innerHTML = `
    <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-sans); margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-muted); pointer-events: none;">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
      <span>Screenshot Attachment ${screenshotObj.selector ? `(${screenshotObj.selector})` : ''}</span>
    </div>
    <img src="${screenshotObj.screenshot}" alt="Captured view" style="max-width: 100%; max-height: 250px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.15); display: block; cursor: pointer; object-fit: contain; background: #222;" />
  `;
  
  screenshotDiv.querySelector("img").onclick = () => {
    const w = window.open();
    w.document.write(`<img src="${screenshotObj.screenshot}" style="max-width:100%;" />`);
  };
  bubble.appendChild(screenshotDiv);
}


// Customize marked code block renderer to support custom syntax highlighting
const renderer = new marked.Renderer();
renderer.code = (code, language) => {
  let lang = language;
  let codeStr = code;
  if (code && typeof code === "object") {
    codeStr = code.text || code.code || "";
    lang = language || code.lang;
  }
  const highlighted = highlightCode(codeStr, lang);
  return `<pre><code class="language-${lang || 'text'}">${highlighted}</code></pre>`;
};
marked.setOptions({ renderer });

function inspectPageElement(selector) {
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
}

function renderDinoResponse(content, container) {
  // Pre-process custom protocols to raw HTML links to bypass marked parser filter
  let processed = content || "";
  processed = processed.replace(/===\s*RESPONSE\s*===/gi, "");
  processed = processed.replace(/\[([^\]]+)\]\((suggest:(?:[^()]+|\([^()]*\))+)\)/g, (match, label, url) => {
    return `<a href="${escapeHtmlForChat(url)}">${escapeHtmlForChat(label)}</a>`;
  });
  processed = processed.replace(/\[([^\]]+)\]\((inspect:(?:[^()]+|\([^()]*\))+)\)/g, (match, label, url) => {
    return `<a href="${escapeHtmlForChat(url)}">${escapeHtmlForChat(label)}</a>`;
  });
  processed = processed.replace(/\[([^\]]+)\]\((useCaseId:(?:[^()]+|\([^()]*\))+)\)/g, (match, label, url) => {
    return `<a href="${escapeHtmlForChat(url)}">${escapeHtmlForChat(label)}</a>`;
  });
  processed = processed.replace(/\[([^\]]+)\]\((source:(?:[^()]+|\([^()]*\))+)\)/g, (match, label, url) => {
    return `<a href="${escapeHtmlForChat(url)}">${escapeHtmlForChat(label)}</a>`;
  });

  container.innerHTML = marked.parse(processed);
  
  // Bind [Label](source:URL?line=LINE) or (source:URL:LINE) links
  container.querySelectorAll('a[href^="source:"]').forEach(link => {
    const href = link.getAttribute("href");
    const rawUrl = decodeURIComponent(href.substring(7));
    
    link.className = "source-link-btn";
    link.removeAttribute("href");
    link.style.cursor = "pointer";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        let fileUrl = rawUrl;
        let lineNum = 0;
        let colNum = 0;
        
        try {
          const urlObj = new URL(rawUrl);
          if (urlObj.searchParams.has("line")) {
            lineNum = parseInt(urlObj.searchParams.get("line"), 10) - 1;
            if (urlObj.searchParams.has("column")) {
              colNum = parseInt(urlObj.searchParams.get("column"), 10) - 1;
            }
            urlObj.searchParams.delete("line");
            urlObj.searchParams.delete("column");
            fileUrl = urlObj.href;
          } else {
            const match = rawUrl.match(/:(\d+)(?::(\d+))?$/);
            if (match) {
              lineNum = parseInt(match[1], 10) - 1;
              if (match[2]) {
                colNum = parseInt(match[2], 10) - 1;
              }
              fileUrl = rawUrl.substring(0, match.index);
            }
          }
        } catch (urlErr) {
          const match = rawUrl.match(/:(\d+)(?::(\d+))?$/);
          if (match) {
            lineNum = parseInt(match[1], 10) - 1;
            if (match[2]) {
              colNum = parseInt(match[2], 10) - 1;
            }
            fileUrl = rawUrl.substring(0, match.index);
          }
        }

        if (lineNum < 0) lineNum = 0;
        if (colNum < 0) colNum = 0;

        if (colNum > 0) {
          chrome.devtools.panels.openResource(fileUrl, lineNum, colNum, (result) => {
            if (result && result.status === "error") {
              showToast(`Could not open source: ${result.message || 'unknown error'}`, "error");
            }
          });
        } else {
          chrome.devtools.panels.openResource(fileUrl, lineNum, (result) => {
            if (result && result.status === "error") {
              showToast(`Could not open source: ${result.message || 'unknown error'}`, "error");
            }
          });
        }
      } catch (err) {
        console.error("Dino open source click failed:", err);
        showToast(`Failed to open source: ${err.message}`, "error");
      }
    });
  });

  // Bind [Inspect: CSS_SELECTOR](inspect:CSS_SELECTOR) links
  container.querySelectorAll('a[href^="inspect:"]').forEach(link => {
    const href = link.getAttribute("href");
    const selector = normalizeSelector(decodeURIComponent(href.substring(8)));
    
    // Check if this inspect link is part of a suggestion button group
    const isButtonGroup = link.parentElement && (
      link.parentElement.querySelector('a.chat-suggest-btn') ||
      link.parentElement.querySelector('a[href^="suggest:"]')
    );

    if (isButtonGroup) {
      link.className = "chat-suggest-btn";
    } else {
      link.className = "target-link-btn";
    }

    link.removeAttribute("href");
    link.style.cursor = "pointer";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        inspectPageElement(selector);
      } catch (err) {
        console.error("Dino inspect element click failed:", err);
        showToast(`Failed to inspect element: ${err.message}`, "error");
      }
    });
    link.addEventListener("mouseenter", () => {
      try {
        highlightElementOnPage(selector);
      } catch (err) {
        console.error("Dino element highlight failed:", err);
      }
    });
    link.addEventListener("mouseleave", () => {
      try {
        removeHighlightFromPage();
      } catch (err) {
        console.error("Dino remove highlight failed:", err);
      }
    });
  });

  // Bind [Label](suggest:message) suggestion buttons
  container.querySelectorAll('a[href^="suggest:"]').forEach(link => {
    const href = link.getAttribute("href");
    const suggestionText = decodeURIComponent(href.substring(8));
    link.className = "chat-suggest-btn";
    link.removeAttribute("href");
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      try {
        const chatInput = document.getElementById("chat-input");
        if (chatInput) {
          chatInput.value = suggestionText;
          handleSendChatMessage();
        }
      } catch (err) {
        console.error("Dino suggestion button click failed:", err);
        showToast(`Failed to trigger suggestion: ${err.message}`, "error");
      }
    });
  });

  // Bind [Label](useCaseId:useCaseId) guide links
  container.querySelectorAll('a[href^="useCaseId:"]').forEach(link => {
    const href = link.getAttribute("href");
    const targetGuide = decodeURIComponent(href.substring(10));
    link.className = "guide-link-btn";
    link.removeAttribute("href");
    link.style.cursor = "pointer";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        let guideId = targetGuide;
        let anchor = "";
        const hashIdx = targetGuide.indexOf("#");
        if (hashIdx !== -1) {
          guideId = targetGuide.substring(0, hashIdx);
          anchor = targetGuide.substring(hashIdx);
        }
        
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
  });

  // Bind standard HTTP/HTTPS links to open in a new tab via chrome.tabs.create
  container.querySelectorAll('a[href^="http://"], a[href^="https://"]').forEach(link => {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const url = link.getAttribute("href");
      if (url) {
        chrome.tabs.create({ url });
      }
    });
  });

  // Bind interactive code tags for element highlights/inspections inside HTML/code blocks
  bindInteractiveCodeTags(container);
}


document.addEventListener("DOMContentLoaded", () => {
  const chatTab = document.querySelector('[data-tab="chat"]');
  if (chatTab) {
    chatTab.addEventListener("click", onChatTabActive);
    
    // Automatically trigger greeting if the chat tab is active on load
    if (chatTab.classList.contains("active")) {
      onChatTabActive();
    }
  }
  
  const sendBtn = document.getElementById("send-btn");
  const chatInput = document.getElementById("chat-input");
  const micBtn = document.getElementById("mic-btn");
  const newChatBtn = document.getElementById("btn-new-chat");
  
  if (sendBtn) sendBtn.addEventListener("click", handleSendChatMessage);
  if (micBtn) {
    micBtn.addEventListener("click", () => {
      if (isListening) {
        stopListening();
      } else {
        startListening();
      }
    });
  }
  if (newChatBtn) {
    newChatBtn.addEventListener("click", handleNewChat);
  }
  if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendChatMessage();
      } else if (e.key === "ArrowUp") {
        const text = chatInput.value;
        const firstNewline = text.indexOf('\n');
        const cursorPosition = chatInput.selectionStart;

        if (firstNewline === -1 || cursorPosition <= firstNewline) {
          const userMessages = chatHistory
            .filter(msg => msg.role === "user" && !msg.hidden && !(msg.content && msg.content.startsWith("I have a question about this modernization audit result:")))
            .map(msg => msg.content);

          if (userMessages.length > 0) {
            e.preventDefault();
            if (historyIndex === -1) {
              tempInput = chatInput.value;
              historyIndex = userMessages.length - 1;
            } else {
              historyIndex--;
              if (historyIndex < 0) {
                historyIndex = 0;
              }
            }
            chatInput.value = userMessages[historyIndex];
            chatInput.style.height = "auto";
            chatInput.style.height = chatInput.scrollHeight + "px";
            chatInput.selectionStart = chatInput.selectionEnd = chatInput.value.length;
          }
        }
      } else if (e.key === "ArrowDown") {
        if (historyIndex !== -1) {
          const text = chatInput.value;
          const lastNewline = text.lastIndexOf('\n');
          const cursorPosition = chatInput.selectionStart;

          if (lastNewline === -1 || cursorPosition > lastNewline) {
            const userMessages = chatHistory
              .filter(msg => msg.role === "user" && !msg.hidden && !(msg.content && msg.content.startsWith("I have a question about this modernization audit result:")))
              .map(msg => msg.content);

            e.preventDefault();
            historyIndex++;
            if (historyIndex >= userMessages.length) {
              chatInput.value = tempInput;
              historyIndex = -1;
              tempInput = "";
            } else {
              chatInput.value = userMessages[historyIndex];
            }
            chatInput.style.height = "auto";
            chatInput.style.height = chatInput.scrollHeight + "px";
            chatInput.selectionStart = chatInput.selectionEnd = chatInput.value.length;
          }
        }
      }
    });
    chatInput.addEventListener("input", () => {
      chatInput.style.height = "auto";
      chatInput.style.height = chatInput.scrollHeight + "px";
    });
  }
});

let hasInitializedChat = false;
let isAskDinoPending = false;
let pendingOpportunity = null;

function askDinoAboutOpportunity(opp) {
  isAskDinoPending = true;
  pendingOpportunity = opp;
  
  // Switch to the chat tab
  const chatTab = document.querySelector('.tab-item[data-tab="chat"]');
  if (chatTab) {
    chatTab.click();
  }
}

async function startChatWithOpportunity(opp) {
  if (isChatGenerating) {
    abortAnalysis();
  }
  
  hasInitializedChat = true;
  historyIndex = -1;
  tempInput = "";

  const chatMessages = document.getElementById("chat-messages");
  if (chatMessages) {
    chatMessages.innerHTML = "";
  }

  const modelMsgBubble = appendChatMessage("model", "", true);

  try {
    const greeting = await runDinoAuditResultGreeting(opp);
    
    const responseContent = modelMsgBubble.querySelector(".dino-response-content");
    if (responseContent) {
      responseContent.innerHTML = "";
      renderDinoResponse(greeting, responseContent);
    }
    
    addMessageActions(modelMsgBubble, greeting);

    let codeContent = "";
    if (opp.changes && opp.changes.length > 0) {
      codeContent = opp.changes.map((c, idx) => `Change #${idx + 1} (Target: ${c.target || opp.target || 'document'}):\nLegacy Code:\n${c.originalCode || ''}\nModernized Code:\n${c.modernizedCode || ''}\n`).join("\n");
    } else {
      codeContent = `${opp.originalCode ? `Legacy Code:\n${opp.originalCode}\n` : ''}${opp.modernizedCode ? `Modernized Code:\n${opp.modernizedCode}\n` : ''}`;
    }

    chatHistory = [
      {
        role: "user",
        hidden: true,
        content: `I have a question about this modernization audit result:
Title: ${opp.title}
Impact: ${opp.impact}
Target: ${opp.target || 'document'}
Description: ${opp.description}
${codeContent}
${opp.useCaseId ? `Use Case / Guide ID: ${opp.useCaseId}\n` : ''}`
      },
      {
        role: "model",
        content: greeting
      }
    ];
    await persistCurrentChatHistory();

  } catch (err) {
    console.error("Failed to start chat with opportunity:", err);
    const fallback = `Rawr! Dino here! 🦖 I see you have a question about the modernization opportunity: **${opp.title}** (Target: \`${opp.target || 'document'}\`). Let's get this prehistoric pattern modernised! What would you like to know?\n\n[🛠️ How do I fix this?](suggest:How do I fix this modernization issue?) [❓ Why is this an issue?](suggest:Why is this considered a legacy issue?) [🧪 How should I test it?](suggest:How do I test if this is successfully fixed?)`;
    
    const responseContent = modelMsgBubble.querySelector(".dino-response-content");
    if (responseContent) {
      responseContent.innerHTML = "";
      renderDinoResponse(fallback, responseContent);
    }
    addMessageActions(modelMsgBubble, fallback);
    
    let codeContent = "";
    if (opp.changes && opp.changes.length > 0) {
      codeContent = opp.changes.map((c, idx) => `Change #${idx + 1} (Target: ${c.target || opp.target || 'document'}):\nLegacy Code:\n${c.originalCode || ''}\nModernized Code:\n${c.modernizedCode || ''}\n`).join("\n");
    } else {
      codeContent = `${opp.originalCode ? `Legacy Code:\n${opp.originalCode}\n` : ''}${opp.modernizedCode ? `Modernized Code:\n${opp.modernizedCode}\n` : ''}`;
    }

    chatHistory = [
      {
        role: "user",
        hidden: true,
        content: `I have a question about this modernization audit result:
Title: ${opp.title}
Impact: ${opp.impact}
Target: ${opp.target || 'document'}
Description: ${opp.description}
${codeContent}
${opp.useCaseId ? `Use Case / Guide ID: ${opp.useCaseId}\n` : ''}`
      },
      {
        role: "model",
        content: fallback
      }
    ];
    await persistCurrentChatHistory();
  }

  if (opp.useCaseId) {
    readGuideAsynchronously(opp.useCaseId, modelMsgBubble);
  }

  if (chatMessages) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

async function readGuideAsynchronously(useCaseId, bubble) {
  const steps = [
    {
      type: 'tool',
      name: 'get_guide_content',
      args: { useCaseId },
      title: `Reading guide "${useCaseId}"...`,
      status: 'running'
    }
  ];

  renderSteps(steps, bubble, true);

  try {
    const guideContent = await getGuideContent(useCaseId);
    
    // Update step to completed
    steps[0].status = 'completed';
    steps[0].result = guideContent;
    renderSteps(steps, bubble, false);

    // Collapse the thought container after completing
    const detailsEl = bubble.querySelector(".dino-thought-container");
    if (detailsEl) {
      detailsEl.removeAttribute("open");
    }

    // Append to initial chat history message content
    if (chatHistory.length > 0 && chatHistory[0].role === "user") {
      chatHistory[0].content += `\n\nAssociated Guide Content for ${useCaseId}:\n${guideContent}`;
    }

    // Add citation to the bubble
    let title = useCaseId;
    const titleMatch = guideContent.match(/^#\s+(.+)$/m);
    if (titleMatch) title = titleMatch[1].trim();

    const uc = useCasesCache.find(u => u.id === useCaseId);
    const citation = {
      id: useCaseId,
      title: title,
      description: uc ? uc.description : ""
    };

    if (chatHistory.length > 1 && chatHistory[1].role === "model") {
      chatHistory[1].citations = [citation];
    }
    await persistCurrentChatHistory();

    renderGreetingCitations([citation], bubble);

  } catch (err) {
    console.error("Failed to asynchronously read guide:", err);
    steps[0].status = 'failed';
    steps[0].error = err.message;
    renderSteps(steps, bubble, false);
  }
}

function renderGreetingCitations(citations, bubble) {
  let citationsDiv = bubble.querySelector(".chat-citations");
  if (!citationsDiv) {
    citationsDiv = document.createElement("div");
    citationsDiv.className = "chat-citations";
    bubble.appendChild(citationsDiv);
  }

  let itemsHtml = citations.map(cit => `
    <button class="citation-badge" data-id="${cit.id}" title="${escapeHtmlForChat(cit.description || '')}">
      <svg class="citation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
      <span>${escapeHtmlForChat(cit.title)}</span>
    </button>
  `).join("");

  citationsDiv.innerHTML = `
    <div class="citations-header">
      <svg class="citations-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      </svg>
      <span>Modern Web Sources</span>
    </div>
    <div class="citations-list">${itemsHtml}</div>
  `;

  citationsDiv.querySelectorAll(".citation-badge").forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute("data-id");
      try {
        const category = useCasesCache.find(u => u.id === id)?.category || "user-experience";
        const url = `https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/${category}/${id}.md`;
        chrome.tabs.create({ url });
        showToast(`Opening GitHub guide for ${id}...`, "success");
      } catch (err) {
        showToast(`Failed to open guide: ${err.message}`, "error");
      }
    };
  });
}


async function onChatTabActive() {
  const chatInput = document.getElementById("chat-input");
  if (chatInput) {
    chatInput.focus();
  }

  if (isAskDinoPending && pendingOpportunity) {
    const opp = pendingOpportunity;
    isAskDinoPending = false;
    pendingOpportunity = null;
    await startChatWithOpportunity(opp);
    return;
  }

  if (hasInitializedChat) return;

  try {
    await loadConfig();
  } catch (err) {
    console.warn("Failed to load config for chat:", err);
  }

  hasInitializedChat = true;
  
  const restored = await loadAndRestoreChat();
  if (restored) return;

  await startFreshChat();
}

async function startFreshChat() {
  const chatMessages = document.getElementById("chat-messages");
  if (chatMessages) {
    chatMessages.innerHTML = `
      <div class="chat-message with-avatar model">
        <div class="message-avatar">
          <img src="dino-agent.png" alt="Dino">
        </div>
        <div class="message-bubble" id="initial-greeting">
          <div class="typing-indicator">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
          </div>
        </div>
      </div>
    `;
  }

  const greetingEl = document.getElementById("initial-greeting");
  try {
    const greeting = await runDinoGreeting();
    renderDinoResponse(greeting, greetingEl);
    addMessageActions(greetingEl, greeting);
    chatHistory = [{ role: "model", content: greeting }];
    await persistCurrentChatHistory();
  } catch (err) {
    console.error("Failed to fetch Dino greeting:", err);
    const fallback = "Rawr! I'm Dino. I've risen from the fossils to help you build modern web apps. What can I help you with today?\n\nFeel free to ask me any open questions about this page, or get started with one of these audits:\n\n[🔍 Audit Accessibility](suggest:Audit the page for accessibility) [⚡ Audit Performance](suggest:Audit the page for performance) [🛡️ Audit Privacy & Security](suggest:Audit the page for privacy and security)";
    renderDinoResponse(fallback, greetingEl);
    addMessageActions(greetingEl, fallback);
    chatHistory = [{ role: "model", content: fallback }];
    await persistCurrentChatHistory();
  }
}

async function handleNewChat() {
  const rawUrl = await getInspectedTabUrl();
  if (rawUrl) {
    const storageKey = normalizeUrlForStorage(rawUrl);
    await chrome.storage.session.remove(storageKey);
  }
  chatHistory = [];
  historyIndex = -1;
  tempInput = "";
  await startFreshChat();
  showToast("Started a new conversation!", "success");
}

if (chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (tabId === chrome.devtools.inspectedWindow.tabId && changeInfo.url) {
      chatHistory = [];
      historyIndex = -1;
      tempInput = "";
      const restored = await loadAndRestoreChat();
      if (!restored) {
        await startFreshChat();
      }
    }
  });
}

function renderSteps(steps, bubble, isGenerating) {
  let detailsEl = bubble.querySelector(".dino-thought-container");
  if (!detailsEl) {
    detailsEl = document.createElement("details");
    detailsEl.className = "dino-thought-container";
    detailsEl.open = false;
    bubble.insertBefore(detailsEl, bubble.firstChild);
  }

  let summaryEl = detailsEl.querySelector("summary");
  if (!summaryEl) {
    summaryEl = document.createElement("summary");
    summaryEl.className = "dino-thought-summary";
    detailsEl.appendChild(summaryEl);
  }

  const toolSteps = steps.filter(s => s.type === 'tool');
  const completedCount = toolSteps.filter(s => s.status === 'completed' || s.status === 'failed').length;

  let summaryText = "";
  if (isGenerating) {
    summaryText = `Thinking... (${completedCount} tool${completedCount === 1 ? "" : "s"} executed)`;
  } else {
    summaryText = `Dino's thought process (${completedCount} tool${completedCount === 1 ? "" : "s"} executed)`;
  }
  summaryEl.textContent = summaryText;

  // Track expanded step indices to restore them after rendering
  const expandedIndices = new Set();
  const existingStepsList = detailsEl.querySelector(".dino-steps-list");
  if (existingStepsList) {
    existingStepsList.querySelectorAll(".dino-step").forEach((stepEl) => {
      const idx = parseInt(stepEl.getAttribute("data-step-index"), 10);
      const detailsEl = stepEl.querySelector(".dino-step-details");
      if (detailsEl && !detailsEl.classList.contains("hidden")) {
        expandedIndices.add(idx);
      }
    });
  }

  let stepsListEl = detailsEl.querySelector(".dino-steps-list");
  if (!stepsListEl) {
    stepsListEl = document.createElement("div");
    stepsListEl.className = "dino-steps-list";
    detailsEl.appendChild(stepsListEl);
  }

  stepsListEl.innerHTML = steps.map((step, idx) => {
    let statusClass = step.status || 'running';
    let icon = "⏳";
    if (step.type === 'thought') {
      icon = "💭";
    } else if (step.status === 'completed') {
      icon = "✅";
    } else if (step.status === 'failed') {
      icon = "❌";
    }

    let detailsHtml = "";
    if (step.type === 'tool') {
      const argsStr = step.args ? JSON.stringify(step.args, null, 2) : "";
      let resultStr = "";
      let screenshotHtml = "";
      if (step.status === 'completed' && step.result !== undefined) {
        if (step.name === "take_screenshot" && step.result.screenshot) {
          resultStr = `Screenshot captured successfully (${step.result.width || 'unknown'}x${step.result.height || 'unknown'}px).`;
          screenshotHtml = `
            <div class="dino-step-screenshot-container" style="margin-top: 8px;">
              <img class="dino-step-screenshot-img" src="${step.result.screenshot}" alt="Captured Screenshot" style="max-width: 100%; max-height: 250px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.15); display: block; object-fit: contain; cursor: pointer; background: #222;" />
            </div>`;
        } else {
          if (typeof step.result === 'string') {
            resultStr = step.result;
          } else {
            resultStr = JSON.stringify(step.result, null, 2);
          }
          if (resultStr.length > 500) {
            resultStr = resultStr.substring(0, 500) + "\n... (truncated)";
          }
        }
      } else if (step.status === 'failed' && step.error) {
        resultStr = `Error: ${step.error}`;
      }

      detailsHtml = `
        <div class="dino-step-args">Args: <code>${escapeHtmlForChat(argsStr)}</code></div>
        ${resultStr ? `<div class="dino-step-result">Result: <pre><code>${escapeHtmlForChat(resultStr)}</code></pre></div>` : ''}
        ${screenshotHtml}
      `;
    } else {
      detailsHtml = `<div class="dino-step-thought-text">${escapeHtmlForChat(step.details)}</div>`;
    }

    const isThought = step.type === 'thought';
    const isExpanded = isThought || expandedIndices.has(idx);
    const detailsClass = isExpanded ? "dino-step-details" : "dino-step-details hidden";

    return `
      <div class="dino-step ${statusClass}" data-step-index="${idx}">
        <div class="dino-step-header">
          <span class="dino-step-icon">${icon}</span>
          <span class="dino-step-title">${escapeHtmlForChat(step.title)}</span>
        </div>
        <div class="${detailsClass}">
          ${detailsHtml}
        </div>
      </div>
    `;
  }).join("");

  stepsListEl.querySelectorAll(".dino-step-header").forEach(header => {
    header.addEventListener("click", () => {
      const details = header.nextElementSibling;
      if (details) {
        details.classList.toggle("hidden");
      }
    });
  });

  stepsListEl.querySelectorAll(".dino-step-screenshot-img").forEach(img => {
    img.onclick = () => {
      const w = window.open();
      w.document.write(`<img src="${img.src}" style="max-width: 100%;" />`);
    };
  });
}

function appendChatMessage(role, content, isTyping = false) {
  const chatMessages = document.getElementById("chat-messages");
  if (!chatMessages) return null;
  
  const msgDiv = document.createElement("div");

  if (role === "model") {
    msgDiv.className = "chat-message with-avatar model";
    msgDiv.innerHTML = `
      <div class="message-avatar">
        <img src="dino-agent.png" alt="Dino">
      </div>
      <div class="message-bubble"></div>
    `;
    const bubble = msgDiv.querySelector(".message-bubble");
    if (isTyping) {
      bubble.innerHTML = `
        <div class="dino-response-content">
          <div class="typing-indicator">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
          </div>
        </div>
      `;
    } else {
      const contentDiv = document.createElement("div");
      contentDiv.className = "dino-response-content";
      bubble.appendChild(contentDiv);
      renderDinoResponse(content, contentDiv);
      addMessageActions(bubble, content);
    }
  } else {
    msgDiv.className = "chat-message user";
    msgDiv.textContent = content;
  }

  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return role === "model" ? msgDiv.querySelector(".message-bubble") : msgDiv;
}

function getFriendlyErrorMessage(err) {
  const msg = err.message || "";
  
  if (msg.includes("context invalidated") || msg.includes("Extension context invalidated")) {
    return `Rawr! 🦖 The extension context was invalidated (probably due to an extension reload or update). Please close and reopen DevTools to restart Dino! 🐾`;
  }
  
  if (msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("experiencing high demand")) {
    let response = `Rawr! 🦖 The Gemini API is currently experiencing a massive meteor shower of demand (Error 503)! ☄️ Spikes in demand are usually temporary. Please try again in a few moments, or check back once the dust settles!`;
    
    if (config.model === "gemini-3.5-flash") {
      response += `\n\nWould you like to switch to a lower model like **Gemini 3.1 Flash Lite** to see if it has more availability?\n\n[⚙️ Switch model to Gemini 3.1 Flash Lite](suggest:Switch model to Gemini 3.1 Flash Lite)`;
    } else if (config.model === "gemini-3.1-pro-preview") {
      response += `\n\nWould you like to switch to a faster model like **Gemini 3.5 Flash** or **Gemini 3.1 Flash Lite**?\n\n[⚙️ Switch model to Gemini 3.5 Flash](suggest:Switch model to Gemini 3.5 Flash) [⚙️ Switch model to Gemini 3.1 Flash Lite](suggest:Switch model to Gemini 3.1 Flash Lite)`;
    } else if (config.model === "gemini-3-flash-preview") {
      response += `\n\nWould you like to switch to **Gemini 3.1 Flash Lite**?\n\n[⚙️ Switch model to Gemini 3.1 Flash Lite](suggest:Switch model to Gemini 3.1 Flash Lite)`;
    }
    
    return response;
  }
  
  if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
    return `Rawr! 🦖 Slow down, swift raptor! We have hit the Gemini API rate limit (Error 429). 🐾 Please take a short breather and try sending your message again in a minute!`;
  }

  if (msg.includes("API Key is missing") || msg.includes("API key is invalid") || msg.includes("INVALID_ARGUMENT") || msg.includes("400")) {
    return `Rawr! 🦖 It looks like there's an issue with your Gemini API key (Error 400). Please check your settings under the Settings tab to ensure a valid API key is configured!`;
  }

  if (msg.includes("Failed to fetch") || msg.includes("network error") || msg.includes("offline")) {
    return `Rawr! 🦖 Dino lost connection to the prehistoric server! Please check your internet connection and try again. 🌐🐾`;
  }
  
  return `Error: ${err.message}`;
}

async function handleSendChatMessage() {
  stopListening();
  const chatInput = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-btn");
  if (!chatInput || !sendBtn) return;
  
  if (sendBtn.classList.contains("stopping")) {
    abortAnalysis();
    return;
  }

  const message = chatInput.value.trim();
  if (!message) return;

  historyIndex = -1;
  tempInput = "";

  chatInput.value = "";
  chatInput.style.height = "auto";

  appendChatMessage("user", message);

  if (message.startsWith("Switch model to ")) {
    const targetModelName = message.substring("Switch model to ".length).trim();
    let modelValue = "";
    let modelLabel = "";
    if (targetModelName.includes("3.5 Flash") || targetModelName.includes("gemini-3.5-flash")) {
      modelValue = "gemini-3.5-flash";
      modelLabel = "Gemini 3.5 Flash";
    } else if (targetModelName.includes("3.1 Flash Lite") || targetModelName.includes("gemini-3.1-flash-lite")) {
      modelValue = "gemini-3.1-flash-lite";
      modelLabel = "Gemini 3.1 Flash Lite";
    } else if (targetModelName.includes("3.1 Pro") || targetModelName.includes("gemini-3.1-pro-preview")) {
      modelValue = "gemini-3.1-pro-preview";
      modelLabel = "Gemini 3.1 Pro Preview";
    } else if (targetModelName.includes("3 Flash Preview") || targetModelName.includes("gemini-3-flash-preview")) {
      modelValue = "gemini-3-flash-preview";
      modelLabel = "Gemini 3.0 Flash Preview";
    }
    
    if (modelValue) {
      const modelMsgBubble = appendChatMessage("model", "", true);
      const responseContent = modelMsgBubble.querySelector(".dino-response-content");
      try {
        config.model = modelValue;
        const select = document.getElementById("settings-model");
        if (select) {
          select.value = modelValue;
        }
        await chrome.storage.local.set({ model: modelValue });
        
        responseContent.innerHTML = "";
        const msg = `Rawr! 🦖 I've switched my brain to **${modelLabel}**! Let's try sending that query again and see if we can bypass the demand bottleneck! 🐾`;
        renderDinoResponse(msg, responseContent);
        
        chatHistory.push({ role: "user", content: message });
        chatHistory.push({ role: "model", content: msg });
        await persistCurrentChatHistory();
        
        showToast(`Switched model to ${modelLabel}`, "success");
      } catch (err) {
        responseContent.innerHTML = "";
        renderDinoResponse(`Error switching model: ${err.message}`, responseContent);
        showToast(`Failed to switch model: ${err.message}`, "error");
      }
      return;
    }
  }

  isChatGenerating = true;
  
  // Set to stopping state
  sendBtn.classList.add("stopping");
  sendBtn.querySelector("span").textContent = "Stop";
  const svg = sendBtn.querySelector("svg");
  const originalSvgContent = svg.innerHTML;
  svg.innerHTML = '<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"></rect>';

  const modelMsgBubble = appendChatMessage("model", "", true);

  // Set up abortion
  isAborted = false;
  currentAbortController = new AbortController();

  let chatSteps = [];
  let streamedText = "";

  try {
    const { response, citations } = await runDinoChatAgent(
      message,
      chatHistory,
      (steps) => {
        const chatMessages = document.getElementById("chat-messages");
        const isAtBottom = chatMessages ? (chatMessages.scrollHeight - chatMessages.clientHeight - chatMessages.scrollTop <= 15) : false;

        chatSteps = steps;
        renderSteps(steps, modelMsgBubble, true);
        
        const responseContent = modelMsgBubble.querySelector(".dino-response-content");
        if (responseContent) {
          const toolSteps = steps.filter(s => s.type === 'tool');
          const runningTool = toolSteps.find(s => s.status === 'running');
          
          if (runningTool) {
            // Clear any streamed final text because we are running tools
            streamedText = ""; 
            
            // Clear the HTML of the main response bubble
            responseContent.innerHTML = "";
            
            let typingIndicator = document.createElement("div");
            typingIndicator.className = "typing-indicator";
            responseContent.appendChild(typingIndicator);
            
            const statusText = runningTool.title || "Thinking...";
            
            typingIndicator.innerHTML = `
              <div class="typing-dot"></div>
              <div class="typing-dot"></div>
              <div class="typing-dot"></div>
              <span style="font-size: 11px; margin-left: 8px; color: var(--text-muted); font-family: var(--font-sans);">${statusText}</span>
            `;
          }
        }
        
        if (chatMessages && isAtBottom) {
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
      },
      (textChunk) => {
        const chatMessages = document.getElementById("chat-messages");
        const isAtBottom = chatMessages ? (chatMessages.scrollHeight - chatMessages.clientHeight - chatMessages.scrollTop <= 15) : false;

        streamedText += textChunk;
        
        const { thoughts, userContent } = parseStreamContent(streamedText);
        
        // Render thoughts in the thought steps log if present
        if (thoughts) {
          const streamingSteps = [
            ...chatSteps,
            {
              type: 'thought',
              title: 'Thinking',
              details: thoughts,
              status: 'completed'
            }
          ];
          renderSteps(streamingSteps, modelMsgBubble, true);
        } else {
          // Hide thought container if it's empty
          const detailsEl = modelMsgBubble.querySelector(".dino-thought-container");
          if (detailsEl && !detailsEl.querySelector(".dino-steps-list")?.children.length) {
            detailsEl.remove();
          }
        }
        
        const responseContent = modelMsgBubble.querySelector(".dino-response-content");
        if (responseContent) {
          const typingIndicator = responseContent.querySelector(".typing-indicator");
          if (typingIndicator) {
            typingIndicator.remove();
          }
          
          if (userContent) {
            renderDinoResponse(userContent, responseContent);
          } else {
            responseContent.innerHTML = "";
          }
        }
        
        if (chatMessages && isAtBottom) {
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
      }
    );

    const chatMessages = document.getElementById("chat-messages");
    const isAtBottom = chatMessages ? (chatMessages.scrollHeight - chatMessages.clientHeight - chatMessages.scrollTop <= 15) : false;

    // Collapse the thought container
    const thoughtContainer = modelMsgBubble.querySelector(".dino-thought-container");
    if (thoughtContainer) {
      thoughtContainer.removeAttribute("open");
      renderSteps(chatSteps, modelMsgBubble, false);
    }

    const responseContent = modelMsgBubble.querySelector(".dino-response-content");
    let finalResponse = response;
    if (!finalResponse || finalResponse.trim() === "") {
      finalResponse = parseStreamContent(streamedText).userContent;
    }
    if (responseContent) {
      renderDinoResponse(finalResponse, responseContent);
    }

    const screenshotStep = chatSteps.find(s => s.type === 'tool' && s.name === 'take_screenshot' && s.status === 'completed' && s.result?.screenshot);
    if (screenshotStep) {
      appendScreenshotAttachment(screenshotStep.result, modelMsgBubble);
    }

    chatHistory.push({ role: "user", content: message });
    chatHistory.push({ 
      role: "model", 
      content: finalResponse, 
      citations: citations || [],
      screenshot: screenshotStep ? screenshotStep.result : null 
    });
    await persistCurrentChatHistory();

    // Render citations if we have them
    if (citations && citations.length > 0) {
      const citationsDiv = document.createElement("div");
      citationsDiv.className = "chat-citations";
      
      let itemsHtml = citations.map(cit => `
        <button class="citation-badge" data-id="${cit.id}" title="${escapeHtmlForChat(cit.description || '')}">
          <svg class="citation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          <span>${escapeHtmlForChat(cit.title)}</span>
        </button>
      `).join("");

      citationsDiv.innerHTML = `
        <div class="citations-header">
          <svg class="citations-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          <span>Modern Web Sources</span>
        </div>
        <div class="citations-list">${itemsHtml}</div>
      `;
      
      modelMsgBubble.appendChild(citationsDiv);
      
      // Add click listeners to open guide
      citationsDiv.querySelectorAll(".citation-badge").forEach(btn => {
        btn.onclick = () => {
          const id = btn.getAttribute("data-id");
          try {
            const category = useCasesCache.find(u => u.id === id)?.category || "user-experience";
            const url = `https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/${category}/${id}.md`;
            chrome.tabs.create({ url });
            showToast(`Opening GitHub guide for ${id}...`, "success");
          } catch (err) {
            showToast(`Failed to open guide: ${err.message}`, "error");
          }
        };
      });
    }

    addMessageActions(modelMsgBubble, response);

    if (chatMessages && isAtBottom) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

  } catch (err) {
    // Collapse thought process container on error
    const thoughtContainer = modelMsgBubble.querySelector(".dino-thought-container");
    if (thoughtContainer) {
      thoughtContainer.removeAttribute("open");
      renderSteps(chatSteps, modelMsgBubble, false);
    }

    const responseContent = modelMsgBubble.querySelector(".dino-response-content");
    if (responseContent) {
      if (err.name === 'AbortError' || isAborted) {
        responseContent.innerHTML = `<span style="color: var(--warning-color); font-style: italic;">Dino was stopped in his tracks! 🦖🐾</span>`;
      } else {
        console.error(err);
        const friendlyMsg = getFriendlyErrorMessage(err);
        renderDinoResponse(friendlyMsg, responseContent);

        // Restore the input value so the user doesn't lose their message!
        if (chatInput && !chatInput.value) {
          chatInput.value = message;
          chatInput.style.height = "auto";
          chatInput.style.height = chatInput.scrollHeight + "px";
        }
      }
    }
  } finally {
    isChatGenerating = false;
    
    // Reset button state
    sendBtn.classList.remove("stopping");
    sendBtn.querySelector("span").textContent = "Send";
    svg.innerHTML = originalSvgContent;
    
    currentAbortController = null;
  }
}

function escapeHtmlForChat(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function startListening() {
  const micBtn = document.getElementById("mic-btn");
  if (micBtn) micBtn.classList.add("listening");
  isListening = true;

  // Clear previous voice result to prevent stale data
  chrome.storage.local.remove(['lastVoiceResult']);

  // Open the voice input popup window
  chrome.windows.create({
    url: chrome.runtime.getURL('voice.html'),
    type: 'popup',
    width: 380,
    height: 280,
    focused: true
  }, (window) => {
    voiceWindowId = window.id;
  });
}

function stopListening() {
  const micBtn = document.getElementById("mic-btn");
  if (micBtn) micBtn.classList.remove("listening");
  isListening = false;
  
  if (voiceWindowId !== null) {
    chrome.windows.remove(voiceWindowId, () => {
      voiceWindowId = null;
    });
  }
}

// Clean up references and state if the user closes the window manually
if (chrome.windows && chrome.windows.onRemoved) {
  chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId === voiceWindowId) {
      voiceWindowId = null;
      isListening = false;
      const micBtn = document.getElementById("mic-btn");
      if (micBtn) micBtn.classList.remove("listening");

      // Fallback: read from storage in case the message was missed
      chrome.storage.local.get(['lastVoiceResult'], (result) => {
        if (result && result.lastVoiceResult) {
          const chatInput = document.getElementById("chat-input");
          if (chatInput && !chatInput.value) {
            chatInput.value = result.lastVoiceResult;
            chatInput.style.height = "auto";
            chatInput.style.height = chatInput.scrollHeight + "px";
          }
          chrome.storage.local.remove(['lastVoiceResult']);
        }
      });
    }
  });
}

// Receive messages from the voice popup window
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'voice-result') {
    const chatInput = document.getElementById("chat-input");
    if (chatInput) {
      chatInput.value = message.transcript;
      chatInput.style.height = "auto";
      chatInput.style.height = chatInput.scrollHeight + "px";
    }
  }
});

function addMessageActions(bubble, rawContent) {
  // If actions already exist, don't re-add them
  if (bubble.querySelector(".message-actions")) return;

  const actionsDiv = document.createElement("div");
  actionsDiv.className = "message-actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "btn-copy-msg";
  copyBtn.title = "Copy response to clipboard";
  copyBtn.innerHTML = `
    <svg class="copy-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
    <span>Copy</span>
  `;

  copyBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(rawContent);
      
      const span = copyBtn.querySelector("span");
      const originalText = span.textContent;
      span.textContent = "Copied!";
      copyBtn.classList.add("copied");
      
      const svg = copyBtn.querySelector(".copy-icon");
      const originalSvg = svg.innerHTML;
      svg.innerHTML = `
        <polyline points="20 6 9 17 4 12"></polyline>
      `;

      setTimeout(() => {
        span.textContent = originalText;
        copyBtn.classList.remove("copied");
        svg.innerHTML = originalSvg;
      }, 2000);
      
      showToast("Response copied to clipboard!", "success");
    } catch (err) {
      showToast("Failed to copy message: " + err.message, "error");
    }
  });

  actionsDiv.appendChild(copyBtn);
  bubble.appendChild(actionsDiv);
}

function parseStreamContent(text) {
  const parsed = parseThoughtAndContent(text);
  return { thoughts: parsed.thoughts, userContent: parsed.response };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderDinoResponse,
    escapeHtmlForChat,
    inspectPageElement,
    parseStreamContent
  };
}



