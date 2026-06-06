// Dino Chat Panel Controller
let chatHistory = [];
let isChatGenerating = false;
let isListening = false;
let voiceWindowId = null;

document.addEventListener("DOMContentLoaded", () => {
  const chatTab = document.querySelector('[data-tab="chat"]');
  if (chatTab) {
    chatTab.addEventListener("click", onChatTabActive);
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
  if (hasInitializedChat) return;
  hasInitializedChat = true;
  
  const greetingEl = document.getElementById("initial-greeting");
  try {
    const greeting = await runDinoGreeting();
    greetingEl.innerHTML = marked.parse(greeting);
    chatHistory = [{ role: "model", content: greeting }];
  } catch (err) {
    console.error("Failed to fetch Dino greeting:", err);
    const fallback = "Rawr! I'm Dino. I've risen from the fossils to help you build modern web apps. What can I help you with today?";
    greetingEl.textContent = fallback;
    chatHistory = [{ role: "model", content: fallback }];
  }
}

function appendChatMessage(role, content, isTyping = false) {
  const chatMessages = document.getElementById("chat-messages");
  if (!chatMessages) return null;
  
  const msgDiv = document.createElement("div");

  if (role === "model") {
    msgDiv.className = "chat-message with-avatar model";
    const bubbleContent = isTyping
      ? `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`
      : marked.parse(content);

    msgDiv.innerHTML = `
      <div class="message-avatar">
        <img src="dino-agent.png" alt="Dino">
      </div>
      <div class="message-bubble">${bubbleContent}</div>
    `;
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

    modelMsgBubble.innerHTML = marked.parse(response);

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
