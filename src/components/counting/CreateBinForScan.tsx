import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { Loader2, PackagePlus } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useLocations } from '../../hooks/useLocations';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { NEW_OPTION_VALUE, QuickCreateFridge, QuickCreateProduct } from '../QuickCreate';
import { clampInt, createBin, DEFAULT_VIALS_PER_TRAY, isReusableLabelId, MAX_TRAYS_PER_BIN, parseShelfId } from '../../lib/inventory';

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface ProductOption {
  id: string;
  name: string;
  category?: string;
}

/**
 * Shown in /count when a scanned BSKT: label has no bin behind it. Creates the bin with the
 * label's own ID, so the label already on the basket keeps working and the count carries on
 * without leaving the page.
 */
export default function CreateBinForScan({ basketId, shelfId }: { basketId: string; shelfId: string | null }) {
  const { user } = useAuth();
  const { locations, byId } = useLocations();
  const scannedShelf = parseShelfId(shelfId);

  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productId, setProductId] = useState('');
  const [locationId, setLocationId] = useState(scannedShelf?.locationId ?? '');
  const [shelfIndex, setShelfIndex] = useState<number | ''>(scannedShelf?.shelfIndex ?? '');
  const [trayCount, setTrayCount] = useState(1);
  const [vialsPerTray, setVialsPerTray] = useState(DEFAULT_VIALS_PER_TRAY);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [creatingFridge, setCreatingFridge] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'products')),
      (snap) => {
        const next: ProductOption[] = [];
        snap.forEach((d) => {
          const data = d.data() as { name?: string; category?: string };
          next.push({ id: d.id, name: data.name ?? d.id, category: data.category });
        });
        next.sort((a, b) => a.name.localeCompare(b.name));
        setProducts(next);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'products'),
    );
    return () => unsub();
  }, []);

  // Default to the only fridge when there is just one and no shelf was scanned.
  useEffect(() => {
    if (!locationId && locations.length === 1) setLocationId(locations[0].id);
  }, [locations, locationId]);

  const shelves = useMemo(() => {
    const n = clampInt(byId[locationId]?.shelfCount);
    return Array.from({ length: n }, (_, i) => i + 1);
  }, [byId, locationId]);

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category).filter((c): c is string => Boolean(c)))).sort(),
    [products],
  );

  if (!isReusableLabelId(basketId)) {
    return (
      <p className="text-xs text-gray-600">
        This label's ID can't be reused for a new bin. Create the bin under{' '}
        <Link to="/bins" className="underline text-teal-700">
          Bins
        </Link>{' '}
        and print a new label.
      </p>
    );
  }

  const save = async () => {
    if (!user) return;
    setError(null);
    const productName = products.find((p) => p.id === productId)?.name ?? '';
    setSaving(true);
    try {
      await createBin({
        id: basketId,
        productId,
        locationId,
        name: productName,
        shelfIndex: shelfIndex === '' ? null : shelfIndex,
        trayCount,
        vialsPerTray,
        looseVials: 0,
        userId: user.uid,
      });
      // The bottom panel is already listening to this bin and switches to it once it exists.
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `baskets/${basketId}`);
      setError(err instanceof Error ? err.message : 'Could not create the bin.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 text-left">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-0.5">
          <span className="text-[10px] font-bold uppercase text-gray-500">Product</span>
          <select
            className={selectClass}
            value={productId}
            onChange={(e) => {
              if (e.target.value === NEW_OPTION_VALUE) {
                setCreatingProduct(true);
                return;
              }
              setCreatingProduct(false);
              setProductId(e.target.value);
            }}
          >
            <option value="">Choose…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value={NEW_OPTION_VALUE}>+ New product…</option>
          </select>
        </label>
        <label className="space-y-0.5">
          <span className="text-[10px] font-bold uppercase text-gray-500">Fridge</span>
          <select
            className={selectClass}
            value={locationId}
            onChange={(e) => {
              if (e.target.value === NEW_OPTION_VALUE) {
                setCreatingFridge(true);
                return;
              }
              setCreatingFridge(false);
              setLocationId(e.target.value);
              setShelfIndex('');
            }}
          >
            <option value="">Choose…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
            <option value={NEW_OPTION_VALUE}>+ New fridge…</option>
          </select>
        </label>
      </div>

      {creatingProduct && (
        <QuickCreateProduct
          categories={categories}
          onCancel={() => setCreatingProduct(false)}
          onCreated={(id) => {
            setCreatingProduct(false);
            setProductId(id);
          }}
        />
      )}
      {creatingFridge && (
        <QuickCreateFridge
          onCancel={() => setCreatingFridge(false)}
          onCreated={(id) => {
            setCreatingFridge(false);
            setLocationId(id);
            setShelfIndex('');
          }}
        />
      )}

      <div className="grid grid-cols-3 gap-2">
        <label className="space-y-0.5">
          <span className="text-[10px] font-bold uppercase text-gray-500">Shelf</span>
          {shelves.length > 0 ? (
            <select
              className={selectClass}
              value={shelfIndex}
              onChange={(e) => setShelfIndex(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">—</option>
              {shelves.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          ) : (
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              className="h-9"
              value={shelfIndex}
              onChange={(e) => setShelfIndex(e.target.value === '' ? '' : clampInt(e.target.value, 1))}
            />
          )}
        </label>
        <label className="space-y-0.5">
          <span className="text-[10px] font-bold uppercase text-gray-500">Trays</span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_TRAYS_PER_BIN}
            className="h-9"
            value={trayCount}
            onChange={(e) => setTrayCount(clampInt(e.target.value, 0, MAX_TRAYS_PER_BIN))}
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-[10px] font-bold uppercase text-gray-500">Vials/tray</span>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            className="h-9"
            value={vialsPerTray}
            onChange={(e) => setVialsPerTray(clampInt(e.target.value, 1) || DEFAULT_VIALS_PER_TRAY)}
          />
        </label>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      <Button
        className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white"
        onClick={() => void save()}
        disabled={saving || !productId || !locationId || creatingProduct || creatingFridge}
      >
        {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PackagePlus className="h-4 w-4 mr-2" />}
        Create bin for this label
      </Button>
      <p className="text-[11px] text-gray-500">The label you just scanned stays valid. Lot / BUD can be added per tray while counting.</p>
    </div>
  );
}
