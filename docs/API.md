# VialTrack reporting API

Read-only JSON/CSV endpoints served by `server.js` (the same process that hosts the web app), so a
business system, a spreadsheet, or a script can pull the current inventory and the count history
without touching Firestore directly.

Base URL: your Cloud Run URL, e.g. `https://vialtrack-ai-156214809618.us-west1.run.app`

## Authentication

Every endpoint except `/health` requires:

```
Authorization: Bearer <API key>
```

The key is whatever is saved under **Settings → API Bridge → API key** in the app (an admin sets it).
The server can also be given `VIALTRACK_API_KEY` as an environment variable, which takes precedence.
If no key is configured anywhere the API answers `503`.

## Endpoints

| Method | Path | What you get |
| --- | --- | --- |
| GET | `/api/v1/health` | Liveness, app version, database ID. No auth. |
| GET | `/api/v1/summary` | Totals: products, low-stock products, bins, vials on hand, active trays, expired / expiring trays, last completed count. |
| GET | `/api/v1/products` | Every product with `currentStock`, `reorderPoint`, `lowStock`, number of bins and vials in bins, last count time. |
| GET | `/api/v1/bins` | Every bin with product, fridge, shelf, trays, loose vials, `totalVials`, last counted at/by. |
| GET | `/api/v1/trays` | Every tray with lot #, date compounded, BUD, `daysToBud`, `budStatus`, count, and `fifoRank` (1 = use first for that product). Query: `productId`, `binId`, `status=active|removed|all` (default active), `expiringWithinDays=30`. |
| GET | `/api/v1/counts` | Stock reconciliations written by **Complete & Sync**, newest first: product, previous, new, delta, who, session. Query: `since`, `until` (ISO 8601), `limit`. |
| GET | `/api/v1/sessions` | Counting sessions: user, status, started/completed, bins, trays, vials, net delta. Query: `since`, `until`, `status`. |
| GET | `/api/v1/sessions/:id` | One session plus the bins it touched and the stock changes it produced. |
| GET | `/api/v1/export.csv?table=…` | CSV download of `products`, `bins`, `trays`, `counts` or `sessions` (same query params as the JSON routes). |

All timestamps are ISO 8601 strings in UTC. Dates on tray labels (`bud`, `dateCompounded`) are `YYYY-MM-DD`.

## Examples

```bash
API=https://vialtrack-ai-156214809618.us-west1.run.app
KEY='paste the API key from Settings'

# Is it up?
curl -s $API/api/v1/health

# Headline numbers
curl -s -H "Authorization: Bearer $KEY" $API/api/v1/summary

# Everything expiring in the next 30 days, use-first order
curl -s -H "Authorization: Bearer $KEY" "$API/api/v1/trays?expiringWithinDays=30"

# Counts done in September 2026
curl -s -H "Authorization: Bearer $KEY" "$API/api/v1/counts?since=2026-09-01&until=2026-10-01"

# Spreadsheet of all bins
curl -s -H "Authorization: Bearer $KEY" "$API/api/v1/export.csv?table=bins" -o bins.csv
```

Google Sheets: `IMPORTDATA` cannot send headers, so either use a small Apps Script with
`UrlFetchApp.fetch(url, {headers: {Authorization: 'Bearer …'}})` or download the CSV from the
app's **Reports → Exports** card and import it.

## Sample responses

`GET /api/v1/summary`

```json
{
  "generatedAt": "2026-09-30T18:02:11.412Z",
  "products": 14,
  "lowStockProducts": 2,
  "bins": 19,
  "binsNeverCounted": 0,
  "activeTrays": 61,
  "vialsOnHand": 1418,
  "traysExpired": 1,
  "traysExpiringSoon": 4,
  "lastCompletedCountAt": "2026-09-30T15:40:02.101Z"
}
```

`GET /api/v1/trays?productId=abc123` (one element)

```json
{
  "id": "k3Jd9…",
  "binId": "Qw8…",
  "binName": "BPC-157 5 mg/mL",
  "productId": "abc123",
  "productName": "BPC-157 (Phenol Free MDV) 5 mg/mL",
  "locationName": "Avantco Fridge 1",
  "shelf": "Avantco Fridge 1 · Shelf 4",
  "slot": 2,
  "fifoRank": 1,
  "count": 11,
  "capacity": 25,
  "counted": true,
  "status": "active",
  "lotNumber": "260622@1",
  "dateCompounded": "2026-06-22",
  "bud": "2026-08-06",
  "daysToBud": -55,
  "budStatus": "expired",
  "countedAt": "2026-09-30T15:12:40.001Z",
  "countedByName": "Duval Villegas",
  "qrCode": "TRAY:k3Jd9…"
}
```

## Writing stock from outside (existing)

`POST /api/webhook/sale` with the same bearer key decrements a product when the ordering system
sells it. It requires **Settings → API Bridge → Enabled** to be on. Body:
`{"productId": "…", "quantityRemoved": 1, "orderId": "RX-12345"}`.

## Notes for whoever runs the server

- The server reads the **named** Firestore database from `firebase-applet-config.json`
  (`firestoreDatabaseId`), or `FIRESTORE_DATABASE_ID` if set. The admin SDK's default database is a
  different, empty database.
- Credentials come from Application Default Credentials: automatic on Cloud Run, or
  `GOOGLE_APPLICATION_CREDENTIALS=/path/key.json` locally. The service account needs the
  **Cloud Datastore User** role.
- Responses are built from full collection reads (capped at 5,000 docs per collection). Fine for a
  pharmacy-sized dataset; add pagination before pointing a dashboard at it every few seconds.
