# Chrome Web Store Listing Metadata & Policies

This document compiles the store metadata, permission justifications, and privacy declarations required to publish the **MWG Modernizer** extension.

---

## 📝 Store Listing Metadata

### Extension Name
`MWG Modernizer`

### Single-sentence Summary
`Evaluate website modernization opportunities in DevTools using Google Gemini and Modern Web Guidance.`

### Detailed Description
```
MWG Modernizer is a developer productivity tool that integrates directly into Chrome DevTools to help frontend developers modernize their websites.

By combining the power of Google Gemini models with the Chrome team's official Modern Web Guidance (MWG) repository, this extension automatically audits your pages and recommends native modern replacements for legacy code.

Key Features:
- Page Audit (Full Scan): Analyzes the page's DOM, styling, and configuration to find legacy patterns (e.g., custom JS scroll listener) and recommend native web platform replacements (e.g., CSS scrollbar-color).
- Element Inspector: Select any custom component in the DevTools "Elements" panel, and click "Analyze Selected Element" to receive targeted refactoring tips.
- Side-by-Side Diff: View original legacy code compared directly to modernized code recommendations.
- Toast Notifications: A smooth toast notification banner alerts you of status changes without blocking developer workflow.
- 100% Client-Side: Your Gemini API Key is stored safely in Chrome local storage. All requests are sent directly to the Gemini API and GitHub guidance files from your browser.
```

---

## 🔒 Permissions & Justifications

These justifications must be submitted to the Chrome Web Store review team to explain why each permission is required:

### 1. `storage`
- **Justification**: Required to securely save the user's Gemini API Key, preferred Gemini Model (e.g., `gemini-3.5-flash`), and cache loaded guidance database use-cases offline.

### 2. `scripting`
- **Justification**: Required to run a lightweight script on the inspected page tab to traverse and capture the simplified DOM hierarchy for analysis.

### 3. `tabs`
- **Justification**: Required to query the active tab's properties (such as the URL and title) to perform the audit, and to programmatically open the guidance pages on GitHub in a new browser tab.

### 4. `<all_urls>` (Host Permissions)
- **Justification**: Required to allow developers to summon the auditor panel and run modernization scans on any production domain they are currently inspecting.

---

## 🛡️ Privacy Policy & Data Usage

### User Data Collection
- The extension **does not collect, store, or transmit** any personal identification data, location info, browsing history, or user credentials.
- All configuration settings (such as the Gemini API Key) are stored **exclusively in Chrome local storage** on the user's machine and are never transmitted to any analytics tracker or third-party server.

### External Network Requests
The extension only makes network calls to two endpoints:
1. **Gemini API** (`generativelanguage.googleapis.com`): To process the audit prompts using the user-provided API key.
2. **GitHub Raw Contents** (`raw.githubusercontent.com`): To fetch compiled use cases and markdown guides from the official `GoogleChrome/modern-web-guidance` repository.
