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
node scripts/bump-version.js # Bump patch version and sync src/lib/version.ts + index.html <title>
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
- `firebase-blueprint.json` documents the Firestore entity schemas (User, Location, Shelf, Product, Basket, Tray, InventoryLog, CountingSession, LearningDataEntry, AppSettings, FridgeConfig). **Rules are authoritative** for on-disk shapes (`Basket` requires `name`, `trayCount`, `vialsPerTray`, `looseVials`, `qrCode`; `Tray` requires `slot`, `count`).
- `appSettings.fridges` (FridgeConfig with `shelfCount`/`basketSlotsPerShelf`) is a legacy layout config that nothing in the count flow reads; the live source of shelf layout is `locations.shelfCount`.
- `firestore.rules` enforces role-based access. **Two** bootstrap admin emails are hardcoded in both [firestore.rules](firestore.rules#L15) and [src/contexts/AuthContext.tsx](src/contexts/AuthContext.tsx#L34-L36): `duval.villegas@mdexam.com` and `duval.villegas@gmail.com`. First sign-in for either auto-creates a user doc with role `admin`; other emails must be present in `/whitelist/{email}` (lowercase) or sign-in is rejected.
- `vite.config.ts` has a comment explicitly warning that file watching is controlled via `DISABLE_HMR` to prevent flickering during AI Studio agent edits — don't change that logic casually.

## Pages & navigation

Routes are declared in [src/App.tsx](src/App.tsx). `/count` is full-screen (outside `Layout`); everything else renders inside [Layout](src/components/Layout.tsx), whose `navItems` array has a `mobile` flag — only flagged items fit the phone bottom bar (Home, Count, Bins, Items, More); the rest (Locations, Reports, Print Station) are reachable from the desktop sidebar and the quick-links card at the top of Settings on phones.

- **/bins** ([src/pages/Bins.tsx](src/pages/Bins.tsx)) — create/edit bins (product, fridge, shelf, trays, vials/tray, loose), grouped fridge → shelf, last-counted staleness, bin detail with per-tray counts and lot/BUD, bin QR label and batch tray labels.
- **/locations** — fridges/cabinets with `shelfCount`; "Shelf labels" prints/batches `SHELF:` codes.
- **/** (Dashboard) — [SetupGuide](src/components/SetupGuide.tsx) checklist (fridges → shelf labels → products → bins → bin labels → first count → Complete & Sync; detected from Firestore, label steps can be ticked by hand, hides itself when done or dismissed via localStorage), the "Today's Count" coverage card (bins finished today, vials on hand, bins not counted in 7 days) and live sessions from the last 24h. Setup pages show a one-line [NextStepHint](src/components/NextStepHint.tsx) pointing at the next stage; `/count` tells first-time users to set up bins when none exist.

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

## Physical model & label formats

The pharmacy hierarchy the app models (see the fridge photos in the project history):

```
Fridge / cabinet  (locations/{id}, optional shelfCount)
  └─ Shelf         derived ID `{locationId}-{n}`, n = 1 at the top   → QR  SHELF:{locationId}-{n}
       └─ Bin      plastic basket, ONE product, variable # of trays  (baskets/{id})  → QR  BSKT:{basketId}
            └─ Tray  5×5 molded insert, 25 pockets, usually full     (baskets/{id}/trays/slot-N) → QR  TRAY:{basketId}-{slot}  (optional)
                 └─ vials
```

- Helpers for all of this live in [src/lib/inventory.ts](src/lib/inventory.ts): QR builders/parsers (`basketQrCode`, `shelfQrCode`, `trayQrCode`, `parseShelfId`, `parseTrayId`, `describeShelf`), doc types (`BasketDoc`, `TrayDoc`, `LocationDoc`), totals (`basketTotal`, `liveBasketTotal`), BUD helpers, and the write paths used by the count flow (`recordTrayCount`, `setAllTraysFull`, `finalizeBasketCount`, `syncProductStockFromBaskets`).
- **Bins hold different numbers of trays.** `baskets.trayCount` is the declared count and is adjustable mid-count from the bin panel; tray docs beyond `trayCount` are ignored (never deleted — staff can't delete tray docs).
- **Most trays are full (25); partial trays get a true count.** `vialsPerTray` (default 25) is the capacity; the tray counter offers "Full 25", AI count, or manual +/-.
- `baskets.totalVials` is denormalized when a bin is *finished* (`finalizeBasketCount`), together with `lastCountedAt/By`. Until a bin has been finished once, `basketTotal()` falls back to `trayCount × vialsPerTray + looseVials`.
- Labels: bins and shelf labels are printed from **/bins** and **/locations** (single label via `LabelPrinter`, batches via `sendPrintJobs` in [src/lib/printing.ts](src/lib/printing.ts)). The 2.5"×1.5" Epson format fits the bin tag sleeves. Firestore auto-IDs never contain "-", which is what makes the `{id}-{n}` shelf/tray suffix parseable.
- Legacy: `/scan` used to mint `CONT:<timestamp>` basket codes, which `/count` cannot resolve. It now mints `BSKT:` codes too and still resolves old `CONT:` labels by the `qrCode` field.

## Counting flow

There are two scan flows in the codebase, but only one is canonical:

- **Canonical: `/count`** — driven by [src/contexts/CountingSessionContext.tsx](src/contexts/CountingSessionContext.tsx). The `countingSessions` doc is created **lazily on the first recognized scan** (not on mount — StrictMode double-mounting used to create ghost sessions). Parses `SHELF:`, `BSKT:`, `TRAY:` codes; a `TRAY:` scan activates its bin and opens that slot directly. Enforces a soft lock so two users can't count the same bin. [BottomPanel](src/components/counting/BottomPanel.tsx) routes between [BasketDetail](src/components/counting/BasketDetail.tsx) (tray grid sized by `trayCount`, tray/loose steppers, All full, Finish), [TrayCount](src/components/counting/TrayCount.tsx) (count + AI + lot/BUD capture, writes via `recordTrayCount`) and [PutBackConfirm](src/components/counting/PutBackConfirm.tsx). Finishing a bin (explicit button, "All full", or accepting the last tray) runs `finalizeBasketCount` and then waits for the shelf scan. Ending the session shows [SessionReview](src/components/counting/SessionReview.tsx); **Complete & Sync** sets each counted product's `currentStock` to the sum of its bins and writes an immutable `COUNT` inventory log.
- Session progress fields: `progress.totalVials` (net Δ vs. stored tray counts), `progress.vialsCounted` (gross), `progress.traysCounted`, `progress.basketsCounted`, plus `countedBaskets[]`. Tray docs carry the `sessionId` that last wrote them so re-counting a tray in the same session replaces rather than adds. Leaving `/count` without completing marks the session `paused` (if bins were counted) or `abandoned`.
- **Deprecated: `/scan`** — [src/pages/Scanner.tsx](src/pages/Scanner.tsx) (self-labeled "Inventory Scanner (Deprecated)"). Still hosts the legacy Basket Setup and Reassign flows; prefer **/bins** for bin setup.

Both flows write `learningData` samples (image + AI prediction + user-confirmed count + delta) for future model fine-tuning. `/count` threads the real `productId`; `/scan`'s guided/dialog paths use placeholder IDs (`scanner_guided`, `scanner_unknown`) and so should not be relied on for per-product accuracy.

The Gemini tray prompt ([src/lib/ai.ts](src/lib/ai.ts) `countVialsInTray`) is told the tray geometry (rows × cols, capacity) and also transcribes the compounding label (product, strength, lot #, date compounded, BUD, quantity made) when it is in frame; TrayCount stores `lotNumber`/`bud`/`dateCompounded`/`labelText` on the tray doc and flags BUDs that are expired or within 30 days.

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
- `locations` (+ `locations/{id}/shelves/{shelfId}` subcollection, unused by the app) — fridges/cabinets with `LOC:` QR codes and an optional `shelfCount` that drives `SHELF:` labels.
- `products` — catalog with `currentStock`, `category`, `reorderPoint`.
- `baskets` (+ `baskets/{id}/trays/{trayId}` subcollection) — bins; `trayCount` varies per bin, `totalVials`/`lastCountedAt` are set when a bin is finished. Tray docs (`slot-N`, validated by `isValidTray`) hold `count` plus optional `sessionId`, `aiPrediction`, `lotNumber`, `bud`, `dateCompounded`, `labelText`.
- `inventoryLogs` — immutable after create (`allow update: if false`); admin-only delete (used for factory resets). `COUNT` entries (with `previousCount`/`newCount`/`sessionId`) come from Complete & Sync.
- `printJobs` — see Print job architecture above.
- `config/{configId}` — singleton `appSettings` doc holding `fridges` (FridgeConfig list), `hudEnabled`, `capColorMap`, `apiBridgeConfig`. Admin-only writes.
- `countingSessions` — in-progress counts with `status` ∈ `active | in_progress | paused | completed | abandoned`, `progress.{totalVials,vialsCounted,traysCounted,basketsCounted}`, `countedBaskets[]`, `activeBasketId`. Validated by `isValidCountingSession`.
- `learningData` — per-tray AI training samples (`imageBase64`, `aiPrediction`, `userFinalCount`, `delta`, `productId`, `trayId`, `basketId`, `userId`, `timestamp`). No schema validator in rules — staff can write any shape.

All reads require auth; most writes require `staff` or `admin`; deletes are admin-only (except `printJobs`). Role is read from `/users/{uid}.role` or granted via either bootstrap admin email.

## Desktop packaging notes

- Packaged app runs as a tray-only app (`app.dock.hide()`), auto-launches at login (hidden), and keeps running when the window is closed. See [desktop/main/index.ts](desktop/main/index.ts).
- Logs stream to `~/Library/Logs/VialTrack Print Server/print-server.log`.
- First unsigned launch needs right-click → Open (Gatekeeper).
- macOS print-dialog "Presets" don't apply to `lp`; bake equivalents into CUPS with `lpoptions -p <printer> -o ...` — documented in [desktop/README.md](desktop/README.md).
