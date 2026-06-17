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
        return {
          tagName: el.tagName.toLowerCase(),
          id: el.id,
          className: el.className,
          attributes: attrs,
          outerHTML: el.outerHTML.substring(0, 3000), // Cap size slightly lower for list matches
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
