import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, collection, doc, getDocs, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { makeShelfId, parseCode, parseShelfId, type ParsedCode, type ScanKind } from '../lib/scanCodes';
import {
  getLocation,
  resolveBasketByCode,
  resolveLocationByCode,
  type BasketRecord,
  type FridgeLocation,
} from '../lib/inventory';
import { playErrorBeep, playScanBeep, vibrate } from '../lib/feedback';

export type { ParsedCode, ScanKind };

export interface SessionProgress {
  /** Gross vials counted in this session. */
  vialsCounted: number;
  /** Net change vs. the previous counts of the baskets touched. */
  netDelta: number;
  basketsCount: number;
}

export type ScanEventKind = 'fridge' | 'shelf' | 'basket' | 'info' | 'error';

export interface ScanEvent {
  id: number;
  kind: ScanEventKind;
  message: string;
  at: number;
}

interface CountingSessionContextValue {
  fridge: FridgeLocation | null;
  shelfNumber: number | null;
  /** `${fridge.id}/${shelfNumber}` when both are set. */
  shelfId: string | null;
  activeBasketId: string | null;
  lastScan: ParsedCode | null;
  lastEvent: ScanEvent | null;
  resolving: boolean;
  sessionId: string | null;
  sessionProgress: SessionProgress;
  /** Basket ids counted in this session (live). */
  countedBasketIds: string[];
  selectFridge: (fridge: FridgeLocation | null) => void;
  selectShelf: (shelfNumber: number | null) => void;
  /** Make a basket active (soft-lock checked). Pass null to go back to the shelf. */
  selectBasket: (basket: BasketRecord | null, opts?: { adoptLocation?: boolean }) => Promise<boolean>;
  handleScan: (payload: string) => Promise<void>;
  notify: (kind: ScanEventKind, message: string) => void;
  /** Step one level up: basket → shelf → fridge → fridge list. */
  goBack: () => void;
  completeSession: () => Promise<void>;
}

const CountingSessionContext = createContext<CountingSessionContextValue | null>(null);

export function useCountingSession() {
  const ctx = useContext(CountingSessionContext);
  if (!ctx) throw new Error('useCountingSession must be used within CountingSessionProvider');
  return ctx;
}

const DEDUPE_MS = 3000;

export function CountingSessionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [fridge, setFridge] = useState<FridgeLocation | null>(null);
  const [shelfNumber, setShelfNumber] = useState<number | null>(null);
  const [activeBasketId, setActiveBasketId] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<ParsedCode | null>(null);
  const [lastEvent, setLastEvent] = useState<ScanEvent | null>(null);
  const [resolving, setResolving] = useState(false);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionProgress, setSessionProgress] = useState<SessionProgress>({
    vialsCounted: 0,
    netDelta: 0,
    basketsCount: 0,
  });
  const [countedBasketIds, setCountedBasketIds] = useState<string[]>([]);

  const lastScanRef = useRef<{ raw: string; at: number } | null>(null);
  const eventSeq = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;
  const stateRef = useRef({ fridge, shelfNumber, activeBasketId });
  stateRef.current = { fridge, shelfNumber, activeBasketId };

  const notify = useCallback((kind: ScanEventKind, message: string) => {
    eventSeq.current += 1;
    setLastEvent({ id: eventSeq.current, kind, message, at: Date.now() });
    if (kind === 'error') {
      playErrorBeep();
      vibrate([40, 40, 40]);
    } else {
      playScanBeep();
      vibrate(30);
    }
  }, []);

  // ---- Session doc lifecycle -------------------------------------------------
  useEffect(() => {
    let mounted = true;
    let createdId: string | null = null;
    const initSession = async () => {
      try {
        const docRef = await addDoc(collection(db, 'countingSessions'), {
          userName: user?.displayName || user?.email || 'Anonymous Worker',
          status: 'active',
          progress: { basketsCounted: 0, totalVials: 0, netDelta: 0 },
          countedBaskets: [],
          startedAt: new Date().toISOString(),
          locationId: 'default',
          activeBasketId: null,
          userId: user?.uid || 'unknown',
        });
        createdId = docRef.id;
        if (mounted) setSessionId(docRef.id);
      } catch (err) {
        console.error('Failed to create counting session', err);
      }
    };
    initSession();

    return () => {
      mounted = false;
      if (createdId) {
        updateDoc(doc(db, 'countingSessions', createdId), { status: 'paused' }).catch(() => {});
      }
    };
  }, [user]);

  useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(
      doc(db, 'countingSessions', sessionId),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const counted: string[] = Array.isArray(data?.countedBaskets)
          ? data.countedBaskets.filter((x: unknown): x is string => typeof x === 'string')
          : [];
        setCountedBasketIds(counted);
        setSessionProgress({
          vialsCounted: Number(data?.progress?.totalVials) || 0,
          netDelta: Number(data?.progress?.netDelta) || 0,
          basketsCount: counted.length,
        });
      },
      (err) => console.error('Session progress subscription failed', err),
    );
    return () => unsub();
  }, [sessionId]);

  const patchSession = useCallback((patch: Record<string, unknown>) => {
    const id = sessionIdRef.current;
    if (!id) return;
    updateDoc(doc(db, 'countingSessions', id), patch).catch(console.error);
  }, []);

  const completeSession = useCallback(async () => {
    if (sessionId) {
      await updateDoc(doc(db, 'countingSessions', sessionId), {
        status: 'completed',
        completedAt: new Date().toISOString(),
        activeBasketId: null,
      });
    }
  }, [sessionId]);

  // ---- Navigation -------------------------------------------------------------
  const selectFridge = useCallback(
    (next: FridgeLocation | null) => {
      setFridge(next);
      setShelfNumber(null);
      setActiveBasketId(null);
      patchSession({ activeBasketId: null, locationId: next?.id ?? 'default' });
    },
    [patchSession],
  );

  const selectShelf = useCallback(
    (next: number | null) => {
      setShelfNumber(next);
      setActiveBasketId(null);
      patchSession({ activeBasketId: null });
    },
    [patchSession],
  );

  const selectBasket = useCallback(
    async (basket: BasketRecord | null, opts?: { adoptLocation?: boolean }): Promise<boolean> => {
      if (!basket) {
        setActiveBasketId(null);
        patchSession({ activeBasketId: null });
        return true;
      }

      // Soft lock: warn if another live session is on this basket right now.
      try {
        const q = query(
          collection(db, 'countingSessions'),
          where('status', 'in', ['active', 'paused']),
          where('activeBasketId', '==', basket.id),
        );
        const snap = await getDocs(q);
        const other = snap.docs.find((d) => d.id !== sessionIdRef.current);
        if (other) {
          const who = other.data().userName || 'another user';
          if (!window.confirm(`${basket.name || 'This basket'} is being counted by ${who} right now. Open it anyway?`)) {
            return false;
          }
        }
      } catch (e) {
        console.error('Soft lock check failed', e);
      }

      // Scanning a basket cold (no fridge selected yet) adopts the basket's own location so the
      // breadcrumb and the shelf list make sense. When a fridge IS selected the user is physically
      // there, so we keep their context and let QuickCount offer to move the basket instead.
      if (opts?.adoptLocation !== false) {
        const current = stateRef.current;
        const shelfRef = parseShelfId(basket.shelfId);
        if (!current.fridge) {
          const targetLocationId = shelfRef?.locationId ?? basket.locationId;
          const loc = targetLocationId ? await getLocation(targetLocationId).catch(() => null) : null;
          if (loc) {
            setFridge(loc);
            setShelfNumber(shelfRef && shelfRef.locationId === loc.id ? shelfRef.shelfNumber : null);
            patchSession({ locationId: loc.id });
          }
        } else if (current.shelfNumber === null && shelfRef && shelfRef.locationId === current.fridge.id) {
          setShelfNumber(shelfRef.shelfNumber);
        }
      }

      setActiveBasketId(basket.id);
      patchSession({ activeBasketId: basket.id });
      return true;
    },
    [patchSession],
  );

  const goBack = useCallback(() => {
    const current = stateRef.current;
    if (current.activeBasketId) {
      setActiveBasketId(null);
      patchSession({ activeBasketId: null });
    } else if (current.shelfNumber !== null) {
      setShelfNumber(null);
    } else if (current.fridge) {
      setFridge(null);
      patchSession({ locationId: 'default' });
    }
  }, [patchSession]);

  // ---- Scanning ---------------------------------------------------------------
  const handleScan = useCallback(
    async (payload: string) => {
      const raw = (payload ?? '').trim();
      if (!raw) return;
      const now = Date.now();
      const prev = lastScanRef.current;
      if (prev && prev.raw === raw && now - prev.at < DEDUPE_MS) {
        prev.at = now; // keep suppressing while the same code stays in view
        return;
      }
      lastScanRef.current = { raw, at: now };

      const parsed = parseCode(raw);
      setLastScan(parsed);
      setResolving(true);
      try {
        switch (parsed.kind) {
          case 'FRIDGE': {
            const loc = await resolveLocationByCode(parsed);
            if (!loc) {
              notify('error', `Unknown fridge code: ${raw}`);
              return;
            }
            selectFridge(loc);
            notify('fridge', loc.name);
            return;
          }
          case 'SHELF': {
            const ref = parseShelfId(parsed.value);
            if (!ref) {
              notify('error', `Unrecognized shelf code: ${raw}`);
              return;
            }
            let loc = stateRef.current.fridge;
            if (!loc || loc.id !== ref.locationId) {
              loc = await getLocation(ref.locationId);
              if (!loc) {
                notify('error', 'Shelf label points at a fridge that no longer exists');
                return;
              }
              setFridge(loc);
              patchSession({ locationId: loc.id });
            }
            setShelfNumber(ref.shelfNumber);
            setActiveBasketId(null);
            patchSession({ activeBasketId: null });
            notify('shelf', `${loc.name} · Shelf ${ref.shelfNumber}`);
            return;
          }
          case 'BASKET': {
            const basket = await resolveBasketByCode(parsed);
            if (!basket) {
              notify('error', `Unknown basket code: ${raw}`);
              return;
            }
            const ok = await selectBasket(basket);
            if (ok) notify('basket', basket.name || 'Basket');
            return;
          }
          case 'TRAY':
            notify('info', 'Tray labels are not needed — count trays + loose vials on the basket');
            return;
          case 'PRODUCT':
            notify('info', 'Product label scanned. Scan a basket, shelf, or fridge label to count.');
            return;
          default:
            notify('error', `Unrecognized code: ${raw}`);
        }
      } catch (err) {
        console.error('Scan handling failed', err);
        notify('error', err instanceof Error ? err.message : 'Scan failed');
      } finally {
        setResolving(false);
      }
    },
    [notify, patchSession, selectBasket, selectFridge],
  );

  const shelfId = useMemo(
    () => (fridge && shelfNumber !== null ? makeShelfId(fridge.id, shelfNumber) : null),
    [fridge, shelfNumber],
  );

  const value = useMemo<CountingSessionContextValue>(
    () => ({
      fridge,
      shelfNumber,
      shelfId,
      activeBasketId,
      lastScan,
      lastEvent,
      resolving,
      sessionId,
      sessionProgress,
      countedBasketIds,
      selectFridge,
      selectShelf,
      selectBasket,
      handleScan,
      notify,
      goBack,
      completeSession,
    }),
    [
      fridge,
      shelfNumber,
      shelfId,
      activeBasketId,
      lastScan,
      lastEvent,
      resolving,
      sessionId,
      sessionProgress,
      countedBasketIds,
      selectFridge,
      selectShelf,
      selectBasket,
      handleScan,
      notify,
      goBack,
      completeSession,
    ],
  );

  return <CountingSessionContext.Provider value={value}>{children}</CountingSessionContext.Provider>;
}
