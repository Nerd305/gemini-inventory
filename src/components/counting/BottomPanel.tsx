import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useCountingSession } from '../../contexts/CountingSessionContext';
import ScanStateMachine from './ScanStateMachine';
import BasketDetail, { type BasketSummary } from './BasketDetail';
import TrayCount from './TrayCount';
import PutBackConfirm from './PutBackConfirm';

const TOTAL_SLOTS = 6;

interface BasketDoc {
  productId: string;
  name?: string;
  vialsPerTray?: number;
  shelfId?: string;
}

interface PutBackContext {
  basketId: string;
  expectedShelfId: string | null;
  productName: string;
}

export default function BottomPanel() {
  const { activeBasketId } = useCountingSession();

  const [basket, setBasket] = useState<BasketSummary | null>(null);
  const [trayCounts, setTrayCounts] = useState<Map<number, number>>(new Map());
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [aiSequence, setAiSequence] = useState(false);
  const [putBack, setPutBack] = useState<PutBackContext | null>(null);

  // Whenever the active basket changes, reset per-basket UI state.
  useEffect(() => {
    setSelectedSlot(null);
    setAiSequence(false);
    setTrayCounts(new Map());
    setBasket(null);
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
    const unsub = onSnapshot(basketRef, async (snap) => {
      if (cancelled) return;
      if (!snap.exists()) {
        setBasket(null);
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
      setBasket({
        id: activeBasketId,
        name: data.name,
        productId: data.productId,
        productName,
        vialsPerTray: data.vialsPerTray ?? 25,
        shelfId: data.shelfId ?? null,
      });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [activeBasketId]);

  // Subscribe to tray subcollection.
  useEffect(() => {
    if (!activeBasketId) {
      setTrayCounts(new Map());
      return;
    }
    const traysRef = collection(db, 'baskets', activeBasketId, 'trays');
    const unsub = onSnapshot(traysRef, (snap) => {
      const next = new Map<number, number>();
      snap.docs.forEach((d) => {
        const data = d.data() as { slot?: number; count?: number };
        if (typeof data.slot === 'number' && typeof data.count === 'number') {
          next.set(data.slot, data.count);
        }
      });
      setTrayCounts(next);
    });
    return () => unsub();
  }, [activeBasketId]);

  const allCounted = useMemo(() => {
    for (let i = 1; i <= TOTAL_SLOTS; i++) {
      if (!trayCounts.has(i)) return false;
    }
    return true;
  }, [trayCounts]);

  // Auto-advance into PutBackConfirm when all 6 slots are counted (and we aren't editing one).
  useEffect(() => {
    if (!basket || putBack || selectedSlot !== null) return;
    if (allCounted) {
      setPutBack({
        basketId: basket.id,
        expectedShelfId: basket.shelfId,
        productName: basket.productName,
      });
      setAiSequence(false);
    }
  }, [allCounted, basket, putBack, selectedSlot]);

  // Drive the AI sequence: after Accept, advance to next uncounted slot.
  const handleAcceptSlot = () => {
    if (!aiSequence || !basket) {
      setSelectedSlot(null);
      return;
    }
    const next = findNextUncountedSlot(trayCounts, selectedSlot);
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
      <div className="h-full w-full bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
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
      <div className="h-full w-full bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
        <TrayCount
          basketId={basket.id}
          slot={selectedSlot}
          initialCount={trayCounts.has(selectedSlot) ? (trayCounts.get(selectedSlot) as number) : null}
          vialsPerTray={basket.vialsPerTray}
          sequenceLabel={aiSequence ? `AI sequence ${selectedSlot}/${TOTAL_SLOTS}` : undefined}
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
      <div className="h-full w-full bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.04)] flex items-center justify-center text-sm text-gray-500">
        Loading basket {activeBasketId}…
      </div>
    );
  }

  if (activeBasketId && basket) {
    return (
      <div className="h-full w-full bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
        <BasketDetail
          basket={basket}
          trayCounts={trayCounts}
          onSelectSlot={(slot) => setSelectedSlot(slot)}
          onStartAiSequence={() => {
            const start = findNextUncountedSlot(trayCounts, null) ?? 1;
            setAiSequence(true);
            setSelectedSlot(start);
          }}
        />
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
      <ScanStateMachine />
    </div>
  );
}

function findNextUncountedSlot(counts: Map<number, number>, current: number | null): number | null {
  const start = current === null ? 1 : current + 1;
  for (let s = start; s <= TOTAL_SLOTS; s++) {
    if (!counts.has(s)) return s;
  }
  for (let s = 1; s <= TOTAL_SLOTS; s++) {
    if (!counts.has(s)) return s;
  }
  return null;
}
