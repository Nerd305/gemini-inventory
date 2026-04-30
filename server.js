import express from 'express';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// Initialize Firebase Admin
// Note: In production, provide a serviceAccountKey.json or set FIREBASE_CONFIG environment variables.
// Check if running in a Google Cloud environment or if credentials are provided
try {
  initializeApp();
  console.log('Firebase Admin initialized successfully.');
} catch (error) {
  console.warn('Firebase Admin app initialization failed:', error.message);
  console.warn('Please set the GOOGLE_APPLICATION_CREDENTIALS environment variable to your service account key file.');
}

const db = getFirestore();

// Webhook endpoint to receive SALE events from the ordering system
app.post('/api/webhook/sale', async (req, res) => {
  try {
    const configDoc = await db.collection('config').doc('appSettings').get();
    const config = configDoc.exists ? configDoc.data().apiBridgeConfig : null;

    if (!config || !config.enabled) {
      return res.status(403).json({ error: 'API Bridge is not enabled' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${config.apiKey}`) {
      return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    }

    const { productId, quantityRemoved, orderId } = req.body;
    
    if (!productId || typeof quantityRemoved !== 'number') {
      return res.status(400).json({ error: 'Missing productId or quantityRemoved' });
    }

    const productRef = db.collection('products').doc(productId);
    
    // Decrement stock in a transaction to ensure we have the correct previous count for the log
    await db.runTransaction(async (t) => {
      const doc = await t.get(productRef);
      if (!doc.exists) {
        throw new Error('Product not found');
      }
      
      const currentStock = doc.data().currentStock || 0;
      const newStock = Math.max(0, currentStock - quantityRemoved);
      
      t.update(productRef, { currentStock: newStock });
      
      const logRef = db.collection('inventoryLogs').doc();
      t.set(logRef, {
        productId,
        action: 'SALE',
        amount: quantityRemoved,
        previousCount: currentStock,
        newCount: newStock,
        reason: orderId ? `Order ${orderId}` : 'Automated sale sync',
        userId: 'system',
        timestamp: new Date().toISOString()
      });
    });

    console.log(`Successfully processed sale webhook for product ${productId}. Decremented by ${quantityRemoved}.`);
    res.status(200).json({ ok: true, message: 'Stock updated successfully' });
  } catch (error) {
    console.error('Webhook Error:', error);
    if (error.message === 'Product not found') {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API Bridge Server running on port ${PORT}`);
  console.log(`Send POST requests to http://localhost:${PORT}/api/webhook/sale`);
});
