import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Camera, Check, X, Sparkles, Pencil, Tag, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { handleFirestoreError, OperationType } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useCountingSession } from '../../contexts/CountingSessionContext';
import { Button } from '../ui/button';
import { countVialsInTray } from '../../lib/ai';
import { saveLearningRecord } from '../../lib/learning';
import {
  budStatus,
  daysUntilBud,
  formatBud,
  normalizeLabelDate,
  recordTrayCount,
  TRAY_GRID,
  type TrayDoc,
  type TrayLabelFields,
} from '../../lib/inventory';

interface TrayCountProps {
  basketId: string;
  productId: string;
  slot: number;
  trayCount: number;
  existing: TrayDoc | null;
  vialsPerTray: number;
  onAccept: (slot: number, count: number) => void;
  onCancel: () => void;
  sequenceLabel?: string;
}

/** Tiny pocket grid so the counter can sanity-check the number against the physical tray. */
function PocketGrid({ count, capacity }: { count: number; capacity: number }) {
  const cols = capacity === TRAY_GRID.rows * TRAY_GRID.cols ? TRAY_GRID.cols : Math.ceil(Math.sqrt(capacity));
  const cells = Math.min(capacity, 50);
  return (
    <div
      className="grid gap-[3px] shrink-0"
      style={{ gridTemplateColumns: `repeat(${cols}, 8px)` }}
      aria-label={`${count} of ${capacity} pockets filled`}
      title={`${count} of ${capacity} pockets filled`}
    >
      {Array.from({ length: cells }, (_, i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${i < count ? 'bg-teal-500' : 'bg-gray-200'} ${count > capacity ? 'ring-1 ring-red-400' : ''}`}
        />
      ))}
    </div>
  );
}

export default function TrayCount({
  basketId,
  productId,
  slot,
  trayCount,
  existing,
  vialsPerTray,
  onAccept,
  onCancel,
  sequenceLabel,
}: TrayCountProps) {
  const { user } = useAuth();
  const { sessionId } = useCountingSession();
  const [count, setCount] = useState<number>(existing?.count ?? vialsPerTray);
  const [label, setLabel] = useState<TrayLabelFields>({
    lotNumber: existing?.lotNumber,
    bud: existing?.bud,
    dateCompounded: existing?.dateCompounded,
    labelText: existing?.labelText,
  });
  const [editingLabel, setEditingLabel] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const aiPredictionRef = useRef<number | null>(null);
  const lastImageRef = useRef<string | undefined>(undefined);

  // Snapshots rebuild the tray map (new object identities) on every write to the bin; only reset
  // the editor when the slot or the stored values actually change.
  const existingKey = existing
    ? `${existing.count}|${existing.countedAt ?? ''}|${existing.lotNumber ?? ''}|${existing.bud ?? ''}|${existing.labelText ?? ''}`
    : 'none';

  useEffect(() => {
    setCount(existing?.count ?? vialsPerTray);
    setLabel({
      lotNumber: existing?.lotNumber,
      bud: existing?.bud,
      dateCompounded: existing?.dateCompounded,
      labelText: existing?.labelText,
    });
    setEditingLabel(false);
    setAiError(null);
    setAiNote(null);
    aiPredictionRef.current = null;
    lastImageRef.current = undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, existingKey, vialsPerTray]);

  const runAi = async (file: File) => {
    setAiLoading(true);
    setAiError(null);
    setAiNote(null);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Could not read image'));
        reader.readAsDataURL(file);
      });
      const result = await countVialsInTray(dataUrl, { capacity: vialsPerTray });
      setCount(result.vialCount);
      aiPredictionRef.current = result.vialCount;
      lastImageRef.current = dataUrl;
      if (result.label) {
        const l = result.label;
        setLabel((prev) => ({
          lotNumber: l.lotNumber ?? prev.lotNumber,
          bud: normalizeLabelDate(l.bud) ?? prev.bud,
          dateCompounded: normalizeLabelDate(l.dateCompounded) ?? prev.dateCompounded,
          labelText: [l.product, l.strength].filter(Boolean).join(' ') || prev.labelText,
        }));
      }
      setAiNote(
        `AI read ${result.vialCount} vials (${result.confidence} confidence)${result.label ? ' and the tray label' : ''}. Verify before accepting.`,
      );
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI count failed');
    } finally {
      setAiLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleAccept = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await recordTrayCount({
        basketId,
        slot,
        count,
        userId: user.uid,
        sessionId,
        previous: existing,
        aiPrediction: aiPredictionRef.current,
        label,
      });

      // Save learning record in background
      saveLearningRecord({
        imageBase64: lastImageRef.current,
        aiPrediction: aiPredictionRef.current || undefined,
        userFinalCount: count,
        productId,
        trayId: `slot-${slot}`,
        basketId,
        userId: user.uid,
      });

      onAccept(slot, count);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `baskets/${basketId}/trays/slot-${slot}`);
    } finally {
      setSaving(false);
    }
  };

  const dec = (n: number) => setCount((c) => Math.max(0, c - n));
  const inc = (n: number) => setCount((c) => c + n);

  const bud = budStatus(label.bud);
  const budDays = daysUntilBud(label.bud);
  const hasLabel = Boolean(label.lotNumber || label.bud || label.labelText);
  const overCapacity = count > vialsPerTray;

  const budText = useMemo(() => {
    if (!label.bud) return null;
    if (bud === 'expired') return `BUD ${formatBud(label.bud)} · expired`;
    if (bud === 'soon' && budDays !== null) return `BUD ${formatBud(label.bud)} · ${budDays}d left`;
    return `BUD ${formatBud(label.bud)}`;
  }, [label.bud, bud, budDays]);

  return (
    <div className="flex h-full flex-col px-4 py-2 overflow-y-auto">
      <div className="flex items-center justify-between mb-1">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-teal-700 truncate">
            Tray {slot} of {Math.max(trayCount, slot)}
            {sequenceLabel ? ` · ${sequenceLabel}` : ''}
          </p>
          <p className="text-[11px] text-gray-500">
            {existing ? `Previously ${existing.count}` : 'Not counted yet'} · full tray = {vialsPerTray}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onCancel} aria-label="Cancel">
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex items-center justify-center gap-1.5 my-1">
        <motion.div whileTap={{ scale: 0.9 }}>
          <Button variant="outline" className="h-11 w-11 px-0 text-sm" onClick={() => dec(5)}>-5</Button>
        </motion.div>
        <motion.div whileTap={{ scale: 0.9 }}>
          <Button variant="outline" className="h-11 w-11 px-0 text-base" onClick={() => dec(1)}>-1</Button>
        </motion.div>
        <input
          type="number"
          inputMode="numeric"
          value={count}
          onChange={(e) => setCount(Math.max(0, parseInt(e.target.value) || 0))}
          className={`h-12 w-20 rounded-md border text-center text-3xl font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-500 ${
            overCapacity ? 'border-red-400 text-red-700' : 'border-gray-300'
          }`}
        />
        <motion.div whileTap={{ scale: 0.9 }}>
          <Button variant="outline" className="h-11 w-11 px-0 text-base" onClick={() => inc(1)}>+1</Button>
        </motion.div>
        <motion.div whileTap={{ scale: 0.9 }}>
          <Button variant="outline" className="h-11 w-11 px-0 text-sm" onClick={() => inc(5)}>+5</Button>
        </motion.div>
        <div className="ml-2 hidden min-[380px]:block">
          <PocketGrid count={count} capacity={vialsPerTray} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 mb-1">
        <Button
          variant={count === vialsPerTray ? 'default' : 'secondary'}
          className={`h-10 ${count === vialsPerTray ? 'bg-teal-600 hover:bg-teal-700 text-white' : ''}`}
          onClick={() => setCount(vialsPerTray)}
          disabled={aiLoading}
        >
          <Sparkles className="h-4 w-4 mr-1" /> Full {vialsPerTray}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) runAi(f);
          }}
        />
        <Button variant="outline" className="h-10" onClick={() => fileRef.current?.click()} disabled={aiLoading}>
          {aiLoading ? (
            <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Counting…</>
          ) : (
            <><Camera className="h-4 w-4 mr-1" /> AI count</>
          )}
        </Button>
        <Button variant="secondary" className="h-10" onClick={() => setCount(0)} disabled={aiLoading}>
          Empty
        </Button>
      </div>

      {aiError && <p className="text-xs text-red-600 mb-1">{aiError}</p>}
      {aiNote && !aiError && <p className="text-[11px] text-teal-700 mb-1">{aiNote}</p>}
      {overCapacity && (
        <p className="text-[11px] text-red-600 mb-1 flex items-center">
          <AlertTriangle className="h-3 w-3 mr-1" /> More than a full tray ({vialsPerTray}). Double-check the count.
        </p>
      )}

      {/* Compounding label: lot / BUD read by the AI or typed in. */}
      {editingLabel ? (
        <div className="grid grid-cols-2 gap-1.5 mb-1.5">
          <input
            value={label.lotNumber ?? ''}
            onChange={(e) => setLabel((l) => ({ ...l, lotNumber: e.target.value }))}
            placeholder="Lot #"
            className="h-9 rounded-md border border-gray-300 px-2 text-sm"
          />
          <input
            type="date"
            value={/^\d{4}-\d{2}-\d{2}$/.test(label.bud ?? '') ? label.bud : ''}
            onChange={(e) => setLabel((l) => ({ ...l, bud: e.target.value || undefined }))}
            className="h-9 rounded-md border border-gray-300 px-2 text-sm"
            aria-label="Beyond-use date"
          />
          <input
            value={label.labelText ?? ''}
            onChange={(e) => setLabel((l) => ({ ...l, labelText: e.target.value }))}
            placeholder="Label text (product / strength)"
            className="h-9 rounded-md border border-gray-300 px-2 text-sm col-span-2"
          />
          <Button variant="ghost" size="sm" className="col-span-2 h-8" onClick={() => setEditingLabel(false)}>
            Done
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditingLabel(true)}
          className={`flex items-center gap-1.5 text-left text-[11px] mb-1.5 rounded px-1.5 py-1 border ${
            bud === 'expired'
              ? 'border-red-200 bg-red-50 text-red-700'
              : bud === 'soon'
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-gray-200 bg-gray-50 text-gray-600'
          }`}
        >
          <Tag className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {hasLabel
              ? [label.lotNumber ? `Lot ${label.lotNumber}` : null, budText, label.labelText]
                  .filter(Boolean)
                  .join(' · ')
              : 'No lot / BUD on file — tap to add (or use AI count with the label in frame)'}
          </span>
          <Pencil className="h-3 w-3 shrink-0 ml-auto" />
        </button>
      )}

      <div className="mt-auto">
        <Button
          className="w-full h-12 text-base bg-teal-600 hover:bg-teal-700 text-white"
          onClick={handleAccept}
          disabled={saving}
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Check className="h-5 w-5 mr-2" /> Accept {count}</>}
        </Button>
      </div>
    </div>
  );
}
