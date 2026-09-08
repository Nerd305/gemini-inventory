# VialTrack Print Server

Native macOS desktop app that replaces the browser-based Print Station. Listens to the Firestore `printJobs` queue and routes each job to the correct physical printer (Zebra / Epson C6000 / Canon) using CUPS.

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

## First-time setup

### 1. Add printers in macOS

Go to **System Settings → Printers & Scanners** and add your printers:
- Zebra ZD410 (4×3 labels)
- Epson TM-C6000 (2×1.5 basket/shelf labels, plus 1.5×1.5, 2.5×1.5, 2.5×0.7)
- Canon (integrated label sheets)

### 2. Auto-detect & configure

Run the setup script to auto-detect printers and generate `printers.json`:

```bash
npm run setup
```

This runs `lpstat -p` to find available printers and suggests mappings based on printer names.

### 3. Test alignment

Print alignment sheets for each format to verify label positioning:

```bash
npm run test-print -- --format 2x1.5
npm run test-print -- --format 4x3
npm run test-print -- --format 2.5x0.7
npm run test-print -- --format canon-integrated
```

Or from the app: Open the app → click the tray icon → Settings → "Test Print" for each format.

The alignment sheet shows:
- **Red border** = label boundary
- **Blue dashed** = printable area
- Use a ruler to measure and adjust `stickyRegion` in `printers.json`

### 4. Verify custom media

Ensure each printer has the custom media size configured in CUPS:

```bash
lpoptions -p Zebra_ZD410 -l | grep -i custom
lpoptions -p EPSON_C6000 -l | grep -i custom
```

If missing, add in **System Settings → Printers → Options & Supplies**.

## Configuring printers manually

Edit [`config/printers.json`](config/printers.json). The file is hot-reloaded — no restart needed. On packaged installs it lives under `~/Library/Application Support/VialTrack Print Server/printers.json`.

**Adding a format to an existing install:** the packaged app never overwrites an existing `printers.json`, so when a new
format ships (e.g. `2x1.5`, used for the basket / shelf / fridge labels printed from the counting flow) add its entry to
`~/Library/Application Support/VialTrack Print Server/printers.json` by hand (copy it from
[`config/printers.json`](config/printers.json)). Jobs for a format with no entry are logged as
`No printer mapping for format` and stay `pending` in Firestore until the mapping exists.

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
lpoptions -p EPSON_C6000 -o media=Custom.2x1.5in
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
