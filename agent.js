// Gemini REST Orchestrator and Agentic Tool-Calling Loop
let isAborted = false;
let currentAbortController = null;

const GENERIC_SYSTEM_INSTRUCTION = `
You are a Senior Frontend Architect and an expert Auditor specializing in modernizing legacy web codebases.
Your task is to audit a production website's DOM structure and console warnings, identify modernization opportunities, and recommend best practices using exclusively the tools provided to discover and load matching Modern Web Guidance (MWG) guides.

Guidelines:
1. Inspect the page DOM structure or target element to identify potential legacy web patterns, and then use semantic search (search_use_cases) or list_use_cases to discover matching guidelines.
2. You MUST retrieve the guide content for the relevant use cases you want to recommend using get_guide_content. DO NOT hallucinate best practices. Only use recommendations and patterns defined inside the guides you retrieved.
3. Keep suggestions actionable. If you identify a modernization opportunity, you must provide:
   - The element or file targeted.
   - The specific issue (e.g. "Uses custom JS scroll listener for scrollbar adjustments").
   - The MWG guide ID matches.
   - The modern recommended solution (e.g. "Use scrollbar-color CSS property").
   - A side-by-side code diff (original legacy vs modernized). Both originalCode and modernizedCode MUST use the same language and syntax context (e.g. HTML vs HTML, CSS vs CSS, JS vs JS). Do not mix HTML on one side and CSS on the other.
4. Output your final report STRICTLY as a JSON array of opportunity objects. DO NOT wrap the JSON in Markdown code fences except if required by the schema, and do not write conversational text.

Output JSON Format Schema:
[
  {
    "title": "Short title describing opportunity",
    "impact": "high" | "medium" | "low",
    "useCaseId": "matching-use-case-id",
    "description": "Explanatory text showing why this is an issue and how the modern API solves it.",
    "target": "CSS Selector or descriptive label of the target element/module",
    "originalCode": "Original/legacy HTML/CSS/JS snippet",
    "modernizedCode": "Modernized implementation snippet"
  }
]
`;

const FOCUSED_SYSTEM_INSTRUCTION = `
You are a Senior Frontend Architect and an expert Auditor specializing in modernizing legacy web codebases.
Your task is to perform a targeted audit of a production website's DOM structure for a specific category of guidelines (e.g., accessibility or performance).
You must learn the best practices and recommendations from the guidelines first, and then check the page's DOM for adherence to those specific guidelines.

Guidelines:
1. First, call list_use_cases with the specified category (or categories) to discover all available use case IDs in that focus area.
2. You MUST call get_guide_content for the relevant use cases to retrieve and read their full guide content. Learn the modern recommended patterns, requirements, and fallback options. Do NOT proceed to the DOM until you have loaded the guide content.
3. Retrieve the simplified page DOM using get_page_dom.
4. Audit the DOM specifically to check if the page's elements and structures adhere to the lessons and patterns from the loaded guides.
5. If the DOM fails to conform, or if there is a clear opportunity to apply the modern standard recommendation, list it in your report.
6. DO NOT hallucinate best practices. Only use recommendations and patterns defined inside the guides you retrieved.
7. Keep suggestions actionable. If you identify a modernization opportunity, you must provide:
   - The element or file targeted.
   - The specific issue.
   - The MWG guide ID matches.
   - The modern recommended solution.
   - A side-by-side code diff (original legacy vs modernized). Both originalCode and modernizedCode MUST use the same language and syntax context (e.g. HTML vs HTML, CSS vs CSS, JS vs JS). Do not mix HTML on one side and CSS on the other.
8. Output your final report STRICTLY as a JSON array of opportunity objects. DO NOT wrap the JSON in Markdown code fences except if required by the schema, and do not write conversational text.

Output JSON Format Schema:
[
  {
    "title": "Short title describing opportunity",
    "impact": "high" | "medium" | "low",
    "useCaseId": "matching-use-case-id",
    "description": "Explanatory text showing why this is an issue and how the modern API solves it.",
    "target": "CSS Selector or descriptive label of the target element/module",
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
5. DO NOT hallucinate best practices. Only use recommendations and patterns defined inside the guides you retrieved.
6. Keep suggestions actionable. If you identify a modernization opportunity, you must provide:
   - The element targeted.
   - The specific issue.
   - The MWG guide ID matches.
   - The modern recommended solution.
   - A side-by-side code diff (original legacy vs modernized). Both originalCode and modernizedCode MUST use the same language and syntax context (e.g. HTML vs HTML, CSS vs CSS, JS vs JS). Do not mix HTML on one side and CSS on the other.
7. Output your final report STRICTLY as a JSON array of opportunity objects. DO NOT wrap the JSON in Markdown code fences except if required by the schema, and do not write conversational text.

Output JSON Format Schema:
[
  {
    "title": "Short title describing opportunity",
    "impact": "high" | "medium" | "low",
    "useCaseId": "matching-use-case-id",
    "description": "Explanatory text showing why this is an issue and how the modern API solves it.",
    "target": "CSS Selector or descriptive label of the target element/module",
    "originalCode": "Original/legacy HTML/CSS/JS snippet",
    "modernizedCode": "Modernized implementation snippet"
  }
]
`;

async function runGeminiAgent(loggerId, startPrompt, systemInstruction) {
  if (isAborted) {
    throw new Error("Analysis aborted by user.");
  }
  if (!config.apiKey) {
    throw new Error("Gemini API Key is missing. Please set it in the Settings tab.");
  }

  const logLines = document.getElementById(`${loggerId}-log-lines`);
  logLines.innerHTML = ""; // Clear logs

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
      }
    };

    const historySummary = history.map(h => `${h.role} (${h.parts.map(p => Object.keys(p).join(',')).join(' | ')})`).join(' -> ');
    appendLog(loggerId, `Request History: ${historySummary}`, "system");

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
    appendLog(loggerId, `Request Body Debug: ${JSON.stringify(debugBody)}`, "system");

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

    appendLog(loggerId, `Raw Model Content: ${JSON.stringify(rawModelContent)}`, "system");

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
    const part = modelContent.parts[0];

    if (!part) {
      throw new Error("Received empty or unrecognized content response from Gemini model.");
    }

    // Check if the model called a function
    if (part.functionCall) {
      if (isAborted) {
        throw new Error("Analysis aborted by user.");
      }
      const { name, args } = part.functionCall;
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

      appendLog(loggerId, `Pushing Tool Result: ${JSON.stringify(toolResult).substring(0, 120)}...`, "system");

      const responsePart = {
        functionResponse: {
          name: name,
          response: { result: toolResult }
        }
      };

      history.push({
        role: "user",
        parts: [responsePart]
      });
    } else {
      // Final text response reached
      appendLog(loggerId, "Analysis completed! Parsing results...", "system");
      try {
        const text = part.text.trim();
        const firstBracket = text.indexOf("[");
        const firstBrace = text.indexOf("{");
        
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
        
        const endIdx = text.lastIndexOf(endChar);
        if (endIdx <= startIdx) {
          throw new Error("Mismatched brackets or braces in output");
        }
        
        const jsonText = text.substring(startIdx, endIdx + 1);
        const parsed = JSON.parse(jsonText);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch (err) {
        console.error("Failed to parse Gemini output text to JSON:", part.text, err);
        throw new Error("Final report did not conform to JSON format");
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
