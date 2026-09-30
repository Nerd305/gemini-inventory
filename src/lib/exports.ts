/**
 * Spreadsheet exports (Reports → Exports). Everything is read client-side with the signed-in
 * user's permissions, shaped into flat tables, and downloaded as CSV or a multi-sheet .xlsx
 * (exceljs, loaded on demand so it stays out of the main bundle).
 */
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import {
  activeTrays,
  basketTotal,
  budStatus,
  clampInt,
  daysUntilBud,
  describeShelf,
  fifoOrder,
  trayRecordFromSnapshot,
  type BasketDoc,
  type LocationDoc,
  type TrayRecord,
} from './inventory';

export type Cell = string | number | boolean | null;

export interface ExportTable {
  /** Sheet / file name. */
  name: string;
  columns: string[];
  rows: Cell[][];
}

export interface ExportBundle {
  generatedAt: string;
  tables: ExportTable[];
}

const fmtTs = (iso?: string | null) => (iso ? iso.replace('T', ' ').slice(0, 19) : '');

export async function collectExportBundle(): Promise<ExportBundle> {
  const [productsSnap, basketsSnap, traysSnap, locationsSnap, usersSnap, countsSnap, sessionsSnap] = await Promise.all([
    getDocs(collection(db, 'products')),
    getDocs(collection(db, 'baskets')),
    getDocs(collection(db, 'trays')),
    getDocs(collection(db, 'locations')),
    getDocs(collection(db, 'users')),
    getDocs(query(collection(db, 'inventoryLogs'), where('action', '==', 'COUNT'))),
    getDocs(collection(db, 'countingSessions')),
  ]);

  const products = new Map<string, { name: string; category: string; currentStock: number; reorderPoint: number; updatedAt?: string }>();
  productsSnap.forEach((d) => {
    const p = d.data();
    products.set(d.id, {
      name: String(p.name ?? d.id),
      category: String(p.category ?? ''),
      currentStock: clampInt(p.currentStock),
      reorderPoint: clampInt(p.reorderPoint),
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : undefined,
    });
  });
  const locations = new Map<string, LocationDoc>();
  locationsSnap.forEach((d) => locations.set(d.id, d.data() as LocationDoc));
  const users = new Map<string, string>();
  usersSnap.forEach((d) => {
    const u = d.data();
    users.set(d.id, String(u.displayName || u.email || d.id));
  });
  const bins: (BasketDoc & { id: string })[] = [];
  basketsSnap.forEach((d) => bins.push({ id: d.id, ...(d.data() as BasketDoc) }));
  const trays: TrayRecord[] = [];
  traysSnap.forEach((d) => {
    const t = trayRecordFromSnapshot(d.id, d.data());
    if (t) trays.push(t);
  });

  const locName = (id: string) => locations.get(id)?.name;
  const productName = (id: string) => products.get(id)?.name ?? id;
  const userName = (id?: string) => (id ? users.get(id) ?? id : '');
  const binById = new Map(bins.map((b) => [b.id, b]));

  // ---- Products -------------------------------------------------------------
  const perProduct = new Map<string, { bins: number; vials: number; last: string }>();
  for (const b of bins) {
    const cur = perProduct.get(b.productId) ?? { bins: 0, vials: 0, last: '' };
    cur.bins += 1;
    cur.vials += basketTotal(b);
    if (b.lastCountedAt && b.lastCountedAt > cur.last) cur.last = b.lastCountedAt;
    perProduct.set(b.productId, cur);
  }
  const productRows: Cell[][] = Array.from(products.entries())
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([id, p]) => {
      const agg = perProduct.get(id) ?? { bins: 0, vials: 0, last: '' };
      return [p.name, p.category, p.currentStock, p.reorderPoint, p.currentStock <= p.reorderPoint, agg.bins, agg.vials, fmtTs(agg.last)];
    });

  // ---- Bins -------------------------------------------------------------------
  const binRows: Cell[][] = [...bins]
    .sort(
      (a, b) =>
        (locName(a.locationId) ?? '').localeCompare(locName(b.locationId) ?? '') ||
        (a.shelfId ?? '').localeCompare(b.shelfId ?? '') ||
        a.name.localeCompare(b.name),
    )
    .map((b) => [
      locName(b.locationId) ?? '',
      describeShelf(b.shelfId, locName),
      b.name,
      productName(b.productId),
      clampInt(b.trayCount),
      clampInt(b.vialsPerTray, 1),
      clampInt(b.looseVials),
      basketTotal(b),
      typeof b.totalVials === 'number',
      fmtTs(b.lastCountedAt),
      userName(b.lastCountedBy),
      b.qrCode,
    ]);

  // ---- Trays (use-first order per product) ------------------------------------
  const active = activeTrays(trays);
  const byProduct = new Map<string, TrayRecord[]>();
  for (const t of active) {
    const key = t.productId || binById.get(t.basketId)?.productId || '';
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key)!.push(t);
  }
  const trayRows: Cell[][] = [];
  Array.from(byProduct.entries())
    .sort((a, b) => productName(a[0]).localeCompare(productName(b[0])))
    .forEach(([pid, list]) => {
      fifoOrder(list).forEach((t, i) => {
        const bin = binById.get(t.basketId);
        trayRows.push([
          productName(pid),
          bin ? locName(bin.locationId) ?? '' : '',
          bin ? describeShelf(bin.shelfId, locName) : '',
          bin?.name ?? '',
          t.slot,
          i + 1,
          t.countedAt ? t.count : null,
          t.capacity,
          t.lotNumber ?? '',
          t.dateCompounded ?? '',
          t.bud ?? '',
          daysUntilBud(t.bud),
          budStatus(t.bud),
          t.labelText ?? '',
          fmtTs(t.countedAt),
          userName(t.countedBy),
          `TRAY:${t.id}`,
        ]);
      });
    });

  // ---- Count history ----------------------------------------------------------
  const countRows: Cell[][] = [];
  countsSnap.forEach((d) => {
    const l = d.data();
    const prev = clampInt(l.previousCount);
    const next = clampInt(l.newCount ?? l.amount);
    countRows.push([fmtTs(l.timestamp), productName(String(l.productId)), prev, next, next - prev, userName(String(l.userId)), String(l.sessionId ?? ''), String(l.reason ?? '')]);
  });
  countRows.sort((a, b) => String(b[0]).localeCompare(String(a[0])));

  // ---- Sessions ---------------------------------------------------------------
  const sessionRows: Cell[][] = [];
  sessionsSnap.forEach((d) => {
    const s = d.data();
    sessionRows.push([
      fmtTs(s.startedAt),
      fmtTs(s.completedAt),
      String(s.userName ?? userName(String(s.userId))),
      String(s.status ?? ''),
      Array.isArray(s.countedBaskets) ? s.countedBaskets.length : clampInt(s.progress?.basketsCounted),
      clampInt(s.progress?.traysCounted),
      clampInt(s.progress?.vialsCounted),
      clampInt(s.progress?.totalVials),
      d.id,
    ]);
  });
  sessionRows.sort((a, b) => String(b[0]).localeCompare(String(a[0])));

  // ---- Summary ----------------------------------------------------------------
  const now = new Date().toISOString();
  const vialsOnHand = bins.reduce((s, b) => s + basketTotal(b), 0);
  const summaryRows: Cell[][] = [
    ['Generated', fmtTs(now)],
    ['Products', products.size],
    ['Low-stock products', Array.from(products.values()).filter((p) => p.currentStock <= p.reorderPoint).length],
    ['Bins', bins.length],
    ['Bins never counted', bins.filter((b) => !b.lastCountedAt).length],
    ['Active trays', active.length],
    ['Vials on hand (last known)', vialsOnHand],
    ['Trays expired', active.filter((t) => budStatus(t.bud) === 'expired').length],
    ['Trays expiring within 30 days', active.filter((t) => budStatus(t.bud) === 'soon').length],
    ['Completed count sessions', sessionRows.filter((r) => r[3] === 'completed').length],
  ];

  return {
    generatedAt: now,
    tables: [
      { name: 'Summary', columns: ['Metric', 'Value'], rows: summaryRows },
      { name: 'Products', columns: ['Product', 'Category', 'On hand', 'Reorder point', 'Low stock', 'Bins', 'Vials in bins', 'Last counted'], rows: productRows },
      { name: 'Bins', columns: ['Fridge', 'Shelf', 'Bin', 'Product', 'Trays', 'Vials per tray', 'Loose vials', 'Total vials', 'Counted', 'Last counted', 'Counted by', 'QR code'], rows: binRows },
      { name: 'Trays (use first)', columns: ['Product', 'Fridge', 'Shelf', 'Bin', 'Tray #', 'Use-first rank', 'Vials', 'Capacity', 'Lot #', 'Date compounded', 'BUD', 'Days to BUD', 'BUD status', 'Label text', 'Counted at', 'Counted by', 'QR code'], rows: trayRows },
      { name: 'Count history', columns: ['Timestamp', 'Product', 'Previous', 'New', 'Delta', 'User', 'Session', 'Reason'], rows: countRows },
      { name: 'Sessions', columns: ['Started', 'Completed', 'User', 'Status', 'Bins', 'Trays', 'Vials', 'Net delta', 'Session ID'], rows: sessionRows },
    ],
  };
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v: Cell) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function tableToCsv(table: ExportTable): string {
  return [table.columns.map(csvCell).join(','), ...table.rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

export function downloadTableCsv(table: ExportTable, datePrefix = new Date().toISOString().slice(0, 10)) {
  const slug = table.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  triggerDownload(new Blob([tableToCsv(table)], { type: 'text/csv;charset=utf-8;' }), `vialtrack-${slug}-${datePrefix}.csv`);
}

/** Multi-sheet .xlsx with bold headers, frozen first row, filters and sensible widths. */
export async function downloadWorkbook(bundle: ExportBundle) {
  const mod: any = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VialTrack';
  wb.created = new Date(bundle.generatedAt);
  for (const table of bundle.tables) {
    const ws = wb.addWorksheet(table.name.slice(0, 31));
    ws.columns = table.columns.map((c, i) => {
      const longest = table.rows.reduce((m, r) => Math.max(m, String(r[i] ?? '').length), c.length);
      return { header: c, key: `c${i}`, width: Math.min(48, Math.max(10, longest + 2)) };
    });
    table.rows.forEach((r) => ws.addRow(r.map((v) => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : v))));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    if (table.rows.length > 0 && table.columns.length > 1) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: table.columns.length } };
    }
  }
  const buffer = await wb.xlsx.writeBuffer();
  triggerDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `vialtrack-inventory-${bundle.generatedAt.slice(0, 10)}.xlsx`,
  );
}
