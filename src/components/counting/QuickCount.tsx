import { useEffect, useRef, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { ArrowLeft, Check, ChevronDown, Loader2, Printer, Sparkles, Ban, ArrowRightLeft } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useCountingSession } from '../../contexts/CountingSessionContext';
import {
  basketTotal,
  commitBasketCount,
  formatTraysVials,
  subscribeBasket,
  SLOT_POSITIONS,
  DEFAULT_VIALS_PER_TRAY,
  type BasketRecord,
} from '../../lib/inventory';
import { saveLearningRecord } from '../../lib/learning';
import { useProducts } from '../../lib/useProducts';
import { primeAudio } from '../../lib/feedback';
import { handleFirestoreError, OperationType } from '../../firebase';
import { LabelPrinter } from '../LabelPrinter';
import { Button } from '../ui/button';
import Stepper from './Stepper';
import AiCountButton, { type AiCountSample } from './AiCountButton';

/** A full bin in the pharmacy fridge holds 6 trays of 25 = 150 vials. */
const DEFAULT_TRAYS_PER_BASKET = 6;

interface QuickCountProps {
  basketId: string;
}

export default function QuickCount({ basketId }: QuickCountProps) {
  const { user } = useAuth();
  const { fridge, shelfNumber, shelfId, sessionId, selectBasket, notify } = useCountingSession();
  const { byId } = useProducts();

  const [basket, setBasket] = useState<BasketRecord | null | undefined>(undefined);
  const [trays, setTrays] = useState(0);
  const [loose, setLoose] = useState(0);
  const [vpt, setVpt] = useState(DEFAULT_VIALS_PER_TRAY);
  const [name, setName] = useState('');
  const [lot, setLot] = useState('');
  const [position, setPosition] = useState<number | null>(null);
  const [placeHere, setPlaceHere] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const aiSampleRef = useRef<AiCountSample | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    initialized.current = false;
    return subscribeBasket(
      basketId,
      (b) => {
        setBasket(b);
        if (b && !initialized.current) {
          initialized.current = true;
          setTrays(b.trayCount);
          setLoose(b.looseVials);
          setVpt(b.vialsPerTray);
          setName(b.name);
          setLot(b.lotNumber);
          setPosition(b.shelfPosition);
        }
      },
      (e) => {
        console.error('basket subscription', e);
        setError('Could not load this basket');
      },
    );
  }, [basketId]);

  if (basket === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (basket === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center text-gray-600">
        <p className="text-sm">This basket no longer exists.</p>
        <Button variant="outline" className="mt-3" onClick={() => selectBasket(null)}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
        </Button>
      </div>
    );
  }

  const productName = byId[basket.productId]?.name ?? basket.name ?? 'Basket';
  const targetShelfId = fridge && shelfNumber !== null && shelfNumber > 0 ? shelfId : null;
  const needsShelfMove = !!targetShelfId && basket.shelfId !== targetShelfId;
  const needsFridgeMove = !!fridge && basket.locationId !== fridge.id;
  const offerMove = needsShelfMove || needsFridgeMove;

  const total = trays * vpt + loose;
  const prevTotal = basketTotal(basket);
  const delta = total - prevTotal;
  const extraTrays = vpt > 0 ? Math.floor(loose / vpt) : 0;

  const whereLine = [
    fridge?.name,
    shelfNumber !== null && shelfNumber > 0 ? `Shelf ${shelfNumber}` : null,
    basket.lotNumber ? `Lot ${basket.lotNumber}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const lastCounted = basket.lastCountedAt && Number.isFinite(Date.parse(basket.lastCountedAt))
    ? `counted ${formatDistanceToNowStrict(Date.parse(basket.lastCountedAt), { addSuffix: true })}`
    : 'never counted';

  const handleAccept = async () => {
    if (!user) return;
    primeAudio();
    setSaving(true);
    setError(null);
    try {
      const moving = offerMove && placeHere && fridge;
      const result = await commitBasketCount({
        basketId,
        trayCount: trays,
        looseVials: loose,
        vialsPerTray: vpt,
        userId: user.uid,
        sessionId,
        locationId: moving ? fridge.id : undefined,
        shelfId: moving && targetShelfId ? targetShelfId : undefined,
        shelfPosition: position ?? undefined,
        name: name.trim() && name.trim() !== basket.name ? name.trim() : undefined,
        lotNumber: lot.trim() !== basket.lotNumber ? lot.trim() : undefined,
        note: aiSampleRef.current ? `AI suggested ${aiSampleRef.current.prediction} loose` : undefined,
      });
      if (aiSampleRef.current) {
        saveLearningRecord({
          imageBase64: aiSampleRef.current.imageBase64,
          aiPrediction: aiSampleRef.current.prediction,
          userFinalCount: loose,
          productId: basket.productId,
          trayId: 'loose',
          basketId,
          userId: user.uid,
        });
      }
      notify('basket', `Saved ${productName}: ${formatTraysVials(trays, loose)} = ${result.newTotal}`);
      await selectBasket(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `baskets/${basketId}`);
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="px-3 pt-2 pb-1 flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => selectBasket(null)} aria-label="Back to shelf">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 truncate leading-tight">{productName}</p>
          <p className="text-[11px] text-gray-500 truncate">
            {whereLine ? `${whereLine} · ` : ''}
            {lastCounted}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => { primeAudio(); setPrintOpen(true); }} aria-label="Print basket label">
          <Printer className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 space-y-3">
        {offerMove && fridge && (
          <label className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
            <input type="checkbox" className="h-4 w-4" checked={placeHere} onChange={(e) => setPlaceHere(e.target.checked)} />
            <ArrowRightLeft className="h-4 w-4 shrink-0" />
            <span className="min-w-0">
              Place on <span className="font-semibold">{fridge.name}{targetShelfId ? ` · Shelf ${shelfNumber}` : ''}</span>
            </span>
          </label>
        )}

        <Stepper label="Full trays" hint={`× ${vpt} vials`} value={trays} onChange={setTrays} max={99} />
        <Stepper label="Loose vials" hint="partial tray" value={loose} onChange={setLoose} bigStep={5} max={999} accent="amber" />

        {extraTrays > 0 && (
          <button
            type="button"
            onClick={() => {
              setTrays(trays + extraTrays);
              setLoose(loose - extraTrays * vpt);
            }}
            className="w-full text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2 text-left"
          >
            {loose} loose ≥ {vpt}: tap to convert into {extraTrays} more {extraTrays === 1 ? 'tray' : 'trays'} + {loose - extraTrays * vpt} loose
          </button>
        )}

        <div className="grid grid-cols-3 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => {
              setTrays(0);
              setLoose(0);
            }}
          >
            <Ban className="h-4 w-4 mr-1.5" /> Empty
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => {
              setTrays(DEFAULT_TRAYS_PER_BASKET);
              setLoose(0);
            }}
          >
            <Sparkles className="h-4 w-4 mr-1.5" /> Full ({DEFAULT_TRAYS_PER_BASKET})
          </Button>
          <AiCountButton
            label="AI loose"
            onResult={(sample) => {
              aiSampleRef.current = sample;
              setLoose(sample.prediction);
              notify('info', `AI counted ${sample.prediction} loose vials${sample.confidence ? ` (${sample.confidence})` : ''}`);
            }}
            onError={(msg) => setError(msg)}
          />
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500 py-1"
          >
            <span>Details · lot, slot, vials per tray</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
          </button>
          {showDetails && (
            <div className="space-y-2 rounded-lg border border-gray-200 p-3">
              <label className="block text-xs text-gray-600">
                Basket name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-gray-600">
                  Lot number
                  <input
                    value={lot}
                    onChange={(e) => setLot(e.target.value)}
                    placeholder="optional"
                    className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
                  />
                </label>
                <label className="block text-xs text-gray-600">
                  Vials per tray
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={vpt}
                    onChange={(e) => setVpt(Math.max(1, parseInt(e.target.value, 10) || DEFAULT_VIALS_PER_TRAY))}
                    className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 text-sm tabular-nums"
                  />
                </label>
              </div>
              <div>
                <p className="text-xs text-gray-600 mb-1">Slot on shelf</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {SLOT_POSITIONS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setPosition(position === s.value ? null : s.value)}
                      className={`h-9 rounded-md border text-xs font-semibold ${
                        position === s.value ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-gray-300 text-gray-700'
                      }`}
                    >
                      {s.short}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{error}</p>}
      </div>

      {/* Footer */}
      <div className="px-3 pb-3 pt-2 border-t border-gray-100 flex items-center gap-3">
        <div className="min-w-0">
          <p className="text-2xl font-bold tabular-nums text-gray-900 leading-none">{total}</p>
          <p className="text-[11px] text-gray-500 truncate">
            vials · {formatTraysVials(trays, loose)}
            {basket.lastCountedAt ? (
              <span className={delta === 0 ? '' : delta > 0 ? ' text-green-700' : ' text-red-700'}>
                {' '}({delta > 0 ? '+' : ''}{delta} vs last)
              </span>
            ) : null}
          </p>
        </div>
        <Button
          className="flex-1 h-12 text-base bg-teal-600 hover:bg-teal-700 text-white"
          onClick={handleAccept}
          disabled={saving}
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Check className="h-5 w-5 mr-2" /> Save count</>}
        </Button>
      </div>

      <LabelPrinter
        isOpen={printOpen}
        onClose={() => setPrintOpen(false)}
        code={basket.qrCode}
        title={productName}
        subtitle={whereLine}
      />
    </div>
  );
}
