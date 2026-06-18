// Dino Dynamic/Stock Greeting Generators

async function runDinoGreeting() {
  if (!config.apiKey) {
    return "Rawr! Dino here! Set up your Gemini API Key in Settings to get started, and I'll help you modernise your prehistoric web apps!";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

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
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Give me a fresh, punny Dino greeting where you introduce yourself." }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }
      })
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const greeting = text.trim().replace(/^"/, '').replace(/"$/, '');
    return appendAuditSuggestions(greeting);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn("Dino greeting API call timed out after 3 seconds, using stock greeting.");
    } else {
      console.warn("Failed to generate Dino greeting dynamically:", err);
    }
    return getRandomStockGreeting();
  }
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
