// Gemini API client utilities: pacing, retries, rate limits
let recentRequests = [];

function getAdaptivePacingDelay(history, loopCount) {
  const now = Date.now();
  recentRequests = recentRequests.filter(r => now - r.timestamp < 60000);
  
  const currentRPM = recentRequests.length;
  
  let totalChars = 0;
  for (const turn of history) {
    if (turn.parts) {
      for (const part of turn.parts) {
        if (part.text) totalChars += part.text.length;
        if (part.functionCall) totalChars += JSON.stringify(part.functionCall).length;
        if (part.functionResponse) totalChars += JSON.stringify(part.functionResponse).length;
      }
    }
  }
  const estimatedRequestTokens = Math.ceil(totalChars / 4) + 1000;
  
  const currentTPM = recentRequests.reduce((sum, r) => {
    return sum + (r.actualTokens || r.estimatedTokens);
  }, 0);
  
  // Read limits from global config (defaulting to standard free tier limits)
  const MAX_RPM = (typeof config !== "undefined" && config.maxRpm) ? config.maxRpm : 15;
  const MAX_TPM = (typeof config !== "undefined" && config.maxTpm) ? config.maxTpm : 1000000;
  
  let delay = 0;
  
  // Throttle if we are at >= 65% of RPM capacity or if the upcoming request would exceed 85% of TPM capacity
  const upcomingTPM = currentTPM + estimatedRequestTokens;
  if (currentRPM >= MAX_RPM * 0.65 || upcomingTPM >= MAX_TPM * 0.85) {
    if (recentRequests.length > 0) {
      const oldestRequestAge = now - recentRequests[0].timestamp;
      const timeRemaining = 60000 - oldestRequestAge;
      
      // Calculate remaining slots
      const availableSlots = MAX_RPM - currentRPM;
      
      if (upcomingTPM >= MAX_TPM * 0.85) {
        // If we are getting close to TPM limit, wait out the required decay time of the window
        delay = Math.max(delay, timeRemaining);
      } else if (availableSlots > 1) {
        delay = Math.max(delay, Math.ceil(timeRemaining / availableSlots));
      } else {
        delay = Math.max(delay, timeRemaining);
      }
    }
  }
  
  // Cap the delay to 60 seconds (full window length) instead of 5 seconds to let the rate limit window decay completely if needed.
  delay = Math.min(delay, 60000);
  
  recentRequests.push({ 
    id: loopCount,
    timestamp: now + delay, 
    estimatedTokens: estimatedRequestTokens,
    actualTokens: 0
  });

  if (typeof window !== "undefined" && typeof updateTokenVisualizer === "function") {
    updateTokenVisualizer(window.activeLoggerId);
  }
  
  return delay;
}

async function fetchWithRetry(url, options, maxRetries = 5, loggerId = null) {
  let attempt = 0;
  let delay = 2000;
  
  while (true) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }
      
      if (response.status === 429 || response.status === 503) {
        if (response.status === 429) {
          const now = Date.now();
          const currentRPM = recentRequests.filter(r => now - r.timestamp < 60000).length;
          if (currentRPM >= 15 && config.maxRpm > 15) {
            console.warn(`Dynamic rate limit auto-detection: Hit 429 at ${currentRPM} RPM. Downgrading session limit to 15 RPM.`);
            config.maxRpm = 15;
            if (typeof updateTokenVisualizer === "function") {
              updateTokenVisualizer(window.activeLoggerId);
            }
          }
        }
        
        attempt++;
        if (attempt > maxRetries) {
          const errText = await response.text();
          throw new Error(`Gemini API returned error ${response.status} after ${maxRetries} retries: ${errText}`);
        }
        
        const message = `Rate limit or service unavailable (HTTP ${response.status}). Retrying in ${(delay / 1000).toFixed(1)}s... (Attempt ${attempt}/${maxRetries})`;
        console.warn(message);
        if (loggerId) {
          appendLog(loggerId, message, "system");
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      
      const errText = await response.text();
      throw new Error(`Gemini API returned error: ${response.status} - ${errText}`);
    } catch (err) {
      if (err.name === 'AbortError') {
        throw err;
      }
      
      attempt++;
      if (attempt > maxRetries) {
        throw err;
      }
      
      const message = `Network error: ${err.message}. Retrying in ${(delay / 1000).toFixed(1)}s... (Attempt ${attempt}/${maxRetries})`;
      console.warn(message);
      if (loggerId) {
        appendLog(loggerId, message, "system");
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
      continue;
    }
  }
}

function getCurrentRateLimits() {
  const now = Date.now();
  recentRequests = recentRequests.filter(r => now - r.timestamp < 60000);
  
  const currentRPM = recentRequests.length;
  const currentTPM = recentRequests.reduce((sum, r) => {
    return sum + (r.actualTokens || r.estimatedTokens);
  }, 0);
  
  const pacingDelay = recentRequests.length > 0 ? Math.max(0, recentRequests[recentRequests.length - 1].timestamp - now) : 0;

  const maxRpm = (typeof config !== "undefined" && config.maxRpm) ? config.maxRpm : 15;
  const maxTpm = (typeof config !== "undefined" && config.maxTpm) ? config.maxTpm : 1000000;

  return {
    rpm: currentRPM,
    tpm: currentTPM,
    maxRpm: maxRpm,
    maxTpm: maxTpm,
    pacingDelay
  };
}
