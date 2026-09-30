import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useCountingSession } from '../../contexts/CountingSessionContext';
import ScanStateMachine from './ScanStateMachine';
import BasketDetail, { type BasketSummary } from './BasketDetail';
import TrayCount from './TrayCount';
import PutBackConfirm from './PutBackConfirm';
import {
  activeTrays,
  allTraysCountedInSession,
  clampInt,
  DEFAULT_VIALS_PER_TRAY,
  finalizeBasketCount,
  migrateLegacyTrays,
  nextUncountedTray,
  trayRecordFromSnapshot,
  traysForBasketQuery,
  useFirstTrayId,
  type BasketDoc,
  type TrayRecord,
} from '../../lib/inventory';

interface PutBackContext {
  basketId: string;
  expectedShelfId: string | null;
  productName: string;
}

const panelClass =
  'h-full w-full bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]';

export default function BottomPanel() {
  const { user } = useAuth();
  const { activeBasketId, pendingTray, clearPendingTray, sessionId } = useCountingSession();

  const [basket, setBasket] = useState<BasketSummary | null>(null);
  const [basketMissing, setBasketMissing] = useState(false);
  const [trays, setTrays] = useState<TrayRecord[]>([]);
  const [traysLoaded, setTraysLoaded] = useState(false);
  const [selectedTrayId, setSelectedTrayId] = useState<string | null>(null);
  const [aiSequence, setAiSequence] = useState(false);
  const [putBack, setPutBack] = useState<PutBackContext | null>(null);
  const [finishing, setFinishing] = useState(false);
  const migratingRef = useRef<string | null>(null);

  // Whenever the active basket changes, reset per-basket UI state.
  useEffect(() => {
    setSelectedTrayId(null);
    setAiSequence(false);
    setTrays([]);
    setTraysLoaded(false);
    setBasket(null);
    setBasketMissing(false);
  }, [activeBasketId]);

  // Put-back state must survive activeBasketId being cleared by a SHELF scan
  // (the context clears activeBasketId on every SHELF scan, but PutBackConfirm
  // needs to render the match/mismatch outcome). Only drop put-back when the
  // user explicitly scans a *different* basket.
  useEffect(() => {
    setPutBack((prev) => {
      if (prev && activeBasketId && activeBasketId !== prev.basketId) return null;
      return prev;
    });
  }, [activeBasketId]);

  // Subscribe to basket doc + product name.
  useEffect(() => {
    if (!activeBasketId) {
      setBasket(null);
      return;
    }
    let cancelled = false;
    const basketRef = doc(db, 'baskets', activeBasketId);
    const unsub = onSnapshot(
      basketRef,
      async (snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setBasket(null);
          setBasketMissing(true);
          return;
        }
        const data = snap.data() as BasketDoc;
        let productName = '(unknown product)';
        try {
          const prodSnap = await getDoc(doc(db, 'products', data.productId));
          if (prodSnap.exists()) productName = (prodSnap.data() as { name?: string }).name ?? productName;
        } catch {
          // leave fallback
        }
        if (cancelled) return;
        setBasketMissing(false);
        setBasket({
          id: activeBasketId,
          name: data.name,
          productId: data.productId,
          productName,
          vialsPerTray: clampInt(data.vialsPerTray, 1) || DEFAULT_VIALS_PER_TRAY,
          trayCount: clampInt(data.trayCount),
          looseVials: clampInt(data.looseVials),
          shelfId: data.shelfId ?? null,
          totalVials: typeof data.totalVials === 'number' ? data.totalVials : undefined,
          lastCountedAt: data.lastCountedAt,
          migratedTraysAt: data.migratedTraysAt,
        });
      },
      (error) => handleFirestoreError(error, OperationType.GET, `baskets/${activeBasketId}`),
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [activeBasketId]);

  // Subscribe to the bin's trays.
  useEffect(() => {
    if (!activeBasketId) {
      setTrays([]);
      setTraysLoaded(false);
      return;
    }
    const unsub = onSnapshot(
      traysForBasketQuery(activeBasketId),
      (snap) => {
        const next: TrayRecord[] = [];
        snap.forEach((d) => {
          const t = trayRecordFromSnapshot(d.id, d.data());
          if (t) next.push(t);
        });
        setTrays(next);
        setTraysLoaded(true);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'trays'),
    );
    return () => unsub();
  }, [activeBasketId]);

  // Bins created before trays had their own documents: copy the legacy slot docs over once.
  useEffect(() => {
    if (!basket || !user || !traysLoaded || trays.length > 0) return;
    if (basket.id !== activeBasketId || basket.migratedTraysAt) return;
    if (migratingRef.current === basket.id) return;
    migratingRef.current = basket.id;
    migrateLegacyTrays({ basketId: basket.id, userId: user.uid }).catch((error) =>
      handleFirestoreError(error, OperationType.WRITE, 'trays'),
    );
  }, [basket, user, traysLoaded, trays.length, activeBasketId]);

  // A TRAY: scan jumps straight into that tray once the bin and its trays have loaded.
  useEffect(() => {
    if (!pendingTray || !basket || basket.id !== activeBasketId || !traysLoaded) return;
    const match = pendingTray.trayId
      ? trays.find((t) => t.id === pendingTray.trayId)
      : trays.find((t) => t.status === 'active' && t.slot === pendingTray.slot);
    if (!match) {
      // Legacy slot labels may point at a bin that is still migrating; wait for the trays to appear.
      if (trays.length === 0 && !basket.migratedTraysAt) return;
      clearPendingTray();
      return;
    }
    setPutBack(null);
    setAiSequence(false);
    setSelectedTrayId(match.id);
    clearPendingTray();
  }, [pendingTray, basket, activeBasketId, trays, traysLoaded, clearPendingTray]);

  const startPutBack = useCallback(async () => {
    if (!basket || !user) return;
    setFinishing(true);
    try {
      await finalizeBasketCount({ basketId: basket.id, userId: user.uid, sessionId });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `baskets/${basket.id}`);
    } finally {
      setFinishing(false);
    }
    setSelectedTrayId(null);
    setAiSequence(false);
    setPutBack({ basketId: basket.id, expectedShelfId: basket.shelfId, productName: basket.productName });
  }, [basket, user, sessionId]);

  // After a tray is accepted: continue the AI sequence, or finish the bin when the last tray is done.
  const handleAcceptTray = (trayId: string, count: number) => {
    if (!basket) {
      setSelectedTrayId(null);
      return;
    }
    const now = new Date().toISOString();
    const projected = trays.map((t) =>
      t.id === trayId ? { ...t, count, countedAt: now, sessionId: sessionId ?? t.sessionId } : t,
    );
    if (allTraysCountedInSession(projected, sessionId)) {
      void startPutBack();
      return;
    }
    if (!aiSequence) {
      setSelectedTrayId(null);
      return;
    }
    const next = nextUncountedTray(projected, sessionId, trayId);
    if (!next) {
      setSelectedTrayId(null);
      setAiSequence(false);
    } else {
      setSelectedTrayId(next.id);
    }
  };

  const active = useMemo(() => activeTrays(trays), [trays]);
  const selectedTray = selectedTrayId ? active.find((t) => t.id === selectedTrayId) ?? null : null;
  const useFirst = useMemo(() => useFirstTrayId(trays), [trays]);

  // Routing
  if (putBack) {
    return (
      <div className={panelClass}>
        <PutBackConfirm
          basketId={putBack.basketId}
          expectedShelfId={putBack.expectedShelfId}
          productName={putBack.productName}
          onComplete={() => setPutBack(null)}
          onBackToBasket={() => setPutBack(null)}
        />
      </div>
    );
  }

  if (activeBasketId && basket && selectedTray) {
    return (
      <div className={panelClass}>
        <TrayCount
          tray={selectedTray}
          position={active.findIndex((t) => t.id === selectedTray.id) + 1}
          total={active.length}
          allTrays={trays}
          productId={basket.productId}
          useFirst={useFirst === selectedTray.id}
          sequenceLabel={aiSequence ? 'AI sequence' : undefined}
          onAccept={handleAcceptTray}
          onRemoved={() => {
            setSelectedTrayId(null);
            setAiSequence(false);
          }}
          onCancel={() => {
            setSelectedTrayId(null);
            setAiSequence(false);
          }}
        />
      </div>
    );
  }

  if (activeBasketId && !basket) {
    return (
      <div className={`${panelClass} flex flex-col items-center justify-center text-sm text-gray-500 px-6 text-center`}>
        {basketMissing ? (
          <>
            <p className="font-medium text-gray-800">Bin not found</p>
            <p className="text-xs mt-1 break-all">No bin with ID {activeBasketId}. Create it under Bins and reprint the label.</p>
          </>
        ) : (
          <>Loading bin…</>
        )}
      </div>
    );
  }

  if (activeBasketId && basket) {
    return (
      <div className={panelClass}>
        <BasketDetail
          basket={basket}
          trays={trays}
          traysLoaded={traysLoaded}
          finishing={finishing}
          onSelectTray={(id) => setSelectedTrayId(id)}
          onTrayAdded={(id) => {
            setAiSequence(false);
            setSelectedTrayId(id);
          }}
          onStartAiSequence={() => {
            const start = nextUncountedTray(trays, sessionId, null) ?? active[0];
            if (!start) return;
            setAiSequence(true);
            setSelectedTrayId(start.id);
          }}
          onAllFull={() => void startPutBack()}
          onFinish={() => void startPutBack()}
        />
      </div>
    );
  }

  return (
    <div className={panelClass}>
      <ScanStateMachine />
    </div>
  );
}
