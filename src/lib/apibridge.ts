import { doc, getDoc, updateDoc, addDoc, collection } from 'firebase/firestore';
import { db } from '../firebase';

import { loadAppSettings } from './config';

export async function pushInventoryUpdate(productId: string, newStock: number) {
  try {
    const appSettings = await loadAppSettings();
    const config = appSettings.apiBridgeConfig;
    if (!config || !config.enabled || !config.endpointUrl) return;

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
