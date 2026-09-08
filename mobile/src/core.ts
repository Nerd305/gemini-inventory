/**
 * Shared count core bound to this app's Firestore handle. Components import
 * from here so the web app (src/lib/inventory.ts) and this app run the exact
 * same write path (src/shared/inventoryCore.ts).
 */
import { addDoc, collection } from 'firebase/firestore';
import { db } from './firebase';
import * as core from '../../src/shared/inventoryCore';
import { enqueuePrintJob as enqueue, type PrintJobInput } from '../../src/shared/printJobs';
import type { ParsedCode } from '../../src/shared/scanCodes';

export * from '../../src/shared/scanCodes';
export { DEFAULT_LABEL_FORMAT, LABEL_FORMAT_SPECS, labelSpec } from '../../src/shared/labelFormats';
export type { LabelFormat } from '../../src/shared/types';
export { describePrintError } from '../../src/shared/printJobs';
export type { PrintJobInput };

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
} from '../../src/shared/inventoryCore';
export type {
  FridgeLocation,
  BasketRecord,
  ProductSummary,
  CommitCountInput,
  CommitCountResult,
  CreateBasketInput,
} from '../../src/shared/inventoryCore';

export const getLocation = (locationId: string) => core.getLocation(db, locationId);
export const resolveLocationByCode = (parsed: ParsedCode) => core.resolveLocationByCode(db, parsed);
export const getBasket = (basketId: string) => core.getBasket(db, basketId);
export const resolveBasketByCode = (parsed: ParsedCode) => core.resolveBasketByCode(db, parsed);
export const subscribeLocations = (
  cb: Parameters<typeof core.subscribeLocations>[1],
  onError?: Parameters<typeof core.subscribeLocations>[2],
) => core.subscribeLocations(db, cb, onError);
export const subscribeAllBaskets = (
  cb: Parameters<typeof core.subscribeAllBaskets>[1],
  onError?: Parameters<typeof core.subscribeAllBaskets>[2],
) => core.subscribeAllBaskets(db, cb, onError);
export const subscribeBasketsForLocation = (
  locationId: string,
  cb: Parameters<typeof core.subscribeBasketsForLocation>[2],
  onError?: Parameters<typeof core.subscribeBasketsForLocation>[3],
) => core.subscribeBasketsForLocation(db, locationId, cb, onError);
export const subscribeBasket = (
  basketId: string,
  cb: Parameters<typeof core.subscribeBasket>[2],
  onError?: Parameters<typeof core.subscribeBasket>[3],
) => core.subscribeBasket(db, basketId, cb, onError);
export const subscribeProducts = (
  cb: Parameters<typeof core.subscribeProducts>[1],
  onError?: Parameters<typeof core.subscribeProducts>[2],
) => core.subscribeProducts(db, cb, onError);
export const commitBasketCount = (input: core.CommitCountInput) => core.commitBasketCount(db, input);
export const createBasket = (input: core.CreateBasketInput) => core.createBasket(db, input);
export const enqueuePrintJob = (input: PrintJobInput) => enqueue(db, input);

export interface LearningSample {
  imageBase64?: string;
  aiPrediction?: number;
  userFinalCount: number;
  productId: string;
  trayId: string;
  basketId: string;
  userId: string;
  notes?: string;
}

/** Same shape the web app writes (src/lib/learning.ts). Never throws. */
export async function saveLearningRecord(sample: LearningSample): Promise<void> {
  try {
    await addDoc(collection(db, 'learningData'), {
      ...sample,
      delta: sample.userFinalCount - (sample.aiPrediction ?? 0),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Failed to save learning record', err);
  }
}

export async function createQuickProduct(name: string): Promise<string> {
  const ref = await addDoc(collection(db, 'products'), {
    name: name.trim(),
    category: 'Uncategorized',
    description: '',
    reorderPoint: 0,
    currentStock: 0,
    qrCode: `PRODUCT:${Date.now()}`,
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}
