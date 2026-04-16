# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Two independent applications share one Firestore database and a `src/shared/` code folder:

- **Root (`/`)** — React 19 + Vite + Tailwind 4 web app (MedInventory / VialTrack). Built for Google AI Studio; uses Gemini via `@google/genai` and Firebase Auth + Firestore.
- **`desktop/`** — Electron + Vite + TypeScript macOS print server (VialTrack Print Server). Runs on the pharmacy iMac, subscribes to the Firestore `printJobs` queue, and routes each job to a physical printer via CUPS (`lp`).

The desktop renderer imports shared types and the `usePrintJobQueue` hook from the root via Vite aliases:
- `@shared` → `../src/shared`
- `@firebase-config` → `../src/firebase`

Keep anything used by both apps inside `src/shared/`; imports from `src/components`, `src/pages`, etc. will break the desktop build.

## Common commands

Web app (from repo root):

```bash
npm install
npm run dev      # vite on :3000, HMR disabled when DISABLE_HMR=true (AI Studio)
npm run build    # vite build → dist/
npm run lint     # tsc --noEmit (type-check only; no ESLint configured)
```

Desktop app (from `desktop/`):

```bash
npm install
npm run dev      # concurrent: tsc watch for main + vite :5173 + electron
npm run build    # build:main (tsc) + build:renderer (vite)
npm run package  # electron-builder → dist/packaged/*.dmg
npm run lint     # tsc --noEmit for both main & renderer tsconfigs
```

There is no test suite and no single-test command — `lint` is the primary automated check for both apps.

## Environment & config

- `GEMINI_API_KEY` is required by `src/lib/ai.ts`. Vite injects it via `define` in [vite.config.ts](vite.config.ts#L11) as `process.env.GEMINI_API_KEY`. In AI Studio this is auto-injected; locally, put it in `.env.local`.
- `firebase-applet-config.json` is committed and loaded directly by [src/firebase.ts](src/firebase.ts#L4). It includes a non-default `firestoreDatabaseId` — always pass it to `getFirestore(app, firebaseConfig.firestoreDatabaseId)`.
- `firebase-blueprint.json` documents the Firestore entity schemas (User, Location, Product, Basket, InventoryLog). Note: the committed blueprint and the Firestore rules disagree on `Basket` shape — rules are authoritative (`name`, `trayCount`, `vialsPerTray`, `looseVials`).
- `firestore.rules` enforces role-based access. The admin bootstrap email is hardcoded (`duval.villegas@gmail.com`) in both [firestore.rules](firestore.rules#L15) and [src/contexts/AuthContext.tsx](src/contexts/AuthContext.tsx#L40). First sign-in auto-creates a user doc with role `admin` for that email, else `staff`.
- `vite.config.ts` has a comment explicitly warning that file watching is controlled via `DISABLE_HMR` to prevent flickering during AI Studio agent edits — don't change that logic casually.

## Print job architecture

The end-to-end print flow spans Firestore + both apps:

1. Web app writes a `PrintJob` doc to Firestore collection `printJobs` with `status: 'pending'` (see [src/shared/types.ts](src/shared/types.ts) for the shape). The web app's `PrintStation` page was the original renderer; the desktop app replaces it.
2. Desktop renderer's [`usePrintJobQueue`](src/shared/printJobSubscription.ts) (imported from `@shared`) subscribes via `onSnapshot`, maintains a FIFO in-memory queue, and drives one active job at a time.
3. On an active job, the renderer calls `window.printServer.printJob(job)` (exposed by `desktop/main/preload.ts`). Main-process [`dispatchPrintJob`](desktop/main/printDispatcher.ts) spawns a hidden `BrowserWindow` loading `print.html`, waits for a `render:ready` IPC from the print renderer (with a 1.5 s fallback timeout), calls `webContents.printToPDF`, writes to a temp file, then `spawn('lp', ['-d', cupsPrinter, ...lpOptions, tmpPdf])`.
4. On success the renderer marks the Firestore doc `status: 'completed'`; on failure the job is simply dropped from the in-memory queue (the Firestore doc stays `pending` for retry).

Key invariants:
- Printer format keys (`'4x3' | '1.5x1.5' | '2.5x0.7' | '2.5x1.5' | 'canon-integrated'`) must match between `LabelFormat` in `src/shared/types.ts`, the `format` enum in `firestore.rules` (`isValidPrintJob`), and the `formats` map in `desktop/config/printers.json` / `DEFAULT_CONFIG` in [configLoader.ts](desktop/main/configLoader.ts#L17). Adding a format means updating all four.
- `printers.json` is hot-reloaded via `fs.watch`. In dev it lives at `desktop/config/printers.json`; when packaged it moves to `~/Library/Application Support/VialTrack Print Server/printers.json`. The config loader seeds defaults if missing.
- The `canon-integrated` format prints a full Letter page with content positioned onto an adhesive patch via `stickyRegion` (inches). `LabelContent.tsx` consumes that region to place the label body.
- CUPS printer names must match `lpstat -p` exactly. `lpOptions` in the config are passed literally as CLI args to `lp`.

## Firestore collections

Defined in [firestore.rules](firestore.rules): `users`, `locations`, `products`, `baskets`, `inventoryLogs` (immutable after create), `printJobs`. All reads require auth; most writes require `staff` or `admin`; deletes are admin-only (except `printJobs`). Role is read from `/users/{uid}.role` or granted via the hardcoded admin email.

## Desktop packaging notes

- Packaged app runs as a tray-only app (`app.dock.hide()`), auto-launches at login (hidden), and keeps running when the window is closed. See [desktop/main/index.ts](desktop/main/index.ts).
- Logs stream to `~/Library/Logs/VialTrack Print Server/print-server.log`.
- First unsigned launch needs right-click → Open (Gatekeeper).
- macOS print-dialog "Presets" don't apply to `lp`; bake equivalents into CUPS with `lpoptions -p <printer> -o ...` — documented in [desktop/README.md](desktop/README.md).
