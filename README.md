# VialTrack AI

Physical inventory for a compounding pharmacy fridge, built for phones and an iMac label station.

Every fridge shelf, plastic bin and 25-pocket tray gets a QR label. Staff scan a shelf, scan a bin,
tap each tray (full, AI-counted from a photo, or typed), and the app keeps running totals, the
lot / BUD of every tray for first-in-first-out use, and a count history the business can pull over
an API or as a spreadsheet.

| I want to… | Read |
| --- | --- |
| Install the app on a phone | [docs/QUICKSTART.md](docs/QUICKSTART.md) §3 — Safari *Add to Home Screen*, Chrome *Install app* |
| Use the app (setup, counting, FIFO, printing, exports) | **[docs/QUICKSTART.md](docs/QUICKSTART.md)** — also pops up on first launch and behind the **?** button in the app |
| Pull counts / stock into another system | [docs/API.md](docs/API.md) — also the **API** page in the app (any signed-in user) |
| Install the label print server on the iMac | [desktop/README.md](desktop/README.md) and the section below |
| Understand the code before changing it | [CLAUDE.md](CLAUDE.md) (architecture notes), [TASKS.md](TASKS.md) (open items) |

Live app: https://blu35inventory-156214809618.us-west1.run.app (Cloud Run service `blu35inventory`, us-west1, deployed by GitHub Actions from `main`; see "Deploy the web app" below). The earlier `vialtrack-ai` service is retired.

## What is in this repository

```
/                 React 19 + Vite + Tailwind web app (phone + desktop), served by server.js
server.js         Express: hosts the build, sale webhook, read-only reporting API (/api/v1)
desktop/          Electron macOS print server: Firestore printJobs → CUPS printers (Zebra / Epson / Canon)
src/shared/       Types + hooks shared by the web app and the print server
public/           App manifest + icons for phone install (regenerate with node scripts/make-icons.mjs)
firestore.rules   Security rules (role-based) — deploy these whenever they change
docs/             Quick start for staff and testers, API reference
```

The physical model the app follows:

```
Fridge (location, N shelves)
  └─ Shelf   → QR  SHELF:<locationId>-<n>     (1 = top)
       └─ Bin (one product, any number of trays)   → QR  BSKT:<binId>
            └─ Tray (5×5 = 25 pockets, lot # / date compounded / BUD)   → QR  TRAY:<trayId>
                 └─ vials
```

## Setup

### 1. Prerequisites

- Node.js 22 and npm
- A Google account on the whitelist (the two bootstrap admin emails are hard-coded in
  `firestore.rules` and `src/contexts/AuthContext.tsx`; everyone else is invited from **Settings → Users**)
- Gemini API key (AI vial counting and label reading). In production it lives in Google Secret Manager and never reaches
  the browser; locally it goes in `.env.local`
- Firebase project `gen-lang-client-0920383400`, Firestore database
  `ai-studio-198437a8-7e10-4c8b-9a00-22acac4c2d1f` (a **named** database, not `(default)`)

### 2. Run the web app locally

```bash
npm install
echo 'GEMINI_API_KEY=your-key' >> .env.local  # git-ignored; used only by the local AI proxy, never put in the bundle
npm run dev                                   # http://localhost:3000
npm run lint                                  # tsc type-check (the only automated check)
npm run build                                 # production bundle → dist/
```

Sign-in uses Google popup auth; add `localhost` to Firebase Auth → Authorized domains if it complains.

### 3. Firestore rules

Rules live in `firestore.rules` and must be deployed separately from the app whenever they change
(new collections such as `trays` are denied until the rules that allow them are live):

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only firestore:rules --project gen-lang-client-0920383400
```

Or paste the file into Firebase Console → Firestore → **switch the database dropdown to the named
database** → Rules → Publish.

### 4. Deploy the web app (Cloud Run, from GitHub)

Merging to `main` deploys the app: the **CI** workflow (type-check + build) runs, and when it passes the
**Deploy** workflow (`.github/workflows/deploy.yml`) builds the image, pushes it to Artifact Registry, starts a
new Cloud Run revision with **no traffic**, smoke-tests it (right version and commit, Gemini key accepted,
database reachable, AI proxy refusing anonymous calls) and only then moves traffic to it. A bad build never
reaches staff. The Deploy workflow does nothing until you finish the one-time setup below.

**One-time setup (about 10 minutes, no coding):**

1. Open [Google Cloud Shell](https://shell.cloud.google.com) signed in as the project owner and run:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/Nerd305/gemini-inventory/main/scripts/gcp-setup-deploy.sh -o gcp-setup-deploy.sh
   bash gcp-setup-deploy.sh
   ```

   It turns on the Google services, creates the image store, stores your Gemini key in Secret Manager (it asks
   for it once and checks it with Google), creates a deployer account and a keyless trust that only this
   repository's `main` branch can use, and saves a copy of the current service as a rollback reference. It is
   safe to run again.
2. Add the two values it prints under GitHub → Settings → Secrets and variables → Actions → **Secrets**
   (`GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`) and the **variable** `DEPLOY_ENABLED` = `true`.
3. Wait about five minutes, then GitHub → Actions → **Deploy** → **Run workflow** (branch `main`).

**Day to day:** merge to `main` and watch the Deploy run. Confirm with `GET /api/v1/health`: `version`, `commit`
(the exact code commit), `gemini: "ok"`, and `?deep=1` adds `firestore: "ok"`. The same commit id shows after
the version badge in the app.

**Never press Deploy in Google AI Studio.** It would overwrite the service with its own wrapper and an old
copy of the code. If that happens, `/api/v1/health` shows `"commit": null`; run the Deploy workflow again.

**Rollback:** set `DEPLOY_ENABLED` to `false` first, then in the Cloud Run console open `blu35inventory` →
Revisions → the previous revision → *Manage traffic* → 100 % → Save (or
`gcloud run services update-traffic blu35inventory --region us-west1 --to-revisions <old-revision>=100`). Fix problems
forward on `main`; do not revert the merge that added the workflow.

**If the Google trust step fails** with a 403 right after setup, wait a few minutes and re-run the job. A
long-lived service-account key (`credentials_json` on the `google-github-actions/auth` step, from a
`GCP_SA_KEY` secret) also works but is less safe; prefer the keyless trust.

### 5. Label printing (iMac print server)

Labels are queued in Firestore (`printJobs`). Two things can print them:

1. **VialTrack Print Server** (recommended) — the Electron app in `desktop/`. It runs in the menu bar
   on the iMac connected to the printers and sends each job to the right CUPS printer.

   ```bash
   cd desktop
   npm install
   npm run setup          # detects printers with lpstat -p and writes config/printers.json
   npm run dev            # run it now, or:
   npm run package        # builds dist/packaged/*.dmg to install (right-click → Open the first time)
   ```

   Printer names in `printers.json` must match `lpstat -p` exactly. Formats: `4x3` (Zebra ZD410),
   `2.5x1.5` / `1.5x1.5` / `2.5x0.7` (Epson TM-C6000), `canon-integrated` (Letter sheets). The 2.5×1.5
   Epson label fits the bin tag sleeves and the trays. Logs:
   `~/Library/Logs/VialTrack Print Server/print-server.log`. Full details in [desktop/README.md](desktop/README.md).

2. **Print Station page** (fallback) — open **Print Station** in the web app on the computer wired to the
   printers, switch on **Auto-print on this device** and leave the tab open; each job opens the browser
   print dialog. The switch is per device and off by default so phones never take labels away from the
   iMac; do not turn it on where the Print Server app is also running.

Verify with **Print Station → Send Test Print**. The in-app setup checklist on the dashboard has a
"Set up label printing" step for exactly this.

### 6. First run in the app

The dashboard shows a **Setup progress** checklist that walks through: fridges (with shelf counts)
→ printing → shelf labels → products → bins → bin labels → first count → Complete & Sync. The
[quick start](docs/QUICKSTART.md) explains each step and the daily counting routine.

## Reporting API and spreadsheet exports

- **Reports → Exports** in the app downloads a 6-sheet Excel workbook (summary, products, bins, trays in
  use-first order with lot / BUD, count history, sessions) or any single table as CSV.
- `server.js` exposes the same data at `GET /api/v1/…` (JSON and `export.csv`), protected by the API key
  from **Settings → API Bridge**. See [docs/API.md](docs/API.md).
- `POST /api/webhook/sale` lets the ordering system decrement stock (needs the bridge enabled).

## server.js variables (all optional)

| Variable | When to set it |
| --- | --- |
| `FIRESTORE_DATABASE_ID` | Only to override the database from `firebase-applet-config.json`. Leave unset. |
| `VIALTRACK_API_KEY` | Only if you want the reporting API key to come from the environment instead of Settings → API Bridge. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Local runs of `node server.js` only (path to a service-account JSON). Never on Cloud Run, which supplies credentials itself. |
| `GEMINI_PROXY_KEY` / `GEMINI_API_KEY` | The Gemini key used by the server-side AI proxy. On Cloud Run it is the Secret Manager secret `gemini-api-key`, mounted as `GEMINI_PROXY_KEY` by the deploy; locally put `GEMINI_API_KEY` in `.env.local`. It is never baked into the web bundle. |
| `GIT_SHA` | Set by the deploy; shown as `commit` on `/api/v1/health` and after the version badge. |

## Development notes

- `npm run lint` is a `tsc --noEmit` type-check; there is no test suite. CI (`.github/workflows/ci.yml`)
  runs lint + build for the web app and lint for the desktop app on every push and pull request.
- Bump the version with `node scripts/bump-version.js` whenever you ship a change; it updates
  `package.json`, `src/lib/version.ts` and the `<title>`.
- AI calls go browser → `/api/ai/gemini` (this server, after checking the Firebase sign-in and the whitelist) →
  Google. `npm run dev` has its own small proxy for the same path (needs `GEMINI_API_KEY` in `.env.local`).
- The server removes the old Google AI Studio service worker from phones (`/_service-worker.js`); do not add a
  service worker of your own without checking that route.
- `/scan` is the deprecated first-generation scanner (still reachable from Settings → Legacy scanner);
  `/count` is the real counting flow.
- `firebase-blueprint.json` documents the Firestore document shapes; `firestore.rules` is authoritative.
