# Modern Web Dino — Chrome DevTools Extension

**Modern Web Dino** is a Chrome Developer Tools extension designed to help web developers identify and implement modernization opportunities on any website. 

It inspects the page DOM, layout styles, and console logs, and uses **Google Gemini** (via direct client-side API calls) combined with the Chrome team's **Modern Web Guidance (MWG)** database to suggest modern replacements for legacy code.

---

## ✨ Features
1. **Page Audit (Full Scan)**: Audits the entire page to find opportunities to replace custom CSS/JS with native modern APIs (e.g. Scroll-driven animations, popovers, `<dialog>`, speculation rules, etc.).
2. **Selected Element Inspector**: Analyze the element currently selected in the DevTools **Elements** panel. For example, select a custom dropdown or modal to see how to refactor it using `<select>` or `<dialog>`.
3. **Interactive Code Diff**: Displays original legacy code vs. modernized code recommendations side-by-side.
4. **100% Client-Side**: No local servers or native helpers are required. Your Gemini API key is stored securely in Chrome local storage, and the analysis runs directly in your browser.
5. **Toast Notifications**: Replaces blocking alert windows with premium, fluid toast status notifications.
6. **Smart Guide Links**: Clicking a guide redirects directly to the beautifully rendered markdown file on GitHub.

---

## 🛠️ Architecture
The extension uses an **Agentic Tool-Calling** flow to drive the audit process:
- It initializes a conversation with Gemini using your configured API key.
- It equips the Gemini model with a set of tools (functions) implemented in the extension:
  - `list_use_cases()`: Returns a list of all available MWG use cases and descriptions.
  - `get_guide_content(use_case_id)`: Fetches the compiled guide markdown from a public URL.
  - `get_page_dom()`: Captures the active tab's simplified DOM structure.
  - `get_inspected_element()`: Returns HTML and computed styles for the selected DevTools element.
- Gemini autonomously analyzes the page, queries the use case list, retrieves relevant guides, and outputs the final report in structured JSON format.

---

## 🚀 Installation & Setup

### 1. Load the Extension in Chrome
1. Clone this repository or copy the extension folder to your machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the extension directory (`/Users/rviscomi/git/mwg-crx`).

### 2. Configure Gemini API Key
1. Open Chrome DevTools on any webpage (Right-click -> **Inspect**, or press `F12`).
2. Select the **Dino** tab in the DevTools panel header.
3. Click the **Settings** sub-tab.
4. Paste your **Gemini API Key** (get one from [Google AI Studio](https://aistudio.google.com/)).
5. Select the model (default: `gemini-3.5-flash` for fast, cost-efficient audits).
6. Click **Save Configuration**.

---

## 📖 How to Use

### 🔍 Full Page Audit
1. Open the **Page Audit** tab in the Dino panel.
2. Click **Start Page Audit**.
3. Watch the progress logger stream events (e.g. `"Scanning DOM..."`, `"Searching guides..."`, `"Analyzing..."`).
4. Review the generated list of modernization cards. Click on any card to see a description, computed impact badge, and a side-by-side code diff.

### 🎯 Selected Element Inspector
1. Go to the DevTools **Elements** tab and select any element (e.g. a custom popup container or scrollable div).
2. Open the **Element Inspector** tab in the Dino panel.
3. Click **Analyze Selected Element**.
4. The agent will inspect the outerHTML and styles of your selected element, match it against the guidance, and return specific component-level recommendations.

---

## 📂 Codebase Structure
- `manifest.json`: Manifest V3 extension configuration.
- `devtools.html` / `devtools.js`: Registers the panel tab.
- `panel.html`: Core HTML workspace container.
- `panel.css`: Sleek premium dark theme matching native DevTools colors.
- `panel.js`: Main execution logic containing DOM simplify routines, Gemini REST connector, tool-calling loop, and UI rendering.
- `use-cases.json`: Local bundled database snapshot of all available MWG use cases (used as an offline fallback).
- `CHROMEWEBSTORE.md`: Metadata and justifications required for publishing to the Chrome Web Store.
