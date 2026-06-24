let isAborted = false;
let currentAbortController = null;
let isEarlyCompletionRequested = false;
if (typeof window !== "undefined") {
  window.activeLoggerId = null;
}

const DEFAULT_REPORT_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      title: { 
        type: "STRING",
        description: "A short, descriptive title summarizing the legacy pattern found and the modern alternative (e.g. 'Use customizable select element'). Max 60 chars."
      },
      impact: {
        type: "STRING",
        enum: ["high", "medium", "low"],
        description: "The priority/impact of the modernization (high, medium, or low)."
      },
      useCaseId: { 
        type: "STRING",
        description: "The exact matching use case ID from the list_use_cases results (e.g. 'branded-select-styling'). Must be a short string or null if not covered by a specific guide. DO NOT put notes or thoughts here."
      },
      guideAnchor: { 
        type: "STRING",
        description: "The optional heading anchor string from the guide (no '#' symbol, e.g. 'fallbacks-browser-support-for-customizable-select'). Must be a short string or null. DO NOT put notes or thoughts here."
      },
      description: { 
        type: "STRING",
        description: "A clear, concise explanation of the legacy issue, the modernized alternative, and how the new web API helps. Maximum 300 chars."
      },
      target: { 
        type: "STRING",
        description: "The primary CSS selector of the legacy DOM element, or 'document' for global issues, or 'Network' for HTTP/network issues."
      },
      originalCode: { 
        type: "STRING",
        description: "Concrete legacy HTML/CSS/JS snippet of the element or code. Keep it minimal and extremely focused on the issue."
      },
      modernizedCode: { 
        type: "STRING",
        description: "Concrete refactored/modernized HTML/CSS/JS snippet. Keep it minimal, concise, and focused. Do NOT include placeholder text or ellipses."
      },
      changes: {
        type: "ARRAY",
        description: "Optional array of secondary or multi-file changes when a single code recommendation is not sufficient.",
        items: {
          type: "OBJECT",
          properties: {
            target: { 
              type: "STRING",
              description: "CSS selector or file path for this specific change."
            },
            originalCode: { 
              type: "STRING",
              description: "Legacy code snippet."
            },
            modernizedCode: { 
              type: "STRING",
              description: "Modernized replacement snippet. No placeholders or ellipses."
            }
          },
          required: ["originalCode", "modernizedCode"]
        }
      }
    },
    required: ["title", "impact", "useCaseId", "guideAnchor", "description", "target", "originalCode", "modernizedCode"]
  }
};


function earlyCompleteAnalysis() {
  isEarlyCompletionRequested = true;
  if (currentAbortController) {
    currentAbortController.abort();
  }
}

function supportsThinking(modelName) {
  if (!modelName) return false;
  const name = modelName.toLowerCase();
  return name.includes("gemini-2.") || 
         name.includes("gemini-3") || 
         name.includes("thinking");
}

function getNormalizedToolKey(name, args) {
  if (!args || typeof args !== "object") return name;

  if (name === "execute_js") {
    // Only compare the JS code content; purpose is user-facing and can vary per turn.
    return `execute_js:${(args.code || "").trim()}`;
  }

  if (name === "get_element_info") {
    // Normalize selector: split, trim, sort, and join comma-separated lists.
    const selector = (args.selector || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .sort()
      .join(",");
    const props = args.computedProperties 
      ? [...args.computedProperties].sort() 
      : [];
    return `get_element_info:${JSON.stringify({ selector, computedProperties: props })}`;
  }

  // Fallback for general tools: sort arguments by key to prevent ordering variations.
  const sortedArgs = {};
  const keys = Object.keys(args).sort();
  for (const key of keys) {
    sortedArgs[key] = args[key];
  }
  return `${name}:${JSON.stringify(sortedArgs)}`;
}

async function runGeminiAgent(loggerId, startPrompt, systemInstruction, responseSchema, screenshot = null) {
  const activeSchema = responseSchema || DEFAULT_REPORT_SCHEMA;
  if (typeof window !== "undefined") {
    window.activeLoggerId = loggerId;
  }
  if (typeof window !== "undefined") {
    window.currentRunTokens = {
      prompt: 0,
      candidates: 0,
      total: 0
    };
  }
  if (typeof updateTokenVisualizer === "function") {
    updateTokenVisualizer(loggerId);
  }
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
  const toolCallCounts = new Map();

  const initialParts = [{ text: startPrompt }];
  if (screenshot) {
    const match = screenshot.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      initialParts.push({
        inlineData: {
          mimeType: match[1],
          data: match[2]
        }
      });
    }
  }

  const history = [
    {
      role: "user",
      parts: initialParts
    }
  ];

  let loopCount = 0;
  let jsonParseRetries = 0;
  const maxJsonParseRetries = 2;

  while (true) {
    if (isAborted) {
      throw new Error("Analysis aborted by user.");
    }
    if (isEarlyCompletionRequested) {
      isEarlyCompletionRequested = false;
      if (typeof autoProgressChecklistFinal === "function") {
        autoProgressChecklistFinal(loggerId);
      }
      const report = await generateEarlyReport(url, history, systemInstruction, activeSchema, loggerId);
      return report;
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
        maxOutputTokens: 8192,
        responseSchema: activeSchema,
        temperature: 0.6
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

    // Adaptive pacing to prevent Tier 1 rate limits (15 RPM, 4M TPM)
    const turnDelay = getAdaptivePacingDelay(history, loopCount);
    if (turnDelay > 0) {
      appendLog(loggerId, `Pacing API request to prevent rate limits... (waiting ${(turnDelay / 1000).toFixed(1)}s)`, "system");
      const steps = turnDelay / 100;
      for (let i = 0; i < steps; i++) {
        if (isAborted || isEarlyCompletionRequested) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (isAborted) {
      throw new Error("Analysis aborted by user.");
    }
    if (isEarlyCompletionRequested) {
      isEarlyCompletionRequested = false;
      if (typeof autoProgressChecklistFinal === "function") {
        autoProgressChecklistFinal(loggerId);
      }
      const report = await generateEarlyReport(url, history, systemInstruction, activeSchema, loggerId);
      return report;
    }

    let response;
    try {
      response = await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: currentAbortController.signal
      }, 5, loggerId);
    } catch (err) {
      if (err.name === 'AbortError') {
        if (isEarlyCompletionRequested) {
          isEarlyCompletionRequested = false;
          appendLog(loggerId, "Request aborted. Compiling report with gathered data...", "system");
          if (typeof autoProgressChecklistFinal === "function") {
            autoProgressChecklistFinal(loggerId);
          }
          const report = await generateEarlyReport(url, history, systemInstruction, activeSchema, loggerId);
          return report;
        }
        throw new Error("Analysis aborted by user.");
      }
      throw err;
    }

    const resJson = await response.json();

    // Update sliding rate limiter window with the exact token count from the server response
    if (resJson.usageMetadata) {
      const entry = recentRequests.find(r => r.id === loopCount);
      if (entry) {
        entry.actualTokens = resJson.usageMetadata.totalTokenCount;
      }
      if (typeof window !== "undefined" && window.currentRunTokens) {
        window.currentRunTokens.prompt += resJson.usageMetadata.promptTokenCount || 0;
        window.currentRunTokens.candidates += resJson.usageMetadata.candidatesTokenCount || 0;
        window.currentRunTokens.total += resJson.usageMetadata.totalTokenCount || 0;
      }
      if (typeof updateTokenVisualizer === "function") {
        updateTokenVisualizer(loggerId);
      }
    }

    if (!resJson.candidates || resJson.candidates.length === 0) {
      if (resJson.promptFeedback) {
        throw new Error(`Gemini API prompt blocked: ${JSON.stringify(resJson.promptFeedback)}`);
      }
      throw new Error(`Gemini API returned response without candidates: ${JSON.stringify(resJson)}`);
    }

    const candidate = resJson.candidates[0];
    const rawModelContent = candidate.content;

    if (!rawModelContent || !rawModelContent.parts || rawModelContent.parts.length === 0) {
      let errorMsg = "Gemini API returned an empty or unrecognized response.";
      if (candidate.finishReason && candidate.finishReason !== "STOP") {
        errorMsg += ` (Generation stopped early due to finishReason: "${candidate.finishReason}")`;
      }
      throw new Error(errorMsg);
    }

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
        if (isEarlyCompletionRequested) {
          appendLog(loggerId, `Skipping tool execution: ${fc.functionCall.name} (Answer Now clicked)`, "system");
          responseParts.push({
            functionResponse: {
              name: fc.functionCall.name,
              response: { result: "Investigation terminated early by user. Please compile the final report immediately." }
            }
          });
          continue;
        }
        const { name, args } = fc.functionCall;
        const callKey = getNormalizedToolKey(name, args);
        const count = (toolCallCounts.get(callKey) || 0) + 1;
        toolCallCounts.set(callKey, count);

        let toolResult;
        if (count >= 4) {
          appendLog(loggerId, `Loop prevention: Intercepted repeated call to ${name}`, "system");
          toolResult = {
            error: `Loop prevention: You have already executed ${name} with these exact arguments ${count - 1} times in this run. The results are in your history. Please do not repeat tool calls. Review your strategy and compile your final response.`
          };
        } else {
          appendLog(loggerId, `Model requested tool execution: ${name}(${JSON.stringify(args || {})})`, "agent");
          if (count === 3) {
            appendLog(loggerId, `Warning: Tool ${name} has been called 3 times with the same arguments. Potential loop detected.`, "system");
          }
          if (typeof autoProgressChecklist === "function") {
            autoProgressChecklist(name, args, loopCount);
          }
          try {
            toolResult = await executeTool(name, args);
            const logMsg = getToolLogMessage(name, args, toolResult);
            if (logMsg) {
              appendLog(loggerId, `Tool output: ${logMsg}`, "tool");
            }
          } catch (err) {
            console.error("Tool execution failed:", err);
            toolResult = { error: err.message };
            appendLog(loggerId, `Tool output: Execution failed (${err.message})`, "system");
          }
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
      if (typeof autoProgressChecklistFinal === "function") {
        autoProgressChecklistFinal(loggerId);
      }
      
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
        if (jsonParseRetries < maxJsonParseRetries) {
          jsonParseRetries++;
          appendLog(loggerId, `Malformed JSON response: ${err.message}. Retrying generation (Attempt ${jsonParseRetries}/${maxJsonParseRetries})...`, "system");
          
          let retryPrompt = `The last response could not be parsed as valid JSON. Error: ${err.message}.`;
          if (candidate && candidate.finishReason === "MAX_TOKENS") {
            retryPrompt += ` The generation was cut off due to MAX_TOKENS. Please output a more concise, complete, and valid JSON report containing all identified findings without truncating.`;
          } else {
            retryPrompt += ` Please correct the formatting and output a valid JSON report conforming strictly to the requested response schema.`;
          }

          history.push({
            role: "user",
            parts: [{ text: retryPrompt }]
          });
          continue;
        }

        let errorMsg = `Final report did not conform to JSON format: ${err.message}`;
        if (candidate && candidate.finishReason && candidate.finishReason !== "STOP") {
          errorMsg += ` (Generation stopped early due to finishReason: "${candidate.finishReason}")`;
        }
        errorMsg += `. Raw output: ${textParts.substring(0, 300)}`;
        throw new Error(errorMsg);
      }
    }
  }
}

async function generateEarlyReport(url, history, baseSystemInstruction, responseSchema, loggerId) {
  const activeSchema = responseSchema || DEFAULT_REPORT_SCHEMA;
  const earlySystemPrompt = `${baseSystemInstruction || GENERIC_SYSTEM_INSTRUCTION}
  
  CRITICAL INSTRUCTION:
  The user has requested early completion. You MUST NOT call or request any tools. You MUST immediately compile and return the final report containing ONLY the legacy issues and opportunities you have identified and verified so far.
  Output the report STRICTLY as a JSON array matching the requested responseSchema.`;

  appendLog(loggerId, "Querying Gemini for early report...", "system");

  const localHistory = [...history];
  let jsonParseRetries = 0;
  const maxJsonParseRetries = 2;

  while (true) {
    currentAbortController = new AbortController();
    
    const requestBody = {
      contents: localHistory,
      systemInstruction: {
        parts: [{ text: earlySystemPrompt }]
      },
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        responseSchema: activeSchema,
        temperature: 0.6
      }
    };

    // We do NOT add thinkingConfig here because thinking budget consumes output tokens,
    // and we need to maximize the tokens available for the final JSON report.

    let response;
    try {
      response = await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: currentAbortController.signal
      }, 3, loggerId);
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error("Analysis aborted by user.");
      }
      throw err;
    }

    const resJson = await response.json();
    if (!resJson.candidates || resJson.candidates.length === 0) {
      if (resJson.promptFeedback) {
        throw new Error(`Gemini API prompt blocked during early report: ${JSON.stringify(resJson.promptFeedback)}`);
      }
      throw new Error(`Gemini API returned response without candidates during early report: ${JSON.stringify(resJson)}`);
    }

    const candidate = resJson.candidates[0];
    const rawModelContent = candidate.content;

    if (!rawModelContent || !rawModelContent.parts || rawModelContent.parts.length === 0) {
      let errorMsg = "Gemini API returned empty response content during early report.";
      if (candidate.finishReason && candidate.finishReason !== "STOP") {
        errorMsg += ` (Generation stopped early due to finishReason: "${candidate.finishReason}")`;
      }
      throw new Error(errorMsg);
    }

    // Sanitize the candidate content parts to keep standard attributes
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

    localHistory.push(modelContent);

    const textParts = modelContent.parts.filter(p => p.text !== undefined).map(p => p.text).join("\n").trim();
    
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
      if (startIdx === -1) throw new Error("No JSON structure found");
      const endIdx = textParts.lastIndexOf(endChar);
      const jsonText = textParts.substring(startIdx, endIdx + 1);
      const parsed = JSON.parse(jsonText);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
      console.error("Failed to parse Gemini early report output text to JSON:", textParts, err);
      if (jsonParseRetries < maxJsonParseRetries) {
        jsonParseRetries++;
        appendLog(loggerId, `Malformed early report JSON: ${err.message}. Retrying generation (Attempt ${jsonParseRetries}/${maxJsonParseRetries})...`, "system");
        
        let retryPrompt = `The last response could not be parsed as valid JSON. Error: ${err.message}.`;
        if (candidate.finishReason === "MAX_TOKENS") {
          retryPrompt += ` The generation was cut off due to MAX_TOKENS. Please output a more concise, complete, and valid JSON report containing all identified findings without truncating.`;
        } else {
          retryPrompt += ` Please correct the formatting and output a valid JSON report conforming strictly to the requested response schema.`;
        }

        localHistory.push({
          role: "user",
          parts: [{ text: retryPrompt }]
        });
        continue;
      }

      let errorMsg = `Failed to parse early report JSON: ${err.message}`;
      if (candidate.finishReason && candidate.finishReason !== "STOP") {
        errorMsg += ` (Generation stopped early due to finishReason: "${candidate.finishReason}")`;
      }
      errorMsg += `. Raw output: ${textParts.substring(0, 300)}`;
      throw new Error(errorMsg);
    }
  }
}

function appendLog(loggerId, message, sender = "system") {
  const logDiv = document.getElementById(`${loggerId}-log-lines`);
  if (!logDiv) return;
  const line = document.createElement("div");
  line.className = `log-line ${sender}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  
  const isAtBottom = logDiv.scrollHeight - logDiv.clientHeight - logDiv.scrollTop <= 15;
  
  logDiv.appendChild(line);
  
  if (isAtBottom) {
    logDiv.scrollTop = logDiv.scrollHeight;
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
  const toolCallCounts = new Map();

  while (true) {
    if (isAborted) {
      throw new Error("Chat aborted by user.");
    }
    loopCount++;

    let customSystemInstruction = DINO_CHAT_SYSTEM_INSTRUCTION;
    if (supportsThinking(config.model)) {
      customSystemInstruction += "\n\n- NATIVE THINKING CONFIGURATION ENABLED: Do NOT output manual `<thought>` or `===RESPONSE===` tags in your text response. Your internal planning/monologue is handled automatically by the API's thinking configuration. Write only your final user-facing markdown response.";
    } else {
      customSystemInstruction += `

- INTERNAL MONOLOGUE & PLANS:
  - At the start of EVERY turn (including the final response turn where you do not call any tools), you MUST always wrap your internal monologue, reasoning, or plan in \`<thought>\` and \`</thought>\` tags (e.g. \`<thought>I need to inspect the active page DOM to see how the testimonials structure is built and if there's any custom slide navigation script. Let's call get_page_dom.</thought>\`).
  - This is critical because the user inspects your thought process to understand *why* you are calling specific tools and what your strategy is. If you do not wrap this explanation in these tags, it will flash in the main chat response area instead of being formatted in the thought log history.
  - In your final response turn, immediately after closing the \`</thought>\` tag, you MUST output the separator \`===RESPONSE===\` on a line by itself before writing your actual user-facing response. For example:
    <thought>I have checked the active page DOM. I will formulate the response now.</thought>
    ===RESPONSE===
    Here is the modernized implementation for your navigation menu...`;
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
        else if (name === "get_accessibility_tree") statusMsg = "Reading accessibility (A11y) tree...";
        else if (name === "execute_js") statusMsg = "Executing custom script on page...";
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
        else if (name === "inspect_event_listeners") statusMsg = `Inspecting event listeners for "${args.selector || "$0"}"...`;
        else if (name === "simulate_action") statusMsg = `Simulating "${args.action}" on "${args.selector}"...`;
        else if (name === "analyze_layout_metrics") statusMsg = `Analyzing layout metrics for "${args.selector}"...`;
        else if (name === "get_lcp_element") statusMsg = "Retrieving Largest Contentful Paint (LCP) element...";
        else if (name === "get_viewport_images") statusMsg = "Retrieving all images in the viewport...";
        else if (name === "get_network_requests") statusMsg = "Auditing network request logs...";
        else if (name === "simulate_and_measure_inp") statusMsg = `Simulating "${args.action}" on "${args.selector}" to measure INP/LoAF...`;
        else if (name === "analyze_css_coverage") statusMsg = "Analyzing dead CSS rules & coverage...";
        else if (name === "analyze_js_dependencies") statusMsg = "Analyzing JS bundle source maps & dependency weights...";
        else if (name === "take_screenshot") statusMsg = args.selector ? `Taking screenshot of element "${args.selector}"...` : "Taking screenshot of viewport...";
        else if (name === "check_bfcache_reasons") statusMsg = "Checking Back-Forward Cache (bfcache) blocking reasons...";

        const callKey = getNormalizedToolKey(name, args);
        const count = (toolCallCounts.get(callKey) || 0) + 1;
        toolCallCounts.set(callKey, count);

        const currentStep = {
          type: 'tool',
          name: name,
          args: args,
          title: count >= 4 ? `Loop prevented: Repeated call to ${name}` : statusMsg,
          status: 'running'
        };
        steps.push(currentStep);
        triggerUpdate();

        let toolResult;
        if (count >= 4) {
          currentStep.status = 'failed';
          currentStep.error = `Repeated tool call prevented.`;
          triggerUpdate();
          toolResult = {
            error: `Loop prevention: You have already executed ${name} with these exact arguments ${count - 1} times in this run. The results are in your history. Please do not repeat tool calls. Review your strategy and compile your final response.`
          };
        } else {
          if (count === 3) {
            console.warn(`[Dino Chat Agent] Warning: Tool ${name} called 3 times with same args:`, args);
          }
          try {
            toolResult = await executeTool(name, args);

            // Handle citations special case for get_guide_content
            if (name === "get_guide_content" && toolResult) {
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


