/**
 * VialTrack web server.
 *
 *  1. Serves the Vite build (dist/) with an SPA fallback.
 *  2. Inbound API bridge: POST /api/webhook/sale decrements stock when the ordering system sells.
 *  3. Read-only reporting API (GET /api/v1/...) so the business can pull counts, bins, trays
 *     (with lot / BUD for FIFO) and count history, as JSON or CSV. See docs/API.md.
 *
 * Auth for 2 and 3: `Authorization: Bearer <apiKey>` where the key is the API key saved under
 * Settings → API Bridge (config/appSettings.apiBridgeConfig.apiKey), or VIALTRACK_API_KEY env.
 */
import express from 'express';
import fs from 'fs';
import crypto from 'crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const APP_VERSION = readJsonSafe(path.join(__dirname, 'package.json'))?.version ?? 'unknown';

// The web app uses a NAMED Firestore database (firebase-applet-config.json → firestoreDatabaseId).
// The admin SDK defaults to "(default)", which is a different, empty database, so always resolve it.
const appletConfig = readJsonSafe(path.join(__dirname, 'firebase-applet-config.json'));
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || appletConfig?.firestoreDatabaseId || '(default)';

const app = express();
app.use(express.json());

// Initialize Firebase Admin via Application Default Credentials.
// Locally: GOOGLE_APPLICATION_CREDENTIALS=<service-account.json>. On Cloud Run the metadata server provides it.
let adminApp = null;
try {
  adminApp = initializeApp();
  console.log(`Firebase Admin initialized (database: ${DATABASE_ID}).`);
} catch (error) {
  console.warn('Firebase Admin app initialization failed:', error.message);
  console.warn('Set GOOGLE_APPLICATION_CREDENTIALS to a service account key file.');
}
const db = adminApp ? getFirestore(adminApp, DATABASE_ID) : getFirestore(DATABASE_ID);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v) => (typeof v === 'string' ? v : '');

function basketTotal(b) {
  return typeof b.totalVials === 'number'
    ? b.totalVials
    : num(b.trayCount) * Math.max(1, num(b.vialsPerTray, 25)) + num(b.looseVials);
}

function parseShelfId(shelfId) {
  if (!shelfId) return null;
  const i = shelfId.lastIndexOf('-');
  if (i <= 0) return null;
  const n = Number(shelfId.slice(i + 1));
  if (!Number.isInteger(n) || n < 1) return null;
  return { locationId: shelfId.slice(0, i), shelfIndex: n };
}

function shelfLabel(shelfId, locations) {
  const parsed = parseShelfId(shelfId);
  if (!parsed) return shelfId ? `Shelf ${shelfId}` : '';
  const name = locations.get(parsed.locationId)?.name;
  return name ? `${name} · Shelf ${parsed.shelfIndex}` : `Shelf ${parsed.shelfIndex}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysToBud(bud, now = new Date()) {
  const m = ISO_DATE.exec(bud || '');
  if (!m) return null;
  const budDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((budDate.getTime() - today.getTime()) / 86_400_000);
}

function budStatus(bud) {
  const d = daysToBud(bud);
  if (d === null) return 'unknown';
  if (d < 0) return 'expired';
  if (d <= 30) return 'soon';
  return 'ok';
}

/** FIFO: earliest BUD first (undated last), then date compounded, then slot. */
function fifoKey(t) {
  const bud = ISO_DATE.test(t.bud || '') ? t.bud : '9999-99-99';
  const cmp = ISO_DATE.test(t.dateCompounded || '') ? t.dateCompounded : '9999-99-99';
  return `${bud}|${cmp}|${String(num(t.slot)).padStart(3, '0')}`;
}

function toCsv(columns, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n') + '\r\n';
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

async function loadCollection(name, { limit = 5000, where = [] } = {}) {
  let q = db.collection(name);
  for (const [field, op, value] of where) q = q.where(field, op, value);
  const snap = await q.limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

let settingsCache = { at: 0, value: null };
async function loadBridgeConfig(force = false) {
  if (!force && settingsCache.value && Date.now() - settingsCache.at < 30_000) return settingsCache.value;
  const snap = await db.collection('config').doc('appSettings').get();
  const value = snap.exists ? snap.data().apiBridgeConfig || null : null;
  settingsCache = { at: Date.now(), value };
  return value;
}

/** Bearer-token auth shared by the webhook and the read API. */
async function requireApiKey(req, res, next) {
  try {
    const cfg = await loadBridgeConfig();
    const key = process.env.VIALTRACK_API_KEY || cfg?.apiKey;
    if (!key) {
      return res.status(503).json({ error: 'API key not configured. Set one under Settings → API Bridge.' });
    }
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || !safeEqual(token, key)) {
      return res.status(401).json({ error: 'Unauthorized: invalid API key' });
    }
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

/** Products / locations / users lookup maps used to decorate API rows. */
async function loadMaps() {
  const [products, locations, users] = await Promise.all([
    loadCollection('products'),
    loadCollection('locations'),
    loadCollection('users'),
  ]);
  return {
    products: new Map(products.map((p) => [p.id, p])),
    locations: new Map(locations.map((l) => [l.id, l])),
    users: new Map(users.map((u) => [u.id, u.displayName || u.email || u.id])),
  };
}

function decorateBin(b, maps) {
  return {
    id: b.id,
    name: str(b.name),
    productId: str(b.productId),
    productName: maps.products.get(b.productId)?.name ?? null,
    locationId: str(b.locationId),
    locationName: maps.locations.get(b.locationId)?.name ?? null,
    shelfId: b.shelfId || null,
    shelf: b.shelfId ? shelfLabel(b.shelfId, maps.locations) : null,
    trayCount: num(b.trayCount),
    vialsPerTray: num(b.vialsPerTray, 25),
    looseVials: num(b.looseVials),
    totalVials: basketTotal(b),
    counted: typeof b.totalVials === 'number',
    lastCountedAt: b.lastCountedAt || null,
    lastCountedBy: b.lastCountedBy || null,
    lastCountedByName: b.lastCountedBy ? maps.users.get(b.lastCountedBy) ?? null : null,
    qrCode: str(b.qrCode),
    updatedAt: b.updatedAt || null,
  };
}

function decorateTray(t, maps, binsById) {
  const bin = binsById.get(t.basketId);
  return {
    id: t.id,
    binId: str(t.basketId),
    binName: bin?.name ?? null,
    productId: str(t.productId) || bin?.productId || null,
    productName: maps.products.get(t.productId || bin?.productId)?.name ?? null,
    locationName: bin ? maps.locations.get(bin.locationId)?.name ?? null : null,
    shelf: bin?.shelfId ? shelfLabel(bin.shelfId, maps.locations) : null,
    slot: num(t.slot),
    count: num(t.count),
    capacity: num(t.capacity, 25),
    counted: Boolean(t.countedAt),
    status: t.status === 'removed' ? 'removed' : 'active',
    lotNumber: t.lotNumber || null,
    dateCompounded: t.dateCompounded || null,
    bud: t.bud || null,
    daysToBud: daysToBud(t.bud),
    budStatus: budStatus(t.bud),
    labelText: t.labelText || null,
    countedAt: t.countedAt || null,
    countedBy: t.countedBy || null,
    countedByName: t.countedBy ? maps.users.get(t.countedBy) ?? null : null,
    qrCode: `TRAY:${t.id}`,
  };
}

function sessionSummary(s) {
  return {
    id: s.id,
    userId: str(s.userId),
    userName: str(s.userName),
    status: str(s.status),
    startedAt: s.startedAt || null,
    completedAt: s.completedAt || null,
    bins: Array.isArray(s.countedBaskets) ? s.countedBaskets.length : num(s.progress?.basketsCounted),
    binIds: Array.isArray(s.countedBaskets) ? s.countedBaskets : [],
    trays: num(s.progress?.traysCounted),
    vials: num(s.progress?.vialsCounted),
    netDelta: num(s.progress?.totalVials),
  };
}

function withinRange(iso, since, until) {
  if (!iso) return false;
  if (since && iso < since) return false;
  if (until && iso > until) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Report builders (shared by JSON and CSV routes)
// ---------------------------------------------------------------------------

async function buildProducts() {
  const [products, baskets] = await Promise.all([loadCollection('products'), loadCollection('baskets')]);
  const perProduct = new Map();
  for (const b of baskets) {
    const cur = perProduct.get(b.productId) || { bins: 0, vialsInBins: 0, lastCountedAt: null };
    cur.bins += 1;
    cur.vialsInBins += basketTotal(b);
    if (b.lastCountedAt && (!cur.lastCountedAt || b.lastCountedAt > cur.lastCountedAt)) cur.lastCountedAt = b.lastCountedAt;
    perProduct.set(b.productId, cur);
  }
  return products
    .map((p) => {
      const agg = perProduct.get(p.id) || { bins: 0, vialsInBins: 0, lastCountedAt: null };
      return {
        id: p.id,
        name: str(p.name),
        category: str(p.category),
        currentStock: num(p.currentStock),
        reorderPoint: num(p.reorderPoint),
        lowStock: num(p.currentStock) <= num(p.reorderPoint),
        bins: agg.bins,
        vialsInBins: agg.vialsInBins,
        lastCountedAt: agg.lastCountedAt,
        updatedAt: p.updatedAt || null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function buildBins(maps) {
  const baskets = await loadCollection('baskets');
  return baskets
    .map((b) => decorateBin(b, maps))
    .sort((a, b) => (a.locationName || '').localeCompare(b.locationName || '') || (a.shelf || '').localeCompare(b.shelf || '') || a.name.localeCompare(b.name));
}

async function buildTrays(maps, { productId, binId, status = 'active', expiringWithinDays } = {}) {
  const where = [];
  if (productId) where.push(['productId', '==', productId]);
  if (binId) where.push(['basketId', '==', binId]);
  const [trays, baskets] = await Promise.all([loadCollection('trays', { where }), loadCollection('baskets')]);
  const binsById = new Map(baskets.map((b) => [b.id, b]));
  let rows = trays
    .filter((t) => (status === 'all' ? true : (t.status === 'removed' ? 'removed' : 'active') === status))
    .sort((a, b) => fifoKey(a).localeCompare(fifoKey(b)))
    .map((t) => decorateTray(t, maps, binsById));
  if (expiringWithinDays !== undefined) {
    const max = Number(expiringWithinDays);
    rows = rows.filter((t) => t.daysToBud !== null && t.daysToBud <= max);
  }
  // Rank within each product so consumers can see "use first" order directly.
  const rank = new Map();
  for (const t of rows) {
    const key = t.productId || '';
    const r = (rank.get(key) || 0) + 1;
    rank.set(key, r);
    t.fifoRank = r;
  }
  return rows;
}

async function buildCounts(maps, { since, until, limit = 1000 } = {}) {
  const logs = await loadCollection('inventoryLogs', { where: [['action', '==', 'COUNT']], limit: 5000 });
  return logs
    .filter((l) => withinRange(l.timestamp, since, until))
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .slice(0, limit)
    .map((l) => ({
      id: l.id,
      timestamp: l.timestamp || null,
      productId: str(l.productId),
      productName: maps.products.get(l.productId)?.name ?? null,
      previousCount: num(l.previousCount),
      newCount: num(l.newCount, num(l.amount)),
      delta: num(l.newCount, num(l.amount)) - num(l.previousCount),
      userId: str(l.userId),
      userName: maps.users.get(l.userId) ?? null,
      sessionId: l.sessionId || null,
      reason: l.reason || null,
    }));
}

async function buildSessions({ since, until, status } = {}) {
  const sessions = await loadCollection('countingSessions', { limit: 2000 });
  return sessions
    .filter((s) => (status ? s.status === status : true))
    .filter((s) => (since || until ? withinRange(s.startedAt, since, until) : true))
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
    .map(sessionSummary);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const api = express.Router();

api.get('/health', (req, res) => {
  res.json({ ok: true, service: 'vialtrack', version: APP_VERSION, database: DATABASE_ID, time: new Date().toISOString() });
});

api.use(requireApiKey);

api.get('/summary', async (req, res, next) => {
  try {
    const [products, baskets, trays, sessions] = await Promise.all([
      loadCollection('products'),
      loadCollection('baskets'),
      loadCollection('trays', { where: [['status', '==', 'active']] }),
      loadCollection('countingSessions', { where: [['status', '==', 'completed']], limit: 2000 }),
    ]);
    const lastCompleted = sessions.map((s) => s.completedAt || s.startedAt).filter(Boolean).sort().pop() || null;
    res.json({
      generatedAt: new Date().toISOString(),
      products: products.length,
      lowStockProducts: products.filter((p) => num(p.currentStock) <= num(p.reorderPoint)).length,
      bins: baskets.length,
      binsNeverCounted: baskets.filter((b) => !b.lastCountedAt).length,
      activeTrays: trays.length,
      vialsOnHand: baskets.reduce((s, b) => s + basketTotal(b), 0),
      traysExpired: trays.filter((t) => budStatus(t.bud) === 'expired').length,
      traysExpiringSoon: trays.filter((t) => budStatus(t.bud) === 'soon').length,
      lastCompletedCountAt: lastCompleted,
    });
  } catch (e) {
    next(e);
  }
});

api.get('/products', async (req, res, next) => {
  try {
    res.json({ generatedAt: new Date().toISOString(), products: await buildProducts() });
  } catch (e) {
    next(e);
  }
});

api.get('/bins', async (req, res, next) => {
  try {
    const maps = await loadMaps();
    res.json({ generatedAt: new Date().toISOString(), bins: await buildBins(maps) });
  } catch (e) {
    next(e);
  }
});

api.get('/trays', async (req, res, next) => {
  try {
    const maps = await loadMaps();
    const { productId, binId, status, expiringWithinDays } = req.query;
    res.json({
      generatedAt: new Date().toISOString(),
      trays: await buildTrays(maps, {
        productId: productId ? String(productId) : undefined,
        binId: binId ? String(binId) : undefined,
        status: status ? String(status) : 'active',
        expiringWithinDays: expiringWithinDays !== undefined ? Number(expiringWithinDays) : undefined,
      }),
    });
  } catch (e) {
    next(e);
  }
});

api.get('/counts', async (req, res, next) => {
  try {
    const maps = await loadMaps();
    const { since, until, limit } = req.query;
    res.json({
      generatedAt: new Date().toISOString(),
      counts: await buildCounts(maps, {
        since: since ? String(since) : undefined,
        until: until ? String(until) : undefined,
        limit: limit ? Math.min(5000, Math.max(1, Number(limit) || 1000)) : 1000,
      }),
    });
  } catch (e) {
    next(e);
  }
});

api.get('/sessions', async (req, res, next) => {
  try {
    const { since, until, status } = req.query;
    res.json({
      generatedAt: new Date().toISOString(),
      sessions: await buildSessions({
        since: since ? String(since) : undefined,
        until: until ? String(until) : undefined,
        status: status ? String(status) : undefined,
      }),
    });
  } catch (e) {
    next(e);
  }
});

api.get('/sessions/:id', async (req, res, next) => {
  try {
    const snap = await db.collection('countingSessions').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: 'Session not found' });
    const session = sessionSummary({ id: snap.id, ...snap.data() });
    const maps = await loadMaps();
    const [allBins, counts] = await Promise.all([buildBins(maps), buildCounts(maps, { limit: 5000 })]);
    res.json({
      generatedAt: new Date().toISOString(),
      session,
      bins: allBins.filter((b) => session.binIds.includes(b.id)),
      stockChanges: counts.filter((c) => c.sessionId === session.id),
    });
  } catch (e) {
    next(e);
  }
});

const CSV_TABLES = {
  products: {
    columns: ['id', 'name', 'category', 'currentStock', 'reorderPoint', 'lowStock', 'bins', 'vialsInBins', 'lastCountedAt'],
    load: () => buildProducts(),
  },
  bins: {
    columns: ['id', 'name', 'productName', 'locationName', 'shelf', 'trayCount', 'vialsPerTray', 'looseVials', 'totalVials', 'counted', 'lastCountedAt', 'lastCountedByName', 'qrCode'],
    load: async () => buildBins(await loadMaps()),
  },
  trays: {
    columns: ['id', 'productName', 'locationName', 'shelf', 'binName', 'slot', 'fifoRank', 'count', 'capacity', 'counted', 'lotNumber', 'dateCompounded', 'bud', 'daysToBud', 'budStatus', 'labelText', 'countedAt', 'countedByName', 'status', 'qrCode'],
    load: async (q) => buildTrays(await loadMaps(), { status: q.status ? String(q.status) : 'active' }),
  },
  counts: {
    columns: ['id', 'timestamp', 'productName', 'previousCount', 'newCount', 'delta', 'userName', 'sessionId', 'reason'],
    load: async (q) => buildCounts(await loadMaps(), { since: q.since ? String(q.since) : undefined, until: q.until ? String(q.until) : undefined, limit: 5000 }),
  },
  sessions: {
    columns: ['id', 'userName', 'status', 'startedAt', 'completedAt', 'bins', 'trays', 'vials', 'netDelta'],
    load: async (q) => buildSessions({ since: q.since ? String(q.since) : undefined, until: q.until ? String(q.until) : undefined, status: q.status ? String(q.status) : undefined }),
  },
};

api.get('/export.csv', async (req, res, next) => {
  try {
    const table = String(req.query.table || 'bins');
    const spec = CSV_TABLES[table];
    if (!spec) return res.status(400).json({ error: `Unknown table. Use one of: ${Object.keys(CSV_TABLES).join(', ')}` });
    const rows = await spec.load(req.query);
    const csv = toCsv(spec.columns, rows.map((r) => spec.columns.map((c) => (typeof r[c] === 'boolean' ? (r[c] ? 'yes' : 'no') : r[c]))));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="vialtrack-${table}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (e) {
    next(e);
  }
});

app.use('/api/v1', api);

// Webhook endpoint to receive SALE events from the ordering system
app.post('/api/webhook/sale', async (req, res) => {
  try {
    const config = await loadBridgeConfig(true);

    if (!config || !config.enabled) {
      return res.status(403).json({ error: 'API Bridge is not enabled' });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token || !config.apiKey || !safeEqual(token, config.apiKey)) {
      return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    }

    const { productId, quantityRemoved, orderId } = req.body;

    if (!productId || typeof quantityRemoved !== 'number') {
      return res.status(400).json({ error: 'Missing productId or quantityRemoved' });
    }

    const productRef = db.collection('products').doc(productId);

    // Decrement stock in a transaction to ensure we have the correct previous count for the log
    await db.runTransaction(async (t) => {
      const doc = await t.get(productRef);
      if (!doc.exists) {
        throw new Error('Product not found');
      }

      const currentStock = doc.data().currentStock || 0;
      const newStock = Math.max(0, currentStock - quantityRemoved);

      t.update(productRef, { currentStock: newStock });

      const logRef = db.collection('inventoryLogs').doc();
      t.set(logRef, {
        productId,
        action: 'SALE',
        amount: quantityRemoved,
        previousCount: currentStock,
        newCount: newStock,
        reason: orderId ? `Order ${orderId}` : 'Automated sale sync',
        userId: 'system',
        timestamp: new Date().toISOString(),
      });
    });

    console.log(`Successfully processed sale webhook for product ${productId}. Decremented by ${quantityRemoved}.`);
    res.status(200).json({ ok: true, message: 'Stock updated successfully' });
  } catch (error) {
    console.error('Webhook Error:', error);
    if (error.message === 'Product not found') {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

// Unknown API routes should 404 as JSON instead of falling through to the SPA.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
});

// API error handler
app.use('/api', (err, req, res, _next) => {
  console.error('API error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Serve static files from the React build
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback for React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`VialTrack v${APP_VERSION} on port ${PORT}`);
  console.log(`Web app:        http://localhost:${PORT}`);
  console.log(`Reporting API:  http://localhost:${PORT}/api/v1/health`);
  console.log(`Sale webhook:   http://localhost:${PORT}/api/webhook/sale`);
});
