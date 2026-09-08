import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  query,
  runTransaction,
  updateDoc,
  where,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import { basketCode, type ParsedCode } from './scanCodes';

export const DEFAULT_SHELF_COUNT = 5;
export const DEFAULT_VIALS_PER_TRAY = 25;

/** Basket slot positions on a shelf, matching the fridge photos (2 deep x 2 wide). */
export const SLOT_POSITIONS: { value: number; label: string; short: string }[] = [
  { value: 1, label: 'Back left', short: 'BL' },
  { value: 2, label: 'Back right', short: 'BR' },
  { value: 3, label: 'Front left', short: 'FL' },
  { value: 4, label: 'Front right', short: 'FR' },
];

export function slotLabel(position: number | null | undefined): string | null {
  if (!position) return null;
  return SLOT_POSITIONS.find((s) => s.value === position)?.label ?? `Slot ${position}`;
}

export interface FridgeLocation {
  id: string;
  name: string;
  type: string;
  description?: string;
  qrCode: string;
  shelfCount: number;
}

export interface BasketRecord {
  id: string;
  productId: string;
  locationId: string;
  name: string;
  trayCount: number;
  vialsPerTray: number;
  looseVials: number;
  qrCode: string;
  shelfId: string | null;
  shelfPosition: number | null;
  lotNumber: string;
  lastCountedAt: string | null;
  lastCountedBy: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface ProductSummary {
  id: string;
  name: string;
  category: string;
  currentStock: number;
}

export function toFridgeLocation(id: string, data: DocumentData): FridgeLocation {
  const shelfCount = Number(data.shelfCount);
  return {
    id,
    name: typeof data.name === 'string' ? data.name : '(unnamed)',
    type: typeof data.type === 'string' ? data.type : 'fridge',
    description: typeof data.description === 'string' ? data.description : undefined,
    qrCode: typeof data.qrCode === 'string' && data.qrCode ? data.qrCode : `LOC:${id}`,
    shelfCount: Number.isFinite(shelfCount) && shelfCount > 0 ? shelfCount : DEFAULT_SHELF_COUNT,
  };
}

export function toBasketRecord(id: string, data: DocumentData): BasketRecord {
  const vialsPerTray = Number(data.vialsPerTray);
  return {
    id,
    productId: typeof data.productId === 'string' ? data.productId : '',
    locationId: typeof data.locationId === 'string' ? data.locationId : '',
    name: typeof data.name === 'string' ? data.name : '',
    trayCount: Math.max(0, Number(data.trayCount) || 0),
    vialsPerTray: Number.isFinite(vialsPerTray) && vialsPerTray > 0 ? vialsPerTray : DEFAULT_VIALS_PER_TRAY,
    looseVials: Math.max(0, Number(data.looseVials) || 0),
    qrCode: typeof data.qrCode === 'string' && data.qrCode ? data.qrCode : basketCode(id),
    shelfId: typeof data.shelfId === 'string' && data.shelfId ? data.shelfId : null,
    shelfPosition: typeof data.shelfPosition === 'number' ? data.shelfPosition : null,
    lotNumber: typeof data.lotNumber === 'string' ? data.lotNumber : '',
    lastCountedAt: typeof data.lastCountedAt === 'string' ? data.lastCountedAt : null,
    lastCountedBy: typeof data.lastCountedBy === 'string' ? data.lastCountedBy : null,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
  };
}

export function toProductSummary(id: string, data: DocumentData): ProductSummary {
  return {
    id,
    name: typeof data.name === 'string' ? data.name : '(unnamed)',
    category: typeof data.category === 'string' ? data.category : '',
    currentStock: Number(data.currentStock) || 0,
  };
}

export function basketTotal(b: { trayCount: number; vialsPerTray: number; looseVials: number }): number {
  return b.trayCount * b.vialsPerTray + b.looseVials;
}

/** "4 trays + 22 vials", "6 trays", "19 vials", or "empty". */
export function formatTraysVials(trayCount: number, looseVials: number): string {
  const parts: string[] = [];
  if (trayCount > 0) parts.push(`${trayCount} ${trayCount === 1 ? 'tray' : 'trays'}`);
  if (looseVials > 0) parts.push(`${looseVials} ${looseVials === 1 ? 'vial' : 'vials'}`);
  return parts.length ? parts.join(' + ') : 'empty';
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export async function getLocation(locationId: string): Promise<FridgeLocation | null> {
  const snap = await getDoc(doc(db, 'locations', locationId));
  return snap.exists() ? toFridgeLocation(snap.id, snap.data()) : null;
}

/** Resolve LOC:/FRIDGE: payloads: doc id first, then the legacy `qrCode` field. */
export async function resolveLocationByCode(parsed: ParsedCode): Promise<FridgeLocation | null> {
  if (parsed.value) {
    const byId = await getLocation(parsed.value).catch(() => null);
    if (byId) return byId;
  }
  const snap = await getDocs(query(collection(db, 'locations'), where('qrCode', '==', parsed.raw), limit(1)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return toFridgeLocation(d.id, d.data());
}

export async function getBasket(basketId: string): Promise<BasketRecord | null> {
  const snap = await getDoc(doc(db, 'baskets', basketId));
  return snap.exists() ? toBasketRecord(snap.id, snap.data()) : null;
}

/** Resolve BSKT:/CONT: payloads: doc id first, then the legacy `qrCode` field. */
export async function resolveBasketByCode(parsed: ParsedCode): Promise<BasketRecord | null> {
  if (parsed.value) {
    const byId = await getBasket(parsed.value).catch(() => null);
    if (byId) return byId;
  }
  const snap = await getDocs(query(collection(db, 'baskets'), where('qrCode', '==', parsed.raw), limit(1)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return toBasketRecord(d.id, d.data());
}

// ---------------------------------------------------------------------------
// Live subscriptions (single-field filters only, so no composite indexes needed)
// ---------------------------------------------------------------------------

export function subscribeLocations(
  cb: (locations: FridgeLocation[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, 'locations'),
    (snap) => {
      const list = snap.docs.map((d) => toFridgeLocation(d.id, d.data()));
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      cb(list);
    },
    (err) => onError?.(err),
  );
}

export function subscribeAllBaskets(
  cb: (baskets: BasketRecord[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, 'baskets'),
    (snap) => cb(snap.docs.map((d) => toBasketRecord(d.id, d.data()))),
    (err) => onError?.(err),
  );
}

export function subscribeBasketsForLocation(
  locationId: string,
  cb: (baskets: BasketRecord[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'baskets'), where('locationId', '==', locationId)),
    (snap) => cb(snap.docs.map((d) => toBasketRecord(d.id, d.data()))),
    (err) => onError?.(err),
  );
}

export function subscribeBasket(
  basketId: string,
  cb: (basket: BasketRecord | null) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'baskets', basketId),
    (snap) => cb(snap.exists() ? toBasketRecord(snap.id, snap.data()) : null),
    (err) => onError?.(err),
  );
}

export function subscribeProducts(
  cb: (products: ProductSummary[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, 'products'),
    (snap) => {
      const list = snap.docs.map((d) => toProductSummary(d.id, d.data()));
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      cb(list);
    },
    (err) => onError?.(err),
  );
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CommitCountInput {
  basketId: string;
  trayCount: number;
  looseVials: number;
  vialsPerTray: number;
  userId: string;
  sessionId: string | null;
  /** When set, the basket is (re)assigned to this fridge / shelf / slot. */
  locationId?: string | null;
  shelfId?: string | null;
  shelfPosition?: number | null;
  /** Optional metadata edits saved together with the count. */
  name?: string;
  lotNumber?: string;
  note?: string;
}

export interface CommitCountResult {
  previousTotal: number;
  newTotal: number;
  delta: number;
  productId: string;
}

/**
 * Save a basket count as one atomic write: basket totals + assignment, a COUNT
 * inventory log, and the counting-session progress. The product's
 * `currentStock` is adjusted afterwards as a best-effort follow-up so a legacy
 * product doc that fails validation can never block the count itself.
 */
export async function commitBasketCount(input: CommitCountInput): Promise<CommitCountResult> {
  const trayCount = Math.max(0, Math.floor(input.trayCount));
  const looseVials = Math.max(0, Math.floor(input.looseVials));
  const vialsPerTray = input.vialsPerTray > 0 ? Math.floor(input.vialsPerTray) : DEFAULT_VIALS_PER_TRAY;
  const now = new Date().toISOString();
  const basketRef = doc(db, 'baskets', input.basketId);
  const sessionRef = input.sessionId ? doc(db, 'countingSessions', input.sessionId) : null;

  const result = await runTransaction(db, async (t) => {
    const bSnap = await t.get(basketRef);
    if (!bSnap.exists()) throw new Error('Basket no longer exists');
    const prev = toBasketRecord(bSnap.id, bSnap.data());

    let alreadyCountedThisSession = false;
    let sessionExists = false;
    if (sessionRef) {
      const sSnap = await t.get(sessionRef);
      sessionExists = sSnap.exists();
      const counted = sessionExists ? sSnap.data()?.countedBaskets : null;
      alreadyCountedThisSession = Array.isArray(counted) && counted.includes(input.basketId);
    }

    const previousTotal = basketTotal(prev);
    const newTotal = trayCount * vialsPerTray + looseVials;
    const delta = newTotal - previousTotal;
    const locationId = input.locationId || prev.locationId;

    const patch: Record<string, unknown> = {
      trayCount,
      looseVials,
      vialsPerTray,
      lastCountedAt: now,
      lastCountedBy: input.userId,
      updatedAt: now,
    };
    if (input.locationId) patch.locationId = input.locationId;
    if (input.shelfId) {
      patch.shelfId = input.shelfId;
    } else if (input.locationId && input.locationId !== prev.locationId && prev.shelfId) {
      // Moved to another fridge without a target shelf: drop the stale shelf reference.
      patch.shelfId = deleteField();
    }
    if (typeof input.shelfPosition === 'number' && input.shelfPosition > 0) patch.shelfPosition = input.shelfPosition;
    if (typeof input.name === 'string' && input.name.trim()) patch.name = input.name.trim();
    if (typeof input.lotNumber === 'string') patch.lotNumber = input.lotNumber.trim();
    t.update(basketRef, patch);

    const logRef = doc(collection(db, 'inventoryLogs'));
    t.set(logRef, {
      productId: prev.productId,
      locationId,
      basketId: input.basketId,
      userId: input.userId,
      action: 'COUNT',
      amount: delta,
      previousCount: previousTotal,
      newCount: newTotal,
      reason: `Count: ${formatTraysVials(trayCount, looseVials)}${input.note ? ` · ${input.note}` : ''}`,
      timestamp: now,
    });

    if (sessionRef && sessionExists) {
      t.update(sessionRef, {
        // Gross vials counted this session (a recount of the same basket only applies its delta).
        'progress.totalVials': increment(alreadyCountedThisSession ? delta : newTotal),
        'progress.netDelta': increment(delta),
        'progress.basketsCounted': increment(alreadyCountedThisSession ? 0 : 1),
        countedBaskets: arrayUnion(input.basketId),
        activeBasketId: input.basketId,
        locationId,
      });
    }

    return { previousTotal, newTotal, delta, productId: prev.productId };
  });

  if (result.delta !== 0 && result.productId) {
    await adjustProductStock(result.productId, result.delta).catch((err) =>
      console.warn('Product stock adjustment failed (count itself was saved)', err),
    );
  }

  return result;
}

/** Best-effort `products/{id}.currentStock += delta`, clamped at zero to satisfy rules. */
export async function adjustProductStock(productId: string, delta: number): Promise<void> {
  const ref = doc(db, 'products', productId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const current = Number(snap.data().currentStock) || 0;
  await updateDoc(ref, {
    currentStock: Math.max(0, current + delta),
    updatedAt: new Date().toISOString(),
  });
}

export interface CreateBasketInput {
  productId: string;
  productName: string;
  locationId: string;
  shelfId?: string | null;
  shelfPosition?: number | null;
  lotNumber?: string;
  trayCount: number;
  looseVials: number;
  vialsPerTray: number;
  userId: string;
  sessionId?: string | null;
}

/**
 * Create a basket (one physical bin, or one lot inside a shared bin) with an
 * initial count. The QR payload is `BSKT:<docId>` so the label can be printed
 * immediately. The initial count is logged exactly like a regular count.
 */
export async function createBasket(input: CreateBasketInput): Promise<BasketRecord> {
  const ref = doc(collection(db, 'baskets'));
  const now = new Date().toISOString();
  const trayCount = Math.max(0, Math.floor(input.trayCount));
  const looseVials = Math.max(0, Math.floor(input.looseVials));
  const vialsPerTray = input.vialsPerTray > 0 ? Math.floor(input.vialsPerTray) : DEFAULT_VIALS_PER_TRAY;
  const lotNumber = (input.lotNumber ?? '').trim();

  const data: Record<string, unknown> = {
    productId: input.productId,
    locationId: input.locationId,
    name: input.productName || 'Basket',
    trayCount,
    vialsPerTray,
    looseVials,
    qrCode: basketCode(ref.id),
    createdAt: now,
    updatedAt: now,
    lastCountedAt: now,
    lastCountedBy: input.userId,
  };
  if (input.shelfId) data.shelfId = input.shelfId;
  if (typeof input.shelfPosition === 'number' && input.shelfPosition > 0) data.shelfPosition = input.shelfPosition;
  if (lotNumber) data.lotNumber = lotNumber;

  const total = trayCount * vialsPerTray + looseVials;
  const sessionRef = input.sessionId ? doc(db, 'countingSessions', input.sessionId) : null;

  await runTransaction(db, async (t) => {
    const sessionExists = sessionRef ? (await t.get(sessionRef)).exists() : false;
    t.set(ref, data);
    const logRef = doc(collection(db, 'inventoryLogs'));
    t.set(logRef, {
      productId: input.productId,
      locationId: input.locationId,
      basketId: ref.id,
      userId: input.userId,
      action: 'COUNT',
      amount: total,
      previousCount: 0,
      newCount: total,
      reason: `New basket: ${formatTraysVials(trayCount, looseVials)}${lotNumber ? ` · Lot ${lotNumber}` : ''}`,
      timestamp: now,
    });
    if (sessionRef && sessionExists) {
      t.update(sessionRef, {
        'progress.totalVials': increment(total),
        'progress.netDelta': increment(total),
        'progress.basketsCounted': increment(1),
        countedBaskets: arrayUnion(ref.id),
        activeBasketId: ref.id,
        locationId: input.locationId,
      });
    }
  });

  if (total > 0) {
    await adjustProductStock(input.productId, total).catch((err) =>
      console.warn('Product stock adjustment failed (basket itself was saved)', err),
    );
  }

  return toBasketRecord(ref.id, data);
}

export async function moveBasket(
  basketId: string,
  target: { locationId: string; shelfId: string | null; shelfPosition?: number | null },
): Promise<void> {
  const patch: Record<string, unknown> = {
    locationId: target.locationId,
    updatedAt: new Date().toISOString(),
  };
  if (target.shelfId) patch.shelfId = target.shelfId;
  if (typeof target.shelfPosition === 'number' && target.shelfPosition > 0) patch.shelfPosition = target.shelfPosition;
  await updateDoc(doc(db, 'baskets', basketId), patch);
}
