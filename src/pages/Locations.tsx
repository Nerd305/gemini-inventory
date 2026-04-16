import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '../components/ui/dialog';
import { Plus, Loader2, Printer, Pencil, Trash2, MapPin } from 'lucide-react';
import { LabelPrinter } from '../components/LabelPrinter';

interface Location {
  id: string;
  name: string;
  type: string;
  description?: string;
  qrCode: string;
}

export default function Locations() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newLocation, setNewLocation] = useState({ name: '', type: 'fridge', description: '' });
  const [adding, setAdding] = useState(false);
  const [printData, setPrintData] = useState<{code: string, title: string, subtitle?: string} | null>(null);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'locations'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const locs: Location[] = [];
      snapshot.forEach((doc) => {
        locs.push({ id: doc.id, ...doc.data() } as Location);
      });
      setLocations(locs);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'locations');
    });

    return () => unsubscribe();
  }, []);

  const handleAddLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      const qrCode = `LOC:${Date.now()}`;
      await addDoc(collection(db, 'locations'), {
        ...newLocation,
        qrCode,
        createdAt: new Date().toISOString(),
      });
      setIsAddOpen(false);
      setNewLocation({ name: '', type: 'fridge', description: '' });
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
        name: editingLocation.name,
        type: editingLocation.type,
        description: editingLocation.description
      });
      setEditingLocation(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'locations');
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteLocation = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this location?")) return;
    try {
      await deleteDoc(doc(db, 'locations', id));
      if (editingLocation?.id === id) {
        setEditingLocation(null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'locations');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Locations</h1>
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
                <Input id="name" required value={newLocation.name} onChange={e => setNewLocation({...newLocation, name: e.target.value})} placeholder="e.g. Main Fridge 1" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">Type</Label>
                <select 
                  id="type" 
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={newLocation.type} 
                  onChange={e => setNewLocation({...newLocation, type: e.target.value})}
                >
                  <option value="fridge">Refrigerator</option>
                  <option value="shelf">Shelf</option>
                  <option value="cabinet">Cabinet</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input id="description" value={newLocation.description} onChange={e => setNewLocation({...newLocation, description: e.target.value})} />
              </div>
              <Button type="submit" className="w-full" disabled={adding}>
                {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save Location
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>
      ) : locations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <MapPin className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900">No locations found</h3>
            <p className="text-gray-500 mt-1">Add a location to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {locations.map((location) => (
            <Card key={location.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setEditingLocation(location)}>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg">{location.name}</CardTitle>
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10 capitalize">
                    {location.type}
                  </span>
                </div>
                {location.description && (
                  <CardDescription className="line-clamp-2">{location.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex justify-end space-x-2 mt-4" onClick={(e) => e.stopPropagation()}>
                  <Button variant="outline" size="sm" onClick={() => setPrintData({ code: location.qrCode, title: location.name, subtitle: 'Location' })}>
                    <Printer className="h-4 w-4 mr-2" /> Print
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEditingLocation(location)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
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
                <Input id="edit-name" required value={editingLocation.name} onChange={e => setEditingLocation({...editingLocation, name: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-type">Type</Label>
                <select 
                  id="edit-type" 
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={editingLocation.type} 
                  onChange={e => setEditingLocation({...editingLocation, type: e.target.value})}
                >
                  <option value="fridge">Refrigerator</option>
                  <option value="shelf">Shelf</option>
                  <option value="cabinet">Cabinet</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Input id="edit-description" value={editingLocation.description || ''} onChange={e => setEditingLocation({...editingLocation, description: e.target.value})} />
              </div>
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

      {/* Label Printer Component */}
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
