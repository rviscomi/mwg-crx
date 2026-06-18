let lastRightClickedElement = null;

// Track right-clicked elements
document.addEventListener("contextmenu", (event) => {
  lastRightClickedElement = event.target;
});

// Toast UI helper
function showPageToast(title, message, duration = 5000) {
  let container = document.getElementById("dino-page-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "dino-page-toast-container";
    document.body.appendChild(container);
    
    // Inject styles
    const style = document.createElement("style");
    style.textContent = `
      #dino-page-toast-container {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        gap: 12px;
        font-family: system-ui, -apple-system, sans-serif;
      }
      .dino-page-toast {
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        color: #f8fafc;
        padding: 14px 18px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -4px rgba(0, 0, 0, 0.3);
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 13px;
        line-height: 1.4;
        max-width: 320px;
        animation: dino-toast-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        transition: all 0.3s ease;
      }
      .dino-page-toast.fade-out {
        opacity: 0;
        transform: translateY(20px) scale(0.95);
      }
      @keyframes dino-toast-in {
        from {
          opacity: 0;
          transform: translateY(20px) scale(0.95);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      .dino-page-toast-icon {
        font-size: 18px;
        flex-shrink: 0;
      }
      .dino-page-toast-content {
        flex-grow: 1;
      }
      .dino-page-toast-title {
        font-weight: 600;
        margin-bottom: 2px;
        color: #38bdf8;
      }
      .dino-page-toast-close {
        background: none;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        font-size: 16px;
        padding: 0 2px;
        line-height: 1;
        transition: color 0.2s;
      }
      .dino-page-toast-close:hover {
        color: #f8fafc;
      }
    `;
    document.head.appendChild(style);
  }

  // Remove existing toast if any
  const existingToast = container.querySelector(".dino-page-toast");
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement("div");
  toast.className = "dino-page-toast";
  toast.innerHTML = `
    <span class="dino-page-toast-icon">🦖</span>
    <div class="dino-page-toast-content">
      <div class="dino-page-toast-title">${title}</div>
      <div>${message}</div>
    </div>
    <button class="dino-page-toast-close" aria-label="Close">×</button>
  `;

  const closeBtn = toast.querySelector(".dino-page-toast-close");
  closeBtn.addEventListener("click", () => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 300);
  });

  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.add("fade-out");
        setTimeout(() => toast.remove(), 300);
      }
    }, duration);
  }
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "context-menu-audit") {
    if (lastRightClickedElement) {
      // Clean up previous tags
      document.querySelectorAll("[data-dino-inspecting]").forEach(el => {
        el.removeAttribute("data-dino-inspecting");
      });
      
      // Tag the element
      lastRightClickedElement.setAttribute("data-dino-inspecting", "true");
      
      // Show toast
      showPageToast(
        "Element Tagged", 
        "Open DevTools and switch to the Dino panel to start the analysis.",
        8000
      );
      
      sendResponse({ success: true });
    } else {
      showPageToast("Audit Failed", "No element selected. Please right-click an element.", 4000);
      sendResponse({ success: false, error: "No element found" });
    }
  } else if (message.action === "audit-started") {
    showPageToast("Dino Auditing", "Analyzing the selected element...", 0); // Indefinite
  } else if (message.action === "audit-completed") {
    showPageToast("Audit Complete", "Switch to DevTools to view modern web recommendations.", 5000);
  }
});
