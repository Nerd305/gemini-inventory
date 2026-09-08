import { db } from '../firebase';
import * as core from '../shared/inventoryCore';
import type { ParsedCode } from '../shared/scanCodes';

// Pure helpers, types and constants are shared verbatim.
export {
  DEFAULT_SHELF_COUNT,
  DEFAULT_VIALS_PER_TRAY,
  SLOT_POSITIONS,
  slotLabel,
  toFridgeLocation,
  toBasketRecord,
  toProductSummary,
  basketTotal,
  formatTraysVials,
} from '../shared/inventoryCore';
export type {
  FridgeLocation,
  BasketRecord,
  ProductSummary,
  CommitCountInput,
  CommitCountResult,
  CreateBasketInput,
} from '../shared/inventoryCore';

// Firestore-touching functions bound to the web app's `db`.
export const getLocation = (locationId: string) => core.getLocation(db, locationId);
export const resolveLocationByCode = (parsed: ParsedCode) => core.resolveLocationByCode(db, parsed);
export const getBasket = (basketId: string) => core.getBasket(db, basketId);
export const resolveBasketByCode = (parsed: ParsedCode) => core.resolveBasketByCode(db, parsed);
export const subscribeLocations: (
  cb: Parameters<typeof core.subscribeLocations>[1],
  onError?: Parameters<typeof core.subscribeLocations>[2],
) => ReturnType<typeof core.subscribeLocations> = (cb, onError) => core.subscribeLocations(db, cb, onError);
export const subscribeAllBaskets: (
  cb: Parameters<typeof core.subscribeAllBaskets>[1],
  onError?: Parameters<typeof core.subscribeAllBaskets>[2],
) => ReturnType<typeof core.subscribeAllBaskets> = (cb, onError) => core.subscribeAllBaskets(db, cb, onError);
export const subscribeBasketsForLocation: (
  locationId: string,
  cb: Parameters<typeof core.subscribeBasketsForLocation>[2],
  onError?: Parameters<typeof core.subscribeBasketsForLocation>[3],
) => ReturnType<typeof core.subscribeBasketsForLocation> = (locationId, cb, onError) =>
  core.subscribeBasketsForLocation(db, locationId, cb, onError);
export const subscribeBasket: (
  basketId: string,
  cb: Parameters<typeof core.subscribeBasket>[2],
  onError?: Parameters<typeof core.subscribeBasket>[3],
) => ReturnType<typeof core.subscribeBasket> = (basketId, cb, onError) => core.subscribeBasket(db, basketId, cb, onError);
export const subscribeProducts: (
  cb: Parameters<typeof core.subscribeProducts>[1],
  onError?: Parameters<typeof core.subscribeProducts>[2],
) => ReturnType<typeof core.subscribeProducts> = (cb, onError) => core.subscribeProducts(db, cb, onError);
export const commitBasketCount = (input: core.CommitCountInput) => core.commitBasketCount(db, input);
export const adjustProductStock = (productId: string, delta: number) => core.adjustProductStock(db, productId, delta);
export const createBasket = (input: core.CreateBasketInput) => core.createBasket(db, input);
export const moveBasket = (basketId: string, target: Parameters<typeof core.moveBasket>[2]) =>
  core.moveBasket(db, basketId, target);
