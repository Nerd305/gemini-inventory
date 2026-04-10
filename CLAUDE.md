# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gemini Inventory is a single-page React inventory management app for a pharmacy/compounding facility ("Greenstone"). It tracks products, stock levels, tray locations, and inventory sessions.

**Live Production URL:** https://inventory-amber-five.vercel.app
**GitHub Repository:** https://github.com/Nerd305/gemini-inventory

## Architecture

This is a **zero-build, two-file app**:

- **index.html** — Entry point. Loads React 18 via ESM import maps (`esm.sh`) and Babel Standalone for in-browser JSX compilation. Fetches `gemini-inventory.jsx` at runtime, compiles it with Babel, and mounts the default export.
- **gemini-inventory.jsx** — The entire application (~1450 lines). Contains all components, state management, styles, and data logic in a single file. Uses global `React` exposed by `index.html`.

There is no bundler, no npm, no build step. Dependencies are loaded via CDN URLs (esm.sh, unpkg, gstatic).

## Key Technical Details

- **Data layer**: Firebase Firestore. Collections: `products`, `locations`, `trays`, `logs`. Config is inline in the JSX file. The `DB` object handles load/save operations.
- **State**: Single `useState` hook in `App` holds all app state (`products`, `locations`, `trays`, `logs`, `sessions`, `settings`). Child components receive state and callbacks as props.
- **Styling**: All CSS-in-JS via inline style objects. Color constants in `COLORS` object. No external CSS framework.
- **Tabs**: `dash` (dashboard), `products`, `locations`, `reports` — controlled by `tab` state in App.
- **Scanning**: In-browser camera barcode scanning via `Scanner` component. Used for inventory intake, removal, and product lookup.
- **AI categorization**: Uses Gemini API (`generativelanguage.googleapis.com`) to auto-categorize products from photos.

## Development

No build or install commands. To develop locally, serve the files with any static HTTP server:

```
npx serve .
# or
python3 -m http.server
```

## Deployment

Hosted on Vercel as a static site (no framework). Just push to deploy.
