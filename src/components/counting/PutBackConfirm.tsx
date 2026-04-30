import { useEffect, useRef, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { CheckCircle2, AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { Button } from '../ui/button';
import { useCountingSession, type ParsedScan } from '../../contexts/CountingSessionContext';

interface PutBackConfirmProps {
  basketId: string;
  expectedShelfId: string | null;
  productName: string;
  onComplete: () => void;
  onBackToBasket: () => void;
}

type Outcome =
  | { kind: 'waiting' }
  | { kind: 'match'; shelfId: string }
  | { kind: 'mismatch'; scannedShelfId: string }
  | { kind: 'assign'; scannedShelfId: string };

export default function PutBackConfirm({
  basketId,
  expectedShelfId,
  productName,
  onComplete,
  onBackToBasket,
}: PutBackConfirmProps) {
  const { lastScan } = useCountingSession();
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'waiting' });
  const [moving, setMoving] = useState(false);
  const baselineRef = useRef<ParsedScan | null>(lastScan);
  const completeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!lastScan || lastScan === baselineRef.current) return;
    if (lastScan.prefix !== 'SHELF') return;

    if (!expectedShelfId) {
      setOutcome({ kind: 'assign', scannedShelfId: lastScan.id });
      return;
    }
    if (lastScan.id === expectedShelfId) {
      setOutcome({ kind: 'match', shelfId: lastScan.id });
    } else {
      setOutcome({ kind: 'mismatch', scannedShelfId: lastScan.id });
    }
  }, [lastScan, expectedShelfId]);

  useEffect(() => {
    if (outcome.kind === 'match') {
      completeTimerRef.current = window.setTimeout(onComplete, 1200);
      return () => {
        if (completeTimerRef.current) window.clearTimeout(completeTimerRef.current);
      };
    }
  }, [outcome, onComplete]);

  const handleMove = async (newShelfId: string) => {
    setMoving(true);
    try {
      await updateDoc(doc(db, 'baskets', basketId), { shelfId: newShelfId });
      onComplete();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `baskets/${basketId}`);
    } finally {
      setMoving(false);
    }
  };

  if (outcome.kind === 'match') {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 bg-green-50 animate-in fade-in">
        <CheckCircle2 className="h-12 w-12 text-green-600 mb-2" />
        <p className="text-lg font-semibold text-green-900">Returned to Shelf {outcome.shelfId}</p>
        <p className="text-sm text-green-800 mt-1">{productName}</p>
      </div>
    );
  }

  if (outcome.kind === 'mismatch') {
    return (
      <div className="flex h-full flex-col px-5 py-3 bg-amber-50">
        <div className="flex items-center text-amber-800 mb-1">
          <AlertTriangle className="h-5 w-5 mr-2" />
          <span className="text-xs font-bold uppercase tracking-wide">Wrong Shelf</span>
        </div>
        <p className="text-sm text-amber-900 mb-3">
          This is <span className="font-bold">Shelf {outcome.scannedShelfId}</span>, but{' '}
          <span className="font-bold">{productName}</span> belongs on{' '}
          <span className="font-bold">Shelf {expectedShelfId}</span>. Move it?
        </p>
        <div className="grid grid-cols-2 gap-2 mt-auto">
          <Button variant="outline" className="h-11" onClick={onBackToBasket} disabled={moving}>
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
          </Button>
          <Button
            className="h-11 bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => handleMove(outcome.scannedShelfId)}
            disabled={moving}
          >
            {moving ? <Loader2 className="h-4 w-4 animate-spin" /> : `Move to Shelf ${outcome.scannedShelfId}`}
          </Button>
        </div>
      </div>
    );
  }

  if (outcome.kind === 'assign') {
    return (
      <div className="flex h-full flex-col px-5 py-3 bg-teal-50">
        <div className="flex items-center text-teal-800 mb-1">
          <CheckCircle2 className="h-5 w-5 mr-2" />
          <span className="text-xs font-bold uppercase tracking-wide">Assign Shelf</span>
        </div>
        <p className="text-sm text-teal-900 mb-3">
          This basket has no assigned shelf. Assign{' '}
          <span className="font-bold">{productName}</span> to{' '}
          <span className="font-bold">Shelf {outcome.scannedShelfId}</span>?
        </p>
        <div className="grid grid-cols-2 gap-2 mt-auto">
          <Button variant="outline" className="h-11" onClick={onBackToBasket} disabled={moving}>
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
          </Button>
          <Button
            className="h-11 bg-teal-600 hover:bg-teal-700 text-white"
            onClick={() => handleMove(outcome.scannedShelfId)}
            disabled={moving}
          >
            {moving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col px-5 py-3">
      <div className="flex items-center text-teal-700 mb-1">
        <CheckCircle2 className="h-5 w-5 mr-2" />
        <span className="text-xs font-bold uppercase tracking-wide">Basket Complete</span>
      </div>
      <p className="text-base font-semibold text-gray-900 mb-1">{productName}</p>
      <p className="text-sm text-gray-700">
        Scan the shelf QR to confirm return
        {expectedShelfId ? <> to <span className="font-bold">Shelf {expectedShelfId}</span></> : null}.
      </p>
      <Button variant="ghost" className="mt-auto self-start" onClick={onBackToBasket}>
        <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to basket
      </Button>
    </div>
  );
}
