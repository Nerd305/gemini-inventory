# VialTrack quick start

For the person testing and tuning the system. Fifteen minutes to read, then go count a fridge.

---

## 1. What it is, in one paragraph

VialTrack tracks compounded vials in the pharmacy fridge. The fridge has shelves, each shelf holds
plastic **bins**, each bin holds one product's **trays** (clear 5×5 inserts, 25 vials when full), and
each tray carries the compounding label with a **lot number**, **date compounded** and **BUD**
(beyond-use date). Everything gets a QR label. Counting is: scan shelf → scan bin → tap each tray
→ finish → scan the shelf you put it back on. The app keeps totals per bin and per product, knows
which tray to use first (earliest BUD), logs every count, and can hand the numbers to the business
as a spreadsheet or over an API.

## 2. Words you will see

| Word | Meaning | QR label |
| --- | --- | --- |
| Location / fridge | A fridge or cabinet, with a shelf count (shelf 1 = top) | `LOC:` (legacy, not used for counting) |
| Shelf | One shelf inside a fridge | `SHELF:<fridgeId>-<n>` |
| Bin | The plastic basket with the tag sleeve; one product; any number of trays | `BSKT:<binId>` |
| Tray | One 25-pocket insert; has its own lot / BUD; can be moved or removed | `TRAY:<trayId>` (optional) |
| Loose vials | Vials in the bin that are not in a tray | — |
| Count session | One person's counting run; ends with Complete & Sync | — |
| Complete & Sync | Sets each counted product's stock to the total across its bins and writes a COUNT log | — |
| Use first | The tray with the earliest BUD for that product (FIFO) | — |

## 3. Getting in

- Open the app URL on a phone (counting) or a computer (setup). Sign in with Google.
- Only whitelisted emails get in. Admins add people under **Settings → Users** with a role of
  *staff* (count, set up bins) or *admin* (everything, including deleting).
- On a phone the bottom bar has **Home · Count · Bins · Items · More**. Locations, Reports and Print
  Station are under **More** (Settings) on phones and in the left sidebar on a computer.

## 4. First-time setup (follow the dashboard checklist)

The dashboard shows **Setup progress**; each step tells you where to go and ticks itself off.

1. **Locations** → Add Location → name the fridge, type *Refrigerator*, shelf count (top → bottom).
2. **Set up label printing** → Print Station → *Send Test Print*. If nothing prints, see §8.
3. **Locations** → *Shelf labels* on the fridge → *Send all to Print Station*. Stick one on the front
   edge of each shelf.
4. **Items (Products)** → Add Product for every product you stock. Name them the way the bin tags read
   ("TIRZ 40 mg/mL 5mL").
5. **Bins** → Add Bin for every basket: product, fridge, shelf, how many trays are in it right now,
   vials per tray (25). *Save & Print Label* → slide the label into the bin's tag sleeve.
6. **Register trays** (this is what powers FIFO): open the bin → *Add tray* → *Photograph the label*.
   The AI reads lot, date compounded and BUD; check and save. Repeat per tray. Or add blank trays and
   let the label get captured during the first count.
7. **Print tray labels** (optional but recommended) → in the bin: *Send N tray labels*. Each label has
   the tray's QR plus "Lot … · BUD …". Stick it on the tray.

## 5. Counting (phone, at the fridge)

1. **Home → Start Count.** The camera opens.
2. **Scan the shelf label.** Top bar shows the shelf.
3. **Pull a bin and scan its label.** You see a grid of its trays. A tray with a star / **1st** is the
   one to use first. If the bin has a tray that is not in the grid, tap **Add tray**. Loose vials have
   a stepper.
4. **Tap a tray.**
   - Full tray → tap **Full 25** → **Accept**.
   - Partial tray → count it and use −5 / −1 / +1 / +5, or tap **AI count** and photograph the tray
     with the white label in frame (you get the count and the lot / BUD). Check, then **Accept**.
   - Empty tray that is gone → trash icon → **Remove tray from bin**.
   - The lot / BUD chip under the buttons is editable if the AI misread something.
   - **All full** does every tray at once; **AI all** walks tray by tray.
5. **Finish.** Accepting the last uncounted tray finishes the bin automatically, or tap **Finish**.
   The panel asks you to **scan the shelf** you are putting the bin back on. Wrong shelf → it offers
   to move the bin.
6. Next bin. The top bar shows bins · trays · vials counted this session.
7. **End → Complete & Sync.** Review the summary, then tap Complete & Sync. Product stock now equals
   what you counted. *Export to CSV* on that screen gives you the session as a spreadsheet.

Tips: the keyboard icon lets you type a code if the camera cannot read a label. Scanning a tray label
opens that tray directly, even before scanning the bin. Two people can count at the same time; the
app warns if someone already has a bin open.

## 6. FIFO: which tray to use

- **Bins → open a bin**: trays are listed in use-first order with a **USE FIRST** badge.
- **Items → open a product**: "Use first (by BUD)" across every bin.
- **Dashboard → Use First · Expiring BUDs**: everything expired or within 60 days, all fridges.
- Colours: red = BUD passed, amber = within 30 days.

## 7. After the count: exports and the API

- **Reports → Exports**: *Download Excel workbook* (six sheets: summary, products, bins, trays in
  use-first order with lot / BUD, count history, sessions) or a single table as CSV.
- **API** for the business: `GET /api/v1/summary`, `/products`, `/bins`, `/trays`, `/counts`,
  `/sessions`, `/export.csv?table=…` with `Authorization: Bearer <API key>`. The key is set under
  **Settings → API Bridge**. Full reference in [API.md](API.md).

## 8. Printing

Labels go into a queue; something has to print them:

- **Print server on the iMac** (recommended): the VialTrack Print Server app in the menu bar. Install
  steps are in the [README](../README.md#5-label-printing-imac-print-server) and
  [desktop/README.md](../desktop/README.md).
- **Fallback**: open **Print Station** in the web app on the computer wired to the printers and leave
  the tab open.

Check with **Print Station → Send Test Print**. Bin and tray labels default to the 2.5" × 1.5" Epson
size; shelf labels too. You can pick another size in the print dialog.

## 9. Pages and what they do

| Page | Use it for |
| --- | --- |
| Home (Dashboard) | Setup checklist, today's count coverage, use-first / expiring trays, low stock, activity |
| Count | The scanning flow |
| Bins | Create bins, register trays (lot / BUD), print bin and tray labels, see totals and staleness |
| Items (Products) | Product catalog, reorder points, stock, use-first list per product |
| Locations | Fridges, shelf counts, shelf labels |
| Reports | Movement charts, spreadsheet exports |
| Print Station | Print queue, test print, browser-based printing fallback |
| Settings | Users / whitelist, API key and bridge, camera HUD, AI stats, danger zone (reset) |
| Legacy scanner (`/scan`) | Old flow; don't use for counting |

## 10. Testing checklist

Work through these and note anything surprising.

- [ ] Sign in works on a phone and a computer; a non-whitelisted account is refused.
- [ ] Shelf labels, a bin label and a tray label print at the right size and scan on the first try.
- [ ] Bin with 3 full trays: All full → Finish → scan shelf → totals show 75 (+ loose).
- [ ] Partial tray: AI count on a tray with 11 vials and the label in frame. Is the count right? Did
      it read lot and BUD correctly? Try bad light and an angle.
- [ ] Tray label scan opens the correct tray. Removing a tray re-numbers the rest.
- [ ] Wrong-shelf put-back offers to move the bin; the bin then shows on the new shelf under Bins.
- [ ] Two phones scanning the same bin: the second gets the "already being counted" warning.
- [ ] End → Complete & Sync changes product stock; the COUNT row appears in Recent Activity and in
      the Count history export.
- [ ] Dashboard "Today's Count" reflects finished bins; use-first card lists the earliest BUD.
- [ ] Reports → Excel workbook opens with all six sheets; API `/api/v1/summary` returns numbers.
- [ ] Leave the count page mid-way: the session shows as paused on the dashboard and disappears
      after 24 h.

## 11. Tuning knobs (where to change things)

| Want to change | File |
| --- | --- |
| The AI counting prompt or the label-reading prompt | `src/lib/ai.ts` (`countVialsInTray`, `readCompoundingLabel`) |
| BUD warning window (30 days), default tray size (25) | `src/lib/inventory.ts` (`BUD_WARNING_DAYS`, `DEFAULT_VIALS_PER_TRAY`) |
| Dashboard expiring window (60 days), stale bin threshold (7 days) | `src/pages/Dashboard.tsx` |
| Label layouts and sizes | `src/shared/LabelContent.tsx`, `src/lib/printing.ts`, `desktop/config/printers.json` |
| What the phone bottom bar shows | `src/components/Layout.tsx` (`navItems`, `mobile` flag) |
| Setup checklist steps | `src/components/SetupGuide.tsx` |
| Security rules (who can write what) | `firestore.rules` (deploy after editing) |
| API routes and CSV columns | `server.js` |

After any change: `npm run lint`, `npm run build`, `node scripts/bump-version.js`, commit, deploy.

## 12. When something looks wrong

| Symptom | Likely cause |
| --- | --- |
| Blank page or "Sign-in failed: unauthorized domain" | Add the domain under Firebase Auth → Authorized domains |
| "AI features are unavailable" | `GEMINI_API_KEY` was not set when the app was built |
| Trays won't save / "Missing or insufficient permissions" | Firestore rules not deployed for the `trays` collection |
| Scanning a bin says "Bin not found" | Label printed from a different database or the bin was deleted; reprint from Bins |
| Nothing prints | Print server not running and no Print Station tab open; check `lpstat -p` names in `printers.json` |
| Version badge is old after a deploy | AI Studio deployed its workspace copy, not GitHub `main`; pull first |
| API answers 503 | No API key set under Settings → API Bridge |
