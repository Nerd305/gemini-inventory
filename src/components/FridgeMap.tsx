import { useMemo, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { Loader2, Printer, Tag } from 'lucide-react';
import { Button } from './ui/button';
import {
  basketTotal,
  formatTraysVials,
  SLOT_POSITIONS,
  type BasketRecord,
  type FridgeLocation,
  type ProductSummary,
} from '../lib/inventory';
import { parseShelfId, shelfCode } from '../lib/scanCodes';
import { describePrintError, enqueuePrintJob } from '../lib/printing';
import { DEFAULT_LABEL_FORMAT } from '../shared/labelFormats';

export interface PrintRequest {
  code: string;
  title: string;
  subtitle?: string;
}

interface FridgeMapProps {
  location: FridgeLocation;
  baskets: BasketRecord[];
  productsById: Record<string, ProductSummary>;
  onPrint: (req: PrintRequest) => void;
}

function lastCounted(iso: string | null): string {
  if (!iso) return 'never counted';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? formatDistanceToNowStrict(t, { addSuffix: true }) : 'never counted';
}

/**
 * Shelf-by-shelf view of one fridge, mirroring the physical layout
 * (back / front rows, left / right slots) with a print button per label.
 */
export default function FridgeMap({ location, baskets, productsById, onPrint }: FridgeMapProps) {
  const [batchState, setBatchState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [batchMessage, setBatchMessage] = useState<string | null>(null);

  const { byShelf, unassigned } = useMemo(() => {
    const byShelf: Record<number, BasketRecord[]> = {};
    const unassigned: BasketRecord[] = [];
    for (const b of baskets) {
      const ref = parseShelfId(b.shelfId);
      if (ref && ref.locationId === location.id && ref.shelfNumber >= 1 && ref.shelfNumber <= location.shelfCount) {
        (byShelf[ref.shelfNumber] ??= []).push(b);
      } else {
        unassigned.push(b);
      }
    }
    const sortFn = (a: BasketRecord, b: BasketRecord) => (a.shelfPosition ?? 99) - (b.shelfPosition ?? 99) || a.name.localeCompare(b.name);
    Object.values(byShelf).forEach((list) => list.sort(sortFn));
    unassigned.sort(sortFn);
    return { byShelf, unassigned };
  }, [baskets, location]);

  const nameOf = (b: BasketRecord) => productsById[b.productId]?.name ?? b.name ?? 'Basket';

  const printAllShelfLabels = async () => {
    if (!window.confirm(`Queue ${location.shelfCount} shelf labels for ${location.name}?`)) return;
    setBatchState('sending');
    setBatchMessage(null);
    try {
      for (let n = 1; n <= location.shelfCount; n++) {
        await enqueuePrintJob({
          code: shelfCode(location.id, n),
          title: `Shelf ${n}`,
          subtitle: location.name,
          format: DEFAULT_LABEL_FORMAT,
        });
      }
      setBatchState('done');
      setBatchMessage(`Queued ${location.shelfCount} shelf labels for the print station.`);
    } catch (err) {
      setBatchState('error');
      setBatchMessage(describePrintError(err, DEFAULT_LABEL_FORMAT));
    }
  };

  const BasketCard = ({ b }: { b: BasketRecord }) => {
    const slot = SLOT_POSITIONS.find((s) => s.value === b.shelfPosition);
    return (
      <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">{nameOf(b)}</p>
          <p className="text-xs text-gray-500 truncate">
            {b.lotNumber ? `Lot ${b.lotNumber} · ` : ''}
            {slot ? `${slot.label} · ` : ''}
            {formatTraysVials(b.trayCount, b.looseVials)} · <span className="font-medium text-gray-700">{basketTotal(b)}</span>
          </p>
          <p className="text-[11px] text-gray-400">{lastCounted(b.lastCountedAt)}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-gray-500"
          aria-label="Print basket label"
          onClick={() =>
            onPrint({
              code: b.qrCode,
              title: nameOf(b),
              subtitle: [location.name, parseShelfId(b.shelfId) ? `Shelf ${parseShelfId(b.shelfId)!.shelfNumber}` : null, b.lotNumber ? `Lot ${b.lotNumber}` : null]
                .filter(Boolean)
                .join(' · '),
            })
          }
        >
          <Printer className="h-4 w-4" />
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onPrint({ code: location.qrCode, title: location.name, subtitle: 'Fridge' })}>
          <Tag className="h-4 w-4 mr-1.5" /> Fridge label
        </Button>
        <Button variant="outline" size="sm" onClick={printAllShelfLabels} disabled={batchState === 'sending'}>
          {batchState === 'sending' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Printer className="h-4 w-4 mr-1.5" />}
          All {location.shelfCount} shelf labels
        </Button>
        {batchMessage && (
          <span className={`text-xs ${batchState === 'error' ? 'text-red-600' : 'text-green-700'}`}>{batchMessage}</span>
        )}
      </div>

      {Array.from({ length: location.shelfCount }, (_, i) => i + 1).map((n) => {
        const list = byShelf[n] ?? [];
        return (
          <div key={n} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Shelf {n}</p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-gray-500"
                onClick={() => onPrint({ code: shelfCode(location.id, n), title: `Shelf ${n}`, subtitle: location.name })}
              >
                <Printer className="h-3.5 w-3.5 mr-1" /> label
              </Button>
            </div>
            {list.length === 0 ? (
              <p className="text-xs text-gray-400 italic">empty</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {list.map((b) => (
                  <BasketCard key={b.id} b={b} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {unassigned.length > 0 && (
        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-800 mb-2">Not on a shelf ({unassigned.length})</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {unassigned.map((b) => (
              <BasketCard key={b.id} b={b} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
