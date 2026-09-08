import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, Package, Plus, Printer } from 'lucide-react';
import { useCountingSession } from '../../contexts/CountingSessionContext';
import {
  basketTotal,
  formatTraysVials,
  subscribeBasketsForLocation,
  SLOT_POSITIONS,
  type BasketRecord,
} from '../../lib/inventory';
import { parseShelfId, shelfCode } from '../../lib/scanCodes';
import { useProducts } from '../../lib/useProducts';
import { primeAudio } from '../../lib/feedback';
import { LabelPrinter } from '../LabelPrinter';
import { Button } from '../ui/button';
import NewBasketSheet from './NewBasketSheet';

function lastCounted(iso: string | null): string {
  if (!iso) return 'never counted';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'never counted';
  return `${formatDistanceToNowStrict(t, { addSuffix: true })}`;
}

function BasketRow({
  basket,
  productName,
  counted,
  onOpen,
}: {
  basket: BasketRecord;
  productName: string;
  counted: boolean;
  onOpen: () => void;
}) {
  const total = basketTotal(basket);
  const slot = SLOT_POSITIONS.find((s) => s.value === basket.shelfPosition);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left active:scale-[0.99] transition-transform ${
        counted ? 'border-teal-300 bg-teal-50' : 'border-gray-200 bg-white active:bg-gray-50'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-gray-900 truncate leading-tight">{productName}</p>
        <p className="text-xs text-gray-500 truncate">
          {basket.lotNumber ? `Lot ${basket.lotNumber} · ` : ''}
          {slot ? `${slot.label} · ` : ''}
          {lastCounted(basket.lastCountedAt)}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-base font-bold tabular-nums text-gray-900">{total}</p>
        <p className="text-[11px] text-gray-500 whitespace-nowrap">{formatTraysVials(basket.trayCount, basket.looseVials)}</p>
      </div>
      {counted ? (
        <CheckCircle2 className="h-5 w-5 text-teal-600 shrink-0" />
      ) : (
        <ChevronRight className="h-5 w-5 text-gray-300 shrink-0" />
      )}
    </button>
  );
}

export default function ShelfBaskets() {
  const { fridge, shelfNumber, shelfId, selectBasket, countedBasketIds, notify } = useCountingSession();
  const { byId } = useProducts();
  const [baskets, setBaskets] = useState<BasketRecord[] | null>(null);
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [creating, setCreating] = useState(false);
  const [printShelf, setPrintShelf] = useState(false);
  const [printBasket, setPrintBasket] = useState<BasketRecord | null>(null);

  useEffect(() => {
    if (!fridge) return;
    setBaskets(null);
    return subscribeBasketsForLocation(fridge.id, setBaskets, (e) => console.error('baskets', e));
  }, [fridge]);

  const { onShelf, unassigned } = useMemo(() => {
    const onShelf: BasketRecord[] = [];
    const unassigned: BasketRecord[] = [];
    if (!fridge) return { onShelf, unassigned };
    for (const b of baskets ?? []) {
      const ref = parseShelfId(b.shelfId);
      const valid = ref && ref.locationId === fridge.id && ref.shelfNumber <= fridge.shelfCount;
      if (!valid) unassigned.push(b);
      else if (ref!.shelfNumber === shelfNumber) onShelf.push(b);
    }
    const sortFn = (a: BasketRecord, b: BasketRecord) => {
      const pa = a.shelfPosition ?? 99;
      const pb = b.shelfPosition ?? 99;
      if (pa !== pb) return pa - pb;
      return (byId[a.productId]?.name ?? a.name).localeCompare(byId[b.productId]?.name ?? b.name);
    };
    onShelf.sort(sortFn);
    unassigned.sort(sortFn);
    return { onShelf, unassigned };
  }, [baskets, fridge, shelfNumber, byId]);

  if (!fridge || shelfNumber === null) return null;

  const isUnassignedBucket = shelfNumber === 0;
  const list = isUnassignedBucket ? unassigned : onShelf;
  const counted = new Set(countedBasketIds);
  const nameOf = (b: BasketRecord) => byId[b.productId]?.name ?? b.name ?? 'Basket';
  const subtitle = isUnassignedBucket ? `${fridge.name} · not on a shelf` : `${fridge.name} · Shelf ${shelfNumber}`;

  if (creating) {
    return (
      <NewBasketSheet
        onClose={() => setCreating(false)}
        onCreated={(basket, print) => {
          setCreating(false);
          notify('basket', `Added ${basket.name} · ${formatTraysVials(basket.trayCount, basket.looseVials)}`);
          if (print) setPrintBasket(basket);
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center text-teal-700 mb-0.5">
            <Package className="h-4 w-4 mr-1.5 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wide truncate">{subtitle}</span>
          </div>
          <p className="text-sm text-gray-600">Scan a basket label, or tap a basket to count it.</p>
        </div>
        {!isUnassignedBucket && (
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => { primeAudio(); setPrintShelf(true); }} aria-label="Print shelf label">
            <Printer className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 space-y-1.5">
        {baskets === null ? (
          <div className="flex items-center justify-center py-6 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : list.length === 0 ? (
          <div className="text-center py-6 px-4 text-gray-500 text-sm">
            {isUnassignedBucket
              ? 'Every basket in this fridge is on a shelf.'
              : 'No baskets on this shelf yet. Scan a basket label to place one here, or add a new basket.'}
          </div>
        ) : (
          list.map((b) => (
            <BasketRow
              key={b.id}
              basket={b}
              productName={nameOf(b)}
              counted={counted.has(b.id)}
              onOpen={() => {
                primeAudio();
                selectBasket(b, { adoptLocation: false });
              }}
            />
          ))
        )}

        {!isUnassignedBucket && unassigned.length > 0 && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowUnassigned((v) => !v)}
              className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
            >
              <span>Not on a shelf yet ({unassigned.length})</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showUnassigned ? 'rotate-180' : ''}`} />
            </button>
            {showUnassigned && (
              <div className="mt-1.5 space-y-1.5">
                {unassigned.map((b) => (
                  <BasketRow
                    key={b.id}
                    basket={b}
                    productName={nameOf(b)}
                    counted={counted.has(b.id)}
                    onOpen={() => {
                      primeAudio();
                      selectBasket(b, { adoptLocation: false });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-3 pb-3 pt-1 border-t border-gray-100">
        <Button className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white" onClick={() => { primeAudio(); setCreating(true); }}>
          <Plus className="h-4 w-4 mr-1.5" /> New basket {isUnassignedBucket ? 'in this fridge' : 'on this shelf'}
        </Button>
      </div>

      {!isUnassignedBucket && shelfId && (
        <LabelPrinter
          isOpen={printShelf}
          onClose={() => setPrintShelf(false)}
          code={shelfCode(fridge.id, shelfNumber)}
          title={`Shelf ${shelfNumber}`}
          subtitle={fridge.name}
        />
      )}
      <LabelPrinter
        isOpen={!!printBasket}
        onClose={() => setPrintBasket(null)}
        code={printBasket?.qrCode ?? ''}
        title={printBasket ? nameOf(printBasket) : ''}
        subtitle={printBasket ? [subtitle, printBasket.lotNumber ? `Lot ${printBasket.lotNumber}` : ''].filter(Boolean).join(' · ') : ''}
      />
    </div>
  );
}
