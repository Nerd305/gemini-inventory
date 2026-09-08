import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ChevronRight, Layers, Loader2, MapPin, Refrigerator, ScanLine } from 'lucide-react';
import { useCountingSession } from '../../contexts/CountingSessionContext';
import { subscribeAllBaskets, subscribeLocations, type BasketRecord, type FridgeLocation } from '../../lib/inventory';
import { primeAudio } from '../../lib/feedback';

function TypeIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'cabinet') return <Archive className={className} />;
  if (type === 'shelf') return <Layers className={className} />;
  return <Refrigerator className={className} />;
}

export default function FridgePicker() {
  const { selectFridge, countedBasketIds } = useCountingSession();
  const [locations, setLocations] = useState<FridgeLocation[] | null>(null);
  const [baskets, setBaskets] = useState<BasketRecord[]>([]);

  useEffect(() => subscribeLocations(setLocations, (e) => console.error('locations', e)), []);
  useEffect(() => subscribeAllBaskets(setBaskets, (e) => console.error('baskets', e)), []);

  const stats = useMemo(() => {
    const byLoc: Record<string, { total: number; counted: number }> = {};
    const counted = new Set(countedBasketIds);
    for (const b of baskets) {
      const s = (byLoc[b.locationId] ??= { total: 0, counted: 0 });
      s.total += 1;
      if (counted.has(b.id)) s.counted += 1;
    }
    return byLoc;
  }, [baskets, countedBasketIds]);

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center text-teal-700 mb-0.5">
          <ScanLine className="h-4 w-4 mr-1.5" />
          <span className="text-xs font-bold uppercase tracking-wide">Where are you counting?</span>
        </div>
        <p className="text-sm text-gray-600">Scan the fridge label, or tap a fridge below.</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1.5">
        {locations === null ? (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : locations.length === 0 ? (
          <div className="text-center py-8 px-4 text-gray-500">
            <MapPin className="h-8 w-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">No fridges yet.</p>
            <Link to="/locations" className="text-sm text-teal-700 underline">
              Add your fridges on the Locations page
            </Link>
          </div>
        ) : (
          locations.map((loc) => {
            const s = stats[loc.id];
            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => {
                  primeAudio();
                  selectFridge(loc);
                }}
                className="w-full flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-left active:bg-teal-50 active:border-teal-300 transition-colors"
              >
                <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <TypeIcon type={loc.type} className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 truncate">{loc.name}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {loc.shelfCount} shelves
                    {s ? ` · ${s.total} baskets` : ' · no baskets yet'}
                    {s && s.counted > 0 ? ` · ${s.counted} counted` : ''}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-300 shrink-0" />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
