// Create the Dino panel
chrome.devtools.panels.create(
  "Dino",
  "dino-agent.png",
  "panel.html",
  (panel) => {
    console.log("Dino DevTools Panel Created");
  }
);
