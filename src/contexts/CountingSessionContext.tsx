import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, collection, doc, getDocs, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { parseTrayId } from '../lib/inventory';

export type ScanPrefix = 'SHELF' | 'BSKT' | 'TRAY' | 'UNKNOWN';

export interface ParsedScan {
  prefix: ScanPrefix;
  id: string;
  raw: string;
}

export interface SessionProgress {
  /** Net change vs. the previously stored tray counts. */
  totalVialsDelta: number;
  /** Gross vials counted in this session. */
  vialsCounted: number;
  traysCounted: number;
  basketsCount: number;
}

interface CountingSessionContextValue {
  activeLocationId: string | null;
  activeShelfId: string | null;
  activeBasketId: string | null;
  /** Slot requested by a TRAY: scan; consumed (cleared) by the bottom panel once it opens the tray. */
  pendingTraySlot: number | null;
  lastScan: ParsedScan | null;
  sessionId: string | null;
  sessionProgress: SessionProgress;
  setActiveLocationId: (id: string | null) => void;
  handleScan: (qrData: string) => void;
  clearPendingTraySlot: () => void;
  completeSession: () => Promise<void>;
}

const CountingSessionContext = createContext<CountingSessionContextValue | null>(null);

export function useCountingSession() {
  const ctx = useContext(CountingSessionContext);
  if (!ctx) throw new Error('useCountingSession must be used within CountingSessionProvider');
  return ctx;
}

export function parseScan(qrData: string): ParsedScan {
  const trimmed = qrData.trim();
  const colon = trimmed.indexOf(':');
  if (colon === -1) return { prefix: 'UNKNOWN', id: trimmed, raw: trimmed };
  const head = trimmed.slice(0, colon).toUpperCase();
  const id = trimmed.slice(colon + 1).trim();
  if (head === 'SHELF' || head === 'BSKT' || head === 'TRAY') {
    return { prefix: head, id, raw: trimmed };
  }
  return { prefix: 'UNKNOWN', id, raw: trimmed };
}

const DEDUPE_MS = 1500;
const EMPTY_PROGRESS: SessionProgress = { totalVialsDelta: 0, vialsCounted: 0, traysCounted: 0, basketsCount: 0 };

export function CountingSessionProvider({ children }: { children: React.ReactNode }) {
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const [activeShelfId, setActiveShelfId] = useState<string | null>(null);
  const [activeBasketId, setActiveBasketId] = useState<string | null>(null);
  const [pendingTraySlot, setPendingTraySlot] = useState<number | null>(null);
  const [lastScan, setLastScan] = useState<ParsedScan | null>(null);

  const { user } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionProgress, setSessionProgress] = useState<SessionProgress>(EMPTY_PROGRESS);

  const lastScanRef = useRef<{ raw: string; at: number } | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const creatingRef = useRef<Promise<string | null> | null>(null);
  const statusRef = useRef<'active' | 'completed'>('active');
  const basketsCountRef = useRef(0);
  const userRef = useRef(user);
  userRef.current = user;

  /**
   * Sessions are created lazily on the first recognized scan, so opening /count and
   * backing out doesn't leave ghost "live sessions" on the dashboard (React StrictMode
   * double-mounting used to create two per visit).
   */
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (creatingRef.current) return creatingRef.current;
    const u = userRef.current;
    creatingRef.current = (async () => {
      try {
        const docRef = await addDoc(collection(db, 'countingSessions'), {
          userName: u?.displayName || u?.email || 'Anonymous Worker',
          userId: u?.uid || 'unknown',
          status: 'active',
          progress: { basketsCounted: 0, totalVials: 0, vialsCounted: 0, traysCounted: 0 },
          countedBaskets: [],
          startedAt: new Date().toISOString(),
          locationId: 'default',
          activeBasketId: null,
        });
        sessionIdRef.current = docRef.id;
        setSessionId(docRef.id);
        return docRef.id;
      } catch (err) {
        console.error('Failed to create counting session', err);
        return null;
      } finally {
        creatingRef.current = null;
      }
    })();
    return creatingRef.current;
  }, []);

  // On leaving /count without completing: pause (if work was done) or abandon (if nothing was counted).
  useEffect(() => {
    return () => {
      const id = sessionIdRef.current;
      if (!id || statusRef.current === 'completed') return;
      const status = basketsCountRef.current > 0 ? 'paused' : 'abandoned';
      updateDoc(doc(db, 'countingSessions', id), { status, activeBasketId: null }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(
      doc(db, 'countingSessions', sessionId),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const basketsCount = Array.isArray(data?.countedBaskets) ? data.countedBaskets.length : 0;
        basketsCountRef.current = basketsCount;
        setSessionProgress({
          totalVialsDelta: Number(data?.progress?.totalVials) || 0,
          vialsCounted: Number(data?.progress?.vialsCounted) || 0,
          traysCounted: Number(data?.progress?.traysCounted) || 0,
          basketsCount,
        });
      },
      (err) => console.error('Session progress subscription failed', err),
    );
    return () => unsub();
  }, [sessionId]);

  const completeSession = useCallback(async () => {
    const id = sessionIdRef.current;
    statusRef.current = 'completed';
    if (id) {
      await updateDoc(doc(db, 'countingSessions', id), {
        status: 'completed',
        activeBasketId: null,
        completedAt: new Date().toISOString(),
      });
    }
  }, []);

  const activateBasket = useCallback(
    async (basketId: string, slot: number | null) => {
      const sid = await ensureSession();
      // Soft lock: warn when another live session is on the same bin.
      try {
        const q = query(
          collection(db, 'countingSessions'),
          where('status', 'in', ['active', 'paused']),
          where('activeBasketId', '==', basketId),
        );
        const activeDocs = await getDocs(q);
        const otherActive = activeDocs.docs.find((d) => d.id !== sid);
        if (otherActive) {
          window.alert(`Warning: this bin is already being counted by ${otherActive.data().userName}.`);
          return;
        }
      } catch (e) {
        console.error('Soft lock check failed', e);
      }
      setActiveBasketId(basketId);
      setPendingTraySlot(slot);
      if (sid) {
        updateDoc(doc(db, 'countingSessions', sid), { activeBasketId: basketId, status: 'active' }).catch(console.error);
      }
    },
    [ensureSession],
  );

  const handleScan = useCallback(
    async (qrData: string) => {
      const now = Date.now();
      const prev = lastScanRef.current;
      if (prev && prev.raw === qrData && now - prev.at < DEDUPE_MS) return;
      lastScanRef.current = { raw: qrData, at: now };

      const parsed = parseScan(qrData);
      setLastScan(parsed);

      switch (parsed.prefix) {
        case 'SHELF': {
          setActiveShelfId(parsed.id);
          setActiveBasketId(null);
          setPendingTraySlot(null);
          const sid = await ensureSession();
          if (sid) updateDoc(doc(db, 'countingSessions', sid), { activeBasketId: null }).catch(console.error);
          break;
        }
        case 'BSKT':
          await activateBasket(parsed.id, null);
          break;
        case 'TRAY': {
          const tray = parseTrayId(parsed.id);
          if (!tray) {
            setLastScan({ prefix: 'UNKNOWN', id: parsed.id, raw: parsed.raw });
            break;
          }
          await activateBasket(tray.basketId, tray.slot);
          break;
        }
        default:
          break;
      }
    },
    [activateBasket, ensureSession],
  );

  const clearPendingTraySlot = useCallback(() => setPendingTraySlot(null), []);

  const value = useMemo<CountingSessionContextValue>(
    () => ({
      activeLocationId,
      activeShelfId,
      activeBasketId,
      pendingTraySlot,
      lastScan,
      sessionId,
      sessionProgress,
      setActiveLocationId,
      handleScan,
      clearPendingTraySlot,
      completeSession,
    }),
    [
      activeLocationId,
      activeShelfId,
      activeBasketId,
      pendingTraySlot,
      lastScan,
      sessionId,
      sessionProgress,
      handleScan,
      clearPendingTraySlot,
      completeSession,
    ],
  );

  return <CountingSessionContext.Provider value={value}>{children}</CountingSessionContext.Provider>;
}
