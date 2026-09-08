import React, { useEffect, useMemo, useState } from 'react';
import { collection, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '../components/ui/dialog';
import { Plus, Loader2, Printer, Pencil, Trash2, MapPin, ChevronDown, Layers } from 'lucide-react';
import { LabelPrinter } from '../components/LabelPrinter';
import FridgeMap, { type PrintRequest } from '../components/FridgeMap';
import {
  DEFAULT_SHELF_COUNT,
  subscribeAllBaskets,
  subscribeLocations,
  type BasketRecord,
  type FridgeLocation,
} from '../lib/inventory';
import { useProducts } from '../lib/useProducts';

const TYPE_OPTIONS = [
  { value: 'fridge', label: 'Refrigerator' },
  { value: 'shelf', label: 'Shelf' },
  { value: 'cabinet', label: 'Cabinet' },
];

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export default function Locations() {
  const [locations, setLocations] = useState<FridgeLocation[] | null>(null);
  const [baskets, setBaskets] = useState<BasketRecord[]>([]);
  const { byId: productsById } = useProducts();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newLocation, setNewLocation] = useState({ name: '', type: 'fridge', description: '', shelfCount: DEFAULT_SHELF_COUNT });
  const [adding, setAdding] = useState(false);
  const [printData, setPrintData] = useState<PrintRequest | null>(null);
  const [editingLocation, setEditingLocation] = useState<FridgeLocation | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    return subscribeLocations(setLocations, (error) => handleFirestoreError(error, OperationType.LIST, 'locations'));
  }, []);

  useEffect(() => {
    return subscribeAllBaskets(setBaskets, (error) => handleFirestoreError(error, OperationType.LIST, 'baskets'));
  }, []);

  const basketsByLocation = useMemo(() => {
    const map: Record<string, BasketRecord[]> = {};
    for (const b of baskets) (map[b.locationId] ??= []).push(b);
    return map;
  }, [baskets]);

  const handleAddLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      const qrCode = `LOC:${Date.now()}`;
      await addDoc(collection(db, 'locations'), {
        name: newLocation.name.trim(),
        type: newLocation.type,
        description: newLocation.description,
        shelfCount: Math.max(0, Math.min(50, newLocation.shelfCount)),
        qrCode,
        createdAt: new Date().toISOString(),
      });
      setIsAddOpen(false);
      setNewLocation({ name: '', type: 'fridge', description: '', shelfCount: DEFAULT_SHELF_COUNT });
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
      await updateDoc(doc(db, 'locations', editingLocation.id), {
        name: editingLocation.name.trim(),
        type: editingLocation.type,
        description: editingLocation.description ?? '',
        shelfCount: Math.max(0, Math.min(50, editingLocation.shelfCount)),
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
      if (editingLocation?.id === id) setEditingLocation(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'locations');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Locations</h1>
          <p className="text-sm text-gray-500">Fridges, their shelves, and the baskets on them. Print a label for each.</p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Add Location</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Location</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddLocation} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Location Name</Label>
                <Input id="name" required value={newLocation.name} onChange={(e) => setNewLocation({ ...newLocation, name: e.target.value })} placeholder="e.g. Fridge 2 - Peptides" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <select id="type" className={selectClass} value={newLocation.type} onChange={(e) => setNewLocation({ ...newLocation, type: e.target.value })}>
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shelfCount">Shelves</Label>
                  <Input id="shelfCount" type="number" min={0} max={50} value={newLocation.shelfCount} onChange={(e) => setNewLocation({ ...newLocation, shelfCount: parseInt(e.target.value, 10) || 0 })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input id="description" value={newLocation.description} onChange={(e) => setNewLocation({ ...newLocation, description: e.target.value })} />
              </div>
              <Button type="submit" className="w-full" disabled={adding}>
                {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save Location
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {locations === null ? (
        <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>
      ) : locations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <MapPin className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900">No locations found</h3>
            <p className="text-gray-500 mt-1">Add a fridge to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {locations.map((location) => {
            const locBaskets = basketsByLocation[location.id] ?? [];
            const isOpen = !!expanded[location.id];
            return (
              <Card key={location.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-lg truncate">{location.name}</CardTitle>
                      <CardDescription className="mt-0.5">
                        {location.shelfCount} shelves · {locBaskets.length} {locBaskets.length === 1 ? 'basket' : 'baskets'}
                        {location.description ? ` · ${location.description}` : ''}
                      </CardDescription>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10 capitalize shrink-0">
                      {location.type}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExpanded((prev) => ({ ...prev, [location.id]: !isOpen }))}
                    >
                      <Layers className="h-4 w-4 mr-2" /> Shelves
                      <ChevronDown className={`h-4 w-4 ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setPrintData({ code: location.qrCode, title: location.name, subtitle: 'Fridge' })}>
                      <Printer className="h-4 w-4 mr-2" /> Print
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditingLocation(location)} aria-label="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                  {isOpen && (
                    <div className="mt-4 border-t pt-4">
                      <FridgeMap location={location} baskets={locBaskets} productsById={productsById} onPrint={setPrintData} />
                    </div>
                  )}
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
                <Input id="edit-name" required value={editingLocation.name} onChange={(e) => setEditingLocation({ ...editingLocation, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="edit-type">Type</Label>
                  <select id="edit-type" className={selectClass} value={editingLocation.type} onChange={(e) => setEditingLocation({ ...editingLocation, type: e.target.value })}>
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-shelfCount">Shelves</Label>
                  <Input id="edit-shelfCount" type="number" min={0} max={50} value={editingLocation.shelfCount} onChange={(e) => setEditingLocation({ ...editingLocation, shelfCount: parseInt(e.target.value, 10) || 0 })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Input id="edit-description" value={editingLocation.description || ''} onChange={(e) => setEditingLocation({ ...editingLocation, description: e.target.value })} />
              </div>
              <p className="text-xs text-gray-500">
                Shelf labels encode this location's ID, so renaming is safe; changing the number of shelves only affects which shelf buttons and labels are offered.
              </p>
              <DialogFooter className="flex justify-between items-center sm:justify-between">
                <Button type="button" variant="destructive" size="icon" onClick={() => handleDeleteLocation(editingLocation.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
                <div className="flex space-x-2">
                  <Button type="button" variant="outline" onClick={() => setEditingLocation(null)}>Cancel</Button>
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

      <LabelPrinter
        isOpen={!!printData}
        onClose={() => setPrintData(null)}
        code={printData?.code || ''}
        title={printData?.title || ''}
        subtitle={printData?.subtitle}
      />
    </div>
  );
}
