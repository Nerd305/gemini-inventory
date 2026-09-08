# VialTrack — Open Tasks

Working list of loose threads from the 2026-04-30 audit, plus the AI Performance / live counter follow-ups.

Tier numbers match the audit framing: lower tier = higher severity.

---

## Recently shipped

- **v1.0.7** — AI Performance Stats panel now reads live from Firestore (`learningData`). Replaced fake hardcoded stats with `getCountFromServer` + `getAggregateFromServer` aggregates and a 28-day weekly trend bucket. Empty-state copy added. See [src/lib/learning.ts](src/lib/learning.ts), [src/pages/Settings.tsx](src/pages/Settings.tsx).
- **v1.0.8** — Live vials/baskets counter on `/count` (TopBar). Subscribes to the active `countingSessions` doc via `onSnapshot`; shows "N baskets" and "Δ ±N vials" pills, replacing the misleading "🧠 Learning" badge. See [src/contexts/CountingSessionContext.tsx](src/contexts/CountingSessionContext.tsx), [src/pages/CountSession.tsx](src/pages/CountSession.tsx).
- **v1.0.8** — Tier 1 #1 (`lastScanRef` ReferenceError on `/count`) — fixed inline; required for the counter to be testable.
- **v1.0.9** — Scan-and-tap counting rebuilt around the physical layout (fridge → shelf → basket, back/front × left/right slots). Baskets are counted as full trays + loose vials in one screen (`QuickCount`), every level is reachable by scan *or* tap, new baskets are registered and labelled in place, and shelf/fridge/basket labels print on the fly to the 2×1.5" Epson stock (`2x1.5` format added across web, rules and desktop). iPhone camera selection now prefers the main back camera. Locations page gained `shelfCount` and a shelf-by-shelf map with print buttons. `@types/react` installed so the whole tree type-checks. See [src/lib/inventory.ts](src/lib/inventory.ts), [src/lib/scanCodes.ts](src/lib/scanCodes.ts), [src/contexts/CountingSessionContext.tsx](src/contexts/CountingSessionContext.tsx), [src/components/counting/](src/components/counting/).

---

## Loose ends after v1.0.9 (scan-and-tap counting)

- [ ] **Deploy rules** — `firebase deploy --only firestore:rules` is required before Firestore accepts `2x1.5` print jobs and validates `locations.shelfCount` / `baskets.lotNumber`. Until then the app still works; only 2x1.5 print jobs are rejected (the dialog explains why).
- [ ] **Print server config** — add the `2x1.5` entry to `~/Library/Application Support/VialTrack Print Server/printers.json` on the iMac (packaged installs never overwrite the file) and make sure the Epson has a `Custom.2x1.5in` media size.
- [ ] **Settings → Fridge Configuration is redundant** — the count flow reads `locations.shelfCount`, not `config/appSettings.fridges`. Either delete that Settings section or migrate it to edit `locations`.
- [ ] **Product `currentStock` drift** — counts adjust stock by delta (best effort). Add an admin "Recalculate stock from baskets" action (sum of `trayCount*vialsPerTray+looseVials` per product) to resync after legacy data.
- [ ] **`/scan` Basket Setup** still creates `CONT:` codes without `shelfId`; the count flow resolves them, but new baskets should be created from `/count` → "New basket" instead. Consider deleting the page.
- [ ] **Slot map UI** — `shelfPosition` (1–4) is captured; the Locations fridge map only sorts by it. A true 2×2 grid per shelf (like the reference screenshots) is a small follow-up.

## Tier 1 — Blocking (`npm run lint` is currently red on these)

- [x] **lastScanRef undefined** — [src/contexts/CountingSessionContext.tsx](src/contexts/CountingSessionContext.tsx). The dedupe ref was scaffolded out, causing a runtime ReferenceError on the first QR scan. **Fixed in v1.0.8.**
- [x] **apibridge import path** — [src/lib/apibridge.ts:2](src/lib/apibridge.ts#L2). `import { db } from './firebase'` should be `'../firebase'`. One-line fix.
- [x] **Dashboard `<LiveSessionCard key={...} />`** — [src/pages/Dashboard.tsx:121](src/pages/Dashboard.tsx#L121). React 19 + strict TS rejecting `key` because `LiveSessionCardProps` doesn't allow it. Either retype the component or remove the local `CountingSession` interface in favor of a shared one.

## Tier 2 — Silent prod bugs (compile fine, fail at runtime)

- [x] **`canon-integrated` print format not whitelisted in [firestore.rules:86](firestore.rules#L86).** CLAUDE.md explicitly documents the four-place invariant ("LabelFormat in src/shared/types.ts, the format enum in firestore.rules, and the formats map in desktop/config/printers.json"). Letter-size print jobs are silently rejected by Firestore validation. Shipped in commit `ac70a9f`. **One-line rule edit. Highest leverage in this tier.**
- [x] **API bridge schema split.** [src/lib/config.ts:13-17](src/lib/config.ts#L13-L17) writes `{webhookUrl, apiKey, enabled}`; [src/lib/apibridge.ts:4-10](src/lib/apibridge.ts#L4-L10) reads `{endpointUrl, apiKey, enabled, syncDirection, pollIntervalMs}`. Result: `pushInventoryUpdate` always calls `fetch(undefined, ...)`. Two callers silently fail every time: [src/pages/Scanner.tsx:346](src/pages/Scanner.tsx#L346), [src/pages/Scanner.tsx:463](src/pages/Scanner.tsx#L463). Pick one schema, migrate, delete the other.
- [x] **`productId: 'unknown'` hardcoded** — [src/components/counting/TrayCount.tsx:92](src/components/counting/TrayCount.tsx#L92). Every `learningData` doc lacks its product. Per-product accuracy is impossible until this is threaded from basket → TrayCount.

## Tier 3 — Unwired infrastructure (real code, no deploy path)

- [x] **[server.js](server.js) — sale-event webhook backend.** Working `firebase-admin` express server on `:3001` with auth + transactional inventory decrement. Not deployed: no `start` script, not in [Dockerfile](Dockerfile), no `/api/*` proxy in [nginx.conf](nginx.conf), no Hosting/Functions block in [firebase.json](firebase.json). Architectural decision needed: Cloud Run? Firebase Functions? Drop the feature? -> **Resolved by migrating to a Node server in Dockerfile that serves both the UI and the webhook API.**
- [x] **[test-page.cjs](test-page.cjs)** — one-off Playwright smoke test against `localhost:3000`. Not in CI, no test runner. Either turn into a real e2e harness or delete. -> **Deleted.**

## Tier 4 — Schema / documentation drift

- [x] **Blueprint vs reality on `LearningDataEntry`** — [firebase-blueprint.json:148-160](firebase-blueprint.json#L148-L160) declares `{imageUrl, predictedCount, actualCount, userId, createdAt}`. [src/lib/learning.ts](src/lib/learning.ts) actually writes `{imageBase64, aiPrediction, userFinalCount, delta, capColors, productId, trayId, basketId, userId, timestamp, proactiveTeach, notes}`. Update the blueprint or migrate the code.
- [x] **Blueprint vs rules on `Basket`** — already noted in [CLAUDE.md](CLAUDE.md): "rules are authoritative." Reconcile.
- [x] **No validators for `countingSessions` or `config`** — [firestore.rules](firestore.rules). Any client can write garbage shapes (e.g. `countedBaskets: "hi"` would crash [SessionReview.tsx:32](src/components/counting/SessionReview.tsx#L32)).
- [x] **`proactiveTeach` field** — declared in `LearningRecord`, never set anywhere. Dead scaffolding — delete or document the intended UX.

## Tier 5 — Loose ends

- [x] **`getApiBridgeConfig`** — [src/lib/apibridge.ts:12](src/lib/apibridge.ts#L12). Exported, never imported. Dead helper duplicating logic in `loadAppSettings`.
- [x] **Two competing scan flows** — `/scan` ([src/pages/Scanner.tsx](src/pages/Scanner.tsx)) and `/count` ([src/pages/CountSession.tsx](src/pages/CountSession.tsx)). Both write inventory. Pick canonical, deprecate other.
- [x] **Scanner.tsx isn't recording learning samples** — [src/pages/Scanner.tsx:430](src/pages/Scanner.tsx#L430) calls `countVialsInTray` but never writes to `learningData`. Half the AI counts in the system are missing from the dataset.
- [x] **App version display** — [src/lib/version.ts](src/lib/version.ts) is mirrored from `package.json` via `scripts/bump-version.js`. Verify [.firebaserc](.firebaserc) project (`gen-lang-client-0920383400`) vs [firebase.json](firebase.json) database ID (`ai-studio-198437a8-...`) — different naming conventions, easy to confuse.

## AI feedback loop (separate roadmap — only after Tier 2 #6 is fixed)

These are the "use the data, not just collect it" follow-ups from the AI Performance review.

- [ ] **Phase 2** — Wire Scanner.tsx to `saveLearningRecord` (Tier 5 above), thread `productId` through TrayCount (Tier 2 #6), migrate `imageBase64` → Cloud Storage URL.
- [ ] **Phase 3** — Admin "Learning Insights" viewer: last 20 records sorted by `|delta|` desc, with thumbnails. Read-only.
- [ ] **Phase 4a** — Per-product confidence flag. Surface "this product historically undercounts by ~1.5 vials" as a warning banner in TrayCount. Does not auto-modify the AI's number. Cheap, deterministic.
- [ ] **Phase 4b** — Few-shot prompt augmentation. Inject top-3 past corrections into Gemini prompts. Requires Phase 2 done + an A/B harness. Real "learning."

## Counter follow-ups (defer until requested)

- [x] **Gross vials counted (not just delta)** — `progress.totalVials` is now gross vials counted and `progress.netDelta` the net change; both shown in the top bar and the session review. **Shipped in v1.0.9.**
- [x] **Trays counted (not just baskets)** — superseded: trays are no longer counted individually (full trays + loose vials per basket). **v1.0.9.**
- [x] **Mobile rendering** — counters now render as a compact row under the top bar on every screen size. **Shipped in v1.0.9.**
