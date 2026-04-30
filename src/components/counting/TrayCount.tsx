import { useEffect, useRef, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { Loader2, Camera, Check, X, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { countVialsInTray } from '../../lib/ai';
import { saveLearningRecord } from '../../lib/learning';
import { useCountingSession } from '../../contexts/CountingSessionContext';
import { increment, arrayUnion, updateDoc } from 'firebase/firestore';

interface TrayCountProps {
  basketId: string;
  slot: number;
  initialCount: number | null;
  vialsPerTray: number;
  onAccept: (count: number) => void;
  onCancel: () => void;
  sequenceLabel?: string;
}

export default function TrayCount({
  basketId,
  slot,
  initialCount,
  vialsPerTray,
  onAccept,
  onCancel,
  sequenceLabel,
}: TrayCountProps) {
  const { user } = useAuth();
  const { sessionId } = useCountingSession();
  const [count, setCount] = useState<number>(initialCount ?? vialsPerTray);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const aiPredictionRef = useRef<number | null>(null);
  const lastImageRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    setCount(initialCount ?? vialsPerTray);
    setAiError(null);
  }, [slot, initialCount, vialsPerTray]);

  const runAi = async (file: File) => {
    setAiLoading(true);
    setAiError(null);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Could not read image'));
        reader.readAsDataURL(file);
      });
      const result = await countVialsInTray(dataUrl);
      if (result && typeof result.vialCount === 'number') {
        setCount(result.vialCount);
        aiPredictionRef.current = result.vialCount;
        lastImageRef.current = dataUrl;
      }
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
      const trayDocRef = doc(db, 'baskets', basketId, 'trays', `slot-${slot}`);
      await setDoc(
        trayDocRef,
        {
          slot,
          count,
          countedAt: new Date().toISOString(),
          countedBy: user.uid,
        },
        { merge: true }
      );
      
      // Save learning record in background
      saveLearningRecord({
        imageBase64: lastImageRef.current,
        aiPrediction: aiPredictionRef.current || undefined,
        userFinalCount: count,
        productId: 'unknown', // Would come from basket context in real app
        trayId: `slot-${slot}`,
        basketId: basketId,
        userId: user.uid
      });
      
      // Update session progress
      if (sessionId) {
        try {
          const countDiff = count - (initialCount || 0);
          await updateDoc(doc(db, 'countingSessions', sessionId), {
            'progress.totalVials': increment(countDiff),
            countedBaskets: arrayUnion(basketId)
          });
        } catch (e) {
          console.error('Failed to update session progress', e);
        }
      }
      
      onAccept(count);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `baskets/${basketId}/trays/slot-${slot}`);
    } finally {
      setSaving(false);
    }
  };

  const dec = (n: number) => setCount((c) => Math.max(0, c - n));
  const inc = (n: number) => setCount((c) => c + n);

  return (
    <div className="flex h-full flex-col px-5 py-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-teal-700">
            Tray Slot {slot}{sequenceLabel ? ` · ${sequenceLabel}` : ''}
          </p>
          <p className="text-xs text-gray-500">
            {initialCount === null ? 'Not counted yet' : `Previously: ${initialCount}`}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onCancel} aria-label="Cancel">
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex items-center justify-center gap-2 my-2">
        <motion.div whileTap={{ scale: 0.9 }}>
          <Button variant="outline" className="h-12 w-12 text-base" onClick={() => dec(5)}>-5</Button>
        </motion.div>
        <motion.div whileTap={{ scale: 0.9 }}>
          <Button variant="outline" className="h-12 w-12 text-lg" onClick={() => dec(1)}>-1</Button>
        </motion.div>
        <motion.input
          animate={{ scale: [1, 1.02, 1], color: ['#111827', '#0d9488', '#111827'] }}
          transition={{ duration: 0.3 }}
          type="number"
          inputMode="numeric"
          value={count}
          onChange={(e) => setCount(Math.max(0, parseInt(e.target.value) || 0))}
          className="h-14 w-24 rounded-md border border-gray-300 text-center text-3xl font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <motion.div whileTap={{ scale: 0.9 }}>
          <Button variant="outline" className="h-12 w-12 text-lg" onClick={() => inc(1)}>+1</Button>
        </motion.div>
        <motion.div whileTap={{ scale: 0.9 }}>
          <Button variant="outline" className="h-12 w-12 text-base" onClick={() => inc(5)}>+5</Button>
        </motion.div>
      </div>

      <div className="flex items-center gap-2 mb-2">
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
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => fileRef.current?.click()}
          disabled={aiLoading}
        >
          {aiLoading ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Counting…</>
          ) : (
            <><Camera className="h-4 w-4 mr-2" /> AI Count This Tray</>
          )}
        </Button>
        <Button variant="secondary" onClick={() => setCount(vialsPerTray)} disabled={aiLoading}>
          <Sparkles className="h-4 w-4 mr-1" /> Full ({vialsPerTray})
        </Button>
        <Button variant="secondary" onClick={() => setCount(0)} disabled={aiLoading}>
          Empty
        </Button>
      </div>

      {aiError && (
        <p className="text-xs text-red-600 mb-1">{aiError}</p>
      )}

      <div className="mt-auto">
        <Button
          className="w-full h-12 text-base bg-teal-600 hover:bg-teal-700 text-white"
          onClick={handleAccept}
          disabled={saving}
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Check className="h-5 w-5 mr-2" /> Accept</>}
        </Button>
      </div>
    </div>
  );
}
