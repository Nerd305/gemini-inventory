/**
 * Shared model + helpers for the physical inventory hierarchy:
 *
 *   Fridge (locations/{id})  →  Shelf (derived: `${locationId}-${n}`)
 *     →  Bin / basket (baskets/{id})  →  Tray (baskets/{id}/trays/slot-N)  →  vials
 *
 * Bins hold a variable number of trays. Trays are molded 5×5 (25-pocket) inserts,
 * usually full, sometimes partial — the counter records the true number per tray.
 */
import {
  addDoc,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';

export const DEFAULT_VIALS_PER_TRAY = 25;
export const TRAY_GRID = { rows: 5, cols: 5 } as const;
export const BUD_WARNING_DAYS = 30;

// ---------------------------------------------------------------------------
// QR code formats consumed by /count (see CountingSessionContext.parseScan)
// ---------------------------------------------------------------------------

export function basketQrCode(basketId: string): string {
  return `BSKT:${basketId}`;
}

/** Shelf IDs are derived from the fridge (location) doc ID + 1-based index from the top. */
export function makeShelfId(locationId: string, shelfIndex: number): string {
  return `${locationId}-${shelfIndex}`;
}

export function shelfQrCode(locationId: string, shelfIndex: number): string {
  return `SHELF:${makeShelfId(locationId, shelfIndex)}`;
}

export function trayQrCode(basketId: string, slot: number): string {
  return `TRAY:${basketId}-${slot}`;
}

export interface ParsedShelfId {
  locationId: string;
  shelfIndex: number;
}

/** `${locationId}-${n}` → parts. Firestore auto-IDs never contain "-", so splitting on the last dash is safe. */
export function parseShelfId(shelfId: string | null | undefined): ParsedShelfId | null {
  if (!shelfId) return null;
  const i = shelfId.lastIndexOf('-');
  if (i <= 0) return null;
  const n = Number(shelfId.slice(i + 1));
  if (!Number.isInteger(n) || n < 1) return null;
  return { locationId: shelfId.slice(0, i), shelfIndex: n };
}

export interface ParsedTrayId {
  basketId: string;
  slot: number;
}

export function parseTrayId(trayId: string | null | undefined): ParsedTrayId | null {
  if (!trayId) return null;
  const i = trayId.lastIndexOf('-');
  if (i <= 0) return null;
  const slot = Number(trayId.slice(i + 1));
  if (!Number.isInteger(slot) || slot < 1) return null;
  return { basketId: trayId.slice(0, i), slot };
}

/** Human label for a shelf id given a lookup of location names. */
export function describeShelf(
  shelfId: string | null | undefined,
  locationName?: (locationId: string) => string | undefined,
): string {
  if (!shelfId) return '';
  const parsed = parseShelfId(shelfId);
  if (!parsed) return `Shelf ${shelfId}`;
  const name = locationName?.(parsed.locationId);
  return name ? `${name} · Shelf ${parsed.shelfIndex}` : `Shelf ${parsed.shelfIndex}`;
}

// ---------------------------------------------------------------------------
// Firestore document shapes
// ---------------------------------------------------------------------------

export interface BasketDoc {
  productId: string;
  locationId: string;
  name: string;
  trayCount: number;
  vialsPerTray: number;
  looseVials: number;
  qrCode: string;
  createdAt: string;
  updatedAt?: string;
  shelfId?: string;
  shelfPosition?: number;
  /** Denormalized: sum of tray counts (slots 1..trayCount) + looseVials at the last finished count. */
  totalVials?: number;
  lastCountedAt?: string;
  lastCountedBy?: string;
}

export interface TrayLabelFields {
  lotNumber?: string;
  /** ISO date (YYYY-MM-DD) when parseable, otherwise the raw text from the label. */
  bud?: string;
  dateCompounded?: string;
  /** Product + strength as printed on the compounding label. */
  labelText?: string;
}

export interface TrayDoc extends TrayLabelFields {
  slot: number;
  count: number;
  countedAt?: string;
  countedBy?: string;
  /** Counting session that last wrote this tray — used for gross per-session totals. */
  sessionId?: string;
  aiPrediction?: number;
}

export type TrayMap = Map<number, TrayDoc>;

export interface LocationDoc {
  name: string;
  type: 'fridge' | 'shelf' | 'cabinet' | string;
  description?: string;
  qrCode: string;
  createdAt: string;
  /** Number of shelves, top → bottom. Drives shelf QR labels. */
  shelfCount?: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function clampInt(n: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

/** Expected total when nothing has been counted yet (setup values). */
export function nominalBasketTotal(b: Pick<BasketDoc, 'trayCount' | 'vialsPerTray' | 'looseVials'>): number {
  return clampInt(b.trayCount) * clampInt(b.vialsPerTray, 1) + clampInt(b.looseVials);
}

/** Best-known total: the last finished count if there is one, otherwise the nominal setup total. */
export function basketTotal(b: BasketDoc): number {
  return typeof b.totalVials === 'number' ? b.totalVials : nominalBasketTotal(b);
}

/** Sum of counted trays inside the declared tray range plus loose vials. */
export function liveBasketTotal(trays: TrayMap, trayCount: number, looseVials: number): number {
  let sum = 0;
  for (let slot = 1; slot <= trayCount; slot++) {
    const t = trays.get(slot);
    if (t) sum += t.count;
  }
  return sum + clampInt(looseVials);
}

export function countedSlots(trays: TrayMap, trayCount: number): number {
  let n = 0;
  for (let slot = 1; slot <= trayCount; slot++) if (trays.has(slot)) n++;
  return n;
}

export function allSlotsCounted(trays: TrayMap, trayCount: number): boolean {
  return trayCount > 0 && countedSlots(trays, trayCount) === trayCount;
}

export function nextUncountedSlot(trays: TrayMap, trayCount: number, current: number | null): number | null {
  const start = current === null ? 1 : current + 1;
  for (let s = start; s <= trayCount; s++) if (!trays.has(s)) return s;
  for (let s = 1; s <= trayCount; s++) if (!trays.has(s)) return s;
  return null;
}

/** Normalize a label date ("8/6/2026", "2026-08-06", "Aug 6 2026") to YYYY-MM-DD; returns the raw text if unparseable. */
export function normalizeLabelDate(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const text = String(raw).trim();
  if (!text) return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return text;
  const us = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(text);
  if (us) {
    const m = Number(us[1]);
    const d = Number(us[2]);
    let y = Number(us[3]);
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }
  return text;
}

export type BudStatus = 'ok' | 'soon' | 'expired' | 'unknown';

/** Days until the beyond-use date (negative when past). null when the BUD isn't a parseable date. */
export function daysUntilBud(bud: string | undefined, now: Date = new Date()): number | null {
  if (!bud) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bud);
  if (!m) return null;
  const budDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((budDate.getTime() - today.getTime()) / 86_400_000);
}

export function budStatus(bud: string | undefined, now: Date = new Date()): BudStatus {
  const days = daysUntilBud(bud, now);
  if (days === null) return 'unknown';
  if (days < 0) return 'expired';
  if (days <= BUD_WARNING_DAYS) return 'soon';
  return 'ok';
}

export function formatBud(bud: string | undefined): string {
  if (!bud) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bud);
  if (!m) return bud;
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

/** Strip undefined values so Firestore setDoc/updateDoc accept the payload. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export function trayDocId(slot: number): string {
  return `slot-${slot}`;
}

interface ProgressEntry {
  count: number;
  previous: TrayDoc | null;
}

/**
 * Bump the live counters on a counting session.
 *  - progress.totalVials   : net change vs. the previously stored tray counts (existing semantics)
 *  - progress.vialsCounted : gross vials counted in this session (re-counting a tray replaces, not adds)
 *  - progress.traysCounted : distinct trays counted in this session
 */
export async function bumpSessionProgress(
  sessionId: string,
  basketId: string,
  entries: ProgressEntry[],
): Promise<void> {
  let net = 0;
  let gross = 0;
  let trays = 0;
  for (const e of entries) {
    const prevCount = e.previous?.count ?? 0;
    const countedThisSession = e.previous?.sessionId === sessionId;
    net += e.count - prevCount;
    gross += e.count - (countedThisSession ? prevCount : 0);
    if (!countedThisSession) trays += 1;
  }
  await updateDoc(doc(db, 'countingSessions', sessionId), {
    'progress.totalVials': increment(net),
    'progress.vialsCounted': increment(gross),
    'progress.traysCounted': increment(trays),
    countedBaskets: arrayUnion(basketId),
  });
}

export interface RecordTrayCountParams {
  basketId: string;
  slot: number;
  count: number;
  userId: string;
  sessionId: string | null;
  previous: TrayDoc | null;
  aiPrediction?: number | null;
  label?: TrayLabelFields;
}

/** Persist one tray's count (+ optional label metadata) and update the session counters. */
export async function recordTrayCount(p: RecordTrayCountParams): Promise<void> {
  const now = new Date().toISOString();
  // When a label object is supplied, an empty field means "clear it" (merge:true would otherwise keep the old value).
  const labelField = (value: string | undefined) =>
    p.label === undefined ? undefined : value?.trim() ? value.trim() : deleteField();
  const payload = compact({
    slot: p.slot,
    count: clampInt(p.count),
    countedAt: now,
    countedBy: p.userId,
    sessionId: p.sessionId ?? undefined,
    aiPrediction: typeof p.aiPrediction === 'number' ? p.aiPrediction : undefined,
    lotNumber: labelField(p.label?.lotNumber),
    bud: labelField(p.label?.bud),
    dateCompounded: labelField(p.label?.dateCompounded),
    labelText: labelField(p.label?.labelText),
  });
  await setDoc(doc(db, 'baskets', p.basketId, 'trays', trayDocId(p.slot)), payload, { merge: true });
  if (p.sessionId) {
    try {
      await bumpSessionProgress(p.sessionId, p.basketId, [{ count: payload.count as number, previous: p.previous }]);
    } catch (err) {
      console.error('Failed to update session progress', err);
    }
  }
}

/** Mark every declared tray slot as full (capacity vials) in one batch. */
export async function setAllTraysFull(params: {
  basketId: string;
  trayCount: number;
  vialsPerTray: number;
  userId: string;
  sessionId: string | null;
  existing: TrayMap;
}): Promise<void> {
  const { basketId, trayCount, vialsPerTray, userId, sessionId, existing } = params;
  if (trayCount <= 0) return;
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  const entries: ProgressEntry[] = [];
  for (let slot = 1; slot <= trayCount; slot++) {
    const ref = doc(db, 'baskets', basketId, 'trays', trayDocId(slot));
    batch.set(
      ref,
      compact({ slot, count: vialsPerTray, countedAt: now, countedBy: userId, sessionId: sessionId ?? undefined }),
      { merge: true },
    );
    entries.push({ count: vialsPerTray, previous: existing.get(slot) ?? null });
  }
  await batch.commit();
  if (sessionId) {
    try {
      await bumpSessionProgress(sessionId, basketId, entries);
    } catch (err) {
      console.error('Failed to update session progress', err);
    }
  }
}

export async function updateBasket(basketId: string, patch: Partial<BasketDoc>): Promise<void> {
  await updateDoc(doc(db, 'baskets', basketId), {
    ...compact(patch as Record<string, unknown>),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Called when the counter finishes a bin: sums the declared tray slots + loose vials,
 * stores the denormalized total on the basket, and refreshes the session's basket counter.
 */
export async function finalizeBasketCount(params: {
  basketId: string;
  userId: string;
  sessionId: string | null;
}): Promise<number | null> {
  const { basketId, userId, sessionId } = params;
  const basketRef = doc(db, 'baskets', basketId);
  const [basketSnap, traysSnap] = await Promise.all([
    getDoc(basketRef),
    getDocs(collection(db, 'baskets', basketId, 'trays')),
  ]);
  if (!basketSnap.exists()) return null;
  const basket = basketSnap.data() as BasketDoc;
  const trays: TrayMap = new Map();
  traysSnap.forEach((d) => {
    const t = d.data() as TrayDoc;
    if (typeof t.slot === 'number' && typeof t.count === 'number') trays.set(t.slot, t);
  });
  const total = liveBasketTotal(trays, clampInt(basket.trayCount), clampInt(basket.looseVials));
  const now = new Date().toISOString();
  await updateDoc(basketRef, {
    totalVials: total,
    lastCountedAt: now,
    lastCountedBy: userId,
    updatedAt: now,
  });

  if (sessionId) {
    try {
      const sessionRef = doc(db, 'countingSessions', sessionId);
      await updateDoc(sessionRef, { countedBaskets: arrayUnion(basketId) });
      const fresh = await getDoc(sessionRef);
      const counted = fresh.exists() && Array.isArray(fresh.data().countedBaskets) ? fresh.data().countedBaskets.length : 0;
      await updateDoc(sessionRef, { 'progress.basketsCounted': counted });
    } catch (err) {
      console.error('Failed to update session basket counter', err);
    }
  }
  return total;
}

export interface StockSyncResult {
  productId: string;
  productName: string;
  previousStock: number;
  newStock: number;
  binCount: number;
}

/**
 * Reconcile products.currentStock from the bins that hold them (sum of basketTotal)
 * and write an immutable COUNT entry to inventoryLogs for each product.
 */
export async function syncProductStockFromBaskets(
  productIds: string[],
  userId: string,
  sessionId?: string | null,
): Promise<StockSyncResult[]> {
  const unique = Array.from(new Set(productIds.filter(Boolean)));
  const results: StockSyncResult[] = [];
  for (const productId of unique) {
    const prodRef = doc(db, 'products', productId);
    const [prodSnap, basketsSnap] = await Promise.all([
      getDoc(prodRef),
      getDocs(query(collection(db, 'baskets'), where('productId', '==', productId))),
    ]);
    if (!prodSnap.exists()) continue;
    let total = 0;
    basketsSnap.forEach((b) => {
      total += basketTotal(b.data() as BasketDoc);
    });
    const previousStock = clampInt(prodSnap.data().currentStock);
    const now = new Date().toISOString();
    await updateDoc(prodRef, { currentStock: total, updatedAt: now });
    await addDoc(collection(db, 'inventoryLogs'), {
      productId,
      userId,
      action: 'COUNT',
      amount: total,
      previousCount: previousStock,
      newCount: total,
      reason: 'Physical count',
      ...(sessionId ? { sessionId } : {}),
      timestamp: now,
    });
    results.push({
      productId,
      productName: (prodSnap.data().name as string) || productId,
      previousStock,
      newStock: total,
      binCount: basketsSnap.size,
    });
  }
  return results;
}
