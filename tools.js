/**
 * Represents an executable tool registerable with the Dino agent.
 */
class Tool {
  constructor({ capability = "core", declaration, execute, getLogMessage }) {
    if (!declaration || !declaration.name) {
      throw new Error("Tool declaration with a name is required.");
    }
    if (typeof execute !== "function") {
      throw new Error(`Execute handler for tool "${declaration.name}" must be a function.`);
    }

    this.capability = capability;
    this.declaration = declaration;
    this.execute = execute;
    this.getLogMessage = getLogMessage || (() => `Executed tool "${declaration.name}".`);
  }

  get name() {
    return this.declaration.name;
  }

  /**
   * Evaluates if this tool is enabled based on user capability configurations.
   * @param {Object} config - The global capability configuration object.
   * @returns {boolean} True if the tool is enabled.
   */
  isEnabled(config) {
    if (this.capability === "core") return true;
    const capKey = `cap${this.capability.charAt(0).toUpperCase() + this.capability.slice(1)}`;
    return config[capKey] !== false;
  }
}

const toolRegistry = {
  list_use_cases: new Tool({
    capability: "core",
    declaration: {
      name: "list_use_cases",
      description: "Retrieve a list of available Modern Web Guidance use case IDs, categories, and descriptions. Can optionally filter by category.",
      parameters: {
        type: "OBJECT",
        properties: {
          category: {
            type: "STRING",
            description: "Optional category to filter by (e.g., 'user-experience', 'performance', 'accessibility', etc.)."
          }
        }
      }
    },
    execute: async (args) => await listUseCases(args?.category),
    getLogMessage: (args, toolResult) => `Returned ${toolResult?.length || 0} use cases.`
  }),

  list_categories: new Tool({
    capability: "core",
    declaration: {
      name: "list_categories",
      description: "Retrieve a list of all supported category names in the catalog."
    },
    execute: async () => await listCategories(),
    getLogMessage: (args, toolResult) => `Returned ${toolResult?.length || 0} categories.`
  }),

  search_use_cases: new Tool({
    capability: "core",
    declaration: {
      name: "search_use_cases",
      description: "Perform a semantic vector search across the guide catalog using a natural language query describing a target topic or legacy pattern.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Natural language query describing the legacy code pattern or feature (e.g., 'lazy load images' or 'custom modal')."
          }
        },
        required: ["query"]
      }
    },
    execute: async (args) => await searchUseCases(args.query),
    getLogMessage: (args, toolResult) => `Found ${toolResult?.length || 0} matching guides for query "${args.query}".`
  }),

  get_guide_content: new Tool({
    capability: "core",
    declaration: {
      name: "get_guide_content",
      description: "Get the full compiled markdown guide containing the best practices and code snippets for a specific use case ID.",
      parameters: {
        type: "OBJECT",
        properties: {
          useCaseId: {
            type: "STRING",
            description: "The unique ID of the use case (e.g. 'deprioritize-background-fetches')."
          }
        },
        required: ["useCaseId"]
      }
    },
    execute: async (args) => await getGuideContent(args.useCaseId),
    getLogMessage: (args) => `Loaded guide content for "${args.useCaseId}".`
  }),

  get_page_dom: new Tool({
    capability: "core",
    declaration: {
      name: "get_page_dom",
      description: "Retrieve the simplified DOM tree structure, URL, and page title of the currently active document."
    },
    execute: async () => await getPageDOM(),
    getLogMessage: () => "Captured active page DOM."
  }),

  get_accessibility_tree: new Tool({
    capability: "core",
    declaration: {
      name: "get_accessibility_tree",
      description: "Retrieve a clean, simplified, and computed accessibility (A11y) tree representation of the active document. It uses the browser's computed roles and names while pruning non-semantic layout-only containers (like layout divs/spans) to make analysis of screen reader navigation, keyboard accessibility, and page hierarchy highly efficient."
    },
    execute: async () => await getAccessibilityTree(),
    getLogMessage: () => "Captured active page accessibility tree."
  }),

  execute_js: new Tool({
    capability: "scripting",
    declaration: {
      name: "execute_js",
      description: "Evaluate an arbitrary JavaScript expression or function body in the context of the active tab/inspected page and retrieve the serialized results. Use this for advanced diagnostics, querying window or global variables, checking custom component states, or executing complex DOM traversals not supported by other tools. IMPORTANT: Be highly conservative with the size of returned payloads. When querying multiple elements via querySelectorAll, map the elements to a small subset of properties (e.g. tag names or IDs) and explicitly slice the array (e.g., .slice(0, 50)) before returning to avoid exceeding token limits. You can self-paginate results across multiple turns using custom slice ranges (e.g. .slice(50, 100)) if the full list is required.",
      parameters: {
        type: "OBJECT",
        properties: {
          code: {
            type: "STRING",
            description: "The JavaScript code to execute. Can be a single expression or an IIFE. The code MUST only return compact, concise data structures (e.g. counts, statistics, or explicitly sliced sub-arrays) rather than raw DOM nodes or large text blobs."
          },
          purpose: {
            type: "STRING",
            description: "A short, user-friendly description of what this script is auditing or checking (e.g. 'Checking if any heavy scripts like jQuery or React are loaded on the page')."
          }
        },
        required: ["code", "purpose"]
      }
    },
    execute: async (args) => await executeJS(args.code),
    getLogMessage: (args, toolResult) => `Executed JS: "${args.purpose}". Success: ${toolResult.success}`
  }),

  get_inspected_element: new Tool({
    capability: "core",
    declaration: {
      name: "get_inspected_element",
      description: "Retrieve the outerHTML and critical computed styling of the element currently selected in DevTools."
    },
    execute: async () => await getInspectedElement(),
    getLogMessage: () => "Captured DevTools selected element."
  }),

  get_element_info: new Tool({
    capability: "core",
    declaration: {
      name: "get_element_info",
      description: "Retrieve detailed information about one or more DOM elements matching the selector or selector list (using querySelectorAll), including their tag name, attributes, outerHTML, innerText, computed styles, and matched CSS rules (with their CSS selector text, styles, and stylesheet file URLs). Use comma-separated selector lists to query details for multiple elements in a single tool call to save tokens and minimize roundtrips.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "CSS selector or comma-separated selector list of the target element(s) (e.g. 'nav, footer, .sidebar')."
          },
          computedProperties: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Optional list of computed CSS property names to retrieve. If omitted, default common properties are returned."
          }
        },
        required: ["selector"]
      }
    },
    execute: async (args) => await getElementInfo(args.selector, args.computedProperties),
    getLogMessage: (args) => `Retrieved info for element matching "${args.selector}".`
  }),

  inspect_event_listeners: new Tool({
    capability: "core",
    declaration: {
      name: "inspect_event_listeners",
      description: "Retrieve all active JavaScript event listeners registered on a DOM element. Useful for debugging event propagation, keyboard access, or memory leaks.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "Optional CSS selector of the target element. If omitted or '$0', targets the element currently inspected in DevTools."
          }
        }
      }
    },
    execute: async (args) => await inspectEventListeners(args?.selector),
    getLogMessage: (args) => `Inspected event listeners for "${args?.selector || "$0"}".`
  }),

  analyze_layout_metrics: new Tool({
    capability: "core",
    declaration: {
      name: "analyze_layout_metrics",
      description: "Analyze the layout, positioning, dimensions, contrast styles, and computed accessibility (A11y) tree path of a target DOM element. Crucial for verifying touch targets, CLS layout shifts, and screen reader flow.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "CSS selector of the element to analyze."
          }
        },
        required: ["selector"]
      }
    },
    execute: async (args) => await analyzeLayoutMetrics(args.selector),
    getLogMessage: (args) => `Analyzed layout metrics for "${args.selector}".`
  }),

  get_lcp_element: new Tool({
    capability: "core",
    declaration: {
      name: "get_lcp_element",
      description: "Retrieve the Largest Contentful Paint (LCP) element details of the page, including its tag name, attributes, outerHTML, CSS selector, bounding box dimensions, and performance paint metrics. Use this to identify and optimize the largest visible content element."
    },
    execute: async () => await getLcpElement(),
    getLogMessage: () => "Retrieved LCP element details."
  }),

  get_viewport_images: new Tool({
    capability: "core",
    declaration: {
      name: "get_viewport_images",
      description: "Retrieve details of all image elements (HTML <img>, SVG <image>, or CSS background-image) that are currently positioned within the user's initial viewport (above the fold), including their source URLs, dimensions, and loading attributes (like loading and fetchpriority). Useful for optimization audits."
    },
    execute: async () => await getViewportImages(),
    getLogMessage: (args, toolResult) => `Retrieved ${toolResult?.length || 0} images inside the viewport.`
  }),

  get_network_requests: new Tool({
    capability: "network",
    declaration: {
      name: "get_network_requests",
      description: "Retrieve the buffer of captured HTTP/HTTPS network requests from the active tab. Use this to audit HTTP/3 usage, check for uncompressed assets, detect bloated JSON payloads, or spot third-party trackers."
    },
    execute: async () => await getNetworkRequests(),
    getLogMessage: (args, toolResult) => `Captured ${toolResult?.length || 0} network requests.`
  }),

  get_document_headers: new Tool({
    capability: "network",
    declaration: {
      name: "get_document_headers",
      description: "Retrieve the HTTP/HTTPS response headers of the base HTML document. It automatically follows any redirect chain to return the final document's headers, and preserves all headers (unlike get_network_requests which filters them). Use this to audit HTTP headers such as Speculation-Rules, Link, Content-Security-Policy (CSP), Strict-Transport-Security, and redirects."
    },
    execute: async () => await getDocumentHeaders(),
    getLogMessage: (args, toolResult) => {
      if (toolResult && toolResult.error) {
        return `Failed to retrieve document headers: ${toolResult.error}`;
      }
      return `Retrieved document headers. Status: ${toolResult?.status || 'unknown'}${toolResult?.redirected ? ' (redirected)' : ''}`;
    }
  }),

  simulate_and_measure_inp: new Tool({
    capability: "interaction",
    declaration: {
      name: "simulate_and_measure_inp",
      description: "Simulate a specific user interaction and measure layout shifts, interaction latency, and retrieve details of any JavaScript scripts blocking the main thread (using Long Animation Frames).",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "CSS selector of the target element to interact with."
          },
          action: {
            type: "STRING",
            description: "The interaction to simulate: 'click', 'type', 'hover', 'scroll', 'press_key'."
          },
          payload: {
            type: "OBJECT",
            description: "Optional arguments for the action (e.g. {text: 'value'} for type, {left: 0, top: 100} for scroll, or {key: 'Escape'} for press_key)."
          }
        },
        required: ["selector", "action"]
      }
    },
    execute: async (args) => await simulateAndMeasureInp(args.selector, args.action, args.payload),
    getLogMessage: (args) => `Simulated "${args.action}" on "${args.selector}" and measured interaction metrics.`
  }),

  analyze_css_coverage: new Tool({
    capability: "core",
    declaration: {
      name: "analyze_css_coverage",
      description: "Scan all active stylesheets on the page and match their selectors against the current DOM to identify unused styles and dead CSS rules."
    },
    execute: async () => await analyzeCssCoverage(),
    getLogMessage: (args, toolResult) => `Audited CSS stylesheet usage (rules: ${toolResult.totalRules}, unused: ${toolResult.totalUnused}).`
  }),

  analyze_js_dependencies: new Tool({
    capability: "core",
    declaration: {
      name: "analyze_js_dependencies",
      description: "Audit JavaScript bundles loaded on the page. Fetches and parses source maps where publicly deployed to extract module sizes, and scans code signatures for heavy/legacy libraries (Lodash, Moment, jQuery)."
    },
    execute: async () => await analyzeJsDependencies(),
    getLogMessage: (args, toolResult) => `Audited JS bundle dependencies (scripts: ${toolResult.scriptsAudited?.length || 0}).`
  }),

  check_bfcache_reasons: new Tool({
    capability: "core",
    declaration: {
      name: "check_bfcache_reasons",
      description: "Retrieve Back-Forward Cache (bfcache) compatibility status and any reasons why the page or its iframes were blocked from using bfcache on navigation. Note: This API only returns data if a back/forward history navigation has occurred; otherwise it returns null."
    },
    execute: async () => await checkBfcacheReasons(),
    getLogMessage: () => "Checked bfcache reasons."
  }),


  simulate_action: new Tool({
    capability: "interaction",
    declaration: {
      name: "simulate_action",
      description: "Simulate a specific browser interaction (click, type, hover, focus, blur, scroll, submit, change) on a target DOM element. This enables testing interactivity, state changes, keyboard flow, and form submissions.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "CSS selector of the target element."
          },
          action: {
            type: "STRING",
            description: "The interaction to simulate: 'click', 'type', 'hover', 'focus', 'blur', 'scroll', 'submit', 'change'."
          },
          payload: {
            type: "OBJECT",
            description: "Optional payload/arguments for the action. For 'type' this is the string to type (or {text: '...'}). For 'scroll' this is {left: number, top: number, behavior: 'auto'|'smooth'}. For 'press_key' this is the key name (or {key: '...'}). For 'change' this is the value (or {value: '...'})."
          }
        },
        required: ["selector", "action"]
      }
    },
    execute: async (args) => await simulateAction(args.selector, args.action, args.payload),
    getLogMessage: (args) => `Simulated "${args.action}" on "${args.selector}".`
  }),

  get_console_logs: new Tool({
    capability: "logs",
    declaration: {
      name: "get_console_logs",
      description: "Retrieve the buffer of captured console messages (logs, warnings, errors) from the active tab. Use this to verify if any javascript errors occurred or if warnings were cleared."
    },
    execute: async () => await getConsoleLogs(),
    getLogMessage: (args, toolResult) => `Captured ${toolResult?.length || 0} console logs.`
  }),

  apply_preview: new Tool({
    capability: "preview",
    declaration: {
      name: "apply_preview",
      description: "Apply a modernized HTML, CSS, or JS code block dynamically into the active browser tab's DOM as a live preview.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "The CSS selector of the target element, or 'document' for global script/styles."
          },
          modernizedCode: {
            type: "STRING",
            description: "The modernized HTML, CSS, or JS code block to inject."
          },
          originalCode: {
            type: "STRING",
            description: "The original legacy HTML, CSS, or JS snippet to replace (if applicable)."
          }
        },
        required: ["selector", "modernizedCode"]
      }
    },
    execute: async (args) => await applyPreview({
      target: args.selector,
      modernizedCode: args.modernizedCode,
      originalCode: args.originalCode
    }, null),
    getLogMessage: () => "Applied live preview to tab."
  }),

  save_override: new Tool({
    capability: "override",
    declaration: {
      name: "save_override",
      description: "Scan the inspected window's static page resources (scripts, stylesheets, document), find the legacy snippet, replace it with the modernized code, and save it as a local override to disk.",
      parameters: {
        type: "OBJECT",
        properties: {
          originalCode: {
            type: "STRING",
            description: "The legacy code snippet to locate in page resources."
          },
          modernizedCode: {
            type: "STRING",
            description: "The modernized code snippet to replace it with."
          }
        },
        required: ["originalCode", "modernizedCode"]
      }
    },
    execute: async (args) => await saveOverride({
      originalCode: args.originalCode,
      modernizedCode: args.modernizedCode
    }),
    getLogMessage: () => "Saved local override to disk."
  }),

  take_screenshot: new Tool({
    capability: "screenshot",
    declaration: {
      name: "take_screenshot",
      description: "Capture a screenshot of the visible viewport or a specific DOM element. If a CSS selector is provided, the element will be scrolled into view and cropped. Returns a base64-encoded PNG image.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "Optional CSS selector of the target element. If omitted, takes a screenshot of the entire visible viewport."
          }
        }
      }
    },
    execute: async (args) => await takeScreenshot(args.selector),
    getLogMessage: (args) => `Captured screenshot${args.selector ? ` of "${args.selector}"` : ""}.`
  })
};

/**
 * Resolves declarations based on current config capabilities.
 */
function getEnabledTools() {
  const declarations = Object.values(toolRegistry)
    .filter(tool => tool.isEnabled(config))
    .map(tool => tool.declaration);

  return [{ functionDeclarations: declarations }];
}

/**
 * Executes a tool by name with the given arguments.
 * @param {string} name - The tool name requested by the model.
 * @param {Object} args - Arguments passed to the tool.
 * @returns {Promise<any>} The result returned by the tool execution.
 */
async function executeTool(name, args) {
  const tool = toolRegistry[name];
  if (!tool) {
    throw new Error(`Unknown function call: ${name}`);
  }
  if (!tool.isEnabled(config)) {
    throw new Error(`Tool "${name}" is disabled by user capability configurations.`);
  }
  return await tool.execute(args);
}

/**
 * Returns a user-friendly log summary of the tool output.
 * @param {string} name - The name of the tool.
 * @param {Object} args - The arguments passed to the tool.
 * @param {any} toolResult - The result returned by the tool.
 * @returns {string} The log message description.
 */
function getToolLogMessage(name, args, toolResult) {
  if (!toolResult) return "";
  if (toolResult.error) return `Execution failed (${toolResult.error})`;

  const tool = toolRegistry[name];
  return tool ? tool.getLogMessage(args, toolResult) : "";
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getEnabledTools, executeTool, getToolLogMessage, toolRegistry };
} else if (typeof globalThis !== 'undefined') {
  globalThis.getEnabledTools = getEnabledTools;
  globalThis.executeTool = executeTool;
  globalThis.getToolLogMessage = getToolLogMessage;
  globalThis.toolRegistry = toolRegistry;
}
