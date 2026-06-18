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
  const parts = response.split(/===\s*RESPONSE\s*===/gi);
  if (parts.length > 1) {
    let thoughtPart = parts[0];
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
    
    thoughts = thoughtPart.trim();
    response = parts.slice(1).join("\n").trim();
  } else {
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
  }

  // Strip partial or full ===RESPONSE=== markers from response
  const partialRegex = /^\s*(?:={1,3}(?:\s*(?:R(?:E(?:S(?:P(?:O(?:N(?:S(?:E(?:\s*={0,3})?)?)?)?)?)?)?)?)?)?)?$/i;
  const fullRegex = /^\s*===\s*RESPONSE\s*===\s*/i;

  if (partialRegex.test(response)) {
    response = "";
  } else {
    response = response.replace(fullRegex, "");
  }

  return { thoughts, response };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseThoughtAndContent };
} else if (typeof globalThis !== 'undefined') {
  globalThis.parseThoughtAndContent = parseThoughtAndContent;
}

