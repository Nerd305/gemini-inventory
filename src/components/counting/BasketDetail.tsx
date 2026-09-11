import { useEffect, useMemo, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { Loader2, Sparkles, Wand2, Pencil, Minus, Plus, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useCountingSession } from '../../contexts/CountingSessionContext';
import { Button } from '../ui/button';
import {
  budStatus,
  clampInt,
  countedSlots,
  liveBasketTotal,
  setAllTraysFull,
  updateBasket,
  type TrayMap,
} from '../../lib/inventory';

export interface BasketSummary {
  id: string;
  name?: string;
  productId: string;
  productName: string;
  vialsPerTray: number;
  trayCount: number;
  looseVials: number;
  shelfId: string | null;
  totalVials?: number;
  lastCountedAt?: string;
}

interface BasketDetailProps {
  basket: BasketSummary;
  trays: TrayMap;
  finishing: boolean;
  onSelectSlot: (slot: number) => void;
  onStartAiSequence: () => void;
  onAllFull: () => void;
  onFinish: () => void;
}

const MAX_TRAYS = 40;

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 py-0.5">
      <span className="text-[10px] font-bold uppercase text-gray-500 mr-1">{label}</span>
      <button
        type="button"
        className="h-7 w-7 rounded text-gray-700 hover:bg-gray-100 disabled:opacity-40 flex items-center justify-center"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
        aria-label={`Decrease ${label}`}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="w-6 text-center text-sm font-bold tabular-nums">{value}</span>
      <button
        type="button"
        className="h-7 w-7 rounded text-gray-700 hover:bg-gray-100 disabled:opacity-40 flex items-center justify-center"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}
        aria-label={`Increase ${label}`}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function BasketDetail({
  basket,
  trays,
  finishing,
  onSelectSlot,
  onStartAiSequence,
  onAllFull,
  onFinish,
}: BasketDetailProps) {
  const { user } = useAuth();
  const { sessionId } = useCountingSession();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(basket.productName);
  const [savingName, setSavingName] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);

  useEffect(() => {
    if (!editingName) setNameDraft(basket.productName);
  }, [basket.productName, editingName]);

  const commitName = async () => {
    const next = nameDraft.trim();
    if (!next || next === basket.productName) {
      setEditingName(false);
      setNameDraft(basket.productName);
      return;
    }
    setSavingName(true);
    try {
      await updateDoc(doc(db, 'products', basket.productId), { name: next });
      setEditingName(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `products/${basket.productId}`);
      setNameDraft(basket.productName);
      setEditingName(false);
    } finally {
      setSavingName(false);
    }
  };

  const setLayout = async (patch: { trayCount?: number; looseVials?: number }) => {
    setSavingLayout(true);
    try {
      await updateBasket(basket.id, patch);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `baskets/${basket.id}`);
    } finally {
      setSavingLayout(false);
    }
  };

  const handleAllFull = async () => {
    if (!user || basket.trayCount <= 0) return;
    setBulkSaving(true);
    try {
      await setAllTraysFull({
        basketId: basket.id,
        trayCount: basket.trayCount,
        vialsPerTray: basket.vialsPerTray,
        userId: user.uid,
        sessionId,
        existing: trays,
      });
      onAllFull();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `baskets/${basket.id}/trays`);
    } finally {
      setBulkSaving(false);
    }
  };

  const trayCount = clampInt(basket.trayCount, 0, MAX_TRAYS);
  const counted = countedSlots(trays, trayCount);
  const total = liveBasketTotal(trays, trayCount, basket.looseVials);
  const busy = bulkSaving || finishing;

  const gridCols = useMemo(() => (trayCount <= 6 ? 3 : trayCount <= 12 ? 4 : 5), [trayCount]);

  return (
    <div className="flex h-full flex-col px-4 py-2">
      <div className="flex items-start justify-between mb-1.5 gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-teal-700">Bin</p>
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') {
                  setEditingName(false);
                  setNameDraft(basket.productName);
                }
              }}
              className="w-full text-base font-semibold text-gray-900 border-b-2 border-teal-500 outline-none bg-transparent"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="flex items-center gap-1.5 text-left text-base font-semibold text-gray-900 truncate max-w-full"
            >
              <span className="truncate">{basket.productName}</span>
              {savingName ? (
                <Loader2 className="h-3.5 w-3.5 text-gray-400 animate-spin shrink-0" />
              ) : (
                <Pencil className="h-3 w-3 text-gray-400 shrink-0" />
              )}
            </button>
          )}
          {basket.name && basket.name !== basket.productName && (
            <p className="text-[11px] text-gray-500 truncate">{basket.name}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] font-bold uppercase text-gray-400">Trays counted</p>
          <p className="text-base font-bold tabular-nums text-gray-900 leading-tight">
            {counted}/{trayCount}
          </p>
          <p className="text-[11px] text-teal-700 font-semibold tabular-nums">{total} vials</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <Stepper
          label="Trays"
          value={trayCount}
          min={0}
          max={MAX_TRAYS}
          disabled={savingLayout || busy}
          onChange={(next) => setLayout({ trayCount: next })}
        />
        <Stepper
          label="Loose"
          value={clampInt(basket.looseVials)}
          min={0}
          max={999}
          disabled={savingLayout || busy}
          onChange={(next) => setLayout({ looseVials: next })}
        />
        <span className="text-[10px] text-gray-400 ml-auto">{basket.vialsPerTray}/tray</span>
      </div>

      {trayCount === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center rounded-md border border-dashed border-gray-300 text-center px-4 text-xs text-gray-500 mb-1.5">
          Set how many trays are in this bin with the Trays stepper, then tap each tray to count it.
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto mb-1.5">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}>
            <AnimatePresence>
              {Array.from({ length: trayCount }, (_, i) => i + 1).map((slot) => {
                const tray = trays.get(slot);
                const counted = tray !== undefined;
                const fillPercentage = counted
                  ? Math.min(100, Math.max(0, (tray.count / basket.vialsPerTray) * 100))
                  : 0;
                const bud = counted ? budStatus(tray.bud) : 'unknown';
                const title = counted
                  ? [
                      `Tray ${slot}: ${tray.count} vials`,
                      tray.lotNumber ? `Lot ${tray.lotNumber}` : null,
                      tray.bud ? `BUD ${tray.bud}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : `Tray ${slot}: not counted`;
                return (
                  <motion.button
                    key={slot}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: Math.min(slot, 12) * 0.03 }}
                    type="button"
                    title={title}
                    onClick={() => onSelectSlot(slot)}
                    disabled={busy}
                    className={`relative h-11 rounded-md border-2 overflow-hidden flex items-center justify-center text-base font-bold tabular-nums transition-colors ${
                      counted
                        ? 'bg-teal-50 border-teal-400 text-teal-800'
                        : 'bg-gray-50 border-gray-200 text-gray-400 hover:border-teal-300'
                    }`}
                  >
                    {counted && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${fillPercentage}%` }}
                        transition={{ type: 'spring', stiffness: 100, damping: 15 }}
                        className="absolute bottom-0 left-0 right-0 bg-teal-200/50 z-0"
                      />
                    )}
                    <span className="absolute top-0.5 left-1 text-[9px] font-semibold text-gray-400 z-10">{slot}</span>
                    {bud === 'expired' && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500 z-10" />}
                    {bud === 'soon' && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-400 z-10" />}
                    <span className="z-10">{counted ? tray.count : '—'}</span>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5 mt-auto">
        <Button variant="outline" className="h-11 px-1" onClick={onStartAiSequence} disabled={busy || trayCount === 0}>
          <Wand2 className="h-4 w-4 mr-1" /> AI all
        </Button>
        <Button
          variant="outline"
          className="h-11 px-1 border-teal-300 text-teal-800"
          onClick={handleAllFull}
          disabled={busy || trayCount === 0}
        >
          {bulkSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <><Sparkles className="h-4 w-4 mr-1" /> All full</>
          )}
        </Button>
        <Button
          className="h-11 px-1 bg-teal-600 hover:bg-teal-700 text-white"
          onClick={onFinish}
          disabled={busy || (trayCount > 0 && counted === 0 && basket.looseVials === 0)}
          title="Finish this bin and confirm the shelf it goes back on"
        >
          {finishing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <><CheckCircle2 className="h-4 w-4 mr-1" /> Finish</>
          )}
        </Button>
      </div>
    </div>
  );
}
