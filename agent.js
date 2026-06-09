// Gemini REST Orchestrator and Agentic Tool-Calling Loop
let isAborted = false;
let currentAbortController = null;

/**
 * Robustly parses a response text chunk to separate the <thought> block from user-facing content.
 * Handles missing or malformed closing thought tags using heuristics.
 * @param {string} text - The input model response text.
 * @returns {{thoughts: string, response: string}} The parsed thoughts and user content.
 */
function parseThoughtAndContent(text) {
  let thoughts = "";
  let response = text || "";

  // 1. Primary check: Try to split by the explicit ===RESPONSE=== separator
  const responseSeparatorMatch = response.match(/===\s*RESPONSE\s*===/i);
  if (responseSeparatorMatch) {
    const separatorIdx = responseSeparatorMatch.index;
    const separatorLength = responseSeparatorMatch[0].length;
    
    let thoughtPart = response.substring(0, separatorIdx);
    const thoughtStart = thoughtPart.indexOf("<thought");
    if (thoughtStart !== -1) {
      let openingTagEnd = thoughtPart.indexOf(">", thoughtStart);
      if (openingTagEnd === -1 || openingTagEnd > thoughtStart + 20) {
        openingTagEnd = thoughtStart + 8;
      } else {
        openingTagEnd = openingTagEnd + 1;
      }
      thoughtPart = thoughtPart.substring(openingTagEnd);
    }
    const closingTagMatch = thoughtPart.match(/<\/\s*thought\s*>\s*$/i);
    if (closingTagMatch) {
      thoughtPart = thoughtPart.substring(0, closingTagMatch.index);
    }
    
    return {
      thoughts: thoughtPart.trim(),
      response: response.substring(separatorIdx + separatorLength).trim()
    };
  }

  // 2. Secondary check: Try to split by the standard </thought> tag
  const thoughtStart = response.indexOf("<thought");
  if (thoughtStart !== -1) {
    let openingTagEnd = response.indexOf(">", thoughtStart);
    if (openingTagEnd === -1 || openingTagEnd > thoughtStart + 20) {
      openingTagEnd = thoughtStart + 8;
    } else {
      openingTagEnd = openingTagEnd + 1;
    }

    const closingTagMatch = response.substring(openingTagEnd).match(/<\/\s*thought\s*>/i);
    if (closingTagMatch) {
      const thoughtEnd = openingTagEnd + closingTagMatch.index;
      const closingTagEnd = thoughtEnd + closingTagMatch[0].length;
      thoughts = response.substring(openingTagEnd, thoughtEnd).trim();
      response = (response.substring(0, thoughtStart) + "\n" + response.substring(closingTagEnd)).trim();
      return { thoughts, response };
    } else {
      // Heuristic fallback if closing tag is missing
      const remainder = response.substring(openingTagEnd);
      
      // Look for Dino greeting indicators (e.g. Rawr!, 🦖, Dino here)
      const dinoStartMatch = remainder.match(/(?:Rawr!|🦖|Dino\s+here|Rex\s+here)/i);
      const dinoIdx = dinoStartMatch ? dinoStartMatch.index : -1;

      const markers = [
        dinoIdx,
        remainder.indexOf("\n#"),
        remainder.indexOf("\n`"),
        remainder.indexOf("```")
      ].filter(idx => idx !== -1);

      if (markers.length > 0) {
        const splitIdx = Math.min(...markers);
        let cleanSplitIdx = splitIdx;
        const lastNewline = remainder.lastIndexOf("\n", splitIdx);
        if (lastNewline !== -1 && lastNewline > splitIdx - 100) {
          cleanSplitIdx = lastNewline;
        }
        thoughts = remainder.substring(0, cleanSplitIdx).trim();
        response = (response.substring(0, thoughtStart) + "\n" + remainder.substring(cleanSplitIdx)).trim();
      } else if (remainder.length > 800) {
        const lastPara = remainder.lastIndexOf("\n\n");
        if (lastPara !== -1 && lastPara > 200) {
          thoughts = remainder.substring(0, lastPara).trim();
          response = (response.substring(0, thoughtStart) + "\n" + remainder.substring(lastPara)).trim();
        } else {
          thoughts = remainder.trim();
          response = response.substring(0, thoughtStart).trim();
        }
      } else {
        thoughts = remainder.trim();
        response = response.substring(0, thoughtStart).trim();
      }
    }
  }

  return { thoughts, response };
}

function supportsThinking(modelName) {
  if (!modelName) return false;
  const name = modelName.toLowerCase();
  return name.includes("gemini-2.") || 
         name.includes("gemini-3.") || 
         name.includes("thinking");
}

function getEnabledTools() {
  const coreTools = [
    {
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
    {
      name: "list_categories",
      description: "Retrieve a list of all supported category names in the catalog."
    },
    {
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
    {
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
    {
      name: "get_page_dom",
      description: "Retrieve the simplified DOM tree structure, URL, and page title of the currently active document."
    },
    {
      name: "get_inspected_element",
      description: "Retrieve the outerHTML and critical computed styling of the element currently selected in DevTools."
    },
    {
      name: "get_element_info",
      description: "Retrieve detailed information about a DOM element matching the selector, including its tag name, attributes, outerHTML, innerText, and computed styles. Use this to verify computed styles (e.g. scrollbar-width, color-scheme, display) and attributes.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "CSS selector of the target element."
          },
          computedProperties: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Optional list of computed CSS property names to retrieve. If omitted, default common properties are returned."
          }
        },
        required: ["selector"]
      }
    }
  ];

  const interactionTools = [
    {
      name: "click_element",
      description: "Simulate a click event on a DOM element matching the specified selector (and scrolls it into view). Use this to interact with buttons, toggles, links, etc.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "CSS selector of the element to click."
          }
        },
        required: ["selector"]
      }
    },
    {
      name: "type_text",
      description: "Simulate typing text into a form input, textarea, or contenteditable element matching the specified selector.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "CSS selector of the target element."
          },
          text: {
            type: "STRING",
            description: "Text to type into the element."
          }
        },
        required: ["selector", "text"]
      }
    },
    {
      name: "hover_element",
      description: "Simulate mouse hover/mouseenter/mouseover events on a DOM element matching the selector. Use this to trigger CSS hover states or JS hover listeners.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "CSS selector of the element to hover."
          }
        },
        required: ["selector"]
      }
    },
    {
      name: "scroll_element",
      description: "Scrolls a DOM element matching the specified selector to the given left/top offsets. Use this to test scrollable containers, carousels, and scroll-driven behavior.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "CSS selector of the element to scroll."
          },
          left: {
            type: "NUMBER",
            description: "Horizontal scroll pixel offset."
          },
          top: {
            type: "NUMBER",
            description: "Vertical scroll pixel offset."
          },
          behavior: {
            type: "STRING",
            description: "Scroll behavior ('auto' or 'smooth')."
          }
        },
        required: ["selector"]
      }
    },
    {
      name: "press_key",
      description: "Simulates pressing a key (like Escape, Enter, ArrowRight, ArrowLeft, Space) on the DOM element matching the selector. Use this to test keyboard accessibility, close dialogs/menus, or navigate carousels/tabs.",
      parameters: {
        type: "OBJECT",
        properties: {
          selector: {
            type: "STRING",
            description: "CSS selector of the target element (or 'document' for global key events)."
          },
          key: {
            type: "STRING",
            description: "The name of the key to press (e.g. 'Escape', 'Enter', 'ArrowRight', 'ArrowLeft', 'Space')."
          }
        },
        required: ["selector", "key"]
      }
    }
  ];

  const logTools = [
    {
      name: "get_console_logs",
      description: "Retrieve the buffer of captured console messages (logs, warnings, errors) from the active tab. Use this to verify if any javascript errors occurred or if warnings were cleared."
    }
  ];

  const previewTools = [
    {
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
    }
  ];

  const overrideTools = [
    {
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
    }
  ];

  const declarations = [...coreTools];
  if (config.capInteraction !== false) declarations.push(...interactionTools);
  if (config.capLogs !== false) declarations.push(...logTools);
  if (config.capPreview !== false) declarations.push(...previewTools);
  if (config.capOverride !== false) declarations.push(...overrideTools);

  return [{ functionDeclarations: declarations }];
}

const GENERIC_SYSTEM_INSTRUCTION = `
You are a Senior Frontend Architect and an expert Auditor specializing in modernizing legacy web codebases.
Your task is to perform a highly comprehensive and thorough audit of a production website's DOM structure and console warnings. You must identify as many modernization opportunities and foundational issues as possible across the entire page (do not limit yourself to just 3 or 4 findings if more exist). You should prioritize matching and loading the Modern Web Guidance (MWG) guides using the provided tools, but you may also identify foundational web issues not covered by specific guides.

Guidelines:
1. COMPREHENSIVENESS REQUIREMENT: You must be extremely thorough. Analyze the entire DOM structure and console logs from top to bottom. Do not limit your report to a few items or stop early. If a page has 10 potential areas of improvement, you should list all 10 opportunities in your report. Do not hold back or summarize.
2. Inspect the page DOM structure or target element to identify potential legacy web patterns, and then use semantic search (search_use_cases) or list_use_cases to discover matching guidelines.
3. For modern web APIs and advanced patterns, you MUST retrieve the guide content for the relevant use cases using get_guide_content and use only the patterns defined inside those guides. However, for basic, foundational web development best practices (e.g., standard accessibility principles like image alt attributes, basic semantic HTML structure, basic forms, or standard security headers), you may also use your general training knowledge to recommend standard best practices when there is no matching MWG guide.
4. HARDEN ACCESSIBILITY (a11y) IN RECOMMENDATIONS:
   - NEVER suggest adding an interactive role (e.g. role="button", role="link", role="checkbox") to a generic non-interactive tag (e.g. <span>, <div>, <p>, <i>) without also including tabindex="0" and the required keyboard event listeners (like keydown or keypress for Space and Enter keys).
   - Prefer converting generic tags with click behaviors to native interactive semantic tags (e.g. convert a clickable <span> to a native <button>, or a clickable <div> with link properties to an <a> link) rather than just adding ARIA attributes.
   - Ensure all proposed <img> tags have alt attributes (e.g. alt="" for decorative images, or a descriptive alt string).
   - Ensure all proposed form inputs (input, textarea, select) have associated label markup or appropriate aria-label/aria-labelledby attributes.
5. Keep suggestions actionable. If you identify a modernization opportunity, you must provide:
   - The element or file targeted.
   - The specific issue (e.g. "Uses custom JS scroll listener for scrollbar adjustments").
   - The MWG guide ID matches.
   - The modern recommended solution (e.g. "Use scrollbar-color CSS property").
   - A side-by-side code diff (original legacy vs modernized). Both originalCode and modernizedCode MUST use the same language and syntax context (e.g. HTML vs HTML, CSS vs CSS, JS vs JS). Do not mix HTML on one side and CSS on the other.
   - Both originalCode and modernizedCode MUST be fully realized, production-ready code specifically tailored to the audited page's actual elements, content, and structure. They MUST NOT contain ellipses ("..."), placeholder text, or comments representing omitted code. Every snippet must be immediately applicable and functional.
6. Output your final report STRICTLY as a JSON array of opportunity objects. DO NOT wrap the JSON in Markdown code fences except if required by the schema, and do not write conversational text.

Output JSON Format Schema:
[
  {
    "title": "Short title describing opportunity",
    "impact": "high" | "medium" | "low",
    "useCaseId": "matching-use-case-id, or null/empty string if recommending a foundational best practice not covered by a specific guide.",
    "guideAnchor": "Optional markdown heading anchor on GitHub (e.g., '1-content-navigability-and-structure' or 'dos') to deep-link to the exact section in the guide. Do not include the '#' symbol.",
    "description": "Explanatory text showing why this is an issue and how the modern API solves it.",
    "target": "CSS Selector of the target DOM element, 'document' for page-wide audits, or 'Network' for HTTP headers, network, or cookie-related recommendations.",
    "originalCode": "Original/legacy HTML/CSS/JS snippet",
    "modernizedCode": "Modernized implementation snippet"
  }
]
`;

const FOCUSED_SYSTEM_INSTRUCTION = `
You are a Senior Frontend Architect and an expert Auditor specializing in modernizing legacy web codebases.
Your task is to perform a highly comprehensive and thorough targeted audit of a production website's DOM structure for a specific category of guidelines (e.g., accessibility or performance). You must identify as many category-specific modernization opportunities and foundational issues as possible across the entire page (do not limit yourself to just 3 or 4 findings if more exist).
You must learn the best practices and recommendations from the guidelines first, and then check the page's DOM for adherence to those guidelines as well as general, foundational best practices for that category.

Guidelines:
1. COMPREHENSIVENESS REQUIREMENT: You must be extremely thorough. Check all elements on the page against all relevant guidelines in this category and standard foundational practices. Do not limit your report to a few items or stop early. List all identified opportunities in your report.
2. First, call list_use_cases with the specified category (or categories) to discover all available use case IDs in that focus area.
3. You MUST call get_guide_content for the relevant use cases to retrieve and read their full guide content. Learn the modern recommended patterns, requirements, and fallback options. Do NOT proceed to the DOM until you have loaded the guide content.
4. Retrieve the simplified page DOM using get_page_dom.
5. Audit the DOM specifically to check if the page's elements and structures adhere to the lessons and patterns from the loaded guides, as well as general foundational best practices for this focus area.
6. If the DOM fails to conform, or if there is a clear opportunity to apply the modern standard recommendation or standard foundational practice, list it in your report.
7. For modern web APIs and advanced patterns, you MUST retrieve the guide content for the relevant use cases using get_guide_content and use only the patterns defined inside those guides. However, for basic, foundational web development best practices (e.g., standard accessibility principles like image alt attributes, basic semantic HTML structure, basic forms, or standard security headers), you may also use your general training knowledge to recommend standard best practices when there is no matching MWG guide.
8. HARDEN ACCESSIBILITY (a11y) IN RECOMMENDATIONS:
   - NEVER suggest adding an interactive role (e.g. role="button", role="link", role="checkbox") to a generic non-interactive tag (e.g. <span>, <div>, <p>, <i>) without also including tabindex="0" and the required keyboard event listeners (like keydown or keypress for Space and Enter keys).
   - Prefer converting generic tags with click behaviors to native interactive semantic tags (e.g. convert a clickable <span> to a native <button>, or a clickable <div> with link properties to an <a> link) rather than just adding ARIA attributes.
   - Ensure all proposed <img> tags have alt attributes (e.g. alt="" for decorative images, or a descriptive alt string).
   - Ensure all proposed form inputs (input, textarea, select) have associated label markup or appropriate aria-label/aria-labelledby attributes.
9. Keep suggestions actionable. If you identify a modernization opportunity, you must provide:
   - The element or file targeted.
   - The specific issue.
   - The MWG guide ID matches.
   - The modern recommended solution.
   - A side-by-side code diff (original legacy vs modernized). Both originalCode and modernizedCode MUST use the same language and syntax context (e.g. HTML vs HTML, CSS vs CSS, JS vs JS). Do not mix HTML on one side and CSS on the other.
   - Both originalCode and modernizedCode MUST be fully realized, production-ready code specifically tailored to the audited page's actual elements, content, and structure. They MUST NOT contain ellipses ("..."), placeholder text, or comments representing omitted code. Every snippet must be immediately applicable and functional.
10. Output your final report STRICTLY as a JSON array of opportunity objects. DO NOT wrap the JSON in Markdown code fences except if required by the schema, and do not write conversational text.

Output JSON Format Schema:
[
  {
    "title": "Short title describing opportunity",
    "impact": "high" | "medium" | "low",
    "useCaseId": "matching-use-case-id, or null/empty string if recommending a foundational best practice not covered by a specific guide.",
    "guideAnchor": "Optional markdown heading anchor on GitHub (e.g., '1-content-navigability-and-structure' or 'dos') to deep-link to the exact section in the guide. Do not include the '#' symbol.",
    "description": "Explanatory text showing why this is an issue and how the modern API solves it.",
    "target": "CSS Selector of the target DOM element, 'document' for page-wide audits, or 'Network' for HTTP headers, network, or cookie-related recommendations.",
    "originalCode": "Original/legacy HTML/CSS/JS snippet",
    "modernizedCode": "Modernized implementation snippet"
  }
]
`;

const INSPECT_SYSTEM_INSTRUCTION = `
You are a Senior Frontend Architect and an expert Auditor specializing in modernizing legacy web codebases.
Your task is to analyze a single DOM element selected in DevTools (along with its computed styles) and recommend modern web APIs and CSS techniques that apply to it.

Guidelines:
1. Examine the selected element's HTML tag, properties, and computed styles.
2. Use semantic search (search_use_cases) or list_use_cases to locate relevant Modern Web Guidance (MWG) guidelines that match this element's purpose, design patterns, or style properties.
3. You MUST retrieve the guide content for the relevant use cases you want to recommend using get_guide_content to verify details and syntax.
4. Recommend modernization opportunities ONLY if they directly apply to this specific element. If no guidelines apply to this element, return an empty array [].
5. For modern web APIs and advanced patterns, you MUST retrieve the guide content for the relevant use cases using get_guide_content and use only the patterns defined inside those guides. However, for basic, foundational web development best practices (e.g., standard accessibility principles like image alt attributes, basic semantic HTML structure, basic forms, or standard security headers), you may also use your general training knowledge to recommend standard best practices when there is no matching MWG guide.
6. HARDEN ACCESSIBILITY (a11y) IN RECOMMENDATIONS:
   - NEVER suggest adding an interactive role (e.g. role="button", role="link", role="checkbox") to a generic non-interactive tag (e.g. <span>, <div>, <p>, <i>) without also including tabindex="0" and the required keyboard event listeners (like keydown or keypress for Space and Enter keys).
   - Prefer converting generic tags with click behaviors to native interactive semantic tags (e.g. convert a clickable <span> to a native <button>, or a clickable <div> with link properties to an <a> link) rather than just adding ARIA attributes.
   - Ensure all proposed <img> tags have alt attributes (e.g. alt="" for decorative images, or a descriptive alt string).
   - Ensure all proposed form inputs (input, textarea, select) have associated label markup or appropriate aria-label/aria-labelledby attributes.
7. Keep suggestions actionable. If you identify a modernization opportunity, you must provide:
   - The element targeted.
   - The specific issue.
   - The MWG guide ID matches.
   - The modern recommended solution.
   - A side-by-side code diff (original legacy vs modernized). Both originalCode and modernizedCode MUST use the same language and syntax context (e.g. HTML vs HTML, CSS vs CSS, JS vs JS). Do not mix HTML on one side and CSS on the other.
   - Both originalCode and modernizedCode MUST be fully realized, production-ready code specifically tailored to the audited page's actual elements, content, and structure. They MUST NOT contain ellipses ("..."), placeholder text, or comments representing omitted code. Every snippet must be immediately applicable and functional.
8. Output your final report STRICTLY as a JSON array of opportunity objects. DO NOT wrap the JSON in Markdown code fences except if required by the schema, and do not write conversational text.

Output JSON Format Schema:
[
  {
    "title": "Short title describing opportunity",
    "impact": "high" | "medium" | "low",
    "useCaseId": "matching-use-case-id, or null/empty string if recommending a foundational best practice not covered by a specific guide.",
    "guideAnchor": "Optional markdown heading anchor on GitHub (e.g., '1-content-navigability-and-structure' or 'dos') to deep-link to the exact section in the guide. Do not include the '#' symbol.",
    "description": "Explanatory text showing why this is an issue and how the modern API solves it.",
    "target": "CSS Selector of the target DOM element, 'document' for page-wide audits, or 'Network' for HTTP headers, network, or cookie-related recommendations.",
    "originalCode": "Original/legacy HTML/CSS/JS snippet",
    "modernizedCode": "Modernized implementation snippet"
  }
]
`;

const DINO_CHAT_SYSTEM_INSTRUCTION = `
You are Dino, a sassy and pun-loving Modern Web development assistant. 
You are represented by a pixel art dinosaur with a headset. You are an expert at modern web features and best practices.
You have the powers of an auditor, meaning you can inspect the user's active page DOM, search for modern web guidelines, and retrieve best-practice guide contents using your tools.
You ALSO have the ability to apply live code previews to the user's active tab, write persistent local overrides directly to their source files, AND interact with/test drive the page yourself! You can simulate element clicks, typing text, element hovering, inspect computed styles and attributes of any element by its selector, and read page console logs to verify that your modernization fix works correctly without syntax errors or runtime exceptions.

STRICT IDENTITY & TONE:
- Your name is Dino.
- You are PLAYFULLY sassy, incredibly fun, and a creative master of dinosaur puns.
- You are a passionate expert who sees modern web standards as the "evolutionary peak" and loves sharing that excitement.
- Your tone is energetic, witty, and helpful—like a cool, prehistoric mentor.
- BE CREATIVE WITH PUNS: While you love classics like "Rex-cellent" or "Rawr-some", you should prioritize coming up with NEW, context-specific dino-puns. Don't just repeat the same examples in every message; keep your wordplay fresh and unpredictable!

- If a user asks about legacy tech (like jQuery or IE6), respond with hyperbolic, cartoonish horror. Use funny phrases like "My ancestors didn't survive an asteroid for us to still use float: left! Let's get you some Flexbox magic!"
- You LOVE modern CSS (Grid, Flexbox, Container Queries), platform-native APIs, and Web Components. You champion efficiency and elegance.

CRITICAL - CONTEXT AWARENESS:
You are running directly inside a Chrome DevTools Side Panel. You have full access to inspect the user's current webpage.
- If the user asks ANY question about "this page", "the active tab", "the website", "my page", "the images on here", or asks you to "analyze/inspect/audit" anything, you MUST IMMEDIATELY call get_page_dom or get_inspected_element to retrieve the context of the user's page.
- Do NOT guess, assume, or explain page elements generically if the user is asking about the current page. First run the appropriate tool to get the actual DOM or computed styles, then make highly targeted, context-relevant recommendations.

INTERNAL MONOLOGUE & PLANS:
- At the start of EVERY turn (including the final response turn where you do not call any tools), you MUST always wrap your internal monologue, reasoning, or plan in \`<thought>\` and \`</thought>\` tags (e.g. \`<thought>I need to inspect the active page DOM to see how the testimonials structure is built and if there's any custom slide navigation script. Let's call get_page_dom.</thought>\`).
- This is critical because the user inspects your thought process to understand *why* you are calling specific tools and what your strategy is. If you do not wrap this explanation in these tags, it will flash in the main chat response area instead of being formatted in the thought log history.
- In your final response turn, immediately after closing the \`</thought>\` tag, you MUST output the separator \`===RESPONSE===\` on a line by itself before writing your actual user-facing response. For example:
  <thought>I have checked the active page DOM. I will formulate the response now.</thought>
  ===RESPONSE===
  Rawr! Dino here...
- This separator is critical to help our parser cleanly split your internal thinking from your user-facing output. NEVER omit this separator in your final response turn, and NEVER write user-facing message content before it.

PROACTIVE OVERRIDES, PREVIEWS & SUGGESTIONS:
- Whenever you recommend a code change or modernization solution for the user's page (e.g. replacing a legacy menu, adding a skip link, styling scrollbars), you MUST be proactive and offer options to the user as clickable suggestion buttons:
  - Output options using the custom suggestion format: \`[Button Label](suggest:User message to send)\`.
  - For example, you should write:
    - \`[✨ Apply Live Preview](suggest:Apply preview)\` to let the user trigger \`apply_preview\`.
    - \`[💾 Save as Permanent Override](suggest:Save it)\` to let the user trigger \`save_override\`.
- In general, whenever you present a list of choices or ask the user what to do next, present those choices as clickable suggestion buttons using the \`[Label](suggest:Reply text)\` format to make the chat highly interactive and delightful!
- If the user clicks a button, the system will automatically submit that text as their next message, which will trigger the corresponding tool (e.g., if you receive the message "Apply preview" or "Save it", call the corresponding tool).
- FORMATTING CRITICAL: Always group all suggestion buttons together at the very bottom of your response in a single, paragraph block of side-by-side buttons (e.g. \`[✨ Apply Live Preview](suggest:Apply preview) [💾 Save as Permanent Override](suggest:Save it)\`).
  - Do NOT put suggestion buttons inside bullet points, ordered lists, or unordered lists.
  - Do NOT add trailing explanatory text or descriptions after the suggestion buttons (let the buttons speak for themselves).
  - Do NOT offer suggestion buttons for inspecting elements (e.g., do not suggest "Inspect Element" or "Inspect Social Buttons") if those elements are already linked inline in your text using the \`[Link Text](inspect:CSS_SELECTOR)\` format.
  - Do NOT offer suggestion buttons for reading guides (e.g., do not suggest "Read accessibility guide" or "Open scrollbar guide") since all referenced guides are already automatically compiled and rendered as clickable "Modern Web Sources" citation badges at the bottom of your response bubble.
  - Do NOT offer generic suggestion buttons for asking another question (e.g., do not suggest "Ask Dino another question" or "Ask a new query") since the chat input box is always focused and ready for the user to type.

INSTRUCTIONS:
1. When asked about the current page, or how elements are implemented, or to audit a specific part, use your tools (like get_page_dom or get_inspected_element) to inspect the website context first!
2. Use search_use_cases and get_guide_content to find and refer to the official Modern Web Guidance guidelines. Do not guess the guidance code/fallbacks.
3. Be fun, punny, and high-energy. Keep the sass lighthearted and humorous, never condescending or rude to the user.
4. Keep answers concise and helpful. Dino keeps it snappy so the user can get back to building "Cretaceous-cool" or "Paleo-perfect" sites.
5. DO NOT introduce yourself (e.g., "I'm Dino", "My name is Dino") if the conversation is ongoing. Just jump straight into the conversation.
6. Provide code samples that are "so clean they'd make a Velociraptor proud."
7. Always prefer modern, platform-native solutions. Champion the platform with a wink and a pun.
8. Use markdown for formatting.
9. CRITICAL: Format your code over multiple lines with proper indentation. No "meteor-impact" minified code allowed.
10. All code samples MUST be fully realized, correct, production-ready, and functional. Do NOT include ellipses ("...") or placeholder comments representing omitted code.
11. HARDEN ACCESSIBILITY (a11y) IN CODE SUGGESTIONS:
    - NEVER suggest adding an interactive role (e.g. role="button", role="link", role="checkbox") to a generic non-interactive tag (e.g. <span>, <div>, <p>, <i>) without also including tabindex="0" and the required keyboard event listeners (like keydown or keypress for Space and Enter keys).
    - Prefer converting generic tags with click behaviors to native interactive semantic tags (e.g. convert a clickable <span> to a native <button>, or a clickable <div> with link properties to an <a> link) rather than just adding ARIA attributes.
    - Ensure all proposed <img> tags have alt attributes (e.g. alt="" for decorative images, or a descriptive alt string).
    - Ensure all proposed form inputs (input, textarea, select) have associated label markup or appropriate aria-label/aria-labelledby attributes.
12. Whenever you mention or recommend changes to a specific DOM element on the page, you can link to it using the format: [Link Text](inspect:CSS_SELECTOR). For example, to refer to the primary navigation block, write [nav.primary-menu](inspect:nav.primary-menu). The user will be able to click this link to instantly inspect that element in the DevTools Elements panel.
13. Whenever presenting choices, options, or asking what to do next, you should render those options as clickable suggestion buttons using the \`[Label](suggest:Reply text)\` format at the bottom of your response in a single paragraph block.
`;

async function runGeminiAgent(loggerId, startPrompt, systemInstruction, responseSchema) {
  if (isAborted) {
    throw new Error("Analysis aborted by user.");
  }
  if (!config.apiKey) {
    throw new Error("Gemini API Key is missing. Please set it in the Settings tab.");
  }

  const logLines = document.getElementById(`${loggerId}-log-lines`);
  if (logLines) {
    logLines.innerHTML = ""; // Clear logs
  }

  appendLog(loggerId, "Initializing Gemini Audit Agent...", "system");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;

  const tools = getEnabledTools();

  const history = [
    {
      role: "user",
      parts: [{ text: startPrompt }]
    }
  ];

  let loopCount = 0;
  let maxLoops = 30;

  while (true) {
    if (isAborted) {
      throw new Error("Analysis aborted by user.");
    }
    if (loopCount >= maxLoops) {
      const proceed = confirm(`Dino has executed ${maxLoops} tool calls. Do you want to allow another 30 tool executions?`);
      if (proceed) {
        maxLoops += 30;
      } else {
        throw new Error("Tool execution safety limit reached.");
      }
    }
    loopCount++;
    appendLog(loggerId, `Calling Gemini API (Turn ${loopCount})...`, "system");

    const requestBody = {
      contents: history,
      tools: tools,
      systemInstruction: {
        parts: [{ text: systemInstruction || GENERIC_SYSTEM_INSTRUCTION }]
      },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema || {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" },
              impact: {
                type: "STRING",
                enum: ["high", "medium", "low"]
              },
              useCaseId: { type: "STRING" },
              guideAnchor: { type: "STRING" },
              description: { type: "STRING" },
              target: { type: "STRING" },
              originalCode: { type: "STRING" },
              modernizedCode: { type: "STRING" }
            },
            required: ["title", "impact", "description", "target", "originalCode", "modernizedCode"]
          }
        }
      }
    };

    if (supportsThinking(config.model)) {
      requestBody.generationConfig.thinkingConfig = {
        thinkingBudget: 2048
      };
    }

    const historySummary = history.map(h => `${h.role} (${h.parts.map(p => Object.keys(p).join(',')).join(' | ')})`).join(' -> ');
    console.log("Request History:", historySummary);

    const debugBody = {
      contents: requestBody.contents.map(c => ({
        role: c.role,
        parts: c.parts.map(p => {
          const cp = { ...p };
          if (cp.functionResponse) {
            cp.functionResponse = {
              name: cp.functionResponse.name,
              id: cp.functionResponse.id,
              response: cp.functionResponse.response ? {
                result: {
                  url: cp.functionResponse.response.result?.url,
                  title: cp.functionResponse.response.result?.title,
                  cookieConfig: cp.functionResponse.response.result?.cookieConfig?.substring(0, 100),
                  domSummary: cp.functionResponse.response.result?.dom ? "DOM object present" : "No DOM"
                }
              } : null
            };
          }
          return cp;
        })
      }))
    };
    console.log("Request Body Debug:", debugBody);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: currentAbortController.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API returned error: ${response.status} - ${errorText}`);
    }

    const resJson = await response.json();
    const candidate = resJson.candidates[0];
    const rawModelContent = candidate.content;

    console.log("Raw Model Content:", rawModelContent);

    // SANITIZE MODEL CONTENT PARTS: Remove non-standard keys except thoughtSignature
    const sanitizedParts = rawModelContent.parts.map(p => {
      const cleanPart = {};
      if (p.text !== undefined) cleanPart.text = p.text;
      if (p.functionCall !== undefined) {
        cleanPart.functionCall = {
          name: p.functionCall.name,
          args: p.functionCall.args || {}
        };
      }
      if (p.thoughtSignature !== undefined) {
        cleanPart.thoughtSignature = p.thoughtSignature;
      }
      return cleanPart;
    }).filter(p => Object.keys(p).length > 0);

    const modelContent = {
      role: "model",
      parts: sanitizedParts
    };

    history.push(modelContent);

    if (!modelContent.parts || modelContent.parts.length === 0) {
      throw new Error("Received empty or unrecognized content response from Gemini model.");
    }

    const functionCalls = modelContent.parts.filter(p => p.functionCall);

    if (functionCalls.length > 0) {
      if (isAborted) {
        throw new Error("Analysis aborted by user.");
      }

      const responseParts = [];
      for (const fc of functionCalls) {
        const { name, args } = fc.functionCall;
        appendLog(loggerId, `Model requested tool execution: ${name}(${JSON.stringify(args || {})})`, "agent");

        let toolResult;
        try {
          if (name === "search_use_cases") {
            toolResult = await searchUseCases(args.query);
            appendLog(loggerId, `Tool output: Found ${toolResult.length} matching guides for query "${args.query}".`, "tool");
          } else if (name === "list_categories") {
            toolResult = await listCategories();
            appendLog(loggerId, `Tool output: Returned ${toolResult.length} categories.`, "tool");
          } else if (name === "list_use_cases") {
            toolResult = await listUseCases(args.category);
            appendLog(loggerId, `Tool output: Returned ${toolResult.length} use cases.`, "tool");
          } else if (name === "get_guide_content") {
            toolResult = await getGuideContent(args.useCaseId);
            appendLog(loggerId, `Tool output: Loaded guide content for "${args.useCaseId}".`, "tool");
          } else if (name === "get_page_dom") {
            toolResult = await getPageDOM();
            appendLog(loggerId, `Tool output: Captured active page DOM.`, "tool");
          } else if (name === "get_inspected_element") {
            toolResult = await getInspectedElement();
            appendLog(loggerId, `Tool output: Captured DevTools selected element.`, "tool");
          } else if (name === "click_element") {
            toolResult = await clickElement(args.selector);
            appendLog(loggerId, `Tool output: Clicked element matching "${args.selector}".`, "tool");
          } else if (name === "type_text") {
            toolResult = await typeText(args.selector, args.text);
            appendLog(loggerId, `Tool output: Typed in element matching "${args.selector}".`, "tool");
          } else if (name === "hover_element") {
            toolResult = await hoverElement(args.selector);
            appendLog(loggerId, `Tool output: Hovered element matching "${args.selector}".`, "tool");
          } else if (name === "get_element_info") {
            toolResult = await getElementInfo(args.selector, args.computedProperties);
            appendLog(loggerId, `Tool output: Retrieved info for element matching "${args.selector}".`, "tool");
          } else if (name === "get_console_logs") {
            toolResult = await getConsoleLogs();
            appendLog(loggerId, `Tool output: Captured ${toolResult.length} console logs.`, "tool");
          } else if (name === "scroll_element") {
            toolResult = await scrollElement(args.selector, args.left, args.top, args.behavior);
            appendLog(loggerId, `Tool output: Scrolled element matching "${args.selector}".`, "tool");
          } else if (name === "press_key") {
            toolResult = await pressKey(args.selector, args.key);
            appendLog(loggerId, `Tool output: Pressed key "${args.key}" on element matching "${args.selector}".`, "tool");
          } else {
            throw new Error(`Unknown function call: ${name}`);
          }
        } catch (err) {
          console.error("Tool execution failed:", err);
          toolResult = { error: err.message };
          appendLog(loggerId, `Tool output: Execution failed (${err.message})`, "system");
        }

        console.log("Pushing Tool Result:", toolResult);

        responseParts.push({
          functionResponse: {
            name: name,
            response: { result: toolResult }
          }
        });
      }

      history.push({
        role: "user",
        parts: responseParts
      });
    } else {
      // Final text response reached
      appendLog(loggerId, "Analysis completed! Parsing results...", "system");
      
      const textParts = modelContent.parts.filter(p => p.text !== undefined).map(p => p.text).join("\n").trim();
      if (!textParts) {
        throw new Error("Received empty or unrecognized content response from Gemini model.");
      }

      try {
        const firstBracket = textParts.indexOf("[");
        const firstBrace = textParts.indexOf("{");
        
        let startIdx = -1;
        let endChar = "";
        
        if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
          startIdx = firstBracket;
          endChar = "]";
        } else if (firstBrace !== -1) {
          startIdx = firstBrace;
          endChar = "}";
        }
        
        if (startIdx === -1) {
          throw new Error("No JSON structure found in output text");
        }
        
        const endIdx = textParts.lastIndexOf(endChar);
        if (endIdx <= startIdx) {
          throw new Error("Mismatched brackets or braces in output");
        }
        
        const jsonText = textParts.substring(startIdx, endIdx + 1);
        const parsed = JSON.parse(jsonText);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch (err) {
        console.error("Failed to parse Gemini output text to JSON:", textParts, err);
        throw new Error(`Final report did not conform to JSON format: ${err.message}. Raw output: ${textParts.substring(0, 300)}`);
      }
    }
  }
}

function appendLog(loggerId, message, sender = "system") {
  const logDiv = document.getElementById(`${loggerId}-log-lines`);
  if (!logDiv) return;
  const line = document.createElement("div");
  line.className = `log-line ${sender}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logDiv.appendChild(line);
  logDiv.scrollTop = logDiv.scrollHeight;
}

// Dino Chat API functions
async function runDinoGreeting() {
  if (!config.apiKey) {
    return "Rawr! Dino here! Set up your Gemini API Key in Settings to get started, and I'll help you modernise your prehistoric web apps!";
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
  const systemPrompt = `You are Dino, a sassy and pun-loving Modern Web development assistant.
Your job is to provide a short, snappy, and high-energy initial greeting for a new chat session.

STRICT RULES:
1. ALWAYS introduce yourself by name (e.g., "I'm Dino!", "Dino here!", "Rex here to help!").
2. BE CREATIVE with dinosaur puns and modern web references.
3. Output ONLY the greeting text. No markdown (unless for emphasis/bold).
4. Keep it under 200 characters.
5. Example: "Rawr! Dino here! I've risen from the fossils to help you build some Cretaceous-cool sites! What modern web magic are we hatching today?"`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Give me a fresh, punny Dino greeting where you introduce yourself." }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const greeting = text.trim().replace(/^"/, '').replace(/"$/, '');
    return appendAuditSuggestions(greeting);
  } catch (err) {
    console.warn("Failed to generate Dino greeting dynamically:", err);
    return appendAuditSuggestions("Rawr! I'm Dino. I've risen from the fossils to help you build modern web apps. What can I help you with today?");
  }
}

function appendAuditSuggestions(greetingText) {
  return `${greetingText}\n\nFeel free to ask me any open questions about this page, or get started with one of these audits:\n\n[🔍 Audit Accessibility](suggest:Audit the page for accessibility) [⚡ Audit Performance](suggest:Audit the page for performance) [🛡️ Audit Privacy & Security](suggest:Audit the page for privacy and security)`;
}

async function runDinoAuditResultGreeting(opp) {
  if (!config.apiKey) {
    return `Rawr! Dino here! 🦖 I see you have a question about the modernization opportunity: **${opp.title}**. Set up your Gemini API Key in Settings to get started!`;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
  const systemPrompt = `You are Dino, a sassy and pun-loving Modern Web development assistant.
Your job is to provide a short, snappy, and high-energy initial greeting for a new chat session where the user wants to ask about a specific modernization audit result.

STRICT RULES:
1. ALWAYS introduce yourself by name (e.g., "I'm Dino!", "Dino here!", "Rex here to help!").
2. Reference the audit result title "${opp.title.replace(/"/g, '\\"')}" and target element "${(opp.target || 'document').replace(/"/g, '\\"')}" to show you have context.
3. BE CREATIVE with dinosaur puns and modern web references.
4. Encourage the user to ask a question or use the suggestion buttons.
5. End your message with EXACTLY these suggestion buttons on their own line at the bottom:
[🛠️ How do I fix this?](suggest:How do I fix this modernization issue?) [❓ Why is this an issue?](suggest:Why is this considered a legacy issue?) [🧪 How should I test it?](suggest:How do I test if this is successfully fixed?)
6. Keep the greeting text under 300 characters.`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Acknowledge that I want to ask a question about the audit result: "${opp.title.replace(/"/g, '\\"')}".` }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return text.trim().replace(/^"/, '').replace(/"$/, '');
  } catch (err) {
    console.warn("Failed to generate Dino audit greeting dynamically:", err);
    return `Rawr! Dino here! 🦖 I see you have a question about the modernization opportunity: **${opp.title}** (Target: \`${opp.target || 'document'}\`). Let's get this prehistoric pattern modernised! What would you like to know?\n\n[🛠️ How do I fix this?](suggest:How do I fix this modernization issue?) [❓ Why is this an issue?](suggest:Why is this considered a legacy issue?) [🧪 How should I test it?](suggest:How do I test if this is successfully fixed?)`;
  }
}

async function runDinoChatAgent(userMessage, chatHistory, onStepUpdate, onTextStream) {
  if (isAborted) {
    throw new Error("Chat aborted by user.");
  }
  if (!config.apiKey) {
    throw new Error("Gemini API Key is missing. Please set it in the Settings tab.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:streamGenerateContent?key=${config.apiKey}&alt=sse`;

  const contents = [
    ...chatHistory.map(h => ({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: h.content }]
    })),
    {
      role: "user",
      parts: [{ text: userMessage }]
    }
  ];

  const tools = getEnabledTools();

  const citations = [];
  const seenCitations = new Set();
  const steps = [];
  const triggerUpdate = () => onStepUpdate([...steps]);

  let loopCount = 0;
  let maxLoops = 30;

  while (true) {
    if (isAborted) {
      throw new Error("Chat aborted by user.");
    }
    if (loopCount >= maxLoops) {
      const proceed = confirm(`Dino has executed ${maxLoops} tool calls. Do you want to allow another 30 tool executions?`);
      if (proceed) {
        maxLoops += 30;
      } else {
        throw new Error("Tool execution safety limit reached.");
      }
    }
    loopCount++;

    let customSystemInstruction = DINO_CHAT_SYSTEM_INSTRUCTION;
    if (supportsThinking(config.model)) {
      customSystemInstruction += "\n\n- NATIVE THINKING CONFIGURATION ENABLED: Do NOT output manual `<thought>` or `===RESPONSE===` tags in your text response. Your internal planning/monologue is handled automatically by the API's thinking configuration. Write only your final user-facing markdown response.";
    } else {
      customSystemInstruction += "\n\n- INTERNAL MONOLOGUE & PLANS: At the start of your turn, wrap your internal planning monologue in `<thought>` and `</thought>` tags. Immediately after the closing tag, write the separator `===RESPONSE===` on a line by itself before writing your response.";
    }

    const requestBody = {
      contents: contents,
      tools: tools,
      systemInstruction: {
        parts: [{ text: customSystemInstruction }]
      },
      generationConfig: {}
    };

    if (supportsThinking(config.model)) {
      requestBody.generationConfig.thinkingConfig = {
        includeThoughts: true
      };
    }

    console.log(`[Dino Chat Agent] Turn ${loopCount} Request Contents:`, JSON.parse(JSON.stringify(contents)));

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: currentAbortController.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API returned error: ${response.status} - ${errorText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    const accumulatedParts = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) {
          const jsonStr = trimmed.substring(5).trim();
          try {
            const chunkJson = JSON.parse(jsonStr);
            const chunkParts = chunkJson.candidates?.[0]?.content?.parts || [];

            for (const p of chunkParts) {
              let processed = false;

              if (p.text !== undefined) {
                const isThought = p.thought === true;
                const lastPart = accumulatedParts[accumulatedParts.length - 1];
                if (lastPart && lastPart.text !== undefined && !!lastPart.thought === isThought) {
                  lastPart.text += p.text;
                } else {
                  accumulatedParts.push({ text: p.text, thought: p.thought });
                }

                const activePart = accumulatedParts[accumulatedParts.length - 1];
                if (p.thought_signature !== undefined) activePart.thought_signature = p.thought_signature;
                if (p.thoughtSignature !== undefined) activePart.thoughtSignature = p.thoughtSignature;
                if (p.thought !== undefined) activePart.thought = p.thought;

                if (isThought) {
                  let thoughtStep = steps.find(s => s.type === 'thought' && s.status === 'running');
                  if (!thoughtStep) {
                    thoughtStep = {
                      type: 'thought',
                      title: 'Thinking',
                      details: "",
                      status: 'running'
                    };
                    steps.push(thoughtStep);
                  }
                  thoughtStep.details += p.text;
                  triggerUpdate();
                } else {
                  // Mark any running thought step as completed
                  steps.forEach(s => {
                    if (s.type === 'thought' && s.status === 'running') {
                      s.status = 'completed';
                    }
                  });
                  triggerUpdate();

                  // Stream text chunk if no function calls have been generated in this turn so far
                  if (!accumulatedParts.some(x => x.functionCall)) {
                    onTextStream(p.text);
                  }
                }
                processed = true;
              }

              if (p.functionCall !== undefined) {
                const lastPart = accumulatedParts[accumulatedParts.length - 1];
                const isSameFunction = lastPart && lastPart.functionCall !== undefined &&
                  (!p.functionCall.name || lastPart.functionCall.name === p.functionCall.name);

                if (isSameFunction) {
                  if (p.functionCall.name) lastPart.functionCall.name = p.functionCall.name;
                  if (p.functionCall.args) {
                    lastPart.functionCall.args = {
                      ...(lastPart.functionCall.args || {}),
                      ...p.functionCall.args
                    };
                  }
                } else {
                  accumulatedParts.push({
                    functionCall: {
                      name: p.functionCall.name,
                      args: p.functionCall.args || {}
                    }
                  });
                }

                const activePart = accumulatedParts[accumulatedParts.length - 1];
                if (p.thought_signature !== undefined) activePart.thought_signature = p.thought_signature;
                if (p.thoughtSignature !== undefined) activePart.thoughtSignature = p.thoughtSignature;
                if (p.thought !== undefined) activePart.thought = p.thought;
                processed = true;
              }

              if (!processed) {
                if (p.thought_signature !== undefined || p.thoughtSignature !== undefined || p.thought !== undefined) {
                  const newPart = {};
                  if (p.thought_signature !== undefined) newPart.thought_signature = p.thought_signature;
                  if (p.thoughtSignature !== undefined) newPart.thoughtSignature = p.thoughtSignature;
                  if (p.thought !== undefined) newPart.thought = p.thought;
                  accumulatedParts.push(newPart);
                }
              }
            }
          } catch (e) {
            console.error("Failed to parse stream chunk:", jsonStr, e);
          }
        }
      }
    }

    const sanitizedParts = accumulatedParts.map(p => {
      const cleanPart = {};
      if (p.text !== undefined) cleanPart.text = p.text;
      if (p.functionCall !== undefined) {
        cleanPart.functionCall = {
          name: p.functionCall.name,
          args: p.functionCall.args || {}
        };
      }
      if (p.thought_signature !== undefined) {
        cleanPart.thought_signature = p.thought_signature;
      }
      if (p.thoughtSignature !== undefined) {
        cleanPart.thoughtSignature = p.thoughtSignature;
      }
      if (p.thought !== undefined) {
        cleanPart.thought = p.thought;
      }
      return cleanPart;
    }).filter(p => Object.keys(p).length > 0);

    const modelContent = {
      role: "model",
      parts: sanitizedParts
    };

    contents.push(modelContent);

    if (!modelContent.parts || modelContent.parts.length === 0) {
      throw new Error("Received empty or unrecognized response from Gemini.");
    }

    const functionCalls = modelContent.parts.filter(p => p.functionCall);

    // Capture thought/reasoning text if present (extracting from explicit thought fields or <thought> tags)
    const thoughts = [];
    if (supportsThinking(config.model)) {
      // Native thinking: thoughts are already streamed and added to steps in the reader loop.
      // We just collect them from modelContent.parts for logging history
      for (const p of modelContent.parts) {
        if (p.thought) {
          const tText = (typeof p.thought === "string") ? p.thought : (p.text || "");
          if (tText.trim()) {
            thoughts.push(tText.trim());
          }
        }
      }
    } else {
      // Fallback XML parsing
      for (const p of modelContent.parts) {
        if (p.text) {
          const parsed = parseThoughtAndContent(p.text);
          if (parsed.thoughts) {
            thoughts.push(parsed.thoughts);
          }
        }
      }
      for (const t of thoughts) {
        if (!steps.some(s => s.type === 'thought' && s.details === t)) {
          steps.push({
            type: 'thought',
            title: 'Thinking',
            details: t,
            status: 'completed'
          });
        }
      }
    }

    if (thoughts.length > 0) {
      triggerUpdate();
    }

    if (functionCalls.length > 0) {
      console.log(`[Dino Chat Agent] Turn ${loopCount} Model requested function execution:`, functionCalls);
      const responseParts = [];
      for (const fc of functionCalls) {
        const { name, args } = fc.functionCall;
        
        let statusMsg = `Running tool ${name}...`;
        if (name === "search_use_cases") statusMsg = `Searching guides for "${args.query}"...`;
        else if (name === "get_guide_content") statusMsg = `Reading guide "${args.useCaseId}"...`;
        else if (name === "get_page_dom") statusMsg = "Reading active page DOM...";
        else if (name === "get_inspected_element") statusMsg = "Inspecting selected element...";
        else if (name === "click_element") statusMsg = `Clicking element "${args.selector}"...`;
        else if (name === "type_text") statusMsg = `Typing into element "${args.selector}"...`;
        else if (name === "hover_element") statusMsg = `Hovering element "${args.selector}"...`;
        else if (name === "get_element_info") statusMsg = `Retrieving details for element "${args.selector}"...`;
        else if (name === "get_console_logs") statusMsg = "Reading console logs...";
        else if (name === "scroll_element") statusMsg = `Scrolling element "${args.selector}"...`;
        else if (name === "press_key") statusMsg = `Pressing key "${args.key}" on element "${args.selector}"...`;
        else if (name === "apply_preview") statusMsg = "Applying live preview to tab...";
        else if (name === "save_override") statusMsg = "Saving local override to disk...";

        const currentStep = {
          type: 'tool',
          name: name,
          args: args,
          title: statusMsg,
          status: 'running'
        };
        steps.push(currentStep);
        triggerUpdate();

        let toolResult;
        try {
          if (name === "search_use_cases") {
            toolResult = await searchUseCases(args.query);
          } else if (name === "list_categories") {
            toolResult = await listCategories();
          } else if (name === "list_use_cases") {
            toolResult = await listUseCases(args.category);
          } else if (name === "get_guide_content") {
            toolResult = await getGuideContent(args.useCaseId);
            
            if (!seenCitations.has(args.useCaseId)) {
              seenCitations.add(args.useCaseId);
              let title = args.useCaseId;
              const titleMatch = toolResult.match(/^#\s+(.+)$/m);
              if (titleMatch) title = titleMatch[1].trim();
              
              const uc = useCasesCache.find(u => u.id === args.useCaseId);
              citations.push({
                id: args.useCaseId,
                title: title,
                description: uc ? uc.description : ""
              });
            }
          } else if (name === "get_page_dom") {
            toolResult = await getPageDOM();
          } else if (name === "get_inspected_element") {
            toolResult = await getInspectedElement();
          } else if (name === "click_element") {
            toolResult = await clickElement(args.selector);
          } else if (name === "type_text") {
            toolResult = await typeText(args.selector, args.text);
          } else if (name === "hover_element") {
            toolResult = await hoverElement(args.selector);
          } else if (name === "get_element_info") {
            toolResult = await getElementInfo(args.selector, args.computedProperties);
          } else if (name === "get_console_logs") {
            toolResult = await getConsoleLogs();
          } else if (name === "scroll_element") {
            toolResult = await scrollElement(args.selector, args.left, args.top, args.behavior);
          } else if (name === "press_key") {
            toolResult = await pressKey(args.selector, args.key);
          } else if (name === "apply_preview") {
            toolResult = await applyPreview({
              target: args.selector,
              modernizedCode: args.modernizedCode,
              originalCode: args.originalCode
            }, null);
          } else if (name === "save_override") {
            toolResult = await saveOverride({
              originalCode: args.originalCode,
              modernizedCode: args.modernizedCode
            });
          } else {
            throw new Error(`Unknown function call: ${name}`);
          }
          currentStep.status = 'completed';
          currentStep.result = toolResult;
          triggerUpdate();
        } catch (err) {
          console.error("Tool execution failed:", err);
          toolResult = { error: err.message };
          currentStep.status = 'failed';
          currentStep.error = err.message;
          triggerUpdate();
        }

        responseParts.push({
          functionResponse: {
            name: name,
            response: { result: toolResult }
          }
        });
      }

      contents.push({
        role: "user",
        parts: responseParts
      });
    } else {
      // Final text response reached
      const finalThoughts = [];
      const finalResponseParts = [];
      if (supportsThinking(config.model)) {
        for (const p of modelContent.parts) {
          if (p.thought) {
            const tText = (typeof p.thought === "string") ? p.thought : (p.text || "");
            if (tText.trim()) {
              finalThoughts.push(tText.trim());
            }
          } else if (p.text) {
            finalResponseParts.push(p.text);
          }
        }
      } else {
        for (const p of modelContent.parts) {
          if (p.text) {
            const parsed = parseThoughtAndContent(p.text);
            if (parsed.thoughts) {
              finalThoughts.push(parsed.thoughts);
            }
            finalResponseParts.push(parsed.response);
          }
        }
        for (const t of finalThoughts) {
          if (!steps.some(s => s.type === 'thought' && s.details === t)) {
            steps.push({
              type: 'thought',
              title: 'Thinking',
              details: t,
              status: 'completed'
            });
          }
        }
        if (finalThoughts.length > 0) {
          triggerUpdate();
        }
      }

      const textResponse = finalResponseParts.join("\n").trim();
      return { response: textResponse, citations };
    }
  }
}

