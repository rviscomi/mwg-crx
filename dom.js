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
