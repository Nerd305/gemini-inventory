import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc } from 'firebase/firestore';
import { formatDistanceToNow } from 'date-fns';
import {
  Archive,
  Boxes,
  Filter,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Refrigerator,
  Search,
  Send,
  Trash2,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocations } from '../hooks/useLocations';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { LabelPrinter } from '../components/LabelPrinter';
import { HelpTooltip } from '../components/HelpTooltip';
import {
  basketQrCode,
  basketTotal,
  budStatus,
  clampInt,
  DEFAULT_VIALS_PER_TRAY,
  describeShelf,
  formatBud,
  makeShelfId,
  parseShelfId,
  trayQrCode,
  updateBasket,
  type BasketDoc,
  type TrayDoc,
} from '../lib/inventory';
import { LABEL_FORMAT_OPTIONS, sendPrintJobs } from '../lib/printing';
import type { LabelFormat } from '../shared/types';

interface BinRecord extends BasketDoc {
  id: string;
}

interface ProductOption {
  id: string;
  name: string;
  category?: string;
}

interface BinForm {
  productId: string;
  name: string;
  locationId: string;
  shelfIndex: number | '';
  trayCount: number;
  vialsPerTray: number;
  looseVials: number;
}

const EMPTY_FORM: BinForm = {
  productId: '',
  name: '',
  locationId: '',
  shelfIndex: '',
  trayCount: 1,
  vialsPerTray: DEFAULT_VIALS_PER_TRAY,
  looseVials: 0,
};

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

function lastCountedText(iso?: string): { text: string; stale: boolean } {
  if (!iso) return { text: 'never counted', stale: true };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: 'never counted', stale: true };
  const ageDays = (Date.now() - d.getTime()) / 86_400_000;
  return { text: `counted ${formatDistanceToNow(d)} ago`, stale: ageDays > 7 };
}

export default function Bins() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const { locations, byId: locationsById, nameOf } = useLocations();

  const [bins, setBins] = useState<BinRecord[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BinRecord | null>(null);
  const [form, setForm] = useState<BinForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [printData, setPrintData] = useState<{ code: string; title: string; subtitle?: string } | null>(null);
  const [detailBin, setDetailBin] = useState<BinRecord | null>(null);
  const [detailTrays, setDetailTrays] = useState<TrayDoc[]>([]);
  const [trayLabelFormat, setTrayLabelFormat] = useState<LabelFormat>('2.5x1.5');
  const [sendingLabels, setSendingLabels] = useState(false);
  const [labelStatus, setLabelStatus] = useState<string | null>(null);

  useEffect(() => {
    const unsubBins = onSnapshot(
      query(collection(db, 'baskets')),
      (snap) => {
        const next: BinRecord[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as BasketDoc) }));
        setBins(next);
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'baskets');
        setLoading(false);
      },
    );
    const unsubProducts = onSnapshot(
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
      (error) => handleFirestoreError(error, OperationType.LIST, 'products'),
    );
    return () => {
      unsubBins();
      unsubProducts();
    };
  }, []);

  // Tray subcollection for the detail dialog.
  useEffect(() => {
    if (!detailBin) {
      setDetailTrays([]);
      return;
    }
    const unsub = onSnapshot(collection(db, 'baskets', detailBin.id, 'trays'), (snap) => {
      const next: TrayDoc[] = [];
      snap.forEach((d) => {
        const t = d.data() as TrayDoc;
        if (typeof t.slot === 'number') next.push(t);
      });
      next.sort((a, b) => a.slot - b.slot);
      setDetailTrays(next);
    });
    return () => unsub();
  }, [detailBin?.id]);

  // Keep the detail dialog's bin fresh when the list updates.
  useEffect(() => {
    if (!detailBin) return;
    const fresh = bins.find((b) => b.id === detailBin.id);
    if (fresh && fresh !== detailBin) setDetailBin(fresh);
    if (!fresh) setDetailBin(null);
  }, [bins]);

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? '(unknown product)';

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return bins.filter((b) => {
      if (locationFilter !== 'all' && b.locationId !== locationFilter) return false;
      if (!term) return true;
      const hay = `${b.name} ${productName(b.productId)} ${b.qrCode}`.toLowerCase();
      return hay.includes(term);
    });
  }, [bins, search, locationFilter, products]);

  /** Fridge → shelf → bins, in physical order (shelf 1 = top). */
  const grouped = useMemo(() => {
    const byLocation = new Map<string, Map<string, BinRecord[]>>();
    for (const b of filtered) {
      const loc = b.locationId || 'unassigned';
      const shelf = b.shelfId || '';
      if (!byLocation.has(loc)) byLocation.set(loc, new Map());
      const shelves = byLocation.get(loc)!;
      if (!shelves.has(shelf)) shelves.set(shelf, []);
      shelves.get(shelf)!.push(b);
    }
    const locationOrder = Array.from(byLocation.keys()).sort((a, b) =>
      (locationsById[a]?.name ?? 'zzz').localeCompare(locationsById[b]?.name ?? 'zzz'),
    );
    return locationOrder.map((locationId) => {
      const shelves = byLocation.get(locationId)!;
      const shelfOrder = Array.from(shelves.keys()).sort((a, b) => {
        const pa = parseShelfId(a)?.shelfIndex ?? 999;
        const pb = parseShelfId(b)?.shelfIndex ?? 999;
        return pa - pb || a.localeCompare(b);
      });
      return {
        locationId,
        locationName: locationsById[locationId]?.name ?? (locationId === 'unassigned' ? 'Unassigned' : 'Unknown location'),
        shelves: shelfOrder.map((shelfId) => ({
          shelfId,
          bins: shelves
            .get(shelfId)!
            .sort((a, b) => (a.shelfPosition ?? 99) - (b.shelfPosition ?? 99) || productName(a.productId).localeCompare(productName(b.productId))),
        })),
      };
    });
  }, [filtered, locationsById, products]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...EMPTY_FORM,
      locationId: locations[0]?.id ?? '',
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (bin: BinRecord) => {
    setEditing(bin);
    setForm({
      productId: bin.productId,
      name: bin.name,
      locationId: bin.locationId,
      shelfIndex: parseShelfId(bin.shelfId)?.shelfIndex ?? '',
      trayCount: clampInt(bin.trayCount),
      vialsPerTray: clampInt(bin.vialsPerTray, 1) || DEFAULT_VIALS_PER_TRAY,
      looseVials: clampInt(bin.looseVials),
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const shelfOptions = (locationId: string): number[] => {
    const n = clampInt(locationsById[locationId]?.shelfCount);
    return Array.from({ length: n }, (_, i) => i + 1);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!form.productId) return setFormError('Pick a product.');
    if (!form.locationId) return setFormError('Pick a fridge / location.');
    const name = form.name.trim() || productName(form.productId);
    const shelfId = form.shelfIndex === '' ? undefined : makeShelfId(form.locationId, Number(form.shelfIndex));

    setSaving(true);
    try {
      if (editing) {
        await updateBasket(editing.id, {
          productId: form.productId,
          locationId: form.locationId,
          name,
          trayCount: clampInt(form.trayCount),
          vialsPerTray: clampInt(form.vialsPerTray, 1) || DEFAULT_VIALS_PER_TRAY,
          looseVials: clampInt(form.looseVials),
          shelfId,
        });
        if (shelfId === undefined && editing.shelfId) {
          // updateBasket drops undefined keys; explicitly clear a removed shelf assignment.
          await setDoc(doc(db, 'baskets', editing.id), { shelfId: '' }, { merge: true });
        }
      } else {
        const ref = doc(collection(db, 'baskets'));
        const now = new Date().toISOString();
        await setDoc(ref, {
          productId: form.productId,
          locationId: form.locationId,
          name,
          trayCount: clampInt(form.trayCount),
          vialsPerTray: clampInt(form.vialsPerTray, 1) || DEFAULT_VIALS_PER_TRAY,
          looseVials: clampInt(form.looseVials),
          qrCode: basketQrCode(ref.id),
          ...(shelfId ? { shelfId } : {}),
          createdAt: now,
          updatedAt: now,
        });
        setPrintData({
          code: basketQrCode(ref.id),
          title: name,
          subtitle: describeShelf(shelfId, nameOf) || nameOf(form.locationId) || '',
        });
      }
      setDialogOpen(false);
      setEditing(null);
    } catch (error) {
      handleFirestoreError(error, editing ? OperationType.UPDATE : OperationType.CREATE, 'baskets');
      setFormError('Could not save the bin. Check your connection and permissions.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (bin: BinRecord) => {
    if (!window.confirm(`Delete bin "${bin.name}"? Its tray counts will be lost.`)) return;
    try {
      await deleteDoc(doc(db, 'baskets', bin.id));
      setDetailBin(null);
      setDialogOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `baskets/${bin.id}`);
      alert('Delete failed. Only admins can delete bins.');
    }
  };

  const printBinLabel = (bin: BinRecord) => {
    setPrintData({
      code: basketQrCode(bin.id),
      title: bin.name || productName(bin.productId),
      subtitle: [productName(bin.productId) !== bin.name ? productName(bin.productId) : null, describeShelf(bin.shelfId, nameOf) || nameOf(bin.locationId)]
        .filter(Boolean)
        .join(' · '),
    });
  };

  const sendTrayLabels = async (bin: BinRecord) => {
    const count = clampInt(bin.trayCount);
    if (count === 0) {
      setLabelStatus('Set the tray count first.');
      return;
    }
    setSendingLabels(true);
    setLabelStatus(null);
    try {
      const title = bin.name || productName(bin.productId);
      const labels = Array.from({ length: count }, (_, i) => ({
        code: trayQrCode(bin.id, i + 1),
        title: `${title} · Tray ${i + 1}`,
        subtitle: `of ${count} · ${bin.vialsPerTray}/tray`,
      }));
      const sent = await sendPrintJobs(labels, trayLabelFormat);
      setLabelStatus(`Sent ${sent} tray label${sent === 1 ? '' : 's'} to the Print Station.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'printJobs');
      setLabelStatus('Failed to queue tray labels.');
    } finally {
      setSendingLabels(false);
    }
  };

  const totalVialsShown = filtered.reduce((s, b) => s + basketTotal(b), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            Bins
            <HelpTooltip content="A bin is the plastic basket that sits on a fridge shelf and holds trays of one product. Each bin gets a BSKT: QR label; scanning it during a count opens that bin's trays." />
          </h1>
          <p className="text-sm text-gray-500">
            {bins.length} bin{bins.length === 1 ? '' : 's'} · {totalVialsShown.toLocaleString()} vials on hand (last known)
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Add Bin
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 bg-white p-4 rounded-lg border shadow-sm">
        <div className="flex-1 space-y-1">
          <Label className="text-xs text-gray-500 flex items-center">
            <Search className="h-3 w-3 mr-1" /> Search
          </Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Product, bin name…" />
        </div>
        <div className="flex-1 space-y-1">
          <Label className="text-xs text-gray-500 flex items-center">
            <Filter className="h-3 w-3 mr-1" /> Fridge
          </Label>
          <select className={selectClass} value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
            <option value="all">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Archive className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900">No bins yet</h3>
            <p className="text-gray-500 mt-1 max-w-md">
              Add a bin for each basket in the fridge (one product per bin), then print its QR label and slide it into the
              bin's tag sleeve.
            </p>
            <Button className="mt-4" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" /> Add your first bin
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.locationId}>
              <h2 className="flex items-center text-lg font-semibold text-gray-900 mb-2">
                <Refrigerator className="h-5 w-5 mr-2 text-blue-600" />
                {group.locationName}
                <span className="ml-2 text-sm font-normal text-gray-500">
                  {group.shelves.reduce((s, sh) => s + sh.bins.length, 0)} bins
                </span>
              </h2>
              <div className="space-y-3">
                {group.shelves.map((shelf) => (
                  <div key={shelf.shelfId || 'none'} className="rounded-lg border border-gray-200 bg-white">
                    <div className="px-3 py-1.5 border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500 rounded-t-lg">
                      {shelf.shelfId ? describeShelf(shelf.shelfId, () => undefined) : 'No shelf assigned'}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-gray-100">
                      {shelf.bins.map((bin) => {
                        const counted = lastCountedText(bin.lastCountedAt);
                        const pName = productName(bin.productId);
                        return (
                          <button
                            key={bin.id}
                            type="button"
                            onClick={() => {
                              setLabelStatus(null);
                              setDetailBin(bin);
                            }}
                            className="text-left bg-white p-3 hover:bg-teal-50/40 transition-colors flex items-start justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <p className="font-semibold text-gray-900 truncate">{bin.name || pName}</p>
                              {bin.name && bin.name !== pName && <p className="text-xs text-gray-500 truncate">{pName}</p>}
                              <p className="text-xs text-gray-500 mt-1">
                                {clampInt(bin.trayCount)} tray{clampInt(bin.trayCount) === 1 ? '' : 's'} × {bin.vialsPerTray}
                                {bin.looseVials ? ` + ${bin.looseVials} loose` : ''}
                              </p>
                              <p className={`text-[11px] mt-0.5 ${counted.stale ? 'text-amber-600' : 'text-gray-400'}`}>{counted.text}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xl font-bold text-teal-700 tabular-nums">{basketTotal(bin)}</p>
                              <p className="text-[10px] uppercase text-gray-400">vials</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            setEditing(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Bin' : 'Add Bin'}</DialogTitle>
            <DialogDescription>
              One product per bin. Tray count can be adjusted later during a count.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bin-product">Product</Label>
              <select
                id="bin-product"
                className={selectClass}
                value={form.productId}
                onChange={(e) => {
                  const productId = e.target.value;
                  setForm((f) => ({
                    ...f,
                    productId,
                    name: f.name.trim() && f.name !== productName(f.productId) ? f.name : productName(productId),
                  }));
                }}
                required
              >
                <option value="">-- Choose product --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {products.length === 0 && (
                <p className="text-xs text-amber-600">No products yet — add the product under Products first.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="bin-name">
                Bin label text
                <HelpTooltip content="What's printed on the label, e.g. 'TIRZ 40 mg/mL 5mL'. Defaults to the product name." />
              </Label>
              <Input
                id="bin-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. TIRZ 40 mg/mL 5mL"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="bin-location">Fridge / location</Label>
                <select
                  id="bin-location"
                  className={selectClass}
                  value={form.locationId}
                  onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value, shelfIndex: '' }))}
                  required
                >
                  <option value="">-- Choose --</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bin-shelf">Shelf (1 = top)</Label>
                {shelfOptions(form.locationId).length > 0 ? (
                  <select
                    id="bin-shelf"
                    className={selectClass}
                    value={form.shelfIndex}
                    onChange={(e) => setForm((f) => ({ ...f, shelfIndex: e.target.value === '' ? '' : Number(e.target.value) }))}
                  >
                    <option value="">Unassigned</option>
                    {shelfOptions(form.locationId).map((n) => (
                      <option key={n} value={n}>
                        Shelf {n}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id="bin-shelf"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={form.shelfIndex}
                    onChange={(e) => setForm((f) => ({ ...f, shelfIndex: e.target.value === '' ? '' : clampInt(e.target.value, 1) }))}
                    placeholder="e.g. 2"
                  />
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="bin-trays">Trays</Label>
                <Input
                  id="bin-trays"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={form.trayCount}
                  onChange={(e) => setForm((f) => ({ ...f, trayCount: clampInt(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bin-vpt">Vials / tray</Label>
                <Input
                  id="bin-vpt"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={form.vialsPerTray}
                  onChange={(e) => setForm((f) => ({ ...f, vialsPerTray: clampInt(e.target.value, 1) }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bin-loose">Loose vials</Label>
                <Input
                  id="bin-loose"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={form.looseVials}
                  onChange={(e) => setForm((f) => ({ ...f, looseVials: clampInt(e.target.value) }))}
                />
              </div>
            </div>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <DialogFooter className="flex justify-between items-center sm:justify-between">
              {editing && isAdmin ? (
                <Button type="button" variant="destructive" size="icon" onClick={() => handleDelete(editing)} title="Delete bin">
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : (
                <span />
              )}
              <div className="flex space-x-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : editing ? null : <Printer className="h-4 w-4 mr-2" />}
                  {editing ? 'Save Changes' : 'Save & Print Label'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bin detail dialog */}
      <Dialog open={!!detailBin} onOpenChange={(open) => !open && setDetailBin(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          {detailBin && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center">
                  <Boxes className="h-5 w-5 mr-2 text-teal-600" />
                  {detailBin.name || productName(detailBin.productId)}
                </DialogTitle>
                <DialogDescription>
                  {productName(detailBin.productId)} · {describeShelf(detailBin.shelfId, nameOf) || nameOf(detailBin.locationId) || 'no location'}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border bg-gray-50 p-2">
                  <p className="text-[10px] uppercase text-gray-500">Trays</p>
                  <p className="text-lg font-bold tabular-nums">{clampInt(detailBin.trayCount)}</p>
                </div>
                <div className="rounded-lg border bg-gray-50 p-2">
                  <p className="text-[10px] uppercase text-gray-500">Loose</p>
                  <p className="text-lg font-bold tabular-nums">{clampInt(detailBin.looseVials)}</p>
                </div>
                <div className="rounded-lg border bg-teal-50 p-2">
                  <p className="text-[10px] uppercase text-teal-700">Total vials</p>
                  <p className="text-lg font-bold text-teal-700 tabular-nums">{basketTotal(detailBin)}</p>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                {typeof detailBin.totalVials === 'number'
                  ? `Last ${lastCountedText(detailBin.lastCountedAt).text}.`
                  : 'Never counted — total is the setup estimate (trays × vials per tray + loose).'}
              </p>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Trays</p>
                {clampInt(detailBin.trayCount) === 0 ? (
                  <p className="text-sm text-gray-500">No trays declared.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {Array.from({ length: clampInt(detailBin.trayCount) }, (_, i) => i + 1).map((slot) => {
                      const t = detailTrays.find((x) => x.slot === slot);
                      const bud = t ? budStatus(t.bud) : 'unknown';
                      return (
                        <div
                          key={slot}
                          className={`rounded-md border px-2 py-1.5 text-xs ${
                            t ? 'border-teal-200 bg-teal-50' : 'border-dashed border-gray-300 bg-white text-gray-400'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-gray-700">Tray {slot}</span>
                            <span className="font-bold tabular-nums text-teal-800">{t ? t.count : '—'}</span>
                          </div>
                          {t?.lotNumber && <p className="text-[11px] text-gray-600 truncate">Lot {t.lotNumber}</p>}
                          {t?.bud && (
                            <p
                              className={`text-[11px] truncate ${
                                bud === 'expired' ? 'text-red-600 font-semibold' : bud === 'soon' ? 'text-amber-700' : 'text-gray-600'
                              }`}
                            >
                              BUD {formatBud(t.bud)}
                              {bud === 'expired' ? ' · expired' : bud === 'soon' ? ' · soon' : ''}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Labels</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => printBinLabel(detailBin)}>
                    <Printer className="h-4 w-4 mr-2" /> Bin label (QR)
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit(detailBin)}>
                    <Pencil className="h-4 w-4 mr-2" /> Edit bin
                  </Button>
                </div>
                <div className="flex flex-wrap items-end gap-2 pt-1">
                  <div className="flex-1 min-w-[180px] space-y-1">
                    <Label className="text-xs text-gray-500">Tray label size</Label>
                    <select className={selectClass} value={trayLabelFormat} onChange={(e) => setTrayLabelFormat(e.target.value as LabelFormat)}>
                      {LABEL_FORMAT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    size="sm"
                    className="bg-indigo-600 hover:bg-indigo-700"
                    onClick={() => sendTrayLabels(detailBin)}
                    disabled={sendingLabels || clampInt(detailBin.trayCount) === 0}
                  >
                    {sendingLabels ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    Send {clampInt(detailBin.trayCount)} tray labels
                  </Button>
                </div>
                <p className="text-[11px] text-gray-500">
                  Tray labels (TRAY: codes) are optional — scanning one during a count jumps straight to that tray slot.
                </p>
                {labelStatus && <p className="text-xs text-teal-700">{labelStatus}</p>}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <LabelPrinter
        isOpen={!!printData}
        onClose={() => setPrintData(null)}
        code={printData?.code || ''}
        title={printData?.title || ''}
        subtitle={printData?.subtitle}
        defaultFormat="2.5x1.5"
      />
    </div>
  );
}
