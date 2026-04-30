# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Two independent applications share one Firestore database and a `src/shared/` code folder:

- **Root (`/`)** — React 19 + Vite + Tailwind 4 web app (MedInventory / VialTrack), packaged into a Node container that also runs an Express webhook backend. Built for Google AI Studio; uses Gemini via `@google/genai` and Firebase Auth + Firestore.
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
npm run start    # node server.js — Express on :8080 serves dist/ + /api/webhook/sale
npm run lint     # tsc --noEmit (type-check only; no ESLint configured)
node scripts/bump-version.js # Bump patch version and sync src/lib/version.ts
```

## Versioning

- The application version is defined in `package.json` and mirrored in `src/lib/version.ts`.
- **CRITICAL**: Whenever implementing new features or fixes, run `node scripts/bump-version.js` to increment the version number. This ensures the UI displays the latest rollout status.

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
- `firebase-applet-config.json` is committed and loaded directly by [src/firebase.ts](src/firebase.ts#L4). It includes a non-default `firestoreDatabaseId` (`ai-studio-198437a8-7e10-4c8b-9a00-22acac4c2d1f`) — always pass it to `getFirestore(app, firebaseConfig.firestoreDatabaseId)`. The same database ID is also declared in [firebase.json](firebase.json) for the rules deploy target.
- The Firebase project ID is `gen-lang-client-0920383400` (see [.firebaserc](.firebaserc)). The two names look unrelated; do not confuse the project ID with the database ID.
- `firebase-blueprint.json` documents the Firestore entity schemas (User, Location, Product, Basket, InventoryLog, CountingSession, LearningDataEntry, AppSettings, FridgeConfig). The blueprint and Firestore rules historically disagreed on `Basket` shape; the blueprint now notes that **rules are authoritative** (`name`, `trayCount`, `vialsPerTray`, `looseVials`, `qrCode` required).
- `firestore.rules` enforces role-based access. **Two** bootstrap admin emails are hardcoded in both [firestore.rules](firestore.rules#L15) and [src/contexts/AuthContext.tsx](src/contexts/AuthContext.tsx#L34-L36): `duval.villegas@mdexam.com` and `duval.villegas@gmail.com`. First sign-in for either auto-creates a user doc with role `admin`; other emails must be present in `/whitelist/{email}` (lowercase) or sign-in is rejected.
- `vite.config.ts` has a comment explicitly warning that file watching is controlled via `DISABLE_HMR` to prevent flickering during AI Studio agent edits — don't change that logic casually.

## Web server / webhook backend ([server.js](server.js))

`server.js` is a small Express app that does two jobs in a single process:

1. **Static SPA host** — serves the Vite build (`dist/`) with a SPA fallback for React Router.
2. **Inbound API bridge** — `POST /api/webhook/sale` decrements product stock when an external ordering system reports a sale. Reads `apiBridgeConfig` from `config/appSettings`, validates `Authorization: Bearer <apiKey>`, then runs a Firestore transaction that updates `products/{id}.currentStock` and writes an `inventoryLogs` entry with `userId: 'system'`.

Listens on `process.env.PORT || 8080`. Initialized via `firebase-admin` using ADC — locally set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account key, on Cloud Run / GCE the metadata server provides it automatically.

Deployment is a single-stage Docker build: [Dockerfile](Dockerfile) does `npm run build` → copies `dist/` and `server.js` into a slim Node 22 image → `node server.js`. There is no separate nginx layer (the previous `nginx.conf` was removed).

## API bridge (bidirectional)

The system has two halves of an external-ordering-system bridge, both gated by `appSettings.apiBridgeConfig.enabled`:

- **Outbound** ([src/lib/apibridge.ts](src/lib/apibridge.ts)): `pushInventoryUpdate(productId, newStock)` POSTs to `apiBridgeConfig.endpointUrl` with the bearer key. Called from [src/pages/Scanner.tsx](src/pages/Scanner.tsx) after stock writes.
- **Inbound** (`server.js`): `/api/webhook/sale` consumes events from the same external system, authenticated by the same `apiKey`.

The `ApiBridgeConfig` shape (`endpointUrl`, `apiKey`, `enabled`, `syncDirection`, `pollIntervalMs?`) is defined in [src/lib/config.ts](src/lib/config.ts#L13-L19); the Settings UI writes via `saveAppSettings`.

## Counting flow

There are two scan flows in the codebase, but only one is canonical:

- **Canonical: `/count`** — driven by [src/contexts/CountingSessionContext.tsx](src/contexts/CountingSessionContext.tsx). Creates a `countingSessions` doc on mount, parses QR codes (`SHELF:`, `BSKT:`, `TRAY:`), enforces a soft lock so two users can't count the same basket, and the [TrayCount](src/components/counting/TrayCount.tsx) component writes `baskets/{id}/trays/slot-N` and increments `progress.totalVials` + `arrayUnion(countedBaskets)` on the session doc. Live progress pills on `/count` subscribe to that doc via `onSnapshot`.
- **Deprecated: `/scan`** — [src/pages/Scanner.tsx](src/pages/Scanner.tsx) (self-labeled "Inventory Scanner (Deprecated)" at line 546). Still hosts Basket Setup and Reassign flows; the General/Guided flows render a deprecation banner pointing users to `/count`.

Both flows write `learningData` samples (image + AI prediction + user-confirmed count + delta) for future model fine-tuning. `/count` threads the real `productId`; `/scan`'s guided/dialog paths use placeholder IDs (`scanner_guided`, `scanner_unknown`) and so should not be relied on for per-product accuracy.

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

Defined in [firestore.rules](firestore.rules):

- `users` — profile + role (`admin` | `staff`). Self-create allowed; role can only be changed by an admin.
- `whitelist/{email}` — gates non-bootstrap sign-ins. Email is stored lowercased as the doc ID; admin-only writes.
- `locations` (+ `locations/{id}/shelves/{shelfId}` subcollection) — fridges/cabinets with QR codes.
- `products` — catalog with `currentStock`, `category`, `reorderPoint`.
- `baskets` (+ `baskets/{id}/trays/{trayId}` subcollection) — physical containers; tray docs are written by `TrayCount.tsx` with `slot-N` IDs.
- `inventoryLogs` — immutable after create (`allow update: if false`); admin-only delete (used for factory resets).
- `printJobs` — see Print job architecture above.
- `config/{configId}` — singleton `appSettings` doc holding `fridges` (FridgeConfig list), `hudEnabled`, `capColorMap`, `apiBridgeConfig`. Admin-only writes.
- `countingSessions` — in-progress counts with `status` ∈ `active | in_progress | paused | completed | abandoned`, `progress.totalVials`, `countedBaskets[]`, `activeBasketId`. Validated by `isValidCountingSession`.
- `learningData` — per-tray AI training samples (`imageBase64`, `aiPrediction`, `userFinalCount`, `delta`, `productId`, `trayId`, `basketId`, `userId`, `timestamp`). No schema validator in rules — staff can write any shape.

All reads require auth; most writes require `staff` or `admin`; deletes are admin-only (except `printJobs`). Role is read from `/users/{uid}.role` or granted via either bootstrap admin email.

## Desktop packaging notes

- Packaged app runs as a tray-only app (`app.dock.hide()`), auto-launches at login (hidden), and keeps running when the window is closed. See [desktop/main/index.ts](desktop/main/index.ts).
- Logs stream to `~/Library/Logs/VialTrack Print Server/print-server.log`.
- First unsigned launch needs right-click → Open (Gatekeeper).
- macOS print-dialog "Presets" don't apply to `lp`; bake equivalents into CUPS with `lpoptions -p <printer> -o ...` — documented in [desktop/README.md](desktop/README.md).
