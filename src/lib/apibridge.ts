import { doc, getDoc, updateDoc, addDoc, collection } from 'firebase/firestore';
import { db } from './firebase';

export type ApiBridgeConfig = {
  enabled: boolean;
  endpointUrl: string;
  apiKey: string;
  syncDirection: 'push' | 'pull' | 'bidirectional';
  pollIntervalMs?: number;
};

export async function getApiBridgeConfig(): Promise<ApiBridgeConfig> {
  const configDoc = await getDoc(doc(db, 'config', 'appSettings'));
  if (configDoc.exists() && configDoc.data().apiBridgeConfig) {
    return configDoc.data().apiBridgeConfig as ApiBridgeConfig;
  }
  return {
    enabled: false,
    endpointUrl: '',
    apiKey: '',
    syncDirection: 'push'
  };
}

export async function pushInventoryUpdate(productId: string, newStock: number) {
  try {
    const config = await getApiBridgeConfig();
    if (!config.enabled || !config.endpointUrl) return;

    await fetch(config.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({ productId, newStock, source: 'vialtrack', timestamp: new Date().toISOString() })
    });
    console.log('Successfully pushed inventory update to ordering system.');
  } catch (error) {
    console.error('Failed to push inventory update via API bridge:', error);
  }
}
