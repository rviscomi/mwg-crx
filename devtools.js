// Create the Modernize panel
chrome.devtools.panels.create(
  "Modernize",
  null, // icon
  "panel.html",
  (panel) => {
    console.log("Modernize DevTools Panel Created");
  }
);
