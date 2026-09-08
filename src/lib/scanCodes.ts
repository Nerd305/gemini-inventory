/**
 * QR / barcode payloads understood by the counting flow.
 *
 *   LOC:<locationDocId>        fridge (also the legacy `LOC:<timestamp>` stored in locations.qrCode)
 *   FRIDGE:<locationDocId>     fridge (alias)
 *   SHELF:<locationDocId>/<n>  shelf n (1-based, top to bottom) inside that fridge
 *   BSKT:<basketDocId>         basket / lot
 *   CONT:<timestamp>           legacy basket code stored in baskets.qrCode
 *   TRAY:<anything>            reserved (trays are counted as "N full trays + loose vials", no per-tray label needed)
 *   PRODUCT:<productDocId>     product catalog label (not used while counting)
 */
export type ScanKind = 'FRIDGE' | 'SHELF' | 'BASKET' | 'TRAY' | 'PRODUCT' | 'UNKNOWN';

export interface ParsedCode {
  kind: ScanKind;
  /** Original payload, trimmed. */
  raw: string;
  /** Upper-cased prefix as written (LOC, FRIDGE, SHELF, BSKT, CONT, TRAY, PRODUCT). */
  prefix: string;
  /** Everything after the first colon. */
  value: string;
}

const KIND_BY_PREFIX: Record<string, ScanKind> = {
  LOC: 'FRIDGE',
  FRIDGE: 'FRIDGE',
  SHELF: 'SHELF',
  BSKT: 'BASKET',
  BASKET: 'BASKET',
  CONT: 'BASKET',
  TRAY: 'TRAY',
  PRODUCT: 'PRODUCT',
};

export function parseCode(input: string): ParsedCode {
  const raw = (input ?? '').trim();
  const colon = raw.indexOf(':');
  if (colon === -1) return { kind: 'UNKNOWN', raw, prefix: '', value: raw };
  const prefix = raw.slice(0, colon).trim().toUpperCase();
  const value = raw.slice(colon + 1).trim();
  const kind = KIND_BY_PREFIX[prefix] ?? 'UNKNOWN';
  return { kind, raw, prefix, value };
}

export const SHELF_ID_SEPARATOR = '/';

/** Stable id stored on baskets.shelfId, e.g. `abc123/3`. */
export function makeShelfId(locationId: string, shelfNumber: number): string {
  return `${locationId}${SHELF_ID_SEPARATOR}${shelfNumber}`;
}

export interface ShelfRef {
  locationId: string;
  shelfNumber: number;
}

/** Inverse of makeShelfId. Returns null for legacy free-text shelf ids. */
export function parseShelfId(shelfId: string | null | undefined): ShelfRef | null {
  if (!shelfId) return null;
  const idx = shelfId.lastIndexOf(SHELF_ID_SEPARATOR);
  if (idx <= 0) return null;
  const locationId = shelfId.slice(0, idx);
  const shelfNumber = Number(shelfId.slice(idx + 1));
  if (!Number.isInteger(shelfNumber) || shelfNumber < 1) return null;
  return { locationId, shelfNumber };
}

export function fridgeCode(locationId: string): string {
  return `LOC:${locationId}`;
}

export function shelfCode(locationId: string, shelfNumber: number): string {
  return `SHELF:${makeShelfId(locationId, shelfNumber)}`;
}

export function basketCode(basketId: string): string {
  return `BSKT:${basketId}`;
}

export function shelfLabel(shelfNumber: number): string {
  return `Shelf ${shelfNumber}`;
}
