import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export interface FridgeConfig {
  id: string;
  name: string;
  shelfCount: number;
  basketSlotsPerShelf: number;
}

export type CapColorMap = Record<string, string>;

export interface ApiBridgeConfig {
  webhookUrl: string;
  apiKey: string;
  enabled: boolean;
}

export interface AppSettings {
  fridges: FridgeConfig[];
  hudEnabled: boolean;
  capColorMap: CapColorMap;
  apiBridgeConfig: ApiBridgeConfig;
}

const APP_SETTINGS_COLLECTION = 'config';
const APP_SETTINGS_DOC = 'appSettings';

export const DEFAULT_FRIDGE: Omit<FridgeConfig, 'id'> = {
  name: 'New Fridge',
  shelfCount: 5,
  basketSlotsPerShelf: 4,
};

export function appSettingsDocRef() {
  return doc(db, APP_SETTINGS_COLLECTION, APP_SETTINGS_DOC);
}

export function newFridgeId(): string {
  return `fridge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function makeFridgeConfig(overrides: Partial<FridgeConfig> = {}): FridgeConfig {
  return {
    id: overrides.id ?? newFridgeId(),
    name: overrides.name ?? DEFAULT_FRIDGE.name,
    shelfCount: overrides.shelfCount ?? DEFAULT_FRIDGE.shelfCount,
    basketSlotsPerShelf: overrides.basketSlotsPerShelf ?? DEFAULT_FRIDGE.basketSlotsPerShelf,
  };
}

export async function loadAppSettings(): Promise<AppSettings> {
  const snap = await getDoc(appSettingsDocRef());
  if (!snap.exists()) {
    return { fridges: [], hudEnabled: false, capColorMap: {}, apiBridgeConfig: { webhookUrl: '', apiKey: '', enabled: false } };
  }
  const data = snap.data() as Partial<AppSettings> | undefined;
  return {
    fridges: Array.isArray(data?.fridges) ? data!.fridges : [],
    hudEnabled: Boolean(data?.hudEnabled),
    capColorMap:
      data?.capColorMap && typeof data.capColorMap === 'object'
        ? (data.capColorMap as CapColorMap)
        : {},
    apiBridgeConfig: data?.apiBridgeConfig || { webhookUrl: '', apiKey: '', enabled: false },
  };
}

export async function saveAppSettings(
  settings: Partial<AppSettings>,
  updatedBy?: string,
): Promise<void> {
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    ...(updatedBy ? { updatedBy } : {}),
  };
  if (settings.fridges !== undefined) payload.fridges = settings.fridges;
  if (settings.hudEnabled !== undefined) payload.hudEnabled = settings.hudEnabled;
  if (settings.capColorMap !== undefined) payload.capColorMap = settings.capColorMap;
  if (settings.apiBridgeConfig !== undefined) payload.apiBridgeConfig = settings.apiBridgeConfig;

  await setDoc(appSettingsDocRef(), payload, { merge: true });
}
