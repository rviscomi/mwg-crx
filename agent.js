// Gemini REST Orchestrator and Agentic Tool-Calling Loop
let isAborted = false;
let currentAbortController = null;

const GENERIC_SYSTEM_INSTRUCTION = `
You are a Senior Frontend Architect and an expert Auditor specializing in modernizing legacy web codebases.
Your task is to audit a production website's DOM structure and console warnings, identify modernization opportunities, and recommend best practices. You should prioritize matching and loading the Modern Web Guidance (MWG) guides using the provided tools, but you may also identify foundational web issues not covered by specific guides.

Guidelines:
1. Inspect the page DOM structure or target element to identify potential legacy web patterns, and then use semantic search (search_use_cases) or list_use_cases to discover matching guidelines.
2. For modern web APIs and advanced patterns, you MUST retrieve the guide content for the relevant use cases using get_guide_content and use only the patterns defined inside those guides. However, for basic, foundational web development best practices (e.g., standard accessibility principles like image alt attributes, basic semantic HTML structure, basic forms, or standard security headers), you may also use your general training knowledge to recommend standard best practices when there is no matching MWG guide.
3. Keep suggestions actionable. If you identify a modernization opportunity, you must provide:
   - The element or file targeted.
   - The specific issue (e.g. "Uses custom JS scroll listener for scrollbar adjustments").
   - The MWG guide ID matches.
   - The modern recommended solution (e.g. "Use scrollbar-color CSS property").
   - A side-by-side code diff (original legacy vs modernized). Both originalCode and modernizedCode MUST use the same language and syntax context (e.g. HTML vs HTML, CSS vs CSS, JS vs JS). Do not mix HTML on one side and CSS on the other.
   - Both originalCode and modernizedCode MUST be fully realized, production-ready code specifically tailored to the audited page's actual elements, content, and structure. They MUST NOT contain ellipses ("..."), placeholder text, or comments representing omitted code. Every snippet must be immediately applicable and functional.
4. Output your final report STRICTLY as a JSON array of opportunity objects. DO NOT wrap the JSON in Markdown code fences except if required by the schema, and do not write conversational text.

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
Your task is to perform a targeted audit of a production website's DOM structure for a specific category of guidelines (e.g., accessibility or performance).
You must learn the best practices and recommendations from the guidelines first, and then check the page's DOM for adherence to those guidelines as well as general, foundational best practices for that category.

Guidelines:
1. First, call list_use_cases with the specified category (or categories) to discover all available use case IDs in that focus area.
2. You MUST call get_guide_content for the relevant use cases to retrieve and read their full guide content. Learn the modern recommended patterns, requirements, and fallback options. Do NOT proceed to the DOM until you have loaded the guide content.
3. Retrieve the simplified page DOM using get_page_dom.
4. Audit the DOM specifically to check if the page's elements and structures adhere to the lessons and patterns from the loaded guides, as well as general foundational best practices for this focus area.
5. If the DOM fails to conform, or if there is a clear opportunity to apply the modern standard recommendation or standard foundational practice, list it in your report.
6. For modern web APIs and advanced patterns, you MUST retrieve the guide content for the relevant use cases using get_guide_content and use only the patterns defined inside those guides. However, for basic, foundational web development best practices (e.g., standard accessibility principles like image alt attributes, basic semantic HTML structure, basic forms, or standard security headers), you may also use your general training knowledge to recommend standard best practices when there is no matching MWG guide.
7. Keep suggestions actionable. If you identify a modernization opportunity, you must provide:
   - The element or file targeted.
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

const INSPECT_SYSTEM_INSTRUCTION = `
You are a Senior Frontend Architect and an expert Auditor specializing in modernizing legacy web codebases.
Your task is to analyze a single DOM element selected in DevTools (along with its computed styles) and recommend modern web APIs and CSS techniques that apply to it.

Guidelines:
1. Examine the selected element's HTML tag, properties, and computed styles.
2. Use semantic search (search_use_cases) or list_use_cases to locate relevant Modern Web Guidance (MWG) guidelines that match this element's purpose, design patterns, or style properties.
3. You MUST retrieve the guide content for the relevant use cases you want to recommend using get_guide_content to verify details and syntax.
4. Recommend modernization opportunities ONLY if they directly apply to this specific element. If no guidelines apply to this element, return an empty array [].
5. For modern web APIs and advanced patterns, you MUST retrieve the guide content for the relevant use cases using get_guide_content and use only the patterns defined inside those guides. However, for basic, foundational web development best practices (e.g., standard accessibility principles like image alt attributes, basic semantic HTML structure, basic forms, or standard security headers), you may also use your general training knowledge to recommend standard best practices when there is no matching MWG guide.
6. Keep suggestions actionable. If you identify a modernization opportunity, you must provide:
   - The element targeted.
   - The specific issue.
   - The MWG guide ID matches.
   - The modern recommended solution.
   - A side-by-side code diff (original legacy vs modernized). Both originalCode and modernizedCode MUST use the same language and syntax context (e.g. HTML vs HTML, CSS vs CSS, JS vs JS). Do not mix HTML on one side and CSS on the other.
   - Both originalCode and modernizedCode MUST be fully realized, production-ready code specifically tailored to the audited page's actual elements, content, and structure. They MUST NOT contain ellipses ("..."), placeholder text, or comments representing omitted code. Every snippet must be immediately applicable and functional.
7. Output your final report STRICTLY as a JSON array of opportunity objects. DO NOT wrap the JSON in Markdown code fences except if required by the schema, and do not write conversational text.

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
You ALSO have the ability to apply live code previews to the user's active tab and write persistent local overrides directly to their source files using tools.

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
11. Whenever you mention or recommend changes to a specific DOM element on the page, you can link to it using the format: [Link Text](inspect:CSS_SELECTOR). For example, to refer to the primary navigation block, write [nav.primary-menu](inspect:nav.primary-menu). The user will be able to click this link to instantly inspect that element in the DevTools Elements panel.
12. Whenever presenting choices, options, or asking what to do next, you should render those options as clickable suggestion buttons using the \`[Label](suggest:Reply text)\` format at the bottom of your response in a single paragraph block.
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

  const tools = [
    {
      functionDeclarations: [
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
        }
      ]
    }
  ];

  const history = [
    {
      role: "user",
      parts: [{ text: startPrompt }]
    }
  ];

  let loopCount = 0;
  const maxLoops = 15;

  while (loopCount < maxLoops) {
    if (isAborted) {
      throw new Error("Analysis aborted by user.");
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

  throw new Error("Exceeded maximum execution turn limit.");
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

async function runDinoChatAgent(userMessage, chatHistory, onStatus) {
  if (isAborted) {
    throw new Error("Chat aborted by user.");
  }
  if (!config.apiKey) {
    throw new Error("Gemini API Key is missing. Please set it in the Settings tab.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;

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

  const tools = [
    {
      functionDeclarations: [
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
      ]
    }
  ];

  const citations = [];
  const seenCitations = new Set();

  let loopCount = 0;
  const maxLoops = 15;

  while (loopCount < maxLoops) {
    if (isAborted) {
      throw new Error("Chat aborted by user.");
    }
    loopCount++;

    const requestBody = {
      contents: contents,
      tools: tools,
      systemInstruction: {
        parts: [{ text: DINO_CHAT_SYSTEM_INSTRUCTION }]
      }
    };

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

    const resJson = await response.json();
    console.log(`[Dino Chat Agent] Turn ${loopCount} Response Json:`, resJson);
    const candidate = resJson.candidates[0];
    const rawModelContent = candidate.content;

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

    contents.push(modelContent);

    if (!modelContent.parts || modelContent.parts.length === 0) {
      throw new Error("Received empty or unrecognized response from Gemini.");
    }

    const functionCalls = modelContent.parts.filter(p => p.functionCall);

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
        else if (name === "apply_preview") statusMsg = "Applying live preview to tab...";
        else if (name === "save_override") statusMsg = "Saving local override to disk...";
        onStatus(statusMsg);

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
        } catch (err) {
          console.error("Tool execution failed:", err);
          toolResult = { error: err.message };
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
      const textResponse = modelContent.parts.filter(p => p.text !== undefined).map(p => p.text).join("\n").trim();
      return { response: textResponse, citations };
    }
  }

  throw new Error("Exceeded maximum execution turn limit.");
}

