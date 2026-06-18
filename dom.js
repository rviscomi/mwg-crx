// DOM Simplifier and Selection Script
async function getInspectedTabUrl() {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        resolve(null);
      } else {
        resolve(tab.url);
      }
    });
  });
}

async function getPageDOM() {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");

  const result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      const simplify = (node, depth = 0) => {
        if (depth > 12) return null; // Prevent deeply nested stacks / huge trees
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
          
          let children = Array.from(node.childNodes)
            .map(c => simplify(c, depth + 1))
            .filter(Boolean);
          
          // Child Capping (Sampling repetitive structures like lists/grids)
          if (children.length > 10) {
            const originalLength = children.length;
            children = children.slice(0, 8);
            children.push({
              tag: "div",
              class: "dino-truncated-placeholder",
              note: `... truncated ${originalLength - 8} similar sibling nodes ...`
            });
          }

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

async function getAccessibilityTree() {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");

  const result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: "MAIN",
    func: () => {
      const buildAXTree = (node, depth = 0) => {
        if (depth > 15) return [];

        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent.trim();
          if (!text) return [];
          return [{
            role: "staticText",
            name: text
          }];
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
          const styles = window.getComputedStyle(node);
          if (styles.display === 'none' || styles.visibility === 'hidden') {
            return [];
          }
          if (node.getAttribute('aria-hidden') === 'true') {
            return [];
          }

          const tag = node.tagName.toLowerCase();
          if (['script', 'style', 'iframe', 'noscript', 'link'].includes(tag)) {
            return [];
          }

          const info = {
            tag,
            role: node.computedRole || node.getAttribute('role') || null,
            name: node.computedName || null,
          };

          if (node.id) info.id = node.id;
          if (node.className) info.class = node.className;

          // States & Properties
          const tabIndex = node.tabIndex;
          if (tabIndex !== undefined && tabIndex >= 0) info.focusable = true;
          if (node.disabled) info.disabled = true;
          if (node.getAttribute('aria-expanded') !== null) info.expanded = node.getAttribute('aria-expanded') === 'true';
          if (node.getAttribute('aria-checked') !== null) info.checked = node.getAttribute('aria-checked');
          if (node.getAttribute('aria-selected') !== null) info.selected = node.getAttribute('aria-selected') === 'true';
          if (node.getAttribute('aria-current') !== null) info.current = node.getAttribute('aria-current');
          if (node.getAttribute('aria-live') !== null) info.live = node.getAttribute('aria-live');
          if (node.getAttribute('aria-invalid') !== null) info.invalid = node.getAttribute('aria-invalid');
          if (node.getAttribute('aria-level') !== null) info.level = parseInt(node.getAttribute('aria-level'), 10);

          // Clean up null/undefined values
          for (const key in info) {
            if (info[key] === null || info[key] === undefined) {
              delete info[key];
            }
          }

          let childNodes = [];
          if (node.shadowRoot) {
            info.shadowRoot = true;
            childNodes = Array.from(node.shadowRoot.childNodes);
          } else if (tag === 'slot') {
            childNodes = node.assignedNodes();
          } else {
            childNodes = Array.from(node.childNodes);
          }

          const children = childNodes.flatMap(c => buildAXTree(c, depth + 1));

          // Child Capping
          let finalChildren = children;
          if (finalChildren.length > 20) {
            const originalLength = finalChildren.length;
            finalChildren = finalChildren.slice(0, 15);
            finalChildren.push({
              role: "staticText",
              name: `... truncated ${originalLength - 15} similar sibling nodes ...`
            });
          }

          if (finalChildren.length > 0) {
            info.children = finalChildren;
          }

          const hasSemanticInfo = info.role && !['generic', 'presentation', 'none'].includes(info.role);
          const hasName = !!info.name;
          const isInteractive = info.focusable || info.disabled;

          // If it has NO semantic info, NO name, and is NOT interactive,
          // we unwrap/flatten it by returning its children directly.
          if (!hasSemanticInfo && !hasName && !isInteractive) {
            return finalChildren;
          }

          return [info];
        }
        return [];
      };

      const tree = buildAXTree(document.body);
      return {
        tree: tree.length > 0 ? tree[0] : null,
        url: window.location.href,
        title: document.title
      };
    }
  });

  return result[0].result;
}


function getInspectedElement() {
  return new Promise((resolve, reject) => {
    chrome.devtools.inspectedWindow.eval(
      `(() => {
        try {
          const el = $0;
          if (!el || el.nodeType !== 1) return null;
          return {
            outerHTML: el.outerHTML || "",
            tagName: el.tagName ? el.tagName.toLowerCase() : "",
            id: el.id || "",
            class: el.className || "",
            computedStyle: {
              display: (window.getComputedStyle(el) || {}).display || "",
              position: (window.getComputedStyle(el) || {}).position || "",
              overflow: (window.getComputedStyle(el) || {}).overflow || "",
              scrollbarColor: (window.getComputedStyle(el) || {}).scrollbarColor || "",
              scrollbarWidth: (window.getComputedStyle(el) || {}).scrollbarWidth || ""
            }
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`,
      (result, exceptionInfo) => {
        if (exceptionInfo && (exceptionInfo.isException || exceptionInfo.value)) {
          const errMsg = exceptionInfo.value || exceptionInfo.description || "Unknown DevTools eval exception";
          reject(new Error(`Failed to evaluate inspected element: ${errMsg}`));
        } else if (result && result.error) {
          reject(new Error(`Failed to evaluate inspected element: ${result.error}`));
        } else {
          resolve(result);
        }
      }
    );
  });
}

function executeJS(code) {
  // To avoid SyntaxErrors when declaring block-scoped variables (const/let) repeatedly,
  // we wrap the code block in curly braces if it contains const/let declarations
  // and is not already wrapped in block braces or IIFE parenthesis.
  let cleanCode = code.trim();
  if (
    (cleanCode.includes("const ") || cleanCode.includes("let ")) &&
    !cleanCode.startsWith("{") &&
    !cleanCode.startsWith("(")
  ) {
    cleanCode = `{\n${code}\n}`;
  }

  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(
      cleanCode,
      (result, isException) => {
        if (isException) {
          resolve({
            success: false,
            error: isException.value || isException.description || "JavaScript execution exception"
          });
        } else {
          let overLimit = false;
          let limitType = "";
          let sizeDetail = "";

          if (typeof result === "string") {
            if (result.length > 20000) {
              overLimit = true;
              limitType = "string length";
              sizeDetail = `${result.length} characters (limit: 20000)`;
            }
          } else if (Array.isArray(result)) {
            if (result.length > 200) {
              overLimit = true;
              limitType = "array length";
              sizeDetail = `${result.length} items (limit: 200)`;
            }
          } else if (result && typeof result === "object") {
            try {
              const str = JSON.stringify(result);
              if (str.length > 30000) {
                overLimit = true;
                limitType = "serialized JSON size";
                sizeDetail = `${str.length} characters (limit: 30000)`;
              }
            } catch (e) {
              // Ignore serialization error, return raw object/result
            }
          }

          if (overLimit) {
            resolve({
              success: false,
              error: `The JavaScript execution returned a result exceeding the safety limits for ${limitType}. Size: ${sizeDetail}. Please modify your script to summarize, slice, or paginate results (e.g. return only count statistics, or use .slice(0, 50)) to stay under limits.`
            });
          } else {
            resolve({
              success: true,
              result: result
            });
          }
        }
      }
    );
  });
}


function getInspectedElementBySelector(selector) {
  return new Promise((resolve, reject) => {
    chrome.devtools.inspectedWindow.eval(
      `(() => {
        try {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el || el.nodeType !== 1) return null;
          return {
            outerHTML: el.outerHTML || "",
            tagName: el.tagName ? el.tagName.toLowerCase() : "",
            id: el.id || "",
            class: el.className || "",
            computedStyle: {
              display: (window.getComputedStyle(el) || {}).display || "",
              position: (window.getComputedStyle(el) || {}).position || "",
              overflow: (window.getComputedStyle(el) || {}).overflow || "",
              scrollbarColor: (window.getComputedStyle(el) || {}).scrollbarColor || "",
              scrollbarWidth: (window.getComputedStyle(el) || {}).scrollbarWidth || ""
            }
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`,
      (result, exceptionInfo) => {
        if (exceptionInfo && (exceptionInfo.isException || exceptionInfo.value)) {
          const errMsg = exceptionInfo.value || exceptionInfo.description || "Unknown DevTools eval exception";
          reject(new Error(`Failed to evaluate inspected element by selector: ${errMsg}`));
        } else if (result && result.error) {
          reject(new Error(`Failed to evaluate inspected element by selector: ${result.error}`));
        } else {
          resolve(result);
        }
      }
    );
  });
}

function removeInspectTag(selector) {
  chrome.devtools.inspectedWindow.eval(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        el.removeAttribute('data-dino-inspecting');
      }
    })()`
  );
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
      const elements = Array.from(document.querySelectorAll(sel));
      if (elements.length === 0) return { exists: false, totalMatches: 0, matches: [] };

      const getSingleElementDetails = (el) => {
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

        const matchedCSSRules = [];
        try {
          for (let i = 0; i < document.styleSheets.length; i++) {
            const sheet = document.styleSheets[i];
            let rules = null;
            try {
              rules = sheet.cssRules || sheet.rules;
            } catch (e) {
              continue;
            }
            if (!rules) continue;
            const href = sheet.href || "inline";
            for (let j = 0; j < rules.length; j++) {
              const rule = rules[j];
              if (rule.type === CSSRule.STYLE_RULE && rule.selectorText) {
                try {
                  if (el.matches(rule.selectorText)) {
                    matchedCSSRules.push({
                      selector: rule.selectorText,
                      cssText: rule.style.cssText,
                      href: href
                    });
                  }
                } catch (e) {
                  // Ignore invalid selector syntax in stylesheet
                }
              }
            }
          }
        } catch (e) {
          // Ignore style sheets errors
        }

        return {
          tagName: el.tagName.toLowerCase(),
          id: el.id,
          className: el.className,
          attributes: attrs,
          outerHTML: el.outerHTML.substring(0, 3000), // Cap size slightly lower for list matches
          innerText: el.innerText.substring(0, 1000),
          computedStyle: computed,
          matchedCSSRules: matchedCSSRules.slice(0, 15),
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
      };

      const limitedElements = elements.slice(0, 10);
      const matches = limitedElements.map(getSingleElementDetails);
      const firstDetails = matches[0];

      return {
        exists: true,
        totalMatches: elements.length,
        matches: matches,
        ...firstDetails
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
            window.__mwg_console_logs.push({ type, text: text.substring(0, 300), timestamp: Date.now() });
            if (window.__mwg_console_logs.length > 50) {
              window.__mwg_console_logs.shift();
            }
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

async function inspectEventListeners(selector) {
  const normSelector = selector ? normalizeSelector(selector) : null;
  return new Promise((resolve, reject) => {
    const targetExpr = normSelector && normSelector !== "$0" ? `document.querySelector(${JSON.stringify(normSelector)})` : `$0`;
    
    const evalString = `(() => {
      const el = ${targetExpr};
      if (!el) return { success: false, error: 'Element not found' };
      
      if (typeof getEventListeners !== 'function') {
        return { success: false, error: 'getEventListeners API is not available in this context.' };
      }
      
      const listeners = getEventListeners(el);
      const serialized = {};
      for (const [type, list] of Object.entries(listeners)) {
        serialized[type] = list.map(l => ({
          useCapture: l.useCapture,
          passive: l.passive,
          once: l.once,
          listener: l.listener ? l.listener.toString() : ''
        }));
      }
      
      return {
        success: true,
        selector: ${selector ? JSON.stringify(selector) : '"$0"'},
        tagName: el.tagName ? el.tagName.toLowerCase() : '',
        id: el.id || '',
        className: el.className || '',
        listeners: serialized
      };
    })()`;

    chrome.devtools.inspectedWindow.eval(evalString, (result, isException) => {
      if (isException) {
        reject(new Error(isException.value || "Exception during event listeners evaluation"));
      } else {
        resolve(result);
      }
    });
  });
}

async function simulateAction(selector, action, payload = {}) {
  const normSelector = normalizeSelector(selector);
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");

  if (action === 'click') {
    return await clickElement(normSelector);
  } else if (action === 'type') {
    const text = typeof payload === 'string' ? payload : (payload.text || '');
    return await typeText(normSelector, text);
  } else if (action === 'hover') {
    return await hoverElement(normSelector);
  } else if (action === 'scroll') {
    const left = payload && payload.left !== undefined ? payload.left : null;
    const top = payload && payload.top !== undefined ? payload.top : null;
    const behavior = (payload && payload.behavior) || 'auto';
    return await scrollElement(normSelector, left, top, behavior);
  } else if (action === 'press_key') {
    const key = typeof payload === 'string' ? payload : (payload && payload.key) || '';
    return await pressKey(normSelector, key);
  }

  // Execute other actions (focus, blur, submit, change) in the MAIN world
  const result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: "MAIN",
    func: (sel, act, pay) => {
      const el = sel === "document" ? document : document.querySelector(sel);
      if (!el) return { success: false, error: `Element matching selector "${sel}" not found.` };

      if (act === 'focus') {
        if (typeof el.focus === 'function') {
          el.focus();
          return { success: true, message: `Successfully focused element matching selector "${sel}".` };
        } else {
          return { success: false, error: `Element does not support focus action.` };
        }
      } else if (act === 'blur') {
        if (typeof el.blur === 'function') {
          el.blur();
          return { success: true, message: `Successfully blurred element matching selector "${sel}".` };
        } else {
          return { success: false, error: `Element does not support blur action.` };
        }
      } else if (act === 'submit') {
        const form = el.tagName.toLowerCase() === 'form' ? el : el.form || el.closest('form');
        if (form) {
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            form.submit();
          }
          return { success: true, message: `Successfully submitted form associated with selector "${sel}".` };
        } else {
          return { success: false, error: `No associated form found for selector "${sel}".` };
        }
      } else if (act === 'change') {
        if ('value' in el) {
          const val = pay && pay.value !== undefined ? pay.value : pay;
          el.value = val;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true, message: `Successfully changed value to "${val}" and triggered change event on selector "${sel}".` };
        } else {
          return { success: false, error: `Element does not support value change.` };
        }
      }

      return { success: false, error: `Unsupported action: "${act}".` };
    },
    args: [normSelector, action, payload]
  });
  return result[0].result;
}

async function analyzeLayoutMetrics(selector) {
  const normSelector = normalizeSelector(selector);
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");
  
  const result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: "MAIN",
    func: (sel) => {
      const el = sel === "document" ? document.documentElement : document.querySelector(sel);
      if (!el) return { success: false, error: `Element matching selector "${sel}" not found.` };
      
      const rect = el.getBoundingClientRect();
      const boundingBox = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      };
      
      const styles = window.getComputedStyle(el);
      const layoutStyles = {
        display: styles.display,
        position: styles.position,
        visibility: styles.visibility,
        opacity: styles.opacity,
        zIndex: styles.zIndex,
        boxSizing: styles.boxSizing,
        marginTop: styles.marginTop,
        marginRight: styles.marginRight,
        marginBottom: styles.marginBottom,
        marginLeft: styles.marginLeft,
        paddingTop: styles.paddingTop,
        paddingRight: styles.paddingRight,
        paddingBottom: styles.paddingBottom,
        paddingLeft: styles.paddingLeft,
      };
      
      const ariaAttributes = {};
      for (const attr of el.attributes) {
        if (attr.name.startsWith('aria-') || attr.name === 'role') {
          ariaAttributes[attr.name] = attr.value;
        }
      }
      
      const a11yPath = [];
      let current = el;
      while (current && current !== document.documentElement) {
        a11yPath.push({
          tagName: current.tagName.toLowerCase(),
          id: current.id || null,
          className: current.className || null,
          role: current.getAttribute('role') || null,
          computedRole: current.computedRole || null,
          computedName: current.computedName || null,
          ariaHidden: current.getAttribute('aria-hidden') || null
        });
        current = current.parentElement;
      }
      
      const isVisible = rect.width > 0 && rect.height > 0 && 
                        styles.visibility !== 'hidden' && 
                        styles.display !== 'none' && 
                        styles.opacity !== '0';
                        
      const contrastDetails = {
        color: styles.color,
        backgroundColor: styles.backgroundColor,
        fontSize: styles.fontSize,
        fontWeight: styles.fontWeight
      };
      
      return {
        success: true,
        selector: sel,
        boundingBox,
        layoutStyles,
        ariaAttributes,
        computedRole: el.computedRole || null,
        computedName: el.computedName || null,
        tabIndex: el.tabIndex,
        disabled: el.disabled || false,
        isVisible,
        a11yPath,
        contrastDetails
      };
    },
    args: [normSelector]
  });
  return result[0].result;
}

async function getLcpElement() {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");

  const result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      return new Promise((resolve) => {
        let entries = [];
        const observer = new PerformanceObserver((list) => {
          entries = entries.concat(list.getEntries());
        });
        
        try {
          observer.observe({ type: 'largest-contentful-paint', buffered: true });
        } catch (e) {
          return resolve({ error: "Largest Contentful Paint API not supported or failed: " + e.message });
        }
        
        setTimeout(() => {
          observer.disconnect();
          if (entries.length === 0) {
            return resolve(null);
          }
          
          const lastEntry = entries[entries.length - 1];
          const el = lastEntry.element;
          
          if (!el) {
            return resolve({
              size: lastEntry.size,
              url: lastEntry.url,
              id: lastEntry.id,
              startTime: lastEntry.startTime,
              renderTime: lastEntry.renderTime,
              loadTime: lastEntry.loadTime,
              message: "LCP entry exists but the DOM element was deleted or is not retrievable."
            });
          }
          
          const getSelector = (element) => {
            if (element.id) return `#${CSS.escape(element.id)}`;
            const parts = [];
            let curr = element;
            while (curr && curr.nodeType === Node.ELEMENT_NODE) {
              let part = curr.tagName.toLowerCase();
              if (curr.id) {
                part += `#${CSS.escape(curr.id)}`;
                parts.unshift(part);
                break;
              }
              let sibling = curr;
              let nth = 1;
              while (sibling.previousElementSibling) {
                sibling = sibling.previousElementSibling;
                if (sibling.tagName === curr.tagName) {
                  nth++;
                }
              }
              let parent = curr.parentElement;
              if (parent) {
                let hasSiblingWithSameTag = false;
                for (const child of parent.children) {
                  if (child !== curr && child.tagName === curr.tagName) {
                    hasSiblingWithSameTag = true;
                    break;
                  }
                }
                if (hasSiblingWithSameTag) {
                  part += `:nth-of-type(${nth})`;
                }
              }
              parts.unshift(part);
              curr = curr.parentElement;
            }
            return parts.join(' > ');
          };
          
          const selector = getSelector(el);
          const rect = el.getBoundingClientRect();
          const attributes = {};
          for (const attr of el.attributes) {
            attributes[attr.name] = attr.value;
          }
          
          const styles = window.getComputedStyle(el);
          
          resolve({
            success: true,
            selector,
            tagName: el.tagName.toLowerCase(),
            outerHTML: el.outerHTML,
            boundingBox: {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              right: rect.right,
              bottom: rect.bottom
            },
            attributes,
            styles: {
              backgroundImage: styles.backgroundImage,
              objectFit: styles.objectFit,
              display: styles.display,
              visibility: styles.visibility,
              opacity: styles.opacity
            },
            metric: {
              size: lastEntry.size,
              url: lastEntry.url,
              id: lastEntry.id,
              startTime: lastEntry.startTime,
              renderTime: lastEntry.renderTime,
              loadTime: lastEntry.loadTime
            }
          });
        }, 100);
      });
    }
  });

  return result[0].result;
}

async function getViewportImages() {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");

  const result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      
      const imagesInViewport = [];
      
      const getSelector = (element) => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const parts = [];
        let curr = element;
        while (curr && curr.nodeType === Node.ELEMENT_NODE) {
          let part = curr.tagName.toLowerCase();
          if (curr.id) {
            part += `#${CSS.escape(curr.id)}`;
            parts.unshift(part);
            break;
          }
          let sibling = curr;
          let nth = 1;
          while (sibling.previousElementSibling) {
            sibling = sibling.previousElementSibling;
            if (sibling.tagName === curr.tagName) {
              nth++;
            }
          }
          let parent = curr.parentElement;
          if (parent) {
            let hasSiblingWithSameTag = false;
            for (const child of parent.children) {
              if (child !== curr && child.tagName === curr.tagName) {
                hasSiblingWithSameTag = true;
                break;
              }
            }
            if (hasSiblingWithSameTag) {
              part += `:nth-of-type(${nth})`;
            }
          }
          parts.unshift(part);
          curr = curr.parentElement;
        }
        return parts.join(' > ');
      };

      const allElements = document.getElementsByTagName('*');
      for (const el of allElements) {
        const tagName = el.tagName.toLowerCase();
        
        let isImage = false;
        let imgSrc = '';
        let imageType = '';
        
        if (tagName === 'img') {
          isImage = true;
          imgSrc = el.currentSrc || el.src;
          imageType = 'img';
        } else if (tagName === 'image' && el.namespaceURI === 'http://www.w3.org/2000/svg') {
          isImage = true;
          imgSrc = el.getAttribute('href') || el.getAttribute('xlink:href');
          imageType = 'svg-image';
        } else {
          const styles = window.getComputedStyle(el);
          const bgImg = styles.backgroundImage;
          if (bgImg && bgImg !== 'none') {
            const match = bgImg.match(/url\((['"]?)(.*?)\1\)/);
            if (match && match[2]) {
              isImage = true;
              imgSrc = match[2];
              imageType = 'background-image';
            }
          }
        }
        
        if (isImage) {
          const rect = el.getBoundingClientRect();
          
          const inViewport = 
            rect.width > 0 && 
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < viewportHeight &&
            rect.left < viewportWidth;
            
          if (inViewport) {
            const styles = window.getComputedStyle(el);
            const isVisible = styles.display !== 'none' && styles.visibility !== 'hidden' && styles.opacity !== '0';
            
            if (isVisible) {
              const attributes = {};
              for (const attr of el.attributes) {
                attributes[attr.name] = attr.value;
              }
              
              imagesInViewport.push({
                selector: getSelector(el),
                tagName,
                imageType,
                src: imgSrc,
                attributes,
                boundingBox: {
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                  right: rect.right,
                  bottom: rect.bottom
                },
                loading: el.loading || null,
                fetchpriority: el.fetchPriority || el.getAttribute('fetchpriority') || null
              });
            }
          }
        }
      }
      
      return imagesInViewport;
    }
  });

  return result[0].result;
}

// --- NEW AUDITING TOOLS IMPLEMENTATIONS ---

const maxNetworkBuffer = 80;
const networkRequestsBuffer = [];

if (typeof chrome !== "undefined" && chrome.devtools && chrome.devtools.network) {
  chrome.devtools.network.onRequestFinished.addListener((request) => {
    try {
      const url = request.request.url || "";
      const truncatedUrl = url.length > 512 ? url.substring(0, 512) + "... [truncated]" : url;
      
      const mimeType = (request.response.content && request.response.content.mimeType) || "";
      const isHtml = mimeType.toLowerCase().includes("html") || (request._resourceType === "document");

      const essentialHeaders = [
        'content-encoding', 'content-type', 'cache-control', 'alt-svc', 
        'content-length', 'server', 'link', 'location', 'speculation-rules'
      ];
      const respHeaders = (request.response.headers || [])
        .filter(h => isHtml || essentialHeaders.includes(h.name.toLowerCase()))
        .map(h => ({ name: h.name, value: h.value }));

      const entry = {
        url: truncatedUrl,
        method: request.request.method || "",
        status: request.response.status || 0,
        httpVersion: request.response.httpVersion || "",
        mimeType: (request.response.content && request.response.content.mimeType) || "",
        responseHeaders: respHeaders,
        requestSize: request.request.bodySize >= 0 ? request.request.bodySize : 0,
        responseSize: request.response.bodySize >= 0 ? request.response.bodySize : 0,
        contentSize: (request.response.content && request.response.content.size >= 0) ? request.response.content.size : 0,
        time: request.time || 0
      };
      networkRequestsBuffer.push(entry);
      if (networkRequestsBuffer.length > maxNetworkBuffer) {
        networkRequestsBuffer.shift();
      }
    } catch (e) {
      console.error("Error buffering network request:", e);
    }
  });

  chrome.devtools.network.onNavigated.addListener(() => {
    networkRequestsBuffer.length = 0;
  });
}

/**
 * Retrieve the buffered network request logs.
 */
async function getNetworkRequests() {
  return networkRequestsBuffer;
}

/**
 * Helper to fetch external text files (CSS, JS, source maps) bypassing CORS via extension context.
 */
async function fetchExternalText(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return "";
    return await res.text();
  } catch (e) {
    console.warn(`Failed to fetch external resource ${url}:`, e);
    return "";
  }
}

/**
 * Simulates an interaction and measures INP (latencies) and captures LoAF entries to pinpoint blocking JS.
 */
async function simulateAndMeasureInp(selector, action, payload = {}) {
  const normSelector = normalizeSelector(selector);
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");

  // Get starting page time via performance.now()
  const timeResult = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => performance.now()
  });
  const startTime = timeResult[0].result;

  // Execute the simulation action
  await simulateAction(normSelector, action, payload);

  // Wait 300ms for event handling and rendering to paint
  await new Promise(r => setTimeout(r, 300));

  // Retrieve metrics
  const metricsResult = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: (since) => {
      const events = (window.__mwg_event_entries || [])
        .filter(e => e.startTime >= since)
        .map(e => ({
          name: e.name,
          startTime: e.startTime,
          duration: e.duration,
          processingStart: e.processingStart,
          processingEnd: e.processingEnd,
          interactionId: e.interactionId
        }));

      const loafs = (window.__mwg_loaf_entries || [])
        .filter(l => l.startTime >= since || (l.startTime + l.duration) >= since)
        .map(l => ({
          startTime: l.startTime,
          duration: l.duration,
          blockingDuration: l.blockingDuration,
          renderStart: l.renderStart,
          styleAndLayoutStart: l.styleAndLayoutStart,
          scripts: (l.scripts || []).map(s => ({
            invoker: s.invoker,
            invokerType: s.invokerType,
            sourceURL: s.sourceURL,
            functionName: s.functionName,
            duration: s.duration,
            forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration
          }))
        }));

      return { events, loafs };
    },
    args: [startTime]
  });

  const { events, loafs } = metricsResult[0].result;
  return {
    success: true,
    selector: normSelector,
    action,
    events,
    loafs
  };
}

/**
 * Normalizes state pseudo-classes and matches CSS rules against active DOM to find unused CSS rules.
 */
async function analyzeCssCoverage() {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");

  // Helper to parse selectors using simple CSS block splitting
  const parseCSSSelectors = (cssText) => {
    const cleanCss = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [];
    const blocks = cleanCss.split('}');
    for (let block of blocks) {
      const openBrace = block.indexOf('{');
      if (openBrace !== -1) {
        let selectorPart = block.substring(0, openBrace).trim();
        if (selectorPart.startsWith('@')) continue; // Skip @media, @keyframes, etc.
        const parts = selectorPart.split(',');
        for (let p of parts) {
          const s = p.trim();
          if (s) selectors.push(s);
        }
      }
    }
    return selectors;
  };

  // Get inline and CORS-enabled rules list, and find CORS-blocked stylesheet URLs
  const sheetResult = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      const sheets = [];
      for (let i = 0; i < document.styleSheets.length; i++) {
        const sheet = document.styleSheets[i];
        const href = sheet.href || "inline";
        try {
          const rules = sheet.cssRules || sheet.rules;
          if (rules) {
            const selectors = [];
            for (let j = 0; j < rules.length; j++) {
              if (rules[j].type === CSSRule.STYLE_RULE && rules[j].selectorText) {
                selectors.push(rules[j].selectorText);
              }
            }
            sheets.push({ href, selectors, corsBlocked: false });
          } else {
            sheets.push({ href, corsBlocked: true });
          }
        } catch (e) {
          sheets.push({ href, corsBlocked: true });
        }
      }
      return sheets;
    }
  });

  const rawSheets = sheetResult[0].result;
  const processedSheets = [];

  // Fetch and parse CORS-blocked sheets
  for (const sheet of rawSheets) {
    if (sheet.corsBlocked && sheet.href && sheet.href !== "inline") {
      const cssText = await fetchExternalText(sheet.href);
      if (cssText) {
        const selectors = parseCSSSelectors(cssText);
        processedSheets.push({ href: sheet.href, selectors });
      } else {
        processedSheets.push({ href: sheet.href, selectors: [], error: "Failed to fetch CSS content" });
      }
    } else {
      processedSheets.push({ href: sheet.href, selectors: sheet.selectors || [] });
    }
  }

  // Compile checklist of selectors
  const allSelectorsWithHref = [];
  for (const sheet of processedSheets) {
    for (const sel of sheet.selectors) {
      allSelectorsWithHref.push({ href: sheet.href, selector: sel });
    }
  }

  // Page script to run querySelector checks on chunks of selectors
  const selectorCheckingFunc = (list) => {
    const results = [];
    
    const normalizeCssSelector = (selector) => {
      return selector
        .replace(/::[a-zA-Z0-9_-]+/g, "")
        .replace(/:[a-zA-Z0-9_-]+(\([^)]*\))?/g, (match) => {
          if (match.startsWith(':nth-') || match.startsWith(':first-') || match.startsWith(':last-') || match.startsWith(':only-') || match.startsWith(':not')) {
            return match;
          }
          return "";
        })
        .trim();
    };

    for (const entry of list) {
      try {
        const norm = normalizeCssSelector(entry.selector);
        if (!norm) {
          results.push({ ...entry, used: true });
          continue;
        }
        const used = document.querySelector(norm) !== null;
        results.push({ ...entry, used });
      } catch (e) {
        results.push({ ...entry, used: true }); // Assume used on parse errors
      }
    }
    return results;
  };

  // Run DOM check in chunks of 500 rules
  const chunkSize = 500;
  const checkedResults = [];
  for (let i = 0; i < allSelectorsWithHref.length; i += chunkSize) {
    const chunk = allSelectorsWithHref.slice(i, i + chunkSize);
    const checkResult = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: selectorCheckingFunc,
      args: [chunk]
    });
    checkedResults.push(...checkResult[0].result);
  }

  // Compile summary details
  const summaryBySheet = {};
  let totalUnused = 0;
  let totalRules = checkedResults.length;

  for (const r of checkedResults) {
    if (!summaryBySheet[r.href]) {
      summaryBySheet[r.href] = { total: 0, unused: 0, unusedSamples: [] };
    }
    summaryBySheet[r.href].total++;
    if (!r.used) {
      summaryBySheet[r.href].unused++;
      totalUnused++;
      if (summaryBySheet[r.href].unusedSamples.length < 10) {
        summaryBySheet[r.href].unusedSamples.push(r.selector);
      }
    }
  }

  return {
    success: true,
    totalRules,
    totalUnused,
    unusedPercentage: totalRules > 0 ? ((totalUnused / totalRules) * 100).toFixed(1) + "%" : "0%",
    stylesheets: summaryBySheet
  };
}

/**
 * Scans JavaScript bundles on the page, fetches source maps if publicly deployed,
 * and maps module dependency weights. Falls back to keyword/signature scan for heavy libraries.
 */
async function analyzeJsDependencies() {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");

  // Find script tags
  const scriptsResult = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      return Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
    }
  });

  const scriptUrls = scriptsResult[0].result;
  const analysis = [];

  for (const url of scriptUrls) {
    try {
      const scriptText = await fetchExternalText(url);
      if (!scriptText) continue;

      // Scan for sourceMappingURL
      const match = scriptText.match(/\/\/#\s*sourceMappingURL=(.+)$/m);
      if (match && match[1]) {
        const mapUrlString = match[1].trim();
        let mapUrl = mapUrlString;
        try {
          mapUrl = new URL(mapUrlString, url).href;
        } catch (e) {}

        const mapText = await fetchExternalText(mapUrl);
        if (mapText) {
          let map;
          try {
            map = JSON.parse(mapText);
          } catch(e) {}
          
          if (map) {
            const sources = map.sources || [];
            const sourcesContent = map.sourcesContent || [];
            const packages = {};
            let nodeModulesTotalSize = 0;
            let totalSize = 0;

            for (let i = 0; i < sources.length; i++) {
              const src = sources[i];
              const content = sourcesContent[i] || "";
              const size = content.length || 0;
              totalSize += size;

              const nodeMatch = src.match(/node_modules\/([^/]+)/);
              if (nodeMatch && nodeMatch[1]) {
                const pkgName = nodeMatch[1];
                packages[pkgName] = (packages[pkgName] || 0) + size;
                nodeModulesTotalSize += size;
              }
            }

            analysis.push({
              scriptUrl: url,
              hasSourceMap: true,
              mapUrl,
              totalSize,
              nodeModulesSize: nodeModulesTotalSize,
              dependencies: packages
            });
            continue;
          }
        }
      }

      // Fallback: Check for library patterns in compiled source
      const signatures = {
        lodash: /lodash|_\.map|_\.filter|_\.debounce|_\.throttle/i,
        moment: /moment\s*\.\s*(?:fn|utc|duration|locale)/i,
        jquery: /jQuery\s*\.\s*(?:fn|ajax|find)/
      };

      const detected = [];
      for (const [lib, regex] of Object.entries(signatures)) {
        if (regex.test(scriptText)) {
          detected.push(lib);
        }
      }

      analysis.push({
        scriptUrl: url,
        hasSourceMap: false,
        detectedSignatures: detected
      });
    } catch (err) {
      console.warn("Failed to analyze JS dependencies for: " + url, err);
    }
  }

  return {
    success: true,
    scriptsAudited: analysis
  };
}

async function takeScreenshot(selector) {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");

  // Step 1: Scroll element into view if selector is specified, and get layout details
  let layout = null;
  if (selector && selector !== "viewport" && selector !== "document") {
    const layoutResults = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: async (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        
        // Scroll element into center of viewport
        el.scrollIntoView({ block: "center", inline: "center" });
        
        // Wait 150ms for scrolling to settle
        await new Promise(r => setTimeout(r, 150));
        
        const rect = el.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          dpr: window.devicePixelRatio,
          vw: window.innerWidth,
          vh: window.innerHeight
        };
      },
      args: [selector]
    });
    
    if (layoutResults && layoutResults[0]) {
      layout = layoutResults[0].result;
    }
    
    if (!layout) {
      throw new Error(`Element matching selector "${selector}" was not found.`);
    }
  }

  // Step 2: Request the background script to capture the visible tab
  const captureResponse = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "capture-tab", tabId }, (res) => {
      resolve(res);
    });
  });

  if (!captureResponse || !captureResponse.success) {
    throw new Error(captureResponse?.error || "Failed to capture visible tab screenshot.");
  }

  const base64DataUrl = captureResponse.dataUrl;

  // Step 3: If no element layout or selector specified, return full viewport screenshot
  if (!layout) {
    return {
      screenshot: base64DataUrl,
      width: null,
      height: null
    };
  }

  // Step 4: Crop the image to the element bounding box
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const dpr = layout.dpr || 1;
        
        // Clamp bounds to viewport
        const left = Math.max(0, layout.left);
        const top = Math.max(0, layout.top);
        const width = Math.min(layout.width, layout.vw - left);
        const height = Math.min(layout.height, layout.vh - top);

        // Canvas dimensions matching element's physical pixels
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to get 2D canvas context for cropping"));
          return;
        }

        // Crop the screenshot using drawImage
        ctx.drawImage(
          img,
          left * dpr,
          top * dpr,
          width * dpr,
          height * dpr,
          0,
          0,
          width * dpr,
          height * dpr
        );

        const croppedDataUrl = canvas.toDataURL("image/png");
        resolve({
          selector: selector,
          screenshot: croppedDataUrl,
          width: width,
          height: height
        });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = (e) => {
      reject(new Error("Failed to load captured image for cropping: " + String(e)));
    };
    img.src = base64DataUrl;
  });
}

async function checkBfcacheReasons() {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!tabId) throw new Error("No inspected tab found");

  const result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      const navEntries = performance.getEntriesByType('navigation');
      if (navEntries.length === 0) {
        return { success: false, error: "No navigation timing entries found on the active page." };
      }
      const nav = navEntries[0];
      if (!('notRestoredReasons' in nav)) {
        return { success: false, error: "The notRestoredReasons API is not supported or enabled in the current browser." };
      }

      const serializeReasons = (reasonsObj) => {
        if (!reasonsObj) return null;
        const result = {
          blocked: reasonsObj.blocked,
          src: reasonsObj.src || "",
          id: reasonsObj.id || "",
          name: reasonsObj.name || "",
          reasons: reasonsObj.reasons ? Array.from(reasonsObj.reasons).map(r => ({
            reason: r.reason || "",
            source: r.source || ""
          })) : []
        };
        
        if (reasonsObj.children) {
          result.children = Array.from(reasonsObj.children)
            .map(child => serializeReasons(child))
            .filter(Boolean);
        }
        return result;
      };

      const reasons = serializeReasons(nav.notRestoredReasons);
      return {
        success: true,
        supported: true,
        reasons: reasons
      };
    }
  });

  return result[0].result;
}

/**
 * Retrieves the response headers of the base HTML document.
 */
async function getDocumentHeaders() {
  // 1. Get the current page URL
  const pageUrl = await new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval("window.location.href", (result, isException) => {
      if (isException || !result) {
        resolve(null);
      } else {
        resolve(result);
      }
    });
  });

  if (!pageUrl) {
    throw new Error("Could not retrieve current page URL.");
  }

  const cleanUrl = (url) => url.split('#')[0].replace(/\/$/, "");
  const targetCleanUrl = cleanUrl(pageUrl);

  // 2. Try to find the document request in the buffer
  const matchedRequest = networkRequestsBuffer.find(req => {
    const reqCleanUrl = cleanUrl(req.url);
    return reqCleanUrl === targetCleanUrl && req.mimeType.includes("html");
  });

  if (matchedRequest) {
    return {
      url: matchedRequest.url,
      status: matchedRequest.status,
      httpVersion: matchedRequest.httpVersion,
      headers: matchedRequest.responseHeaders,
      redirected: false
    };
  }

  // 3. Fallback: fetch the URL to get the headers
  try {
    const controller = new AbortController();
    const response = await fetch(pageUrl, {
      signal: controller.signal,
      credentials: 'include'
    });
    
    // Extract headers
    const headers = [];
    for (const [name, value] of response.headers.entries()) {
      headers.push({ name, value });
    }
    
    // Abort the body read to save bandwidth
    controller.abort();

    return {
      url: response.url,
      status: response.status,
      httpVersion: "", // fetch doesn't expose HTTP version
      headers: headers,
      redirected: response.redirected
    };
  } catch (err) {
    return {
      error: `Failed to retrieve headers: ${err.message}`
    };
  }
}

