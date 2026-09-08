import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { addDoc, collection, doc, getDocs, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';
import {
  getLocation,
  makeShelfId,
  parseCode,
  parseShelfId,
  resolveBasketByCode,
  resolveLocationByCode,
  toBasketRecord,
  toFridgeLocation,
  toProductSummary,
  type BasketRecord,
  type FridgeLocation,
  type ParsedCode,
} from '../core';
import { matchByName, parseVoiceCommands, type VoiceCommand } from '../../../src/shared/voiceCommands';

export interface SessionProgress {
  vialsCounted: number;
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

/** Count-level voice commands are handed to the open basket screen. */
export interface CommandEvent {
  id: number;
  commands: VoiceCommand[];
  transcript: string;
}

interface CountingSessionValue {
  fridge: FridgeLocation | null;
  shelfNumber: number | null;
  shelfId: string | null;
  activeBasketId: string | null;
  lastScan: ParsedCode | null;
  lastEvent: ScanEvent | null;
  lastCommand: CommandEvent | null;
  resolving: boolean;
  sessionId: string | null;
  sessionProgress: SessionProgress;
  countedBasketIds: string[];
  /** True while another screen (AI photo) owns the camera. */
  cameraPaused: boolean;
  setCameraPaused: (paused: boolean) => void;
  selectFridge: (fridge: FridgeLocation | null) => void;
  selectShelf: (shelfNumber: number | null) => void;
  selectBasket: (basket: BasketRecord | null, opts?: { adoptLocation?: boolean }) => Promise<boolean>;
  handleScan: (payload: string) => Promise<void>;
  /** Apply a spoken or typed sentence ("fridge 2 shelf 3", "4 trays 22 vials save"). */
  applyVoiceText: (text: string) => Promise<void>;
  notify: (kind: ScanEventKind, message: string) => void;
  goBack: () => void;
  completeSession: () => Promise<void>;
}

const Ctx = createContext<CountingSessionValue | null>(null);

export function useCountingSession(): CountingSessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCountingSession must be used within CountingSessionProvider');
  return v;
}

const DEDUPE_MS = 3000;

function confirmAsync(title: string, message: string, okLabel = 'Open anyway'): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, onPress: () => resolve(true) },
    ]);
  });
}

export function CountingSessionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [fridge, setFridge] = useState<FridgeLocation | null>(null);
  const [shelfNumber, setShelfNumber] = useState<number | null>(null);
  const [activeBasketId, setActiveBasketId] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<ParsedCode | null>(null);
  const [lastEvent, setLastEvent] = useState<ScanEvent | null>(null);
  const [lastCommand, setLastCommand] = useState<CommandEvent | null>(null);
  const [resolving, setResolving] = useState(false);
  const [cameraPaused, setCameraPaused] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionProgress, setSessionProgress] = useState<SessionProgress>({ vialsCounted: 0, netDelta: 0, basketsCount: 0 });
  const [countedBasketIds, setCountedBasketIds] = useState<string[]>([]);

  const lastScanRef = useRef<{ raw: string; at: number } | null>(null);
  const seq = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;
  const stateRef = useRef({ fridge, shelfNumber, activeBasketId });
  stateRef.current = { fridge, shelfNumber, activeBasketId };

  const notify = useCallback((kind: ScanEventKind, message: string) => {
    seq.current += 1;
    setLastEvent({ id: seq.current, kind, message, at: Date.now() });
    if (kind === 'error') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } else if (kind === 'info') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, []);

  // ---- session doc -----------------------------------------------------------
  useEffect(() => {
    let mounted = true;
    let createdId: string | null = null;
    (async () => {
      try {
        const ref = await addDoc(collection(db, 'countingSessions'), {
          userName: user?.displayName || user?.email || 'Mobile counter',
          status: 'active',
          progress: { basketsCounted: 0, totalVials: 0, netDelta: 0 },
          countedBaskets: [],
          startedAt: new Date().toISOString(),
          locationId: 'default',
          activeBasketId: null,
          userId: user?.uid || 'unknown',
          client: 'expo',
        });
        createdId = ref.id;
        if (mounted) setSessionId(ref.id);
      } catch (err) {
        console.error('Failed to create counting session', err);
      }
    })();
    return () => {
      mounted = false;
      if (createdId) updateDoc(doc(db, 'countingSessions', createdId), { status: 'paused' }).catch(() => {});
    };
  }, [user]);

  useEffect(() => {
    if (!sessionId) return;
    return onSnapshot(
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
      (err) => console.error('Session subscription failed', err),
    );
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

  // ---- navigation ------------------------------------------------------------
  const selectFridge = useCallback(
    (next: FridgeLocation | null) => {
      setFridge(next);
      setShelfNumber(null);
      setActiveBasketId(null);
      stateRef.current = { fridge: next, shelfNumber: null, activeBasketId: null };
      patchSession({ activeBasketId: null, locationId: next?.id ?? 'default' });
    },
    [patchSession],
  );

  const selectShelf = useCallback(
    (next: number | null) => {
      setShelfNumber(next);
      setActiveBasketId(null);
      stateRef.current = { ...stateRef.current, shelfNumber: next, activeBasketId: null };
      patchSession({ activeBasketId: null });
    },
    [patchSession],
  );

  const selectBasket = useCallback(
    async (basket: BasketRecord | null, opts?: { adoptLocation?: boolean }): Promise<boolean> => {
      if (!basket) {
        setActiveBasketId(null);
        stateRef.current = { ...stateRef.current, activeBasketId: null };
        patchSession({ activeBasketId: null });
        return true;
      }
      try {
        const snap = await getDocs(
          query(
            collection(db, 'countingSessions'),
            where('status', 'in', ['active', 'paused']),
            where('activeBasketId', '==', basket.id),
          ),
        );
        const other = snap.docs.find((d) => d.id !== sessionIdRef.current);
        if (other) {
          const who = other.data().userName || 'another user';
          const ok = await confirmAsync('Basket in use', `${basket.name || 'This basket'} is being counted by ${who} right now.`);
          if (!ok) return false;
        }
      } catch (e) {
        console.error('Soft lock check failed', e);
      }

      if (opts?.adoptLocation !== false) {
        const current = stateRef.current;
        const shelfRef = parseShelfId(basket.shelfId);
        if (!current.fridge) {
          const targetLocationId = shelfRef?.locationId ?? basket.locationId;
          const loc = targetLocationId ? await getLocation(targetLocationId).catch(() => null) : null;
          if (loc) {
            const shelf = shelfRef && shelfRef.locationId === loc.id ? shelfRef.shelfNumber : null;
            setFridge(loc);
            setShelfNumber(shelf);
            stateRef.current = { ...stateRef.current, fridge: loc, shelfNumber: shelf };
            patchSession({ locationId: loc.id });
          }
        } else if (current.shelfNumber === null && shelfRef && shelfRef.locationId === current.fridge.id) {
          setShelfNumber(shelfRef.shelfNumber);
          stateRef.current = { ...stateRef.current, shelfNumber: shelfRef.shelfNumber };
        }
      }

      setActiveBasketId(basket.id);
      stateRef.current = { ...stateRef.current, activeBasketId: basket.id };
      patchSession({ activeBasketId: basket.id });
      return true;
    },
    [patchSession],
  );

  const goBack = useCallback(() => {
    const current = stateRef.current;
    if (current.activeBasketId) {
      setActiveBasketId(null);
      stateRef.current = { ...current, activeBasketId: null };
      patchSession({ activeBasketId: null });
    } else if (current.shelfNumber !== null) {
      setShelfNumber(null);
      stateRef.current = { ...current, shelfNumber: null };
    } else if (current.fridge) {
      setFridge(null);
      stateRef.current = { ...current, fridge: null };
      patchSession({ locationId: 'default' });
    }
  }, [patchSession]);

  // ---- scanning --------------------------------------------------------------
  const handleScan = useCallback(
    async (payload: string) => {
      const raw = (payload ?? '').trim();
      if (!raw) return;
      const now = Date.now();
      const prev = lastScanRef.current;
      if (prev && prev.raw === raw && now - prev.at < DEDUPE_MS) {
        prev.at = now;
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
            if (!loc) return notify('error', `Unknown fridge code: ${raw}`);
            selectFridge(loc);
            notify('fridge', loc.name);
            return;
          }
          case 'SHELF': {
            const ref = parseShelfId(parsed.value);
            if (!ref) return notify('error', `Unrecognized shelf code: ${raw}`);
            let loc = stateRef.current.fridge;
            if (!loc || loc.id !== ref.locationId) {
              loc = await getLocation(ref.locationId);
              if (!loc) return notify('error', 'Shelf label points at a fridge that no longer exists');
              setFridge(loc);
              patchSession({ locationId: loc.id });
            }
            setShelfNumber(ref.shelfNumber);
            setActiveBasketId(null);
            stateRef.current = { fridge: loc, shelfNumber: ref.shelfNumber, activeBasketId: null };
            patchSession({ activeBasketId: null });
            notify('shelf', `${loc.name} · Shelf ${ref.shelfNumber}`);
            return;
          }
          case 'BASKET': {
            const basket = await resolveBasketByCode(parsed);
            if (!basket) return notify('error', `Unknown basket code: ${raw}`);
            const ok = await selectBasket(basket);
            if (ok) notify('basket', basket.name || 'Basket');
            return;
          }
          case 'TRAY':
            return notify('info', 'Tray labels are not needed. Count trays + loose vials on the basket.');
          case 'PRODUCT':
            return notify('info', 'Product label scanned. Scan a basket, shelf or fridge label to count.');
          default:
            return notify('error', `Unrecognized code: ${raw}`);
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

  // ---- voice / typed commands -------------------------------------------------
  const applyVoiceText = useCallback(
    async (text: string) => {
      const commands = parseVoiceCommands(text);
      if (commands.length === 0) return;
      setResolving(true);
      try {
        const countCommands: VoiceCommand[] = [];
        for (const cmd of commands) {
          switch (cmd.kind) {
            case 'fridge': {
              const snap = await getDocs(collection(db, 'locations'));
              const match = matchByName(cmd.query, snap.docs.map((d) => toFridgeLocation(d.id, d.data())));
              if (!match) {
                notify('error', `No fridge matches "${cmd.query}"`);
                return;
              }
              selectFridge(match);
              notify('fridge', match.name);
              break;
            }
            case 'shelf': {
              const f = stateRef.current.fridge;
              if (!f) {
                notify('error', 'Say or pick a fridge first, e.g. "fridge 2 shelf 3"');
                return;
              }
              if (cmd.shelfNumber < 1 || cmd.shelfNumber > f.shelfCount) {
                notify('error', `${f.name} has shelves 1–${f.shelfCount}`);
                return;
              }
              selectShelf(cmd.shelfNumber);
              notify('shelf', `${f.name} · Shelf ${cmd.shelfNumber}`);
              break;
            }
            case 'basket': {
              const f = stateRef.current.fridge;
              if (!f) {
                notify('error', 'Pick a fridge first, then say the basket');
                return;
              }
              const [bSnap, pSnap] = await Promise.all([
                getDocs(query(collection(db, 'baskets'), where('locationId', '==', f.id))),
                getDocs(collection(db, 'products')),
              ]);
              const products = new Map(pSnap.docs.map((d) => [d.id, toProductSummary(d.id, d.data()).name]));
              const shelfNow = stateRef.current.shelfNumber;
              const candidates = bSnap.docs
                .map((d) => toBasketRecord(d.id, d.data()))
                .filter((b) => {
                  if (shelfNow === null || shelfNow === 0) return true;
                  const ref = parseShelfId(b.shelfId);
                  return !!ref && ref.locationId === f.id && ref.shelfNumber === shelfNow;
                })
                .map((b) => ({
                  id: b.id,
                  name: `${products.get(b.productId) ?? b.name} ${b.lotNumber ? `lot ${b.lotNumber}` : ''}`.trim(),
                  record: b,
                }));
              const match = matchByName(cmd.query, candidates);
              if (!match) {
                notify('error', `No basket here matches "${cmd.query}"`);
                return;
              }
              const ok = await selectBasket(match.record, { adoptLocation: false });
              if (ok) notify('basket', match.name);
              break;
            }
            case 'back':
              goBack();
              break;
            case 'unknown':
              notify('error', `Didn't understand: "${cmd.transcript}"`);
              return;
            default:
              countCommands.push(cmd);
          }
        }
        if (countCommands.length > 0) {
          if (!stateRef.current.activeBasketId) {
            notify('error', 'Open a basket first, then say the count');
            return;
          }
          seq.current += 1;
          setLastCommand({ id: seq.current, commands: countCommands, transcript: text });
        }
      } catch (err) {
        console.error('Voice command failed', err);
        notify('error', err instanceof Error ? err.message : 'Command failed');
      } finally {
        setResolving(false);
      }
    },
    [goBack, notify, selectBasket, selectFridge, selectShelf],
  );

  const shelfId = useMemo(
    () => (fridge && shelfNumber !== null && shelfNumber > 0 ? makeShelfId(fridge.id, shelfNumber) : null),
    [fridge, shelfNumber],
  );

  const value = useMemo<CountingSessionValue>(
    () => ({
      fridge,
      shelfNumber,
      shelfId,
      activeBasketId,
      lastScan,
      lastEvent,
      lastCommand,
      resolving,
      sessionId,
      sessionProgress,
      countedBasketIds,
      cameraPaused,
      setCameraPaused,
      selectFridge,
      selectShelf,
      selectBasket,
      handleScan,
      applyVoiceText,
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
      lastCommand,
      resolving,
      sessionId,
      sessionProgress,
      countedBasketIds,
      cameraPaused,
      selectFridge,
      selectShelf,
      selectBasket,
      handleScan,
      applyVoiceText,
      notify,
      goBack,
      completeSession,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
