import React, { useState, useEffect, useRef, useMemo } from 'react';
import { collection, query, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, deleteDoc, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '../components/ui/dialog';
import { Plus, Loader2, Camera, Sparkles, Printer, Pencil, Trash2, Package, Filter, ArrowUpDown, MapPin } from 'lucide-react';
import { analyzeProductImage } from '../lib/ai';
import { LabelPrinter } from '../components/LabelPrinter';
import { HelpTooltip } from '../components/HelpTooltip';

interface Product {
  id: string;
  name: string;
  category: string;
  description?: string;
  reorderPoint: number;
  currentStock: number;
  barcode?: string;
  qrCode?: string;
}

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', category: '', reorderPoint: 0, description: '' });
  const [adding, setAdding] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [printData, setPrintData] = useState<{code: string, title: string, subtitle?: string} | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productBaskets, setProductBaskets] = useState<any[]>([]);
  const [locationsMap, setLocationsMap] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filtering & Sorting State
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [sortBy, setSortBy] = useState<string>('name-asc');

  useEffect(() => {
    let unsubscribe: any;
    let unsubLocs: any;
    let isActive = true;

    const timeout = setTimeout(() => {
      if (!isActive) return;
      const q = query(collection(db, 'products'));
      unsubscribe = onSnapshot(q, (snapshot) => {
        const prods: Product[] = [];
        snapshot.forEach((doc) => {
          prods.push({ id: doc.id, ...doc.data() } as Product);
        });
        setProducts(prods);
        setLoading(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'products');
      });

      const locQ = query(collection(db, 'locations'));
      unsubLocs = onSnapshot(locQ, (snapshot) => {
        const lMap: Record<string, string> = {};
        snapshot.forEach(doc => {
          lMap[doc.id] = doc.data().name;
        });
        setLocationsMap(lMap);
      });
    }, 150);

    return () => {
      isActive = false;
      clearTimeout(timeout);
      if (unsubscribe) unsubscribe();
      if (unsubLocs) unsubLocs();
    };
  }, []);

  useEffect(() => {
    if (editingProduct) {
      const q = query(collection(db, 'baskets'), where('productId', '==', editingProduct.id));
      const unsub = onSnapshot(q, (snapshot) => {
        const baskets: any[] = [];
        snapshot.forEach(doc => baskets.push({ id: doc.id, ...doc.data() }));
        setProductBaskets(baskets);
      });
      return () => unsub();
    } else {
      setProductBaskets([]);
    }
  }, [editingProduct]);

  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category).filter(Boolean));
    return ['All', ...Array.from(cats).sort()];
  }, [products]);

  const filteredAndSortedProducts = useMemo(() => {
    let result = [...products];

    if (selectedCategory !== 'All') {
      result = result.filter(p => p.category === selectedCategory);
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'stock-asc':
          return a.currentStock - b.currentStock;
        case 'stock-desc':
          return b.currentStock - a.currentStock;
        case 'category-asc':
          return a.category.localeCompare(b.category);
        default:
          return 0;
      }
    });

    return result;
  }, [products, selectedCategory, sortBy]);

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      const qrCode = `PRODUCT:${Date.now()}`;
      await addDoc(collection(db, 'products'), {
        ...newProduct,
        currentStock: 0,
        qrCode,
        createdAt: new Date().toISOString(),
      });
      setIsAddOpen(false);
      setNewProduct({ name: '', category: '', reorderPoint: 0, description: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'products');
    } finally {
      setAdding(false);
    }
  };

  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    setAdding(true);
    try {
      const prodRef = doc(db, 'products', editingProduct.id);
      await updateDoc(prodRef, {
        name: editingProduct.name,
        category: editingProduct.category,
        description: editingProduct.description,
        reorderPoint: editingProduct.reorderPoint
      });
      setEditingProduct(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'products');
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this product?")) return;
    try {
      await deleteDoc(doc(db, 'products', id));
      if (editingProduct?.id === id) {
        setEditingProduct(null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'products');
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAnalyzing(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Image = reader.result as string;
        const result = await analyzeProductImage(base64Image);
        if (result) {
          setNewProduct(prev => ({
            ...prev,
            name: result.name || prev.name,
            category: result.category || prev.category,
            description: result.description || prev.description
          }));
        }
        setAnalyzing(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error(error);
      alert("Failed to analyze image");
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Products</h1>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Add Product</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Product</DialogTitle>
            </DialogHeader>
            
            <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-100 flex flex-col items-center justify-center text-center">
              <Sparkles className="h-6 w-6 text-blue-500 mb-2" />
              <p className="text-sm text-blue-800 mb-3">Use AI to automatically fill product details from a photo.</p>
              <input 
                type="file" 
                accept="image/*" 
                capture="environment"
                className="hidden" 
                ref={fileInputRef}
                onChange={handleImageUpload}
              />
              <Button 
                variant="outline" 
                className="bg-white" 
                onClick={() => fileInputRef.current?.click()}
                disabled={analyzing}
              >
                {analyzing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Camera className="h-4 w-4 mr-2" />}
                {analyzing ? "Analyzing..." : "Take Photo"}
              </Button>
            </div>

            <form onSubmit={handleAddProduct} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Product Name</Label>
                <Input id="name" required value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Input id="category" required value={newProduct.category} onChange={e => setNewProduct({...newProduct, category: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reorderPoint">Reorder Point <HelpTooltip content="The minimum stock level. If inventory falls below this number, the product will appear in Low Stock Alerts on the dashboard." /></Label>
                <Input id="reorderPoint" type="number" required min="0" value={newProduct.reorderPoint} onChange={e => setNewProduct({...newProduct, reorderPoint: parseInt(e.target.value) || 0})} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input id="description" value={newProduct.description} onChange={e => setNewProduct({...newProduct, description: e.target.value})} />
              </div>
              <Button type="submit" className="w-full" disabled={adding || analyzing}>
                {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save Product
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters and Sorting */}
      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-lg border shadow-sm">
        <div className="flex-1 space-y-1">
          <Label className="text-xs text-gray-500 flex items-center"><Filter className="h-3 w-3 mr-1" /> Category</Label>
          <select 
            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 space-y-1">
          <Label className="text-xs text-gray-500 flex items-center"><ArrowUpDown className="h-3 w-3 mr-1" /> Sort By</Label>
          <select 
            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="name-asc">Name (A-Z)</option>
            <option value="name-desc">Name (Z-A)</option>
            <option value="stock-asc">Stock (Low to High)</option>
            <option value="stock-desc">Stock (High to Low)</option>
            <option value="category-asc">Category (A-Z)</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>
      ) : filteredAndSortedProducts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Package className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900">No products found</h3>
            <p className="text-gray-500 mt-1">Try adjusting your filters or add a new product.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAndSortedProducts.map((product) => (
            <Card key={product.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setEditingProduct(product)}>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg">{product.name}</CardTitle>
                  <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">
                    {product.category}
                  </span>
                </div>
                {product.description && (
                  <CardDescription className="line-clamp-2">{product.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex justify-between items-center mt-2">
                  <div className="flex flex-col">
                    <span className="text-xs text-gray-500 uppercase tracking-wider">Stock</span>
                    <span className={`text-xl font-bold ${product.currentStock <= product.reorderPoint ? "text-red-600" : "text-green-600"}`}>
                      {product.currentStock}
                      <span className="text-sm font-normal text-gray-500 ml-1">/ {product.reorderPoint} min</span>
                    </span>
                  </div>
                  <div className="flex space-x-2" onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="sm" onClick={() => setPrintData({ code: product.qrCode || `PRODUCT:${product.id}`, title: product.name, subtitle: product.category })}>
                      <Printer className="h-4 w-4 mr-2" /> Print
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditingProduct(product)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Product Dialog */}
      <Dialog open={!!editingProduct} onOpenChange={(open) => !open && setEditingProduct(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Product</DialogTitle>
          </DialogHeader>
          {editingProduct && (
            <form onSubmit={handleUpdateProduct} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Product Name</Label>
                <Input id="edit-name" required value={editingProduct.name} onChange={e => setEditingProduct({...editingProduct, name: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-category">Category</Label>
                <Input id="edit-category" required value={editingProduct.category} onChange={e => setEditingProduct({...editingProduct, category: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-reorderPoint">Reorder Point <HelpTooltip content="The minimum stock level. If inventory falls below this number, the product will appear in Low Stock Alerts on the dashboard." /></Label>
                <Input id="edit-reorderPoint" type="number" required min="0" value={editingProduct.reorderPoint} onChange={e => setEditingProduct({...editingProduct, reorderPoint: parseInt(e.target.value) || 0})} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Input id="edit-description" value={editingProduct.description || ''} onChange={e => setEditingProduct({...editingProduct, description: e.target.value})} />
              </div>
              
              {/* Known Locations / Baskets */}
              <div className="space-y-2 pt-4 border-t">
                <Label className="text-sm font-semibold text-gray-900 flex items-center">
                  <MapPin className="h-4 w-4 mr-1 text-blue-600" /> Known Locations
                </Label>
                {productBaskets.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">No baskets or trays registered for this product.</p>
                ) : (
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                    {productBaskets.map(basket => {
                      const locName = locationsMap[basket.locationId] || 'Unknown Location';
                      const totalVials = (basket.trayCount * basket.vialsPerTray) + basket.looseVials;
                      return (
                        <div key={basket.id} className="flex justify-between items-center bg-gray-50 p-2 rounded border text-sm">
                          <div>
                            <p className="font-medium text-gray-900">{locName}</p>
                            <p className="text-xs text-gray-500">{basket.name} • {basket.trayCount} trays ({basket.vialsPerTray}/tray) + {basket.looseVials} loose</p>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-blue-600">{totalVials}</span>
                            <span className="text-xs text-gray-500 block">vials</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <DialogFooter className="flex justify-between items-center sm:justify-between pt-4">
                <Button type="button" variant="destructive" size="icon" onClick={() => handleDeleteProduct(editingProduct.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
                <div className="flex space-x-2">
                  <Button type="button" variant="outline" onClick={() => setEditingProduct(null)}>Cancel</Button>
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
