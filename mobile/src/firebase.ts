import { getApp, getApps, initializeApp } from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import { getAuth, initializeAuth, type Auth, type Persistence } from 'firebase/auth';
import { getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
// Same project + database as the web app and the desktop print server.
import firebaseConfig from '../../firebase-applet-config.json';

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// `getReactNativePersistence` only exists in the React Native build of firebase/auth,
// which Metro resolves at runtime; the package's TypeScript entry is the browser build.
const getReactNativePersistence = (
  firebaseAuth as unknown as { getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence }
).getReactNativePersistence;

function makeAuth(): Auth {
  try {
    // Persist the session on the device so the phone stays signed in between launches.
    return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch {
    // Fast refresh re-runs this module; auth is already initialized.
    return getAuth(app);
  }
}

function makeDb(): Firestore {
  try {
    // Long polling is the reliable transport for Firestore inside React Native.
    return initializeFirestore(app, { experimentalForceLongPolling: true }, firebaseConfig.firestoreDatabaseId);
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const auth = makeAuth();
export const db = makeDb();

/** Emails that are admins even before a /users doc exists (mirrors firestore.rules). */
export const BOOTSTRAP_ADMINS = ['duval.villegas@mdexam.com', 'duval.villegas@gmail.com'];
