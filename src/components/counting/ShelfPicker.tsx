import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Layers, Loader2, Printer, Tag } from 'lucide-react';
import { useCountingSession } from '../../contexts/CountingSessionContext';
import { subscribeBasketsForLocation, type BasketRecord } from '../../lib/inventory';
import { fridgeCode, parseShelfId, shelfCode } from '../../lib/scanCodes';
import { enqueuePrintJob, describePrintError } from '../../lib/printing';
import { DEFAULT_LABEL_FORMAT } from '../../shared/labelFormats';
import { LabelPrinter } from '../LabelPrinter';
import { Button } from '../ui/button';
import { primeAudio } from '../../lib/feedback';

export default function ShelfPicker() {
  const { fridge, selectShelf, countedBasketIds, notify } = useCountingSession();
  const [baskets, setBaskets] = useState<BasketRecord[] | null>(null);
  const [printFridge, setPrintFridge] = useState(false);
  const [printingShelves, setPrintingShelves] = useState(false);

  useEffect(() => {
    if (!fridge) return;
    setBaskets(null);
    return subscribeBasketsForLocation(fridge.id, setBaskets, (e) => console.error('baskets', e));
  }, [fridge]);

  const perShelf = useMemo(() => {
    const counted = new Set(countedBasketIds);
    const map: Record<number, { total: number; counted: number }> = {};
    let unassigned = { total: 0, counted: 0 };
    if (!fridge) return { map, unassigned };
    for (const b of baskets ?? []) {
      const ref = parseShelfId(b.shelfId);
      const bucket =
        ref && ref.locationId === fridge.id && ref.shelfNumber <= fridge.shelfCount
          ? (map[ref.shelfNumber] ??= { total: 0, counted: 0 })
          : unassigned;
      bucket.total += 1;
      if (counted.has(b.id)) bucket.counted += 1;
    }
    return { map, unassigned };
  }, [baskets, countedBasketIds, fridge]);

  if (!fridge) return null;

  const shelves = Array.from({ length: fridge.shelfCount }, (_, i) => i + 1);

  const printShelfLabels = async () => {
    primeAudio();
    if (!window.confirm(`Queue ${fridge.shelfCount} shelf labels for ${fridge.name} on the ${DEFAULT_LABEL_FORMAT}" printer?`)) return;
    setPrintingShelves(true);
    try {
      for (const n of shelves) {
        await enqueuePrintJob({
          code: shelfCode(fridge.id, n),
          title: `Shelf ${n}`,
          subtitle: fridge.name,
          format: DEFAULT_LABEL_FORMAT,
        });
      }
      notify('info', `Queued ${fridge.shelfCount} shelf labels`);
    } catch (err) {
      notify('error', describePrintError(err, DEFAULT_LABEL_FORMAT));
    } finally {
      setPrintingShelves(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center text-teal-700 mb-0.5">
          <Layers className="h-4 w-4 mr-1.5" />
          <span className="text-xs font-bold uppercase tracking-wide">{fridge.name}</span>
        </div>
        <p className="text-sm text-gray-600">Scan a shelf label, or tap the shelf you're on.</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
        {baskets === null ? (
          <div className="flex items-center justify-center py-6 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {shelves.map((n) => {
              const s = perShelf.map[n];
              const done = s && s.total > 0 && s.counted >= s.total;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    primeAudio();
                    selectShelf(n);
                  }}
                  className={`rounded-xl border px-3 py-3 text-left active:scale-[0.98] transition-transform ${
                    done ? 'border-teal-300 bg-teal-50' : 'border-gray-200 bg-white active:bg-teal-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold text-gray-900">Shelf {n}</span>
                    {done && <CheckCircle2 className="h-5 w-5 text-teal-600" />}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {s ? `${s.counted}/${s.total} counted` : 'no baskets yet'}
                  </p>
                </button>
              );
            })}
            {perShelf.unassigned.total > 0 && (
              <button
                type="button"
                onClick={() => {
                  primeAudio();
                  selectShelf(0);
                }}
                className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-3 text-left active:scale-[0.98] transition-transform col-span-2"
              >
                <span className="text-base font-bold text-amber-900">Not on a shelf yet</span>
                <p className="text-xs text-amber-800 mt-0.5">
                  {perShelf.unassigned.total} baskets in this fridge without a shelf · open one to place it
                </p>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="px-3 pb-3 pt-1 flex gap-2 border-t border-gray-100">
        <Button variant="outline" size="sm" className="flex-1 h-10" onClick={() => { primeAudio(); setPrintFridge(true); }}>
          <Tag className="h-4 w-4 mr-1.5" /> Fridge label
        </Button>
        <Button variant="outline" size="sm" className="flex-1 h-10" onClick={printShelfLabels} disabled={printingShelves}>
          {printingShelves ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Printer className="h-4 w-4 mr-1.5" />}
          {fridge.shelfCount} shelf labels
        </Button>
      </div>

      <LabelPrinter
        isOpen={printFridge}
        onClose={() => setPrintFridge(false)}
        code={fridge.qrCode || fridgeCode(fridge.id)}
        title={fridge.name}
        subtitle="Fridge"
      />
    </div>
  );
}
