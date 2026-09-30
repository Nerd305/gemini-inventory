import { useEffect, useMemo, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { Loader2, Sparkles, Wand2, Pencil, Minus, Plus, CheckCircle2, Star } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useCountingSession } from '../../contexts/CountingSessionContext';
import { Button } from '../ui/button';
import {
  activeTrays,
  budStatus,
  clampInt,
  countedInSession,
  createTrays,
  hasBeenCounted,
  liveBasketTotal,
  MAX_TRAYS_PER_BIN,
  setAllTraysFull,
  traysCountedInSession,
  updateBasket,
  useFirstTrayId,
  type TrayRecord,
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
  migratedTraysAt?: string;
}

interface BasketDetailProps {
  basket: BasketSummary;
  trays: TrayRecord[];
  traysLoaded: boolean;
  finishing: boolean;
  onSelectTray: (trayId: string) => void;
  onTrayAdded: (trayId: string) => void;
  onStartAiSequence: () => void;
  onAllFull: () => void;
  onFinish: () => void;
}

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
  traysLoaded,
  finishing,
  onSelectTray,
  onTrayAdded,
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
  const [addingTray, setAddingTray] = useState(false);

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

  const setLoose = async (looseVials: number) => {
    setSavingLayout(true);
    try {
      await updateBasket(basket.id, { looseVials });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `baskets/${basket.id}`);
    } finally {
      setSavingLayout(false);
    }
  };

  const handleAddTray = async () => {
    if (!user) return;
    setAddingTray(true);
    try {
      const [id] = await createTrays({
        basketId: basket.id,
        productId: basket.productId,
        capacity: basket.vialsPerTray,
        userId: user.uid,
        existing: trays,
        items: [{}],
        sessionId,
      });
      if (id) onTrayAdded(id);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'trays');
    } finally {
      setAddingTray(false);
    }
  };

  const handleAllFull = async () => {
    if (!user) return;
    setBulkSaving(true);
    try {
      await setAllTraysFull({ basketId: basket.id, trays, userId: user.uid, sessionId });
      onAllFull();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'trays');
    } finally {
      setBulkSaving(false);
    }
  };

  const active = useMemo(() => activeTrays(trays), [trays]);
  const counted = traysCountedInSession(trays, sessionId);
  const total = liveBasketTotal(trays, basket.looseVials);
  const useFirst = useMemo(() => useFirstTrayId(trays), [trays]);
  const busy = bulkSaving || finishing;
  const gridCols = active.length <= 6 ? 3 : active.length <= 12 ? 4 : 5;

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
          <p className="text-[10px] font-bold uppercase text-gray-400">Counted now</p>
          <p className="text-base font-bold tabular-nums text-gray-900 leading-tight">
            {counted}/{active.length}
          </p>
          <p className="text-[11px] text-teal-700 font-semibold tabular-nums">{total} vials</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2"
          onClick={handleAddTray}
          disabled={addingTray || busy || active.length >= MAX_TRAYS_PER_BIN}
          title="A tray was added to this bin"
        >
          {addingTray ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
          Add tray
        </Button>
        <Stepper
          label="Loose"
          value={clampInt(basket.looseVials)}
          min={0}
          max={999}
          disabled={savingLayout || busy}
          onChange={(next) => setLoose(next)}
        />
        <span className="text-[10px] text-gray-400 ml-auto">{basket.vialsPerTray}/tray</span>
      </div>

      {!traysLoaded ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-gray-400 mb-1.5">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading trays…
        </div>
      ) : active.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center rounded-md border border-dashed border-gray-300 text-center px-4 text-xs text-gray-500 mb-1.5">
          No trays in this bin yet. Tap "Add tray" for each tray inside, then tap a tray to count it.
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto mb-1.5">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}>
            <AnimatePresence>
              {active.map((tray, i) => {
                const doneNow = countedInSession(tray, sessionId);
                const known = hasBeenCounted(tray);
                const fillPercentage = known ? Math.min(100, Math.max(0, (tray.count / tray.capacity) * 100)) : 0;
                const bud = budStatus(tray.bud);
                const title = [
                  `Tray ${tray.slot}: ${known ? `${tray.count} vials` : 'not counted'}`,
                  tray.lotNumber ? `Lot ${tray.lotNumber}` : null,
                  tray.bud ? `BUD ${tray.bud}` : null,
                  useFirst === tray.id ? 'USE FIRST' : null,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <motion.button
                    key={tray.id}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: Math.min(i, 12) * 0.03 }}
                    type="button"
                    title={title}
                    onClick={() => onSelectTray(tray.id)}
                    disabled={busy}
                    className={`relative h-12 rounded-md border-2 overflow-hidden flex items-center justify-center text-base font-bold tabular-nums transition-colors ${
                      doneNow
                        ? 'bg-teal-50 border-teal-400 text-teal-800'
                        : known
                        ? 'bg-white border-gray-300 text-gray-600 hover:border-teal-300'
                        : 'bg-gray-50 border-gray-200 text-gray-400 hover:border-teal-300'
                    }`}
                  >
                    {known && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${fillPercentage}%` }}
                        transition={{ type: 'spring', stiffness: 100, damping: 15 }}
                        className={`absolute bottom-0 left-0 right-0 z-0 ${doneNow ? 'bg-teal-200/50' : 'bg-gray-200/40'}`}
                      />
                    )}
                    <span className="absolute top-0.5 left-1 text-[9px] font-semibold text-gray-400 z-10">{tray.slot}</span>
                    {bud === 'expired' && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500 z-10" title="BUD expired" />}
                    {bud === 'soon' && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-400 z-10" title="BUD within 30 days" />}
                    {useFirst === tray.id && (
                      <span className="absolute bottom-0.5 right-1 inline-flex items-center text-[8px] font-bold text-amber-700 z-10">
                        <Star className="h-2.5 w-2.5 mr-0.5" /> 1st
                      </span>
                    )}
                    <span className="z-10">{known ? tray.count : '—'}</span>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5 mt-auto">
        <Button variant="outline" className="h-11 px-1" onClick={onStartAiSequence} disabled={busy || active.length === 0}>
          <Wand2 className="h-4 w-4 mr-1" /> AI all
        </Button>
        <Button
          variant="outline"
          className="h-11 px-1 border-teal-300 text-teal-800"
          onClick={handleAllFull}
          disabled={busy || active.length === 0}
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
          disabled={busy || !traysLoaded || (active.length > 0 && counted === 0 && basket.looseVials === 0)}
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
