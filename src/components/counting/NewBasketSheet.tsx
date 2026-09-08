import { useMemo, useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';
import { Check, Loader2, Plus, Printer, Search, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useCountingSession } from '../../contexts/CountingSessionContext';
import { createBasket, DEFAULT_VIALS_PER_TRAY, SLOT_POSITIONS, type BasketRecord } from '../../lib/inventory';
import { useProducts } from '../../lib/useProducts';
import { primeAudio } from '../../lib/feedback';
import { Button } from '../ui/button';
import Stepper from './Stepper';

interface NewBasketSheetProps {
  onClose: () => void;
  onCreated: (basket: BasketRecord, print: boolean) => void;
}

/**
 * Register a new basket (a bin, or one lot inside a shared bin) right where you
 * stand: pick the product, type the count, save, and optionally print its label.
 */
export default function NewBasketSheet({ onClose, onCreated }: NewBasketSheetProps) {
  const { user } = useAuth();
  const { fridge, shelfNumber, shelfId, sessionId } = useCountingSession();
  const { products, loading } = useProducts();

  const [search, setSearch] = useState('');
  const [productId, setProductId] = useState<string | null>(null);
  const [lot, setLot] = useState('');
  const [position, setPosition] = useState<number | null>(null);
  const [trays, setTrays] = useState(0);
  const [loose, setLoose] = useState(0);
  const [vpt, setVpt] = useState(DEFAULT_VIALS_PER_TRAY);
  const [saving, setSaving] = useState<null | 'save' | 'print'>(null);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => products.find((p) => p.id === productId) ?? null, [products, productId]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, 8);
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [products, search]);

  const exactMatch = useMemo(
    () => products.some((p) => p.name.trim().toLowerCase() === search.trim().toLowerCase()),
    [products, search],
  );

  const quickCreateProduct = async () => {
    const name = search.trim();
    if (!name) return;
    setCreatingProduct(true);
    setError(null);
    try {
      const ref = await addDoc(collection(db, 'products'), {
        name,
        category: 'Uncategorized',
        description: '',
        reorderPoint: 0,
        currentStock: 0,
        qrCode: `PRODUCT:${Date.now()}`,
        createdAt: new Date().toISOString(),
      });
      setProductId(ref.id);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'products');
      setError(err instanceof Error ? err.message : 'Could not create product');
    } finally {
      setCreatingProduct(false);
    }
  };

  const save = async (print: boolean) => {
    if (!user || !fridge || !selected) return;
    primeAudio();
    setSaving(print ? 'print' : 'save');
    setError(null);
    try {
      const basket = await createBasket({
        productId: selected.id,
        productName: selected.name,
        locationId: fridge.id,
        shelfId: shelfNumber !== null && shelfNumber > 0 ? shelfId : null,
        shelfPosition: position,
        lotNumber: lot,
        trayCount: trays,
        looseVials: loose,
        vialsPerTray: vpt,
        userId: user.uid,
        sessionId,
      });
      onCreated(basket, print);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'baskets');
      setError(err instanceof Error ? err.message : 'Could not create basket');
      setSaving(null);
    }
  };

  const where = fridge ? `${fridge.name}${shelfNumber ? ` · Shelf ${shelfNumber}` : ''}` : '';

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-2 pb-1 flex items-center gap-1">
        <div className="min-w-0 flex-1 pl-2">
          <p className="text-xs font-bold uppercase tracking-wide text-teal-700">New basket</p>
          <p className="text-[11px] text-gray-500 truncate">{where}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onClose} aria-label="Cancel">
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 space-y-3">
        {/* Product */}
        {selected ? (
          <div className="flex items-center gap-2 rounded-lg border border-teal-300 bg-teal-50 px-3 py-2">
            <Check className="h-4 w-4 text-teal-700 shrink-0" />
            <span className="font-semibold text-gray-900 truncate flex-1">{selected.name}</span>
            <button type="button" className="text-xs text-teal-800 underline" onClick={() => setProductId(null)}>
              change
            </button>
          </div>
        ) : (
          <div>
            <div className="relative">
              <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search product (e.g. BPC-157)"
                className="h-11 w-full rounded-lg border border-gray-300 pl-9 pr-3 text-sm"
              />
            </div>
            <div className="mt-1.5 rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {loading ? (
                <div className="flex justify-center py-3 text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /></div>
              ) : (
                <>
                  {matches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setProductId(p.id)}
                      className="w-full text-left px-3 py-2.5 text-sm active:bg-teal-50"
                    >
                      <span className="font-medium text-gray-900">{p.name}</span>
                      {p.category && <span className="text-xs text-gray-400 ml-2">{p.category}</span>}
                    </button>
                  ))}
                  {search.trim() && !exactMatch && (
                    <button
                      type="button"
                      onClick={quickCreateProduct}
                      disabled={creatingProduct}
                      className="w-full text-left px-3 py-2.5 text-sm text-teal-800 bg-teal-50/60 flex items-center"
                    >
                      {creatingProduct ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
                      Create product “{search.trim()}”
                    </button>
                  )}
                  {!search.trim() && matches.length === 0 && (
                    <p className="px-3 py-2.5 text-xs text-gray-500">No products yet — type a name to create one.</p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

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

        <Stepper label="Full trays" hint={`× ${vpt} vials`} value={trays} onChange={setTrays} max={99} />
        <Stepper label="Loose vials" hint="partial tray" value={loose} onChange={setLoose} bigStep={5} max={999} accent="amber" />

        <div>
          <p className="text-xs text-gray-600 mb-1">Slot on shelf (optional)</p>
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
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{error}</p>}
      </div>

      <div className="px-3 pb-3 pt-2 border-t border-gray-100 flex items-center gap-2">
        <div className="min-w-0 mr-1">
          <p className="text-xl font-bold tabular-nums text-gray-900 leading-none">{trays * vpt + loose}</p>
          <p className="text-[11px] text-gray-500">vials</p>
        </div>
        <Button variant="outline" className="flex-1 h-12" onClick={() => save(false)} disabled={!selected || !fridge || saving !== null}>
          {saving === 'save' ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Check className="h-4 w-4 mr-1.5" /> Save</>}
        </Button>
        <Button className="flex-1 h-12 bg-teal-600 hover:bg-teal-700 text-white" onClick={() => save(true)} disabled={!selected || !fridge || saving !== null}>
          {saving === 'print' ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Printer className="h-4 w-4 mr-1.5" /> Save & print</>}
        </Button>
      </div>
    </div>
  );
}
