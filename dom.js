// DOM Simplifier and Selection Script
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
        dom: JSON.stringify(simplify(document.body)),
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

async function highlightElementOnPage(selector) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (sel) => {
        let overlay = document.getElementById("mwg-inspect-overlay");
        if (!overlay) {
          overlay = document.createElement("div");
          overlay.id = "mwg-inspect-overlay";
          overlay.style.position = "fixed";
          overlay.style.pointerEvents = "none";
          overlay.style.zIndex = "2147483647";
          overlay.style.backgroundColor = "rgba(56, 189, 248, 0.25)";
          overlay.style.border = "1px dashed #38bdf8";
          overlay.style.transition = "all 0.1s ease-out";
          document.body.appendChild(overlay);
        }
        
        try {
          const el = document.querySelector(sel);
          if (el) {
            const rect = el.getBoundingClientRect();
            overlay.style.left = rect.left + "px";
            overlay.style.top = rect.top + "px";
            overlay.style.width = rect.width + "px";
            overlay.style.height = rect.height + "px";
            overlay.style.display = "block";
          } else {
            overlay.style.display = "none";
          }
        } catch (e) {
          overlay.style.display = "none";
        }
      },
      args: [selector]
    });
  } catch (err) {
    console.error("Failed to highlight element:", err);
  }
}

async function removeHighlightFromPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const overlay = document.getElementById("mwg-inspect-overlay");
        if (overlay) {
          overlay.style.display = "none";
        }
      }
    });
  } catch (err) {
    console.error("Failed to remove highlight:", err);
  }
}
