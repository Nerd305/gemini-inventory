# Gemini Inventory

Gemini Inventory is a single-page React inventory management app for a pharmacy/compounding facility ("Greenstone"). It tracks products, stock levels, tray locations, and inventory sessions entirely in the browser.

## Important Links

* **Live Production URL:** [https://inventory-amber-five.vercel.app](https://inventory-amber-five.vercel.app)
* **GitHub Repository:** [https://github.com/Nerd305/gemini-inventory](https://github.com/Nerd305/gemini-inventory)

## Architecture

This is a **zero-build, two-file app**:

- `index.html` — Entry point. Loads React 18 and Babel Standalone for in-browser JSX compilation. Fetches `gemini-inventory.jsx` at runtime.
- `gemini-inventory.jsx` — The entire application. Contains all components, state management, styles, and data logic in a single file.

There is no bundler, no npm, and no build step.

## Technologies Used

* **Frontend:** React 18 (loaded via CDN)
* **Hosting:** Vercel
* **Database:** Firebase Firestore
* **AI:** Google Gemini API (for auto-categorization from photos)

## Development

To develop locally, serve the files with any static HTTP server:

```bash
npx serve .
# or
python3 -m http.server
```
