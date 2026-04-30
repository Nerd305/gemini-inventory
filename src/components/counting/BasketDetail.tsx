import { useEffect, useState } from 'react';
import { doc, updateDoc, setDoc, writeBatch } from 'firebase/firestore';
import { Loader2, Sparkles, Wand2, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';

const TOTAL_SLOTS = 6;

export interface BasketSummary {
  id: string;
  name?: string;
  productId: string;
  productName: string;
  vialsPerTray: number;
  shelfId: string | null;
}

interface BasketDetailProps {
  basket: BasketSummary;
  trayCounts: Map<number, number>;
  onSelectSlot: (slot: number) => void;
  onStartAiSequence: () => void;
}

export default function BasketDetail({
  basket,
  trayCounts,
  onSelectSlot,
  onStartAiSequence,
}: BasketDetailProps) {
  const { user } = useAuth();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(basket.productName);
  const [savingName, setSavingName] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);

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

  const handleAllFull = async () => {
    if (!user) return;
    setBulkSaving(true);
    try {
      const batch = writeBatch(db);
      const ts = new Date().toISOString();
      for (let slot = 1; slot <= TOTAL_SLOTS; slot++) {
        const ref = doc(db, 'baskets', basket.id, 'trays', `slot-${slot}`);
        batch.set(
          ref,
          { slot, count: basket.vialsPerTray, countedAt: ts, countedBy: user.uid },
          { merge: true }
        );
      }
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `baskets/${basket.id}/trays`);
    } finally {
      setBulkSaving(false);
    }
  };

  const countedSlots = Array.from(trayCounts.keys()).filter((s) => s >= 1 && s <= TOTAL_SLOTS).length;

  return (
    <div className="flex h-full flex-col px-5 py-3">
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-teal-700">Basket</p>
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') { setEditingName(false); setNameDraft(basket.productName); }
              }}
              className="w-full text-lg font-semibold text-gray-900 border-b-2 border-teal-500 outline-none bg-transparent"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="flex items-center gap-1.5 text-left text-lg font-semibold text-gray-900 truncate"
            >
              <span className="truncate">{basket.productName}</span>
              {savingName ? (
                <Loader2 className="h-3.5 w-3.5 text-gray-400 animate-spin shrink-0" />
              ) : (
                <Pencil className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              )}
            </button>
          )}
          {basket.name && (
            <p className="text-xs text-gray-500 truncate">{basket.name}</p>
          )}
        </div>
        <div className="text-right ml-2 shrink-0">
          <p className="text-[10px] font-bold uppercase text-gray-400">Counted</p>
          <p className="text-base font-bold tabular-nums text-gray-900">{countedSlots}/{TOTAL_SLOTS}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 grid-rows-2 gap-1.5 mb-2">
        <AnimatePresence>
          {Array.from({ length: TOTAL_SLOTS }, (_, i) => i + 1).map((slot) => {
            const value = trayCounts.get(slot);
            const counted = value !== undefined;
            const fillPercentage = counted ? Math.min(100, Math.max(0, (value / basket.vialsPerTray) * 100)) : 0;
            return (
              <motion.button
                key={slot}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: slot * 0.05 }}
                type="button"
                onClick={() => onSelectSlot(slot)}
                className={`relative h-12 rounded-md border-2 overflow-hidden flex items-center justify-center text-lg font-bold tabular-nums transition-colors ${
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
                <span className="z-10">{counted ? value : '—'}</span>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-auto">
        <Button
          variant="outline"
          className="h-11"
          onClick={onStartAiSequence}
          disabled={bulkSaving}
        >
          <Wand2 className="h-4 w-4 mr-1.5" /> AI Count All
        </Button>
        <Button
          className="h-11 bg-teal-600 hover:bg-teal-700 text-white"
          onClick={handleAllFull}
          disabled={bulkSaving}
        >
          {bulkSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <><Sparkles className="h-4 w-4 mr-1.5" /> All Full ({basket.vialsPerTray})</>
          )}
        </Button>
      </div>
    </div>
  );
}
