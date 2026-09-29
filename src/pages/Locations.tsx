import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '../components/ui/dialog';
import { Plus, Loader2, Printer, Pencil, Trash2, MapPin, Layers, Send } from 'lucide-react';
import { LabelPrinter } from '../components/LabelPrinter';
import { HelpTooltip } from '../components/HelpTooltip';
import { NextStepHint } from '../components/NextStepHint';
import { clampInt, shelfQrCode, type LocationDoc } from '../lib/inventory';
import { LABEL_FORMAT_OPTIONS, sendPrintJobs } from '../lib/printing';
import type { LabelFormat } from '../shared/types';

interface Location extends LocationDoc {
  id: string;
}

interface LocationForm {
  name: string;
  type: string;
  description: string;
  shelfCount: number;
}

const EMPTY_FORM: LocationForm = { name: '', type: 'fridge', description: '', shelfCount: 5 };

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export default function Locations() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newLocation, setNewLocation] = useState<LocationForm>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [printData, setPrintData] = useState<{ code: string; title: string; subtitle?: string } | null>(null);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [shelfLabelsFor, setShelfLabelsFor] = useState<Location | null>(null);
  const [shelfFormat, setShelfFormat] = useState<LabelFormat>('2.5x1.5');
  const [sendingShelves, setSendingShelves] = useState(false);
  const [shelfStatus, setShelfStatus] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'locations'));
    let unsubscribe: any;
    let isActive = true;

    const timeout = setTimeout(() => {
      if (!isActive) return;
      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const locs: Location[] = [];
          snapshot.forEach((d) => {
            locs.push({ id: d.id, ...(d.data() as LocationDoc) });
          });
          locs.sort((a, b) => a.name.localeCompare(b.name));
          setLocations(locs);
          setLoading(false);
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'locations');
        },
      );
    }, 150);

    return () => {
      isActive = false;
      clearTimeout(timeout);
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Keep the shelf-label dialog in sync if the location is edited while open.
  useEffect(() => {
    if (!shelfLabelsFor) return;
    const fresh = locations.find((l) => l.id === shelfLabelsFor.id);
    if (fresh && fresh !== shelfLabelsFor) setShelfLabelsFor(fresh);
    if (!fresh) setShelfLabelsFor(null);
  }, [locations]);

  const handleAddLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      const qrCode = `LOC:${Date.now()}`;
      await addDoc(collection(db, 'locations'), {
        name: newLocation.name.trim(),
        type: newLocation.type,
        description: newLocation.description,
        shelfCount: clampInt(newLocation.shelfCount),
        qrCode,
        createdAt: new Date().toISOString(),
      });
      setIsAddOpen(false);
      setNewLocation(EMPTY_FORM);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'locations');
    } finally {
      setAdding(false);
    }
  };

  const handleUpdateLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLocation) return;
    setAdding(true);
    try {
      const locRef = doc(db, 'locations', editingLocation.id);
      await updateDoc(locRef, {
        name: editingLocation.name.trim(),
        type: editingLocation.type,
        description: editingLocation.description ?? '',
        shelfCount: clampInt(editingLocation.shelfCount),
      });
      setEditingLocation(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'locations');
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteLocation = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this location?')) return;
    try {
      await deleteDoc(doc(db, 'locations', id));
      if (editingLocation?.id === id) {
        setEditingLocation(null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'locations');
    }
  };

  const shelfLabels = useMemo(() => {
    if (!shelfLabelsFor) return [];
    const n = clampInt(shelfLabelsFor.shelfCount);
    return Array.from({ length: n }, (_, i) => ({
      index: i + 1,
      code: shelfQrCode(shelfLabelsFor.id, i + 1),
      title: `${shelfLabelsFor.name} · Shelf ${i + 1}`,
      subtitle: i === 0 ? 'Top shelf' : i === n - 1 ? 'Bottom shelf' : `Shelf ${i + 1} of ${n}`,
    }));
  }, [shelfLabelsFor]);

  const sendAllShelfLabels = async () => {
    if (shelfLabels.length === 0) return;
    setSendingShelves(true);
    setShelfStatus(null);
    try {
      const sent = await sendPrintJobs(
        shelfLabels.map((s) => ({ code: s.code, title: s.title, subtitle: s.subtitle })),
        shelfFormat,
      );
      setShelfStatus(`Sent ${sent} shelf label${sent === 1 ? '' : 's'} to the Print Station.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'printJobs');
      setShelfStatus('Failed to queue shelf labels.');
    } finally {
      setSendingShelves(false);
    }
  };

  const renderTypeSelect = (value: string, onChange: (v: string) => void, id: string) => (
    <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="fridge">Refrigerator</option>
      <option value="shelf">Shelf</option>
      <option value="cabinet">Cabinet</option>
    </select>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            Locations
            <HelpTooltip content="Fridges and cabinets. Set the shelf count on each one to print SHELF: QR labels — scanning a shelf label is the first step of every count and confirms where each bin goes back." />
          </h1>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" /> Add Location
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Location</DialogTitle>
              <DialogDescription>A fridge, cabinet, or standalone shelf unit.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAddLocation} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Location Name</Label>
                <Input
                  id="name"
                  required
                  value={newLocation.name}
                  onChange={(e) => setNewLocation({ ...newLocation, name: e.target.value })}
                  placeholder="e.g. Avantco Fridge 1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  {renderTypeSelect(newLocation.type, (type) => setNewLocation({ ...newLocation, type }), 'type')}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shelfCount">Shelves (top → bottom)</Label>
                  <Input
                    id="shelfCount"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={newLocation.shelfCount}
                    onChange={(e) => setNewLocation({ ...newLocation, shelfCount: clampInt(e.target.value) })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={newLocation.description}
                  onChange={(e) => setNewLocation({ ...newLocation, description: e.target.value })}
                />
              </div>
              <Button type="submit" className="w-full" disabled={adding}>
                {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save Location
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {!loading && locations.length > 0 && (
        locations.every((l) => clampInt(l.shelfCount) === 0) ? (
          <NextStepHint>
            Next: open each fridge and set its shelf count, then use <strong>Shelf labels</strong> to print one QR per shelf.
          </NextStepHint>
        ) : (
          <NextStepHint to="/bins" cta="Set up bins">
            Next: print each fridge's <strong>Shelf labels</strong> and stick them on the shelf edges, then add a bin for every basket.
          </NextStepHint>
        )
      )}

      {loading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : locations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <MapPin className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900">No locations found</h3>
            <p className="text-gray-500 mt-1">Add a fridge to get started, then print its shelf labels.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {locations.map((location) => {
            const shelves = clampInt(location.shelfCount);
            return (
              <Card
                key={location.id}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => setEditingLocation(location)}
              >
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg">{location.name}</CardTitle>
                    <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10 capitalize">
                      {location.type}
                    </span>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {shelves > 0 ? `${shelves} shelves` : 'No shelves configured'}
                    {location.description ? ` · ${location.description}` : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap justify-end gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShelfStatus(null);
                        setShelfLabelsFor(location);
                      }}
                      disabled={shelves === 0}
                      title={shelves === 0 ? 'Set a shelf count first' : 'Print shelf QR labels'}
                    >
                      <Layers className="h-4 w-4 mr-2" /> Shelf labels
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPrintData({ code: location.qrCode, title: location.name, subtitle: 'Location' })}
                    >
                      <Printer className="h-4 w-4 mr-2" /> Print
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditingLocation(location)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit Location Dialog */}
      <Dialog open={!!editingLocation} onOpenChange={(open) => !open && setEditingLocation(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Location</DialogTitle>
          </DialogHeader>
          {editingLocation && (
            <form onSubmit={handleUpdateLocation} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Location Name</Label>
                <Input
                  id="edit-name"
                  required
                  value={editingLocation.name}
                  onChange={(e) => setEditingLocation({ ...editingLocation, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="edit-type">Type</Label>
                  {renderTypeSelect(editingLocation.type, (type) => setEditingLocation({ ...editingLocation, type }), 'edit-type')}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-shelfCount">Shelves (top → bottom)</Label>
                  <Input
                    id="edit-shelfCount"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={clampInt(editingLocation.shelfCount)}
                    onChange={(e) => setEditingLocation({ ...editingLocation, shelfCount: clampInt(e.target.value) })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Input
                  id="edit-description"
                  value={editingLocation.description || ''}
                  onChange={(e) => setEditingLocation({ ...editingLocation, description: e.target.value })}
                />
              </div>
              <DialogFooter className="flex justify-between items-center sm:justify-between">
                <Button type="button" variant="destructive" size="icon" onClick={() => handleDeleteLocation(editingLocation.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
                <div className="flex space-x-2">
                  <Button type="button" variant="outline" onClick={() => setEditingLocation(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={adding}>
                    {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Save Changes
                  </Button>
                </div>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Shelf labels dialog */}
      <Dialog open={!!shelfLabelsFor} onOpenChange={(open) => !open && setShelfLabelsFor(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          {shelfLabelsFor && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center">
                  <Layers className="h-5 w-5 mr-2 text-blue-600" />
                  Shelf labels · {shelfLabelsFor.name}
                </DialogTitle>
                <DialogDescription>
                  One QR label per shelf, numbered from the top. Stick each label on the front edge of its shelf; counters
                  scan it before pulling bins and again when putting them back.
                </DialogDescription>
              </DialogHeader>

              <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {shelfLabels.map((s) => (
                  <div key={s.index} className="flex items-center justify-between px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">Shelf {s.index}</p>
                      <p className="text-[11px] font-mono text-gray-400 truncate">{s.code}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPrintData({ code: s.code, title: s.title, subtitle: s.subtitle })}
                    >
                      <Printer className="h-4 w-4 mr-1.5" /> Print
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-2 pt-1">
                <div className="flex-1 min-w-[180px] space-y-1">
                  <Label className="text-xs text-gray-500">Label size</Label>
                  <select className={selectClass} value={shelfFormat} onChange={(e) => setShelfFormat(e.target.value as LabelFormat)}>
                    {LABEL_FORMAT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={sendAllShelfLabels} disabled={sendingShelves}>
                  {sendingShelves ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                  Send all {shelfLabels.length} to Print Station
                </Button>
              </div>
              {shelfStatus && <p className="text-xs text-teal-700">{shelfStatus}</p>}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Label Printer Component */}
      <LabelPrinter
        isOpen={!!printData}
        onClose={() => setPrintData(null)}
        code={printData?.code || ''}
        title={printData?.title || ''}
        subtitle={printData?.subtitle}
        defaultFormat={printData?.code.startsWith('SHELF:') ? '2.5x1.5' : '4x3'}
      />
    </div>
  );
}
