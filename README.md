# VialTrack AI

Physical inventory for a compounding pharmacy fridge, built for phones and an iMac label station.

Every fridge shelf, plastic bin and 25-pocket tray gets a QR label. Staff scan a shelf, scan a bin,
tap each tray (full, AI-counted from a photo, or typed), and the app keeps running totals, the
lot / BUD of every tray for first-in-first-out use, and a count history the business can pull over
an API or as a spreadsheet.

| I want to… | Read |
| --- | --- |
| Use the app (setup, counting, FIFO, printing, exports) | **[docs/QUICKSTART.md](docs/QUICKSTART.md)** — also pops up on first launch and behind the **?** button in the app |
| Pull counts / stock into another system | [docs/API.md](docs/API.md) — also the **API** page in the app (any signed-in user) |
| Install the label print server on the iMac | [desktop/README.md](desktop/README.md) and the section below |
| Understand the code before changing it | [CLAUDE.md](CLAUDE.md) (architecture notes), [TASKS.md](TASKS.md) (open items) |

Live app: the Cloud Run URL shown after Deploy in AI Studio. (The earlier service at `vialtrack-ai-156214809618.us-west1.run.app` is retired and still serves v1.0.2.)

## What is in this repository

```
/                 React 19 + Vite + Tailwind web app (phone + desktop), served by server.js
server.js         Express: hosts the build, sale webhook, read-only reporting API (/api/v1)
desktop/          Electron macOS print server: Firestore printJobs → CUPS printers (Zebra / Epson / Canon)
src/shared/       Types + hooks shared by the web app and the print server
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
- Gemini API key (AI vial counting and label reading)
- Firebase project `gen-lang-client-0920383400`, Firestore database
  `ai-studio-198437a8-7e10-4c8b-9a00-22acac4c2d1f` (a **named** database, not `(default)`)

### 2. Run the web app locally

```bash
npm install
echo 'GEMINI_API_KEY=your-key' > .env.local   # git-ignored; Vite bakes it into the bundle
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

### 4. Deploy the web app (Cloud Run)

The repo has a multi-stage `Dockerfile`; nothing deploys automatically from `main`.

- **AI Studio**: pull the latest `main` from GitHub into the workspace, then Deploy. AI Studio injects
  `GEMINI_API_KEY` at build time.
- **gcloud** from a checkout of `main` with `.env.local` present:

  ```bash
  gcloud run deploy <service-name> --source . --region <region> --project gen-lang-client-0920383400   # name + region from the Cloud Run console
  ```

Confirm the deploy took: the version badge next to "VialTrack AI" on the login page matches
`package.json`, and `GET /api/v1/health` returns the same version.

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
   printers and leave the tab open; each job opens the browser print dialog.

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

If AI Studio asks for these when importing the repo, leave the values blank.

## Development notes

- `npm run lint` is a `tsc --noEmit` type-check; there is no test suite. CI (`.github/workflows/ci.yml`)
  runs lint + build for the web app and lint for the desktop app on every push and pull request.
- Bump the version with `node scripts/bump-version.js` whenever you ship a change; it updates
  `package.json`, `src/lib/version.ts` and the `<title>`.
- `/scan` is the deprecated first-generation scanner (still reachable from Settings → Legacy scanner);
  `/count` is the real counting flow.
- `firebase-blueprint.json` documents the Firestore document shapes; `firestore.rules` is authoritative.
