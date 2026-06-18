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
  
  // Standard free tier limits (15 RPM / 1M TPM)
  const MAX_RPM = 15;
  const MAX_TPM = 1000000;
  
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
