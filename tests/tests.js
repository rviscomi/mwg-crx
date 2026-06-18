// Unit Tests for parser.js

const testSuite = [
  {
    name: "Perfect matching with thought and RESPONSE separator",
    input: "<thought>Checking buttons on the page</thought>\n===RESPONSE===\nHere are the modernization opportunities: ...",
    expected: {
      thoughts: "Checking buttons on the page",
      response: "Here are the modernization opportunities: ..."
    }
  },
  {
    name: "Thought block with trailing closing tag but no RESPONSE separator",
    input: "<thought>Let's inspect the DOM structure.</thought>\nHere is the refactored code block.",
    expected: {
      thoughts: "Let's inspect the DOM structure.",
      response: "Here is the refactored code block."
    }
  },
  {
    name: "Missing closing tag, fallback to Dino greeting indicator 'Rawr!'",
    input: "<thought>Analyzing the LCP image\nRawr! Dino here! Let's update those prehistoric images!",
    expected: {
      thoughts: "Analyzing the LCP image",
      response: "Rawr! Dino here! Let's update those prehistoric images!"
    }
  },
  {
    name: "Missing closing tag, fallback to markdown header marker \\n#",
    input: "<thought>Planning the carousel audit\n# Audit Results\n1. Use Popover API...",
    expected: {
      thoughts: "Planning the carousel audit",
      response: "# Audit Results\n1. Use Popover API..."
    }
  },
  {
    name: "Empty thought block / response only",
    input: "Just plain text output without any thinking tags.",
    expected: {
      thoughts: "",
      response: "Just plain text output without any thinking tags."
    }
  },
  {
    name: "Thought block with whitespace and newlines inside tags",
    input: "  <thought> \n  Spacing tests  \n  </thought>  \n===RESPONSE===\n  Clean result  ",
    expected: {
      thoughts: "Spacing tests",
      response: "Clean result"
    }
  },
  {
    name: "Partial/Malformed ===RESPONSE=== markers clean up",
    input: "<thought>Thinking...</thought>\n===RESP",
    expected: {
      thoughts: "Thinking...",
      response: ""
    }
  }
];

function runTests() {
  const resultsContainer = document.getElementById("test-results");
  let passedCount = 0;
  let failedCount = 0;

  testSuite.forEach((t, index) => {
    let actual;
    let passed = false;
    let errorMsg = null;

    try {
      actual = parseThoughtAndContent(t.input);
      passed = (actual.thoughts === t.expected.thoughts && actual.response === t.expected.response);
    } catch (e) {
      errorMsg = e.message;
    }

    if (passed) passedCount++;
    else failedCount++;

    // Render result card
    const card = document.createElement("div");
    card.className = "test-case";
    
    let detailsHtml = "";
    if (!passed) {
      detailsHtml = `
        <div class="details">
          <strong>Input:</strong>\n${escapeHtml(t.input)}
          <div class="diff">
            <div class="diff-expected"><strong>Expected thoughts:</strong> "${escapeHtml(t.expected.thoughts)}"</div>
            <div class="diff-actual"><strong>Actual thoughts:</strong>   "${escapeHtml(actual ? actual.thoughts : 'ERROR')}"</div>
            <div class="diff-expected" style="margin-top: 5px;"><strong>Expected response:</strong> "${escapeHtml(t.expected.response)}"</div>
            <div class="diff-actual"><strong>Actual response:</strong>   "${escapeHtml(actual ? actual.response : 'ERROR')}"</div>
          </div>
          ${errorMsg ? `<div style="color: var(--failure); margin-top: 10px;"><strong>Error:</strong> ${errorMsg}</div>` : ""}
        </div>
      `;
    } else {
      detailsHtml = `
        <div class="details" style="opacity: 0.7;">
          <strong>Thoughts:</strong> "${escapeHtml(actual.thoughts)}"\n<strong>Response:</strong> "${escapeHtml(actual.response)}"
        </div>
      `;
    }

    card.innerHTML = `
      <div class="test-header">
        <span class="test-name">${index + 1}. ${escapeHtml(t.name)}</span>
        <span class="badge ${passed ? 'passed' : 'failed'}">${passed ? 'passed' : 'failed'}</span>
      </div>
      ${detailsHtml}
    `;

    resultsContainer.appendChild(card);
  });

  // Update Summary Stats
  document.getElementById("total-tests").textContent = testSuite.length;
  document.getElementById("passed-tests").textContent = passedCount;
  document.getElementById("failed-tests").textContent = failedCount;

  console.log(`Tests Run: ${testSuite.length} | Passed: ${passedCount} | Failed: ${failedCount}`);
}

function escapeHtml(str) {
  if (typeof str !== "string") return String(str);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.addEventListener("DOMContentLoaded", runTests);
