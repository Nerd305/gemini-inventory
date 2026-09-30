import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { parseLegacyTrayId } from '../lib/inventory';

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

/** Tray requested by a TRAY: scan; consumed (cleared) by the bottom panel once it opens the tray. */
export interface PendingTray {
  trayId: string | null;
  /** Legacy v1.0.9 labels encoded a slot instead of a tray ID. */
  slot: number | null;
}

interface CountingSessionContextValue {
  activeLocationId: string | null;
  activeShelfId: string | null;
  activeBasketId: string | null;
  pendingTray: PendingTray | null;
  lastScan: ParsedScan | null;
  sessionId: string | null;
  sessionProgress: SessionProgress;
  setActiveLocationId: (id: string | null) => void;
  handleScan: (qrData: string) => void;
  clearPendingTray: () => void;
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
  const [pendingTray, setPendingTray] = useState<PendingTray | null>(null);
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
    async (basketId: string, tray: PendingTray | null) => {
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
      setPendingTray(tray);
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
          setPendingTray(null);
          const sid = await ensureSession();
          if (sid) updateDoc(doc(db, 'countingSessions', sid), { activeBasketId: null }).catch(console.error);
          break;
        }
        case 'BSKT':
          await activateBasket(parsed.id, null);
          break;
        case 'TRAY': {
          // Current labels encode the tray doc ID; resolve it to its bin.
          try {
            const snap = await getDoc(doc(db, 'trays', parsed.id));
            if (snap.exists()) {
              const data = snap.data();
              if (data.status === 'removed') {
                window.alert('This tray was marked as removed from its bin. Re-add it under Bins if it is back in service.');
                break;
              }
              if (typeof data.basketId === 'string') {
                await activateBasket(data.basketId, { trayId: parsed.id, slot: null });
                break;
              }
            }
          } catch (e) {
            console.error('Tray lookup failed', e);
          }
          // Legacy v1.0.9 labels: TRAY:{basketId}-{slot}
          const legacy = parseLegacyTrayId(parsed.id);
          if (legacy) {
            await activateBasket(legacy.basketId, { trayId: null, slot: legacy.slot });
            break;
          }
          setLastScan({ prefix: 'UNKNOWN', id: parsed.id, raw: parsed.raw });
          break;
        }
        default:
          break;
      }
    },
    [activateBasket, ensureSession],
  );

  const clearPendingTray = useCallback(() => setPendingTray(null), []);

  const value = useMemo<CountingSessionContextValue>(
    () => ({
      activeLocationId,
      activeShelfId,
      activeBasketId,
      pendingTray,
      lastScan,
      sessionId,
      sessionProgress,
      setActiveLocationId,
      handleScan,
      clearPendingTray,
      completeSession,
    }),
    [
      activeLocationId,
      activeShelfId,
      activeBasketId,
      pendingTray,
      lastScan,
      sessionId,
      sessionProgress,
      handleScan,
      clearPendingTray,
      completeSession,
    ],
  );

  return <CountingSessionContext.Provider value={value}>{children}</CountingSessionContext.Provider>;
}
