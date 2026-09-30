/**
 * Backfill documents written by earlier versions of the app so they pass today's Firestore rules.
 *
 * The rules validate the *merged* document on every update, so a bin that was created by the
 * April prototype (`count`, `isFull`, `CONT:` code, no `name`/`trayCount`/`vialsPerTray`/
 * `looseVials`) is rejected the moment the new app tries to touch it. Repair adds the missing
 * required fields once; existing values are kept.
 */
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { basketQrCode, clampInt, DEFAULT_VIALS_PER_TRAY } from './inventory';

export interface LegacyReport {
  bins: number;
  products: number;
  locations: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const LOCATION_TYPES = ['fridge', 'shelf', 'cabinet'];

export function basketNeedsRepair(b: Record<string, unknown>): boolean {
  return (
    !isStr(b.name) ||
    !isNum(b.trayCount) ||
    !isNum(b.vialsPerTray) ||
    !isNum(b.looseVials) ||
    !isStr(b.qrCode) ||
    !isStr(b.createdAt) ||
    !isStr(b.productId) ||
    !isStr(b.locationId)
  );
}

export function productNeedsRepair(p: Record<string, unknown>): boolean {
  return !isStr(p.name) || !isStr(p.category) || !isNum(p.currentStock) || !isStr(p.createdAt);
}

export function locationNeedsRepair(l: Record<string, unknown>): boolean {
  return !isStr(l.name) || !LOCATION_TYPES.includes(String(l.type)) || !isStr(l.qrCode) || !isStr(l.createdAt);
}

/** Count documents that would be rejected by the rules on their next update. Read-only. */
export async function scanLegacyData(): Promise<LegacyReport> {
  const [products, locations, baskets] = await Promise.all([
    getDocs(collection(db, 'products')),
    getDocs(collection(db, 'locations')),
    getDocs(collection(db, 'baskets')),
  ]);
  return {
    products: products.docs.filter((d) => productNeedsRepair(d.data())).length,
    locations: locations.docs.filter((d) => locationNeedsRepair(d.data())).length,
    bins: baskets.docs.filter((d) => basketNeedsRepair(d.data())).length,
  };
}

/** Backfill required fields on legacy products, locations and bins. Keeps every existing value. */
export async function repairLegacyData(): Promise<LegacyReport> {
  const now = new Date().toISOString();
  const [productsSnap, locationsSnap, basketsSnap] = await Promise.all([
    getDocs(collection(db, 'products')),
    getDocs(collection(db, 'locations')),
    getDocs(collection(db, 'baskets')),
  ]);
  const productNames = new Map(productsSnap.docs.map((d) => [d.id, String(d.data().name ?? '')]));
  const report: LegacyReport = { bins: 0, products: 0, locations: 0 };

  let batch = writeBatch(db);
  let ops = 0;
  const flush = async () => {
    if (ops > 0) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  };
  const queue = async (path: [string, string], patch: Record<string, unknown>) => {
    batch.update(doc(db, path[0], path[1]), patch);
    ops += 1;
    if (ops >= 400) await flush();
  };

  for (const d of productsSnap.docs) {
    const p = d.data();
    if (!productNeedsRepair(p)) continue;
    await queue(['products', d.id], {
      name: isStr(p.name) && p.name ? p.name : 'Unnamed product',
      category: isStr(p.category) ? p.category : 'Uncategorized',
      currentStock: isNum(p.currentStock) ? p.currentStock : 0,
      createdAt: isStr(p.createdAt) ? p.createdAt : now,
      updatedAt: now,
    });
    report.products += 1;
  }

  for (const d of locationsSnap.docs) {
    const l = d.data();
    if (!locationNeedsRepair(l)) continue;
    await queue(['locations', d.id], {
      name: isStr(l.name) && l.name ? l.name : 'Fridge',
      type: LOCATION_TYPES.includes(String(l.type)) ? l.type : 'fridge',
      qrCode: isStr(l.qrCode) ? l.qrCode : `LOC:${d.id}`,
      createdAt: isStr(l.createdAt) ? l.createdAt : now,
    });
    report.locations += 1;
  }

  for (const d of basketsSnap.docs) {
    const b = d.data();
    if (!basketNeedsRepair(b)) continue;
    // Old bins stored a single vial count; turn it into full trays + loose and keep it as the last known total.
    const count = clampInt(b.count);
    const vialsPerTray = isNum(b.vialsPerTray) && b.vialsPerTray > 0 ? b.vialsPerTray : DEFAULT_VIALS_PER_TRAY;
    const productId = isStr(b.productId) ? b.productId : '';
    await queue(['baskets', d.id], {
      productId,
      locationId: isStr(b.locationId) ? b.locationId : '',
      name: isStr(b.name) && b.name ? b.name : productNames.get(productId) || 'Bin',
      vialsPerTray,
      trayCount: isNum(b.trayCount) ? b.trayCount : Math.floor(count / vialsPerTray),
      looseVials: isNum(b.looseVials) ? b.looseVials : count % vialsPerTray,
      qrCode: isStr(b.qrCode) && b.qrCode ? b.qrCode : basketQrCode(d.id),
      createdAt: isStr(b.createdAt) ? b.createdAt : now,
      updatedAt: now,
      ...(count > 0 && !isNum(b.totalVials) ? { totalVials: count } : {}),
    });
    report.bins += 1;
  }

  await flush();
  return report;
}
