/**
 * Shared model + helpers for the physical inventory hierarchy:
 *
 *   Fridge (locations/{id})  →  Shelf (derived: `${locationId}-${n}`)
 *     →  Bin / basket (baskets/{id})  →  Tray (trays/{trayId}, basketId = bin)  →  vials
 *
 * Bins hold a variable number of trays. Trays are molded 5×5 (25-pocket) inserts,
 * usually full, sometimes partial. Every physical tray is its own document with a
 * stable ID so its compounding-label data (lot #, date compounded, BUD) travels with
 * it: that is what makes FIFO ("use this tray first") possible even when trays are
 * shuffled inside a bin or moved between bins.
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
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';

export const DEFAULT_VIALS_PER_TRAY = 25;
export const TRAY_GRID = { rows: 5, cols: 5 } as const;
export const BUD_WARNING_DAYS = 30;
export const MAX_TRAYS_PER_BIN = 40;

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

/** Tray labels encode the tray document ID (stable for the life of the physical tray). */
export function trayQrCode(trayId: string): string {
  return `TRAY:${trayId}`;
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

export interface ParsedLegacyTrayId {
  basketId: string;
  slot: number;
}

/** v1.0.9 printed `TRAY:{basketId}-{slot}`. Auto-ID tray IDs contain no dash, so this only matches the old format. */
export function parseLegacyTrayId(trayId: string | null | undefined): ParsedLegacyTrayId | null {
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
  /** Number of active trays. Maintained by the tray write paths (syncBasketTrayCount). */
  trayCount: number;
  vialsPerTray: number;
  looseVials: number;
  qrCode: string;
  createdAt: string;
  updatedAt?: string;
  shelfId?: string;
  shelfPosition?: number;
  /** Denormalized: sum of active tray counts + looseVials at the last finished count. */
  totalVials?: number;
  lastCountedAt?: string;
  lastCountedBy?: string;
  /** Set once legacy baskets/{id}/trays/slot-N docs have been copied into the trays collection. */
  migratedTraysAt?: string;
}

export interface TrayLabelFields {
  lotNumber?: string;
  /** ISO date (YYYY-MM-DD) when parseable, otherwise the raw text from the label. */
  bud?: string;
  dateCompounded?: string;
  /** Product + strength as printed on the compounding label. */
  labelText?: string;
}

export type TrayStatus = 'active' | 'removed';

/** trays/{trayId} */
export interface TrayRecord extends TrayLabelFields {
  id: string;
  basketId: string;
  productId: string;
  /** Display position inside the bin, 1-based; re-sequenced when trays are removed. */
  slot: number;
  count: number;
  /** Pockets in this tray (copied from the bin's vialsPerTray when created). */
  capacity: number;
  status: TrayStatus;
  countedAt?: string;
  countedBy?: string;
  /** Counting session that last wrote this tray — used for per-session progress. */
  sessionId?: string;
  aiPrediction?: number;
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
  removedAt?: string;
  removedBy?: string;
}

export type TrayRecordData = Omit<TrayRecord, 'id'>;

/** Legacy tray shape at baskets/{id}/trays/slot-N (pre tray-identity). Read only for migration. */
export interface LegacyTrayDoc extends TrayLabelFields {
  slot: number;
  count: number;
  countedAt?: string;
  countedBy?: string;
  sessionId?: string;
  aiPrediction?: number;
}

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

export function trayRecordFromSnapshot(id: string, data: Record<string, unknown>): TrayRecord | null {
  if (typeof data.basketId !== 'string' || typeof data.slot !== 'number') return null;
  return {
    id,
    basketId: data.basketId,
    productId: typeof data.productId === 'string' ? data.productId : '',
    slot: data.slot,
    count: clampInt(data.count),
    capacity: clampInt(data.capacity, 1) || DEFAULT_VIALS_PER_TRAY,
    status: data.status === 'removed' ? 'removed' : 'active',
    countedAt: typeof data.countedAt === 'string' ? data.countedAt : undefined,
    countedBy: typeof data.countedBy === 'string' ? data.countedBy : undefined,
    sessionId: typeof data.sessionId === 'string' ? data.sessionId : undefined,
    aiPrediction: typeof data.aiPrediction === 'number' ? data.aiPrediction : undefined,
    lotNumber: typeof data.lotNumber === 'string' ? data.lotNumber : undefined,
    bud: typeof data.bud === 'string' ? data.bud : undefined,
    dateCompounded: typeof data.dateCompounded === 'string' ? data.dateCompounded : undefined,
    labelText: typeof data.labelText === 'string' ? data.labelText : undefined,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    removedAt: typeof data.removedAt === 'string' ? data.removedAt : undefined,
    removedBy: typeof data.removedBy === 'string' ? data.removedBy : undefined,
  };
}

/** Trays still physically in the bin, in slot order. */
export function activeTrays(trays: TrayRecord[]): TrayRecord[] {
  return trays.filter((t) => t.status === 'active').sort((a, b) => a.slot - b.slot || a.createdAt.localeCompare(b.createdAt));
}

export function hasBeenCounted(t: TrayRecord): boolean {
  return Boolean(t.countedAt);
}

export function countedInSession(t: TrayRecord, sessionId: string | null): boolean {
  return Boolean(sessionId) && t.sessionId === sessionId;
}

export function traysCountedInSession(trays: TrayRecord[], sessionId: string | null): number {
  return activeTrays(trays).filter((t) => countedInSession(t, sessionId)).length;
}

export function allTraysCountedInSession(trays: TrayRecord[], sessionId: string | null): boolean {
  const active = activeTrays(trays);
  return active.length > 0 && active.every((t) => countedInSession(t, sessionId));
}

/** Next active tray not yet counted in this session, starting after `currentId` and wrapping. */
export function nextUncountedTray(trays: TrayRecord[], sessionId: string | null, currentId: string | null): TrayRecord | null {
  const active = activeTrays(trays);
  const start = currentId ? active.findIndex((t) => t.id === currentId) + 1 : 0;
  for (let i = 0; i < active.length; i++) {
    const t = active[(start + i) % active.length];
    if (!countedInSession(t, sessionId)) return t;
  }
  return null;
}

/** Sum of active tray counts plus loose vials. */
export function liveBasketTotal(trays: TrayRecord[], looseVials: number): number {
  return activeTrays(trays).reduce((s, t) => s + t.count, 0) + clampInt(looseVials);
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

/** Short "8/6/26" form for labels. */
export function formatBudShort(bud: string | undefined): string {
  if (!bud) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bud);
  if (!m) return bud;
  return `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}`;
}

/**
 * FIFO order: earliest BUD first (unknown BUD last), then earliest date compounded,
 * then slot. Only active trays are returned.
 */
export function fifoOrder(trays: TrayRecord[]): TrayRecord[] {
  const key = (t: TrayRecord) => {
    const bud = /^\d{4}-\d{2}-\d{2}$/.test(t.bud ?? '') ? (t.bud as string) : '9999-99-99';
    const cmp = /^\d{4}-\d{2}-\d{2}$/.test(t.dateCompounded ?? '') ? (t.dateCompounded as string) : '9999-99-99';
    return `${bud}|${cmp}|${String(t.slot).padStart(3, '0')}`;
  };
  return activeTrays(trays).sort((a, b) => key(a).localeCompare(key(b)));
}

/** ID of the tray that should be used first, or null when no tray carries a date. */
export function useFirstTrayId(trays: TrayRecord[]): string | null {
  const ordered = fifoOrder(trays);
  const first = ordered[0];
  if (!first) return null;
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(first.bud ?? '') || /^\d{4}-\d{2}-\d{2}$/.test(first.dateCompounded ?? '');
  return dated ? first.id : null;
}

/** Second line printed on a tray label. */
export function trayLabelSubtitle(t: Pick<TrayRecord, 'lotNumber' | 'bud' | 'dateCompounded' | 'capacity'>): string {
  const parts: string[] = [];
  if (t.lotNumber) parts.push(`Lot ${t.lotNumber}`);
  if (t.bud) parts.push(`BUD ${formatBudShort(t.bud)}`);
  if (!t.bud && t.dateCompounded) parts.push(`Cmpd ${formatBudShort(t.dateCompounded)}`);
  return parts.length > 0 ? parts.join(' · ') : `${t.capacity} vials/tray`;
}

/** Strip undefined values so Firestore setDoc/updateDoc accept the payload. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function traysForBasketQuery(basketId: string) {
  return query(collection(db, 'trays'), where('basketId', '==', basketId));
}

export function traysForProductQuery(productId: string) {
  return query(collection(db, 'trays'), where('productId', '==', productId));
}

export function activeTraysQuery() {
  return query(collection(db, 'trays'), where('status', '==', 'active'));
}

export async function fetchTraysForBasket(basketId: string): Promise<TrayRecord[]> {
  const snap = await getDocs(traysForBasketQuery(basketId));
  const out: TrayRecord[] = [];
  snap.forEach((d) => {
    const t = trayRecordFromSnapshot(d.id, d.data());
    if (t) out.push(t);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

interface ProgressEntry {
  count: number;
  previous: Pick<TrayRecord, 'count' | 'sessionId' | 'countedAt'> | null;
}

/**
 * Bump the live counters on a counting session.
 *  - progress.totalVials   : net change vs. the previously stored tray counts
 *  - progress.vialsCounted : gross vials counted in this session (re-counting a tray replaces, not adds)
 *  - progress.traysCounted : distinct trays counted in this session
 */
export async function bumpSessionProgress(sessionId: string, basketId: string, entries: ProgressEntry[]): Promise<void> {
  let net = 0;
  let gross = 0;
  let trays = 0;
  for (const e of entries) {
    const prevCount = e.previous?.countedAt ? e.previous.count : 0;
    const countedThisSession = Boolean(e.previous?.sessionId) && e.previous?.sessionId === sessionId;
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

export async function updateBasket(basketId: string, patch: Partial<BasketDoc>): Promise<void> {
  await updateDoc(doc(db, 'baskets', basketId), {
    ...compact(patch as Record<string, unknown>),
    updatedAt: new Date().toISOString(),
  });
}

/** Keep baskets.trayCount equal to the number of active trays. */
export async function syncBasketTrayCount(basketId: string, knownTrays?: TrayRecord[]): Promise<number> {
  const trays = knownTrays ?? (await fetchTraysForBasket(basketId));
  const n = activeTrays(trays).length;
  await updateBasket(basketId, { trayCount: n });
  return n;
}

export interface NewTrayInput {
  count?: number;
  label?: TrayLabelFields;
  /** Mark as counted right now (sets countedAt/countedBy). */
  countedNow?: boolean;
}

/**
 * Add trays to a bin. Slots continue after the current highest active slot.
 * Returns the created tray IDs in order.
 */
export async function createTrays(params: {
  basketId: string;
  productId: string;
  capacity: number;
  userId: string;
  existing: TrayRecord[];
  items: NewTrayInput[];
  sessionId?: string | null;
}): Promise<string[]> {
  const { basketId, productId, capacity, userId, existing, items, sessionId } = params;
  if (items.length === 0) return [];
  const active = activeTrays(existing);
  let slot = active.length > 0 ? Math.max(...active.map((t) => t.slot)) : 0;
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  const ids: string[] = [];
  for (const item of items) {
    slot += 1;
    const ref = doc(collection(db, 'trays'));
    ids.push(ref.id);
    const counted = Boolean(item.countedNow);
    batch.set(
      ref,
      compact({
        basketId,
        productId,
        slot,
        count: clampInt(item.count ?? 0),
        capacity: clampInt(capacity, 1) || DEFAULT_VIALS_PER_TRAY,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        countedAt: counted ? now : undefined,
        countedBy: counted ? userId : undefined,
        sessionId: counted && sessionId ? sessionId : undefined,
        lotNumber: item.label?.lotNumber?.trim() || undefined,
        bud: item.label?.bud?.trim() || undefined,
        dateCompounded: item.label?.dateCompounded?.trim() || undefined,
        labelText: item.label?.labelText?.trim() || undefined,
      }),
    );
  }
  batch.update(doc(db, 'baskets', basketId), { trayCount: active.length + items.length, updatedAt: now });
  await batch.commit();
  return ids;
}

/** Soft-remove a tray (emptied / taken out of the bin) and re-sequence the remaining slots. */
export async function removeTray(params: { tray: TrayRecord; allTrays: TrayRecord[]; userId: string }): Promise<void> {
  const { tray, allTrays, userId } = params;
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  batch.update(doc(db, 'trays', tray.id), { status: 'removed', removedAt: now, removedBy: userId, updatedAt: now });
  const remaining = activeTrays(allTrays).filter((t) => t.id !== tray.id);
  remaining.forEach((t, i) => {
    if (t.slot !== i + 1) batch.update(doc(db, 'trays', t.id), { slot: i + 1, updatedAt: now });
  });
  batch.update(doc(db, 'baskets', tray.basketId), { trayCount: remaining.length, updatedAt: now });
  await batch.commit();
}

/** Move a tray into another bin (appends it as the last slot there). */
export async function moveTray(params: {
  tray: TrayRecord;
  sourceTrays: TrayRecord[];
  targetBasketId: string;
  targetProductId: string;
  targetTrays: TrayRecord[];
  userId: string;
}): Promise<void> {
  const { tray, sourceTrays, targetBasketId, targetProductId, targetTrays, userId } = params;
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  const targetActive = activeTrays(targetTrays).filter((t) => t.id !== tray.id);
  const nextSlot = targetActive.length > 0 ? Math.max(...targetActive.map((t) => t.slot)) + 1 : 1;
  batch.update(doc(db, 'trays', tray.id), {
    basketId: targetBasketId,
    productId: targetProductId,
    slot: nextSlot,
    updatedAt: now,
    movedBy: userId,
    movedAt: now,
  });
  const remaining = activeTrays(sourceTrays).filter((t) => t.id !== tray.id);
  remaining.forEach((t, i) => {
    if (t.slot !== i + 1) batch.update(doc(db, 'trays', t.id), { slot: i + 1, updatedAt: now });
  });
  batch.update(doc(db, 'baskets', tray.basketId), { trayCount: remaining.length, updatedAt: now });
  batch.update(doc(db, 'baskets', targetBasketId), { trayCount: targetActive.length + 1, updatedAt: now });
  await batch.commit();
}

/** Edit a tray's label fields without touching the count (Bins page). Empty strings clear the field. */
export async function updateTrayLabel(trayId: string, label: TrayLabelFields): Promise<void> {
  const field = (v: string | undefined) => (v === undefined ? undefined : v.trim() ? v.trim() : deleteField());
  await updateDoc(
    doc(db, 'trays', trayId),
    compact({
      lotNumber: field(label.lotNumber),
      bud: field(label.bud),
      dateCompounded: field(label.dateCompounded),
      labelText: field(label.labelText),
      updatedAt: new Date().toISOString(),
    }),
  );
}

export interface RecordTrayCountParams {
  tray: TrayRecord;
  count: number;
  userId: string;
  sessionId: string | null;
  aiPrediction?: number | null;
  label?: TrayLabelFields;
}

/** Persist one tray's count (+ optional label metadata) and update the session counters. */
export async function recordTrayCount(p: RecordTrayCountParams): Promise<void> {
  const now = new Date().toISOString();
  // When a label object is supplied, an empty field means "clear it".
  const labelField = (value: string | undefined) =>
    p.label === undefined ? undefined : value?.trim() ? value.trim() : deleteField();
  const count = clampInt(p.count);
  await updateDoc(
    doc(db, 'trays', p.tray.id),
    compact({
      count,
      countedAt: now,
      countedBy: p.userId,
      updatedAt: now,
      sessionId: p.sessionId ?? undefined,
      aiPrediction: typeof p.aiPrediction === 'number' ? p.aiPrediction : undefined,
      lotNumber: labelField(p.label?.lotNumber),
      bud: labelField(p.label?.bud),
      dateCompounded: labelField(p.label?.dateCompounded),
      labelText: labelField(p.label?.labelText),
    }),
  );
  if (p.sessionId) {
    try {
      await bumpSessionProgress(p.sessionId, p.tray.basketId, [{ count, previous: p.tray }]);
    } catch (err) {
      console.error('Failed to update session progress', err);
    }
  }
}

/** Mark every active tray in the bin as full (its capacity) in one batch. */
export async function setAllTraysFull(params: {
  basketId: string;
  trays: TrayRecord[];
  userId: string;
  sessionId: string | null;
}): Promise<void> {
  const { basketId, trays, userId, sessionId } = params;
  const active = activeTrays(trays);
  if (active.length === 0) return;
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  const entries: ProgressEntry[] = [];
  for (const t of active) {
    batch.update(
      doc(db, 'trays', t.id),
      compact({ count: t.capacity, countedAt: now, countedBy: userId, updatedAt: now, sessionId: sessionId ?? undefined }),
    );
    entries.push({ count: t.capacity, previous: t });
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

/**
 * Called when the counter finishes a bin: sums the active trays + loose vials,
 * stores the denormalized total on the basket, and refreshes the session's basket counter.
 */
export async function finalizeBasketCount(params: {
  basketId: string;
  userId: string;
  sessionId: string | null;
}): Promise<number | null> {
  const { basketId, userId, sessionId } = params;
  const basketRef = doc(db, 'baskets', basketId);
  const [basketSnap, trays] = await Promise.all([getDoc(basketRef), fetchTraysForBasket(basketId)]);
  if (!basketSnap.exists()) return null;
  const basket = basketSnap.data() as BasketDoc;
  const total = liveBasketTotal(trays, clampInt(basket.looseVials));
  const now = new Date().toISOString();
  await updateDoc(basketRef, {
    totalVials: total,
    trayCount: activeTrays(trays).length,
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

/**
 * One-time migration for bins created before trays had their own documents.
 * Copies baskets/{id}/trays/slot-N docs (if any) into the trays collection and pads
 * with blank trays up to the declared trayCount. Idempotent via baskets.migratedTraysAt.
 */
export async function migrateLegacyTrays(params: { basketId: string; userId: string }): Promise<TrayRecord[]> {
  const { basketId, userId } = params;
  const basketRef = doc(db, 'baskets', basketId);
  const basketSnap = await getDoc(basketRef);
  if (!basketSnap.exists()) return [];
  const basket = basketSnap.data() as BasketDoc;
  if (basket.migratedTraysAt) return [];

  const legacySnap = await getDocs(collection(db, 'baskets', basketId, 'trays'));
  const legacy: LegacyTrayDoc[] = [];
  legacySnap.forEach((d) => {
    const t = d.data() as LegacyTrayDoc;
    if (typeof t.slot === 'number' && t.slot >= 1) legacy.push(t);
  });
  legacy.sort((a, b) => a.slot - b.slot);

  const declared = clampInt(basket.trayCount, 0, MAX_TRAYS_PER_BIN);
  const bySlot = new Map(legacy.map((t) => [t.slot, t]));
  const total = Math.max(declared, legacy.length > 0 ? Math.max(...legacy.map((t) => t.slot)) : 0);
  const capacity = clampInt(basket.vialsPerTray, 1) || DEFAULT_VIALS_PER_TRAY;
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  const created: TrayRecord[] = [];
  for (let slot = 1; slot <= Math.min(total, MAX_TRAYS_PER_BIN); slot++) {
    const src = bySlot.get(slot);
    const ref = doc(collection(db, 'trays'));
    const record: TrayRecordData = compact({
      basketId,
      productId: basket.productId,
      slot,
      count: clampInt(src?.count ?? 0),
      capacity,
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      countedAt: src?.countedAt,
      countedBy: src?.countedBy,
      sessionId: src?.sessionId,
      aiPrediction: src?.aiPrediction,
      lotNumber: src?.lotNumber,
      bud: src?.bud,
      dateCompounded: src?.dateCompounded,
      labelText: src?.labelText,
    }) as TrayRecordData;
    batch.set(ref, record);
    created.push({ id: ref.id, ...record });
  }
  batch.update(basketRef, { migratedTraysAt: now, trayCount: created.length, updatedAt: now });
  await batch.commit();
  return created;
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
