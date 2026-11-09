# VialTrack Print Server

Native macOS desktop app that replaces the browser-based Print Station. Listens to the Firestore `printJobs` queue and routes each job to the correct physical printer (Zebra / Epson C6000 / Canon / any AirPrint printer) using CUPS. For one-off labels from a phone or Mac without this server, the web app's **Print here (AirPrint)** button makes the same exact-size PDF.

## Install & run (dev)

```bash
cd desktop
npm install
npm run dev
```

This launches three concurrent processes:
- `main` — TypeScript watch build for Electron main process
- `renderer` — Vite dev server on http://localhost:5173
- `electron` — Electron app that loads the Vite URL once ready

## Setting up the Mac that has the printers

Do this once on the iMac (or any Mac) the label printers are plugged into.

1. **Keep the Mac awake and logged in.** The print server only runs while a user is logged in.
   System Settings → Lock Screen: "Turn display off" is fine, but under **Energy** (or Battery →
   Options on a laptop) turn on **"Prevent automatic sleeping when the display is off"**. In Terminal
   the same thing is `sudo pmset -a sleep 0`. A sleeping Mac prints nothing.
2. **Add every printer to macOS.** System Settings → **Printers & Scanners** → Add. Use the maker's
   driver for label printers (Zebra ZD-series driver; Epson ColorWorks CW-C6000 driver) so their
   label sizes show up; AirPrint / network printers can be added by IP. Print a test page from
   macOS once.
3. **Install the print server.** On a computer with the repo: `cd desktop && npm install && npm run package`,
   copy `dist/packaged/*.dmg` to the Mac, drag the app to Applications, first launch with
   right-click → Open (unsigned app). Sign in with a whitelisted VialTrack account. From then on it
   starts hidden at login and sits in the menu bar.
4. **Map label sizes to printers.** Menu-bar icon → Show Window → ⚙ → **Label sizes**. For each size:
   pick the printer, click the matching **"Use …"** paper size the driver offers, **Save**, then
   **Test print**. The test label should fill the label at 100%, not shrink or cut off.
5. **Publish the database rules** (`firestore.rules`, see the main README). They let the server
   claim each job so it is printed once, and show failed jobs with their error. Until then it still
   prints, without claims (a notice says so).

That's it. New printers can be added any time: add them in Printers & Scanners, and they appear in
⚙ → **Printers on this Mac** within 30 seconds (with a "New printer found" notice); assign them under
**Label sizes**. Changes save instantly, no restart.

### How a label gets printed

1. The web app (or a phone) queues a `printJobs` document.
2. The print server **claims** it in a transaction (`pending → printing`), so a second print server or
   a browser Print Station tab never prints the same label.
3. It builds the label as an **exact-size PDF** with the shared engine
   ([`src/shared/labelRender.ts`](../src/shared/labelRender.ts)): a 2.5" × 1.5" label is a 2.5" × 1.5" page,
   QR codes as vector shapes. The same engine makes the web app's "Print here (AirPrint)" PDFs and
   previews, so what you preview is what prints.
4. Before printing it checks the printer exists and isn't paused, then runs
   `lp -d <printer> <your lp options> label.pdf` (with a 60 s timeout).
5. Success → `completed`. Failure → retried after 15 s, 1 min, 3 min; after 3 tries the job shows
   as **failed** with the error and a Retry button (here and in the web Print Station).

### Troubleshooting

| What you see | What to do |
| --- | --- |
| "Printer … isn't set up on this Mac" | The CUPS name changed or the printer was removed. Re-add it, then pick it again under Label sizes. |
| "Printer … is paused" | Printers & Scanners → the printer → Open Print Queue → Resume, or `cupsenable <name>`. |
| Label prints small or shifted | Remove `-o fit-to-page` from the lp options, add `-o print-scaling=none`, and pick the matching paper size. |
| Nothing prints after the Mac restarted | Check the menu-bar icon is there and the Mac is logged in. (Before this version the queue only started after opening the window.) |
| Jobs stay "pending" | Is the Mac asleep, or the app signed out? Open the window: the banner shows the last error. |
| Anything else | Logs: menu-bar icon → Open Logs Folder (`~/Library/Logs/VialTrack Print Server/`). |

### Command-line helpers (optional)

`npm run setup` suggests a `printers.json` from `lpstat -p`; `npm run test-print -- --format 4x3` prints
an alignment sheet straight through `lp`. `lpoptions -p <printer> -l` lists the paper sizes a driver
supports (the app shows the same list under Label sizes).

## Configuring printers manually

The app's ⚙ → Label sizes edits this file for you. To edit by hand: [`config/printers.json`](config/printers.json).
The file is hot-reloaded — no restart needed, and a broken edit is ignored (the last good settings stay). On packaged installs it lives under `~/Library/Application Support/VialTrack Print Server/printers.json`.

Find your exact CUPS printer names with:

```bash
lpstat -p
```

Example entry:

```json
{
  "4x3": {
    "cupsPrinter": "Zebra_ZD410",
    "pageSize": { "widthIn": 4, "heightIn": 3 },
    "margins": { "top": 0, "right": 0, "bottom": 0, "left": 0 },
    "lpOptions": ["-o", "media=Custom.4x3in", "-o", "fit-to-page"]
  }
}
```

### Canon integrated form sticky region

The Canon loads integrated-label sheets (full 8.5 × 11 inch page with an adhesive patch toward the bottom). Tune `stickyRegion` to position the label content onto the adhesive:

```json
"canon-integrated": {
  "cupsPrinter": "Canon",
  "pageSize": { "widthIn": 8.5, "heightIn": 11 },
  "stickyRegion": { "xIn": 1.25, "yIn": 6.5, "widthIn": 6, "heightIn": 4 },
  "lpOptions": ["-o", "media=Letter"]
}
```

Measure the printed output with a ruler and adjust `xIn`, `yIn`, `widthIn`, `heightIn` until the content lands on the adhesive patch.

### Baking macOS print presets into CUPS

macOS Print-dialog "Presets" are not consumable by the `lp` CLI. Set equivalent defaults via CUPS so every `lp -d <printer>` call inherits them:

```bash
lpoptions -p Zebra_ZD410 -o media=Custom.4x3in -o fit-to-page
lpoptions -p EPSON_C6000 -o media=Custom.2.5x0.7in
```

Per-job overrides are passed through the `lpOptions` array in `printers.json`.

## Build a distributable DMG

```bash
npm run package
```

Output lands in `dist/packaged/`. Drag the `.dmg` to the iMac and install to `/Applications`. First launch needs right-click → Open (unsigned Gatekeeper bypass).

## Auto-launch

In packaged mode the app registers itself as a login item (hidden). The tray icon appears in the menu bar after login.

## Logs

Stored at `~/Library/Logs/VialTrack Print Server/print-server.log`. Open from the tray menu → "Open Logs Folder".
