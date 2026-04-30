import React, { createContext, useCallback, useContext, useMemo, useRef, useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, doc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';

export type ScanPrefix = 'SHELF' | 'BSKT' | 'TRAY' | 'UNKNOWN';

export interface ParsedScan {
  prefix: ScanPrefix;
  id: string;
  raw: string;
}

interface CountingSessionContextValue {
  activeLocationId: string | null;
  activeShelfId: string | null;
  activeBasketId: string | null;
  lastScan: ParsedScan | null;
  sessionId: string | null;
  setActiveLocationId: (id: string | null) => void;
  handleScan: (qrData: string) => void;
  completeSession: () => Promise<void>;
}

const CountingSessionContext = createContext<CountingSessionContextValue | null>(null);

export function useCountingSession() {
  const ctx = useContext(CountingSessionContext);
  if (!ctx) throw new Error('useCountingSession must be used within CountingSessionProvider');
  return ctx;
}

function parseScan(qrData: string): ParsedScan {
  const trimmed = qrData.trim();
  const colon = trimmed.indexOf(':');
  if (colon === -1) return { prefix: 'UNKNOWN', id: trimmed, raw: trimmed };
  const head = trimmed.slice(0, colon).toUpperCase();
  const id = trimmed.slice(colon + 1);
  if (head === 'SHELF' || head === 'BSKT' || head === 'TRAY') {
    return { prefix: head, id, raw: trimmed };
  }
  return { prefix: 'UNKNOWN', id, raw: trimmed };
}

const DEDUPE_MS = 1500;

export function CountingSessionProvider({ children }: { children: React.ReactNode }) {
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const [activeShelfId, setActiveShelfId] = useState<string | null>(null);
  const [activeBasketId, setActiveBasketId] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<ParsedScan | null>(null);

  const { user } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const initSession = async () => {
      try {
        const docRef = await addDoc(collection(db, 'countingSessions'), {
          userName: user?.displayName || user?.email || 'Anonymous Worker',
          status: 'active',
          progress: {
            basketsCounted: 0,
            totalVials: 0,
          },
          startedAt: new Date().toISOString(),
          locationId: 'default',
          activeBasketId: null,
          userId: user?.uid || 'unknown'
        });
        if (mounted) setSessionId(docRef.id);
      } catch (err) {
        console.error("Failed to create counting session", err);
      }
    };
    initSession();

    return () => {
      mounted = false;
      if (sessionId) {
        // Optionally mark as cancelled or paused if unmounted without completing
        updateDoc(doc(db, 'countingSessions', sessionId), { status: 'paused' }).catch(() => {});
      }
    };
  }, [user]);

  const completeSession = useCallback(async () => {
    if (sessionId) {
      await updateDoc(doc(db, 'countingSessions', sessionId), {
        status: 'completed',
        activeBasketId: null,
      });
    }
  }, [sessionId]);

  const handleScan = useCallback(async (qrData: string) => {
    const now = Date.now();
    const prev = lastScanRef.current;
    if (prev && prev.raw === qrData && now - prev.at < DEDUPE_MS) return;
    lastScanRef.current = { raw: qrData, at: now };

    const parsed = parseScan(qrData);
    setLastScan(parsed);

    switch (parsed.prefix) {
      case 'SHELF':
        setActiveShelfId(parsed.id);
        setActiveBasketId(null);
        if (sessionId) {
          updateDoc(doc(db, 'countingSessions', sessionId), { activeBasketId: null }).catch(console.error);
        }
        break;
      case 'BSKT':
        // Soft lock check
        try {
          const q = query(
            collection(db, 'countingSessions'),
            where('status', 'in', ['active', 'paused']),
            where('activeBasketId', '==', parsed.id)
          );
          const activeDocs = await getDocs(q);
          const otherActive = activeDocs.docs.find(d => d.id !== sessionId);
          if (otherActive) {
            window.alert(`Warning: Basket ${parsed.id} is already being counted by ${otherActive.data().userName}.`);
            return; // Prevent setting it as active
          }
        } catch (e) {
          console.error("Soft lock check failed", e);
        }
        
        setActiveBasketId(parsed.id);
        if (sessionId) {
          updateDoc(doc(db, 'countingSessions', sessionId), { activeBasketId: parsed.id }).catch(console.error);
        }
        break;
      case 'TRAY':
        break;
      default:
        break;
    }
  }, [sessionId]);

  const value = useMemo<CountingSessionContextValue>(
    () => ({
      activeLocationId,
      activeShelfId,
      activeBasketId,
      lastScan,
      sessionId,
      setActiveLocationId,
      handleScan,
      completeSession,
    }),
    [activeLocationId, activeShelfId, activeBasketId, lastScan, handleScan, sessionId, completeSession]
  );

  return <CountingSessionContext.Provider value={value}>{children}</CountingSessionContext.Provider>;
}
