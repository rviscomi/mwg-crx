// Hook console logs early in the main page context to capture errors and warnings
(function() {
  if (window.__mwg_console_hooked) return;
  window.__mwg_console_hooked = true;
  window.__mwg_console_logs = [];

  const maxLogs = 500;
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug
  };

  ['log', 'warn', 'error', 'info', 'debug'].forEach(type => {
    console[type] = (...args) => {
      // Safe string conversion to avoid circular structure issues
      let text = "";
      try {
        text = args.map(a => {
          if (a === null) return "null";
          if (a === undefined) return "undefined";
          if (a instanceof Error) return a.stack || a.message;
          if (typeof a === 'object') return JSON.stringify(a);
          return String(a);
        }).join(' ');
      } catch (e) {
        text = args.map(String).join(' ');
      }

      window.__mwg_console_logs.push({
        type,
        text: text.substring(0, 1000), // Cap length of a single log message
        timestamp: Date.now()
      });

      if (window.__mwg_console_logs.length > maxLogs) {
        window.__mwg_console_logs.shift();
      }

      originalConsole[type].apply(console, args);
    };
  });

  // Buffers for INP-Raptor interaction timing and Long Animation Frames (LoAF)
  window.__mwg_loaf_entries = [];
  window.__mwg_event_entries = [];

  try {
    const loafObserver = new PerformanceObserver((list) => {
      window.__mwg_loaf_entries.push(...list.getEntries());
      if (window.__mwg_loaf_entries.length > 100) {
        window.__mwg_loaf_entries = window.__mwg_loaf_entries.slice(-100);
      }
    });
    loafObserver.observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) {
    // LoAF not supported or disabled in this browser
  }

  try {
    const eventObserver = new PerformanceObserver((list) => {
      window.__mwg_event_entries.push(...list.getEntries());
      if (window.__mwg_event_entries.length > 100) {
        window.__mwg_event_entries = window.__mwg_event_entries.slice(-100);
      }
    });
    eventObserver.observe({ type: 'event', buffered: true });
  } catch (e) {
    // Event Timing API not supported
  }
})();

