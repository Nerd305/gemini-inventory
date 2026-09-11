import { useCallback, useEffect, useState } from 'react';
import { collection, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useCountingSession } from '../../contexts/CountingSessionContext';
import ScanStateMachine from './ScanStateMachine';
import BasketDetail, { type BasketSummary } from './BasketDetail';
import TrayCount from './TrayCount';
import PutBackConfirm from './PutBackConfirm';
import {
  allSlotsCounted,
  clampInt,
  DEFAULT_VIALS_PER_TRAY,
  finalizeBasketCount,
  nextUncountedSlot,
  updateBasket,
  type BasketDoc,
  type TrayDoc,
  type TrayMap,
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
  const { activeBasketId, pendingTraySlot, clearPendingTraySlot, sessionId } = useCountingSession();

  const [basket, setBasket] = useState<BasketSummary | null>(null);
  const [basketMissing, setBasketMissing] = useState(false);
  const [trays, setTrays] = useState<TrayMap>(new Map());
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [aiSequence, setAiSequence] = useState(false);
  const [putBack, setPutBack] = useState<PutBackContext | null>(null);
  const [finishing, setFinishing] = useState(false);

  // Whenever the active basket changes, reset per-basket UI state.
  useEffect(() => {
    setSelectedSlot(null);
    setAiSequence(false);
    setTrays(new Map());
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
        });
      },
      (error) => handleFirestoreError(error, OperationType.GET, `baskets/${activeBasketId}`),
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [activeBasketId]);

  // Subscribe to tray subcollection.
  useEffect(() => {
    if (!activeBasketId) {
      setTrays(new Map());
      return;
    }
    const traysRef = collection(db, 'baskets', activeBasketId, 'trays');
    const unsub = onSnapshot(traysRef, (snap) => {
      const next: TrayMap = new Map();
      snap.docs.forEach((d) => {
        const data = d.data() as TrayDoc;
        if (typeof data.slot === 'number' && typeof data.count === 'number') {
          next.set(data.slot, data);
        }
      });
      setTrays(next);
    });
    return () => unsub();
  }, [activeBasketId]);

  // A TRAY: scan jumps straight into that tray once the bin has loaded.
  useEffect(() => {
    if (pendingTraySlot === null || !basket) return;
    // The basket state lags activeBasketId by one snapshot; never act on the previous bin's object.
    if (basket.id !== activeBasketId) return;
    if (pendingTraySlot > basket.trayCount) {
      updateBasket(basket.id, { trayCount: pendingTraySlot }).catch((error) =>
        handleFirestoreError(error, OperationType.UPDATE, `baskets/${basket.id}`),
      );
    }
    setPutBack(null);
    setAiSequence(false);
    setSelectedSlot(pendingTraySlot);
    clearPendingTraySlot();
  }, [pendingTraySlot, basket, activeBasketId, clearPendingTraySlot]);

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
    setSelectedSlot(null);
    setAiSequence(false);
    setPutBack({ basketId: basket.id, expectedShelfId: basket.shelfId, productName: basket.productName });
  }, [basket, user, sessionId]);

  // After a tray is accepted: continue the AI sequence, or finish the bin when the last tray is done.
  const handleAcceptSlot = (slot: number, count: number) => {
    if (!basket) {
      setSelectedSlot(null);
      return;
    }
    const projected: TrayMap = new Map(trays);
    projected.set(slot, { ...(trays.get(slot) ?? { slot }), slot, count });

    if (allSlotsCounted(projected, basket.trayCount)) {
      void startPutBack();
      return;
    }
    if (!aiSequence) {
      setSelectedSlot(null);
      return;
    }
    const next = nextUncountedSlot(projected, basket.trayCount, slot);
    if (next === null) {
      setSelectedSlot(null);
      setAiSequence(false);
    } else {
      setSelectedSlot(next);
    }
  };

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

  if (activeBasketId && basket && selectedSlot !== null) {
    return (
      <div className={panelClass}>
        <TrayCount
          basketId={basket.id}
          productId={basket.productId}
          slot={selectedSlot}
          trayCount={basket.trayCount}
          existing={trays.get(selectedSlot) ?? null}
          vialsPerTray={basket.vialsPerTray}
          sequenceLabel={aiSequence ? 'AI sequence' : undefined}
          onAccept={handleAcceptSlot}
          onCancel={() => {
            setSelectedSlot(null);
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
          finishing={finishing}
          onSelectSlot={(slot) => setSelectedSlot(slot)}
          onStartAiSequence={() => {
            const start = nextUncountedSlot(trays, basket.trayCount, null) ?? 1;
            setAiSequence(true);
            setSelectedSlot(start);
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
