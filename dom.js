// DOM Simplifier and Selection Script
async function getPageDOM() {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");

  const result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
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
    const tabId = chrome.devtools.inspectedWindow.tabId;
    if (!tabId) return;
    chrome.scripting.executeScript({
      target: { tabId: tabId },
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
    const tabId = chrome.devtools.inspectedWindow.tabId;
    if (!tabId) return;
    chrome.scripting.executeScript({
      target: { tabId: tabId },
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

async function clickElement(selector) {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");
  const result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: "MAIN",
    func: (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { success: false, error: `Element matching selector "${sel}" not found.` };
      
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      
      const events = ['mousedown', 'mouseup', 'click'];
      events.forEach(name => {
        const ev = new MouseEvent(name, {
          bubbles: true,
          cancelable: true,
          view: window
        });
        el.dispatchEvent(ev);
      });
      
      if (typeof el.click === 'function') {
        el.click();
      }
      return { success: true, message: `Successfully clicked element matching selector "${sel}".` };
    },
    args: [selector]
  });
  return result[0].result;
}

async function typeText(selector, text) {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");
  const result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: "MAIN",
    func: (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return { success: false, error: `Element matching selector "${sel}" not found.` };
      
      el.focus();
      
      if ('value' in el) {
        el.value = '';
      }
      
      for (let i = 0; i < val.length; i++) {
        const char = val[i];
        const keydown = new KeyboardEvent('keydown', { key: char, bubbles: true });
        el.dispatchEvent(keydown);
        
        if ('value' in el) {
          el.value += char;
        } else {
          el.innerText += char;
        }
        
        const input = new InputEvent('input', { data: char, bubbles: true });
        el.dispatchEvent(input);
        
        const keyup = new KeyboardEvent('keyup', { key: char, bubbles: true });
        el.dispatchEvent(keyup);
      }
      
      const change = new Event('change', { bubbles: true });
      el.dispatchEvent(change);
      
      return { success: true, message: `Successfully typed "${val}" into element matching selector "${sel}".` };
    },
    args: [selector, text]
  });
  return result[0].result;
}

async function hoverElement(selector) {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");
  const result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: "MAIN",
    func: (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { success: false, error: `Element matching selector "${sel}" not found.` };
      
      const events = ['mouseenter', 'mouseover', 'mousemove'];
      events.forEach(name => {
        const ev = new MouseEvent(name, {
          bubbles: true,
          cancelable: true,
          view: window
        });
        el.dispatchEvent(ev);
      });
      
      return { success: true, message: `Successfully simulated hover on element matching selector "${sel}".` };
    },
    args: [selector]
  });
  return result[0].result;
}

async function getElementInfo(selector, computedProperties = []) {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");
  const result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: "MAIN",
    func: (sel, props) => {
      const el = document.querySelector(sel);
      if (!el) return { exists: false };
      const computed = {};
      const styles = window.getComputedStyle(el);
      const propsToGet = props && props.length > 0 ? props : [
        'display', 'position', 'visibility', 'opacity', 'zIndex',
        'scrollbarColor', 'scrollbarWidth', 'colorScheme',
        'overflow', 'width', 'height', 'top', 'left'
      ];
      propsToGet.forEach(p => {
        computed[p] = styles[p];
      });
      const attrs = {};
      for (const attr of el.attributes) {
        attrs[attr.name] = attr.value;
      }
       return {
        exists: true,
        tagName: el.tagName.toLowerCase(),
        id: el.id,
        className: el.className,
        attributes: attrs,
        outerHTML: el.outerHTML.substring(0, 5000), // Cap size to avoid RPC issues
        innerText: el.innerText.substring(0, 1000),
        computedStyle: computed,
        geometry: {
          scrollLeft: el.scrollLeft,
          scrollTop: el.scrollTop,
          scrollWidth: el.scrollWidth,
          scrollHeight: el.scrollHeight,
          clientWidth: el.clientWidth,
          clientHeight: el.clientHeight,
          offsetWidth: el.offsetWidth,
          offsetHeight: el.offsetHeight,
          rect: (() => {
            const r = el.getBoundingClientRect();
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
          })()
        }
      };
    },
    args: [selector, computedProperties]
  });
  return result[0].result;
}

async function scrollElement(selector, left, top, behavior = 'auto') {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");
  const result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: "MAIN",
    func: (sel, scrollLeft, scrollTop, scrollBehavior) => {
      const el = sel === "document" ? (document.scrollingElement || document.documentElement) : document.querySelector(sel);
      if (!el) return { success: false, error: `Element matching selector "${sel}" not found.` };
      
      const scrollOptions = {};
      if (scrollLeft !== undefined && scrollLeft !== null) scrollOptions.left = scrollLeft;
      if (scrollTop !== undefined && scrollTop !== null) scrollOptions.top = scrollTop;
      scrollOptions.behavior = scrollBehavior || 'auto';
      
      el.scrollTo(scrollOptions);
      return { 
        success: true, 
        message: `Successfully scrolled element matching selector "${sel}" to left: ${scrollLeft}, top: ${scrollTop}.` 
      };
    },
    args: [selector, left, top, behavior]
  });
  return result[0].result;
}

async function pressKey(selector, key) {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");
  const result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: "MAIN",
    func: (sel, k) => {
      const el = sel === "document" ? document : document.querySelector(sel);
      if (!el) return { success: false, error: `Element matching selector "${sel}" not found.` };
      
      const eventInit = {
        key: k,
        code: k,
        bubbles: true,
        cancelable: true,
        view: window
      };
      
      if (k === 'Escape') eventInit.code = 'Escape';
      else if (k === 'Enter') eventInit.code = 'Enter';
      else if (k === ' ') { eventInit.code = 'Space'; eventInit.key = ' '; }
      else if (k === 'ArrowRight') eventInit.code = 'ArrowRight';
      else if (k === 'ArrowLeft') eventInit.code = 'ArrowLeft';
      
      const keydown = new KeyboardEvent('keydown', eventInit);
      el.dispatchEvent(keydown);
      
      const keyup = new KeyboardEvent('keyup', eventInit);
      el.dispatchEvent(keyup);
      
      return { success: true, message: `Successfully pressed key "${k}" on element matching selector "${sel}".` };
    },
    args: [selector, key]
  });
  return result[0].result;
}

async function getConsoleLogs() {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");
  
  // Make sure hooking script is also run as fallback in case the tab was loaded before extension
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: "MAIN",
    func: () => {
      if (!window.__mwg_console_hooked) {
        window.__mwg_console_hooked = true;
        window.__mwg_console_logs = [];
        const originalConsole = {
          log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug
        };
        ['log', 'warn', 'error', 'info', 'debug'].forEach(type => {
          console[type] = (...args) => {
            let text = "";
            try { text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '); } catch (e) { text = args.map(String).join(' '); }
            window.__mwg_console_logs.push({ type, text: text.substring(0, 1000), timestamp: Date.now() });
            originalConsole[type].apply(console, args);
          };
        });
      }
    }
  });

  const result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: "MAIN",
    func: () => {
      return window.__mwg_console_logs || [];
    }
  });
  return result[0].result;
}

/**
 * Normalizes a CSS selector by resolving backslash escape sequences and cleanup.
 * @param {string} sel - The raw CSS selector.
 * @returns {string} The normalized selector.
 */
function normalizeSelector(sel) {
  if (!sel) return "";
  // Remove backslash escapes before spaces or dots, but keep other valid escapes
  return sel.replace(/\\(\s+|\.)/g, '$1').trim();
}
