# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Three independent applications share one Firestore database and a `src/shared/` code folder:

- **Root (`/`)** — React 19 + Vite + Tailwind 4 web app (MedInventory / VialTrack), packaged into a Node container that also runs an Express webhook backend. Built for Google AI Studio; uses Gemini via `@google/genai` and Firebase Auth + Firestore.
- **`desktop/`** — Electron + Vite + TypeScript macOS print server (VialTrack Print Server). Runs on the pharmacy iMac, subscribes to the Firestore `printJobs` queue, and routes each job to a physical printer via CUPS (`lp`).
- **`mobile/`** — Expo SDK 57 / React Native iPhone app (VialTrack Count) that runs in Expo Go. Scan / tap / voice counting flow, visual AI vial counter, on-the-fly label printing. See [mobile/README.md](mobile/README.md). Its `metro.config.js` watches the repo root so it imports `../src/shared/*` and `firebase-applet-config.json` directly, blocks the root `node_modules`, and disables package-exports resolution (Firebase's React Native builds are reached through the legacy `react-native` field).

The desktop renderer imports shared types and the `usePrintJobQueue` hook from the root via Vite aliases:
- `@shared` → `../src/shared`
- `@firebase-config` → `../src/firebase`

Keep anything used by more than one app inside `src/shared/`; imports from `src/components`, `src/pages`, etc. will break the desktop and mobile builds. Shared modules must not import `src/firebase.ts` — Firestore-touching functions take the `db` handle as their first argument (`inventoryCore.ts`, `printJobs.ts`) and each app binds it (`src/lib/inventory.ts` / `src/lib/printing.ts` for web, `mobile/src/core.ts` for the phone). Shared today: `types.ts`, `labelFormats.ts`, `LabelContent.tsx` (web + desktop only, uses DOM), `printJobSubscription.ts`, `scanCodes.ts`, `inventoryCore.ts`, `printJobs.ts`, `voiceCommands.ts`.

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

Mobile app (from `mobile/`):

```bash
npm install
cp .env.example .env         # EXPO_PUBLIC_GEMINI_API_KEY
npx expo start               # Expo Go on the iPhone (same Wi-Fi) or --tunnel
npx tsc --noEmit             # type-check (strict)
npx expo export --platform ios --output-dir /tmp/x   # Metro bundling smoke test without a device
```

Desktop app (from `desktop/`):

```bash
npm install
npm run dev      # concurrent: tsc watch for main + vite :5173 + electron
npm run build    # build:main (tsc) + build:renderer (vite)
npm run package  # electron-builder → dist/packaged/*.dmg
npm run lint     # tsc --noEmit for both main & renderer tsconfigs
```

There is no test suite and no single-test command — `lint` / `tsc --noEmit` is the primary automated check for all three apps. The voice parser is pure and can be exercised with `npx tsx` (see `src/shared/voiceCommands.ts`).

`@types/react` / `@types/react-dom` are devDependencies on purpose: without them React imports silently type as `any` and `key` on function components fails to type-check.

## Environment & config

- `GEMINI_API_KEY` is required by `src/lib/ai.ts`. Vite injects it via `define` in [vite.config.ts](vite.config.ts#L11) as `process.env.GEMINI_API_KEY`. In AI Studio this is auto-injected; locally, put it in `.env.local`.
- `firebase-applet-config.json` is committed and loaded directly by [src/firebase.ts](src/firebase.ts#L4). It includes a non-default `firestoreDatabaseId` (`ai-studio-198437a8-7e10-4c8b-9a00-22acac4c2d1f`) — always pass it to `getFirestore(app, firebaseConfig.firestoreDatabaseId)`. The same database ID is also declared in [firebase.json](firebase.json) for the rules deploy target.
- The Firebase project ID is `gen-lang-client-0920383400` (see [.firebaserc](.firebaserc)). The two names look unrelated; do not confuse the project ID with the database ID.
- `firebase-blueprint.json` documents the Firestore entity schemas (User, Location, Product, Basket, InventoryLog, CountingSession, LearningDataEntry, AppSettings, FridgeConfig). The blueprint and Firestore rules historically disagreed on `Basket` shape; the blueprint now notes that **rules are authoritative** (`name`, `trayCount`, `vialsPerTray`, `looseVials`, `qrCode` required).
- The phone app cannot use Google sign-in inside Expo Go. Users attach a password to their Google-backed account from the web app (Settings → "Phone app sign-in", [src/components/MobilePasswordCard.tsx](src/components/MobilePasswordCard.tsx), `linkWithCredential`) and the phone signs in with email + password as the same uid/role. This requires the Email/Password provider to be enabled once in the Firebase console.
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

- **Canonical: `/count`** — driven by [src/contexts/CountingSessionContext.tsx](src/contexts/CountingSessionContext.tsx). The hierarchy is **fridge → shelf → basket**, and every level can be reached by scanning a label *or* by tapping, so counting works before any labels exist. [BottomPanel](src/components/counting/BottomPanel.tsx) routes `FridgePicker` → `ShelfPicker` → `ShelfBaskets` → `QuickCount`; [CountSession.tsx](src/pages/CountSession.tsx) owns the camera (html5-qrcode, prefers the iPhone's plain "Back Camera" over ultra-wide/telephoto), the camera on/off toggle, manual code entry and the scan feedback banner.
  - A basket is counted as **N full trays + loose vials** (`baskets/{id}.trayCount / vialsPerTray / looseVials`), matching the "4 trays + 22 vials" notation used on the floor. There are no per-tray documents any more (the old `baskets/{id}/trays/slot-N` docs are inert).
  - [`commitBasketCount()`](src/lib/inventory.ts) is the single write path: one transaction updates the basket (counts, `lastCountedAt/By`, optional re-assignment of `locationId/shelfId/shelfPosition`, optional `name/lotNumber` edits), appends an `inventoryLogs` `COUNT` entry with `previousCount/newCount`, and bumps the session doc (`progress.totalVials` = gross vials counted this session, `progress.netDelta`, `progress.basketsCounted`, `countedBaskets` via `arrayUnion`). The product's `currentStock` is adjusted afterwards as a best-effort follow-up (clamped ≥ 0) so a legacy product doc can never block a count.
  - [`createBasket()`](src/lib/inventory.ts) registers a basket in place (product picker with quick-create, lot, slot, initial count) with `qrCode = BSKT:<docId>` so its label can be printed immediately through `LabelPrinter`.
  - AI is used only for the loose (partial) tray: `AiCountButton` downsizes the photo to 1024 px, calls `countVialsInTray`, and `QuickCount` writes a `learningData` sample (`trayId: 'loose'`) on save.
  - Soft lock: opening a basket that another live session has as `activeBasketId` shows a confirm instead of blocking.
- **Deprecated: `/scan`** — [src/pages/Scanner.tsx](src/pages/Scanner.tsx) is unchanged. Its Basket Setup still generates `CONT:<timestamp>` codes, which `/count` resolves through the `qrCode` field.

### Scan code formats ([src/lib/scanCodes.ts](src/lib/scanCodes.ts))

| Payload | Meaning | Resolution |
| --- | --- | --- |
| `LOC:<x>` / `FRIDGE:<x>` | fridge (a `locations` doc) | doc id first, then `locations.qrCode == payload` (legacy `LOC:<timestamp>` labels keep working) |
| `SHELF:<locationId>/<n>` | shelf `n` (1-based, top to bottom) of that fridge | parsed locally; `baskets.shelfId` stores the same `<locationId>/<n>` string |
| `BSKT:<basketId>` / `CONT:<x>` | basket (one bin, or one lot inside a shared bin) | doc id first, then `baskets.qrCode == payload` |
| `TRAY:` / `PRODUCT:` | informational only | no state change |

The number of shelves per fridge is `locations.shelfCount` (default 5, editable on the Locations page, which also renders a shelf-by-shelf map with print buttons). `config/appSettings.fridges` (Settings → Fridge Configuration) is legacy and is not read by the count flow.

### Voice / typed commands ([src/shared/voiceCommands.ts](src/shared/voiceCommands.ts))

`parseVoiceCommands(text)` turns a sentence into commands: `fridge <query>`, `shelf <n>`, `basket <query>`, `count {trays, loose}`, `empty`, `full`, `save`, `back`. Spoken numbers are normalised first ("twenty two" → 22). `matchByName(query, items)` does the fuzzy pick of a fridge/basket. The mobile app feeds it from push-to-talk (expo-audio clip → Gemini transcript, `mobile/src/lib/voice.ts`, `transcribeCommand` in `mobile/src/lib/ai.ts`) and from a typed/dictated text field; the web app does not use it yet.

## Print job architecture

The end-to-end print flow spans Firestore + both apps:

1. Web app writes a `PrintJob` doc to Firestore collection `printJobs` with `status: 'pending'` (see [src/shared/types.ts](src/shared/types.ts) for the shape). The web app's `PrintStation` page was the original renderer; the desktop app replaces it.
2. Desktop renderer's [`usePrintJobQueue`](src/shared/printJobSubscription.ts) (imported from `@shared`) subscribes via `onSnapshot`, maintains a FIFO in-memory queue, and drives one active job at a time.
3. On an active job, the renderer calls `window.printServer.printJob(job)` (exposed by `desktop/main/preload.ts`). Main-process [`dispatchPrintJob`](desktop/main/printDispatcher.ts) spawns a hidden `BrowserWindow` loading `print.html`, waits for a `render:ready` IPC from the print renderer (with a 1.5 s fallback timeout), calls `webContents.printToPDF`, writes to a temp file, then `spawn('lp', ['-d', cupsPrinter, ...lpOptions, tmpPdf])`.
4. On success the renderer marks the Firestore doc `status: 'completed'`; on failure the job is simply dropped from the in-memory queue (the Firestore doc stays `pending` for retry).

Key invariants:
- Printer format keys (`'4x3' | '2x1.5' | '1.5x1.5' | '2.5x0.7' | '2.5x1.5' | 'canon-integrated'`) must match between `LabelFormat` in `src/shared/types.ts`, `LABEL_FORMAT_SPECS` in [src/shared/labelFormats.ts](src/shared/labelFormats.ts) (page sizes + option labels), the `format` enum in `firestore.rules` (`isValidPrintJob`), and the `formats` map in `desktop/config/printers.json` / `DEFAULT_CONFIG` in [configLoader.ts](desktop/main/configLoader.ts#L17). Adding a format means updating all five, plus a layout branch in `LabelContent.tsx`.
- `DEFAULT_LABEL_FORMAT` is `2x1.5` (Epson 2" × 1.5" stock): it is what the counting flow, the Locations fridge map and `LabelPrinter` pre-select for basket / shelf / fridge labels. `LabelContent` renders it as QR-left / text-right. Queue jobs through `enqueuePrintJob()` in [src/lib/printing.ts](src/lib/printing.ts). **The rules enum must be deployed (`firebase deploy --only firestore:rules`) before Firestore accepts `2x1.5` jobs**, and an already-installed print server needs the `2x1.5` entry added to its `printers.json`.
- `printers.json` is hot-reloaded via `fs.watch`. In dev it lives at `desktop/config/printers.json`; when packaged it moves to `~/Library/Application Support/VialTrack Print Server/printers.json`. The config loader seeds defaults if missing.
- The `canon-integrated` format prints a full Letter page with content positioned onto an adhesive patch via `stickyRegion` (inches). `LabelContent.tsx` consumes that region to place the label body.
- CUPS printer names must match `lpstat -p` exactly. `lpOptions` in the config are passed literally as CLI args to `lp`.

## Firestore collections

Defined in [firestore.rules](firestore.rules):

- `users` — profile + role (`admin` | `staff`). Self-create allowed; role can only be changed by an admin.
- `whitelist/{email}` — gates non-bootstrap sign-ins. Email is stored lowercased as the doc ID; admin-only writes.
- `locations` (+ an unused `locations/{id}/shelves/{shelfId}` subcollection) — fridges/cabinets with QR codes and an optional `shelfCount` (default 5). Shelves themselves are implicit (`SHELF:<locationId>/<n>`), not documents.
- `products` — catalog with `currentStock`, `category`, `reorderPoint`.
- `baskets` — one physical bin, or one lot inside a shared bin: `productId`, `locationId`, `name`, `trayCount`, `vialsPerTray`, `looseVials`, `qrCode`, optional `shelfId` (`<locationId>/<n>`), `shelfPosition` (1 back-left, 2 back-right, 3 front-left, 4 front-right), `lotNumber`, `lastCountedAt/By`. Written only by `commitBasketCount` / `createBasket` / `moveBasket` in `src/lib/inventory.ts`. The `baskets/{id}/trays` subcollection is legacy.
- `inventoryLogs` — immutable after create (`allow update: if false`); admin-only delete (used for factory resets).
- `printJobs` — see Print job architecture above.
- `config/{configId}` — singleton `appSettings` doc holding `fridges` (FridgeConfig list), `hudEnabled`, `capColorMap`, `apiBridgeConfig`. Admin-only writes.
- `countingSessions` — in-progress counts with `status` ∈ `active | in_progress | paused | completed | abandoned`, `progress.totalVials` (gross vials counted), `progress.netDelta`, `progress.basketsCounted`, `countedBaskets[]`, `activeBasketId`, `locationId` (active fridge). Validated by `isValidCountingSession`.
- `learningData` — AI training samples for the loose tray (`imageBase64` ≤ 1024 px JPEG, `aiPrediction`, `userFinalCount`, `delta`, `productId`, `trayId: 'loose'`, `basketId`, `userId`, `timestamp`). No schema validator in rules — staff can write any shape.

All reads require auth; most writes require `staff` or `admin`; deletes are admin-only (except `printJobs`). Role is read from `/users/{uid}.role` or granted via either bootstrap admin email.

## Desktop packaging notes

- Packaged app runs as a tray-only app (`app.dock.hide()`), auto-launches at login (hidden), and keeps running when the window is closed. See [desktop/main/index.ts](desktop/main/index.ts).
- Logs stream to `~/Library/Logs/VialTrack Print Server/print-server.log`.
- First unsigned launch needs right-click → Open (Gatekeeper).
- macOS print-dialog "Presets" don't apply to `lp`; bake equivalents into CUPS with `lpoptions -p <printer> -o ...` — documented in [desktop/README.md](desktop/README.md).
