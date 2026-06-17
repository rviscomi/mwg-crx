let recognition = null;
let finalTranscript = "";

document.addEventListener('DOMContentLoaded', () => {
  setupRecognition();
  
  document.getElementById('btn-done').addEventListener('click', commitSpeech);
  document.getElementById('btn-cancel').addEventListener('click', () => window.close());
});

function setupRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    updateStatus('Speech API not supported', true);
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let interimTranscript = "";
    
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }

    const previewBox = document.getElementById('preview-box');
    const displayStr = finalTranscript + interimTranscript;
    
    if (displayStr.trim()) {
      previewBox.textContent = displayStr;
      previewBox.classList.remove('preview-placeholder');
    } else {
      previewBox.innerHTML = '<span class="preview-placeholder">Speak to dictate your message...</span>';
    }
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error in popup:", event.error);
    if (event.error === 'not-allowed') {
      requestMicrophonePermission();
    } else {
      updateStatus(`Error: ${event.error}`, true);
    }
  };

  recognition.onend = () => {
    const statusText = document.getElementById('status-text').textContent;
    if (recognition && (statusText === 'Listening...' || statusText === 'Microphone permission needed')) {
      try { recognition.start(); } catch(e) {}
    }
  };

  try {
    recognition.start();
  } catch (err) {
    console.error("Failed to start speech:", err);
    updateStatus('Start failed', true);
  }
}

async function requestMicrophonePermission() {
  updateStatus('Microphone permission needed');
  const previewBox = document.getElementById('preview-box');
  previewBox.innerHTML = '<span class="preview-placeholder" style="color: #f87171;">Please grant microphone permission when prompted by Chrome.</span>';
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    
    // Permission granted, re-start recognition!
    updateStatus('Listening...');
    previewBox.innerHTML = '<span class="preview-placeholder">Listening...</span>';
    if (recognition) {
      try { recognition.start(); } catch(e) {}
    }
  } catch (err) {
    console.error("Microphone permission denied:", err);
    updateStatus('Permission Denied', true);
  }
}

function updateStatus(text, isError = false) {
  const statusEl = document.getElementById('status-text');
  if (statusEl) {
    statusEl.textContent = text;
    if (isError) {
      statusEl.style.color = 'var(--danger-color)';
      const ring = document.getElementById('mic-ring');
      if (ring) ring.style.borderColor = 'var(--border-color)';
    } else {
      statusEl.style.color = 'var(--text-secondary)';
    }
  }
}

async function commitSpeech() {
  const text = finalTranscript.trim();
  if (text) {
    // Write to storage as fallback
    try {
      await chrome.storage.local.set({ lastVoiceResult: text });
    } catch (e) {
      console.error("Failed to write voice result to storage:", e);
    }

    try {
      await chrome.runtime.sendMessage({
        action: 'voice-result',
        transcript: text
      });
    } catch (err) {
      console.warn("Failed to send voice result message:", err);
    }
  }
  window.close();
}
