// Dino Chat Panel Controller
let chatHistory = [];
let isChatGenerating = false;
let isListening = false;
let voiceWindowId = null;

// Highlight function for marked
function highlightCode(code, lang) {
  if (!code) return "";
  
  // Normalize code token/object to string if passed by marked as object
  if (code && typeof code === "object") {
    code = code.text || code.code || String(code);
  }
  if (typeof code !== "string") {
    code = String(code);
  }

  lang = (lang || "").toLowerCase();

  // Escape HTML first
  let escaped = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  if (lang === "html" || lang === "xml") {
    // Highlight tag blocks
    escaped = escaped.replace(/(&lt;[\s\S]*?&gt;)/g, (tag) => {
      let highlightedTag = tag;
      highlightedTag = highlightedTag.replace(/(&quot;[\s\S]*?&quot;|'[^']*')/g, '<span class="hl-string">$1</span>');
      highlightedTag = highlightedTag.replace(/^(&lt;\/?)([a-zA-Z0-9:-]+)/, '$1<span class="hl-tag">$2</span>');
      highlightedTag = highlightedTag.replace(/\b([a-zA-Z0-9:-]+)(?=\s*=)(?![^<]*>)/g, '<span class="hl-attr">$1</span>');
      return highlightedTag;
    });
    // Highlight comments
    escaped = escaped.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="hl-comment">$1</span>');
  } else if (lang === "css") {
    escaped = escaped.replace(/(\/\*[\s\S]*?\*\/)|([\w-]+)(?=\s*:)|(:\s*)([^;\}]+)/g, (match, comment, prop, colon, val) => {
      if (comment) {
        return `<span class="hl-comment">${comment}</span>`;
      }
      if (prop) {
        return `<span class="hl-property">${prop}</span>`;
      }
      if (colon && val) {
        return `${colon}<span class="hl-value">${val}</span>`;
      }
      return match;
    });
  } else {
    // Default: JS/TS
    const keywords = [
      "const", "let", "var", "function", "return", "if", "else", 
      "for", "while", "switch", "case", "break", "class", "export", 
      "import", "from", "async", "await", "try", "catch", "new", 
      "throw", "instanceof", "typeof"
    ];
    const regex = new RegExp(`(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*|&quot;[\\s\\S]*?&quot;|'[^']*'|\\\`[\\s\\S]*?\\\`)|\\b(${keywords.join("|")})\\b`, "g");
    
    escaped = escaped.replace(regex, (match, literal, keyword) => {
      if (literal) {
        if (literal.startsWith("//") || literal.startsWith("/*")) {
          return `<span class="hl-comment">${literal}</span>`;
        } else {
          return `<span class="hl-string">${literal}</span>`;
        }
      }
      return `<span class="hl-keyword">${keyword}</span>`;
    });
  }

  return escaped;
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
  processed = processed.replace(/\[([^\]]+)\]\((suggest:[^)]+)\)/g, '<a href="$2">$1</a>');
  processed = processed.replace(/\[([^\]]+)\]\((inspect:[^)]+)\)/g, '<a href="$2">$1</a>');

  container.innerHTML = marked.parse(processed);
  
  // Bind [Inspect: CSS_SELECTOR](inspect:CSS_SELECTOR) links
  container.querySelectorAll('a[href^="inspect:"]').forEach(link => {
    const href = link.getAttribute("href");
    const selector = decodeURIComponent(href.substring(8));
    link.className = "target-link-btn";
    link.removeAttribute("href");
    link.style.cursor = "pointer";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      inspectPageElement(selector);
    });
    link.addEventListener("mouseenter", () => {
      highlightElementOnPage(selector);
    });
    link.addEventListener("mouseleave", () => {
      removeHighlightFromPage();
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
      
      const chatInput = document.getElementById("chat-input");
      if (chatInput) {
        chatInput.value = suggestionText;
        handleSendChatMessage();
      }
    });
  });
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
  if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendChatMessage();
      }
    });
    chatInput.addEventListener("input", () => {
      chatInput.style.height = "auto";
      chatInput.style.height = chatInput.scrollHeight + "px";
    });
  }
});

let hasInitializedChat = false;
async function onChatTabActive() {
  const chatInput = document.getElementById("chat-input");
  if (chatInput) {
    chatInput.focus();
  }

  if (hasInitializedChat) return;

  try {
    await loadConfig();
  } catch (err) {
    console.warn("Failed to load config for chat:", err);
  }

  hasInitializedChat = true;
  
  const greetingEl = document.getElementById("initial-greeting");
  try {
     const greeting = await runDinoGreeting();
    renderDinoResponse(greeting, greetingEl);
    addMessageActions(greetingEl, greeting);
    chatHistory = [{ role: "model", content: greeting }];
  } catch (err) {
    console.error("Failed to fetch Dino greeting:", err);
    const fallback = "Rawr! I'm Dino. I've risen from the fossils to help you build modern web apps. What can I help you with today?\n\nFeel free to ask me any open questions about this page, or get started with one of these audits:\n\n[🔍 Audit Accessibility](suggest:Audit the page for accessibility) [⚡ Audit Performance](suggest:Audit the page for performance) [🛡️ Audit Privacy & Security](suggest:Audit the page for privacy and security)";
    renderDinoResponse(fallback, greetingEl);
    addMessageActions(greetingEl, fallback);
    chatHistory = [{ role: "model", content: fallback }];
  }
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
      bubble.innerHTML = `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
    } else {
      renderDinoResponse(content, bubble);
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

  chatInput.value = "";
  chatInput.style.height = "auto";

  appendChatMessage("user", message);

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

  try {
    const { response, citations } = await runDinoChatAgent(message, chatHistory, (status) => {
      // Update typing indicator with the current status message
      const typingIndicator = modelMsgBubble.querySelector(".typing-indicator");
      if (typingIndicator) {
        typingIndicator.innerHTML = `
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <span style="font-size: 11px; margin-left: 8px; color: var(--text-muted); font-family: var(--font-sans);">${status}</span>
        `;
      }
    });

    renderDinoResponse(response, modelMsgBubble);

    chatHistory.push({ role: "user", content: message });
    chatHistory.push({ role: "model", content: response });

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

    const chatMessages = document.getElementById("chat-messages");
    chatMessages.scrollTop = chatMessages.scrollHeight;

  } catch (err) {
    if (err.name === 'AbortError' || isAborted) {
      modelMsgBubble.innerHTML = `<span style="color: var(--warning-color); font-style: italic;">Dino was stopped in his tracks! 🦖🐾</span>`;
    } else {
      console.error(err);
      modelMsgBubble.textContent = `Error: ${err.message}`;
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
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function startListening() {
  const micBtn = document.getElementById("mic-btn");
  if (micBtn) micBtn.classList.add("listening");
  isListening = true;

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
