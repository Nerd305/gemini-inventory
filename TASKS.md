# VialTrack — Open Tasks

Working list of loose threads from the 2026-04-30 audit, plus the AI Performance / live counter follow-ups.

Tier numbers match the audit framing: lower tier = higher severity.

---

## Recently shipped

- **v1.0.9** — Bins / trays / fridges model to match the physical fridge. Bins hold a *variable* number of trays (`trayCount` stepper + loose-vial stepper live in the count panel; the old hardcoded 6-slot grid is gone). Tray counter defaults to a full tray (25), shows a 5×5 pocket grid, and the Gemini prompt now knows the tray geometry and transcribes the compounding label (lot #, date compounded, BUD) into the tray doc with expiry flags. New **/bins** page (create/edit, fridge→shelf grouping, staleness, tray detail, `BSKT:` label + batch `TRAY:` labels); **Locations** gained `shelfCount` and batch `SHELF:` labels — previously nothing in the app printed the codes `/count` expects. `TRAY:` scans open the slot directly. Finishing a bin writes `totalVials`/`lastCountedAt`; **Complete & Sync** reconciles `products.currentStock` from bins and logs `COUNT` entries. Sessions are created lazily (no more ghost sessions from StrictMode), track gross vials/trays, and are marked paused/abandoned on exit. Dashboard "Today's Count" coverage card; mobile nav trimmed to Home/Count/Bins/Items/More. See [src/lib/inventory.ts](src/lib/inventory.ts).

- **v1.0.7** — AI Performance Stats panel now reads live from Firestore (`learningData`). Replaced fake hardcoded stats with `getCountFromServer` + `getAggregateFromServer` aggregates and a 28-day weekly trend bucket. Empty-state copy added. See [src/lib/learning.ts](src/lib/learning.ts), [src/pages/Settings.tsx](src/pages/Settings.tsx).
- **v1.0.8** — Live vials/baskets counter on `/count` (TopBar). Subscribes to the active `countingSessions` doc via `onSnapshot`; shows "N baskets" and "Δ ±N vials" pills, replacing the misleading "🧠 Learning" badge. See [src/contexts/CountingSessionContext.tsx](src/contexts/CountingSessionContext.tsx), [src/pages/CountSession.tsx](src/pages/CountSession.tsx).
- **v1.0.8** — Tier 1 #1 (`lastScanRef` ReferenceError on `/count`) — fixed inline; required for the counter to be testable.

---

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

## Counter follow-ups

- [x] **Gross vials counted (not just delta)** — `progress.vialsCounted` (v1.0.9). Tray docs carry `sessionId` so a re-count in the same session replaces instead of adding.
- [x] **Trays counted (not just baskets)** — `progress.traysCounted` (v1.0.9).
- [x] **Mobile rendering** — compact "bins · trays · vials" pill always visible; Δ pill desktop-only (v1.0.9).

## Bins / trays follow-ups (v1.0.9 loose ends)

- [ ] **Resume a paused session** — sessions are marked `paused` on exit when bins were counted, but there is no way to pick one back up; the dashboard hides them after 24h. Either add resume or mark them `abandoned` too.
- [ ] **Tray identity vs. slot** — trays are addressed by slot (`slot-N`). If lots need to be tracked as trays move between bins, promote trays to their own docs keyed by lot and reference them from bins. Lot/BUD per slot is captured today, which is enough for expiry flags.
- [ ] **BUD report** — tray docs now carry `bud`; add a Reports view listing trays expiring in the next 30 days across all bins (needs a collection-group query on `trays` + an index).
- [ ] **`appSettings.fridges` vs `locations.shelfCount`** — two layout configs. Nothing reads `appSettings.fridges` in the count flow; migrate the Settings UI to edit `locations` and drop `FridgeConfig`.
- [ ] **Stale tray docs beyond `trayCount`** — ignored by totals but never deleted (staff can't delete tray docs). An admin cleanup or a rules change to allow the counter to delete slot docs > `trayCount` would tidy this.
- [ ] **Learning samples from the tray label** — `learningData` stores only the count; store the AI's label transcription vs. the user's correction to measure OCR accuracy too.
