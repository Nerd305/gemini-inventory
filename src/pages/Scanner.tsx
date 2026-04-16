import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { collection, query, where, getDocs, addDoc, updateDoc, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Loader2, MapPin, Package, Search, Printer, ArrowRight, PlusCircle, CheckCircle2, Camera, StopCircle, Upload } from 'lucide-react';
import { LabelPrinter } from '../components/LabelPrinter';
import { countVialsInTray } from '../lib/ai';

// Audio helper for scanner feedback
const playBeep = (freq = 523.25, duration = 100, vol = 0.1) => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const audioCtx = new AudioContext();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      audioCtx.close();
    }, duration);
  } catch (e) {
    console.error("Audio play failed", e);
  }
};

const playSuccess = () => {
  playBeep(880, 100, 0.1);
  setTimeout(() => playBeep(1108, 150, 0.1), 100);
};

const playError = () => {
  playBeep(300, 300, 0.1);
};

export default function Scanner() {
  const { user } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Data states
  const [locations, setLocations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  // Selections
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [taskType, setTaskType] = useState<'GENERAL' | 'SPECIFIC' | 'GUIDED'>('GENERAL');
  const [selectedProductId, setSelectedProductId] = useState<string>('');

  // Guided Flow States
  const [guidedStep, setGuidedStep] = useState<'CONTAINER' | 'PRODUCT' | 'QTY'>('CONTAINER');
  const [guidedContainerType, setGuidedContainerType] = useState<'Basket' | 'Tray' | 'Other'>('Basket');
  const [guidedProductId, setGuidedProductId] = useState<string>('');
  const [guidedQty, setGuidedQty] = useState<number>(0);

  // Basket Setup States
  const [basketName, setBasketName] = useState('');
  const [basketTrayCount, setBasketTrayCount] = useState<number>(0);
  const [basketVialsPerTray, setBasketVialsPerTray] = useState<number>(25);
  const [basketLooseVials, setBasketLooseVials] = useState<number>(0);

  // Vial Detection States
  const [vialDetectionImage, setVialDetectionImage] = useState<string>('');
  const [vialCount, setVialCount] = useState<number>(0);
  const [vialDetectionLoading, setVialDetectionLoading] = useState<boolean>(false);
  const [showVialDetectionDialog, setShowVialDetectionDialog] = useState<boolean>(false);
  const [vialDetectionError, setVialDetectionError] = useState<string>('');

  // Creation states
  const [newLocName, setNewLocName] = useState('');
  const [newProdName, setNewProdName] = useState('');
  const [newProdCategory, setNewProdCategory] = useState('');
  const [customContainerCount, setCustomContainerCount] = useState<number | ''>('');
  const [printData, setPrintData] = useState<{ code: string, title: string, subtitle?: string } | null>(null);

  // Scanner states
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [currentProduct, setCurrentProduct] = useState<{ id: string, name: string, stock: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualCode, setManualCode] = useState('');

  // Action states
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [actionAmount, setActionAmount] = useState<number>(1);
  const [actionReason, setActionReason] = useState<string>('');

  const scannerRef = useRef<Html5Qrcode | null>(null);

  // Fetch Locations & Products
  useEffect(() => {
    const unsubLocs = onSnapshot(query(collection(db, 'locations')), (snap) => {
      setLocations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubProds = onSnapshot(query(collection(db, 'products')), (snap) => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => { unsubLocs(); unsubProds(); };
  }, []);

  // Manage Scanner Lifecycle
  useEffect(() => {
    let scanner: Html5Qrcode | null = null;

    if (step === 3) {
      setTimeout(() => {
        scanner = new Html5Qrcode("reader");
        scanner.start(
          { facingMode: "environment" }, // Forces rear camera
          { fps: 10, qrbox: { width: 250, height: 250 } },
          onScanSuccess,
          onScanFailure
        ).catch((err) => {
          console.error("Error starting scanner automatically", err);
          // Fallback if environment camera fails
          scanner?.start(
            { facingMode: "user" },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            onScanSuccess,
            onScanFailure
          ).catch(console.error);
        });
        scannerRef.current = scanner;
      }, 100);
    }

    return () => {
      if (scanner && scanner.isScanning) {
        scanner.stop().then(() => {
          scanner?.clear();
        }).catch(console.error);
      }
    };
  }, [step]);

  const handleCreateLocation = async () => {
    if (!newLocName) return;
    setLoading(true);
    try {
      const qrCode = `LOC:${Date.now()}`;
      const docRef = await addDoc(collection(db, 'locations'), {
        name: newLocName,
        type: 'shelf',
        qrCode,
        createdAt: new Date().toISOString()
      });
      setSelectedLocationId(docRef.id);
      setNewLocName('');
      setPrintData({ code: qrCode, title: newLocName, subtitle: 'Location' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'locations');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProduct = async () => {
    if (!newProdName || !newProdCategory) return;
    setLoading(true);
    try {
      const qrCode = `PRODUCT:${Date.now()}`;
      const docRef = await addDoc(collection(db, 'products'), {
        name: newProdName,
        category: newProdCategory,
        currentStock: 0,
        reorderPoint: 10,
        qrCode,
        createdAt: new Date().toISOString()
      });
      setSelectedProductId(docRef.id);
      setNewProdName('');
      setNewProdCategory('');
      setPrintData({ code: qrCode, title: newProdName, subtitle: newProdCategory });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'products');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateContainerCode = async () => {
    if (!selectedProductId || !selectedLocationId || !basketName) return;
    setLoading(true);
    try {
      const code = `CONT:${Date.now()}`;
      await addDoc(collection(db, 'baskets'), {
        productId: selectedProductId,
        locationId: selectedLocationId,
        name: basketName,
        trayCount: basketTrayCount,
        vialsPerTray: basketVialsPerTray,
        looseVials: basketLooseVials,
        qrCode: code,
        createdAt: new Date().toISOString()
      });
      const prod = products.find(p => p.id === selectedProductId);
      const totalVials = (basketTrayCount * basketVialsPerTray) + basketLooseVials;
      setPrintData({ code, title: basketName, subtitle: `${prod?.name} (${totalVials} vials)` });
      playSuccess();
      setBasketName('');
      setBasketTrayCount(0);
      setBasketLooseVials(0);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'baskets');
      playError();
    } finally {
      setLoading(false);
    }
  };

  const processCode = async (decodedText: string) => {
    if (loading || showProductDialog) return;

    setScanResult(decodedText);
    setLoading(true);

    try {
      if (decodedText.startsWith('LOC:')) {
        const q = query(collection(db, 'locations'), where('qrCode', '==', decodedText));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const locDoc = snap.docs[0];
          setSelectedLocationId(locDoc.id);
          playSuccess();
          alert(`Location updated to: ${locDoc.data().name}`);
        } else {
          playError();
          alert('Location not found');
        }
      } else if (decodedText.startsWith('PRODUCT:')) {
        const productId = decodedText.split(':')[1];
        const prodDoc = await getDoc(doc(db, 'products', productId));
        if (prodDoc.exists()) {
          setCurrentProduct({ id: prodDoc.id, name: prodDoc.data().name, stock: prodDoc.data().currentStock });
          setActionAmount(1);
          playSuccess();
          setShowProductDialog(true);
        } else {
          playError();
          alert('Product not found');
        }
      } else if (decodedText.startsWith('CONT:')) {
        const q = query(collection(db, 'baskets'), where('qrCode', '==', decodedText));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const container = snap.docs[0].data();
          const pDoc = await getDoc(doc(db, 'products', container.productId));
          if (pDoc.exists()) {
            setCurrentProduct({ id: pDoc.id, name: pDoc.data().name, stock: pDoc.data().currentStock });
            const totalVials = (container.trayCount * container.vialsPerTray) + container.looseVials;
            setActionAmount(totalVials); // Pre-fill with basket total
            playSuccess();
            setShowProductDialog(true);
          } else {
            playError();
            alert('Associated product not found');
          }
        } else {
          playError();
          alert('Container code not recognized');
        }
      } else {
        playError();
        alert('Unrecognized Code Format. Expected LOC:, PRODUCT:, or CONT:');
      }
    } catch (error) {
      console.error(error);
      playError();
      alert('Error processing scan');
    } finally {
      setLoading(false);
      setManualCode('');
    }
  };

  const onScanSuccess = (decodedText: string) => processCode(decodedText);
  const onScanFailure = (error: any) => { };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode) processCode(manualCode);
  };

  const handleProductAction = async (action: 'ADD' | 'REMOVE' | 'ADJUST') => {
    if (!currentProduct || !user) return;
    setLoading(true);
    try {
      const prodRef = doc(db, 'products', currentProduct.id);
      let newStock = currentProduct.stock;

      if (action === 'ADD') newStock += actionAmount;
      else if (action === 'REMOVE') newStock -= actionAmount;
      else if (action === 'ADJUST') newStock = actionAmount;

      if (newStock < 0) newStock = 0;

      await updateDoc(prodRef, { currentStock: newStock });

      await addDoc(collection(db, 'inventoryLogs'), {
        productId: currentProduct.id,
        locationId: selectedLocationId,
        userId: user.uid,
        action,
        amount: actionAmount,
        previousCount: currentProduct.stock,
        newCount: newStock,
        reason: actionReason || (action === 'ADJUST' ? 'Manual adjustment' : ''),
        timestamp: new Date().toISOString()
      });

      playSuccess();
      setShowProductDialog(false);
      setActionAmount(1);
      setActionReason('');
      setCurrentProduct(null);
    } catch (error) {
      playError();
      handleFirestoreError(error, OperationType.UPDATE, 'products');
    } finally {
      setLoading(false);
    }
  };

  // Vial Detection Functions
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setVialDetectionError('Please upload a valid image file.');
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        setVialDetectionError('Image file is too large. Please upload an image under 10MB.');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setVialDetectionImage(result);
        setVialDetectionError(''); // Clear any previous errors
      };
      reader.onerror = () => {
        setVialDetectionError('Failed to read the image file. Please try again.');
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeVialTray = async () => {
    if (!vialDetectionImage) {
      setVialDetectionError('Please upload an image first.');
      return;
    }

    setVialDetectionLoading(true);
    setVialDetectionError('');

    try {
      const result = await countVialsInTray(vialDetectionImage);
      if (result) {
        setVialCount(result.vialCount);
        // If we're in guided mode and this is a tray, auto-fill the quantity
        if (taskType === 'GUIDED' && guidedStep === 'QTY' && guidedContainerType === 'Tray') {
          setGuidedQty(result.vialCount);
        }
        playSuccess();
      }
    } catch (error) {
      console.error('Error analyzing vial tray:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to analyze vial tray. Please try again.';
      setVialDetectionError(errorMessage);
      playError();
    } finally {
      setVialDetectionLoading(false);
    }
  };

  const handleGuidedLockIn = async () => {
    if (!guidedProductId || !user) return;
    setLoading(true);
    try {
      const prodRef = doc(db, 'products', guidedProductId);
      const prodDoc = await getDoc(prodRef);
      if (!prodDoc.exists()) throw new Error("Product not found");

      const currentStock = prodDoc.data().currentStock || 0;
      const newStock = currentStock + guidedQty;

      await updateDoc(prodRef, { currentStock: newStock });

      await addDoc(collection(db, 'inventoryLogs'), {
        productId: guidedProductId,
        locationId: selectedLocationId,
        userId: user.uid,
        action: 'ADD',
        amount: guidedQty,
        previousCount: currentStock,
        newCount: newStock,
        reason: `Guided Count (${guidedContainerType})`,
        timestamp: new Date().toISOString()
      });

      playSuccess();
      setGuidedStep('CONTAINER');
      setGuidedProductId('');
      alert(`Successfully locked in ${guidedQty} of ${prodDoc.data().name}`);
    } catch (error) {
      playError();
      handleFirestoreError(error, OperationType.UPDATE, 'products');
    } finally {
      setLoading(false);
    }
  };

  const handleEndSession = () => {
    setStep(1);
    setSelectedLocationId('');
    setSelectedProductId('');
    setTaskType('GENERAL');
    setScanResult(null);
  };

  const handleStartScanning = () => {
    setStep(3);
    if (taskType === 'GUIDED') {
      setGuidedStep('CONTAINER');
      setGuidedContainerType('Basket');
      setGuidedProductId('');
      setGuidedQty(150);
    }
    // If they are in SPECIFIC mode and have a product selected, auto-open the dialog for that product
    if (taskType === 'SPECIFIC' && selectedProductId) {
      const prod = products.find(p => p.id === selectedProductId);
      if (prod) {
        setCurrentProduct({ id: prod.id, name: prod.name, stock: prod.currentStock });
        setActionAmount(1);
        setShowProductDialog(true);
      }
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Inventory Scanner</h1>
        <div className="flex space-x-2">
          <div className={`h-2 w-8 rounded-full ${step >= 1 ? 'bg-blue-600' : 'bg-gray-200'}`} />
          <div className={`h-2 w-8 rounded-full ${step >= 2 ? 'bg-blue-600' : 'bg-gray-200'}`} />
          <div className={`h-2 w-8 rounded-full ${step >= 3 ? 'bg-blue-600' : 'bg-gray-200'}`} />
        </div>
      </div>

      {/* STEP 1: LOCATION */}
      {step === 1 && (
        <Card className="animate-in fade-in">
          <CardHeader>
            <CardTitle className="flex items-center"><MapPin className="mr-2 h-5 w-5 text-blue-600" /> 1. Where are you working?</CardTitle>
            <CardDescription>Select your current location or create a new one.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Select Existing Location</Label>
              <div className="flex gap-2">
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={selectedLocationId}
                  onChange={(e) => setSelectedLocationId(e.target.value)}
                >
                  <option value="">-- Choose Location --</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                {selectedLocationId && (
                  <Button variant="outline" size="icon" onClick={() => {
                    const loc = locations.find(l => l.id === selectedLocationId);
                    if (loc) setPrintData({ code: loc.qrCode, title: loc.name, subtitle: 'Location' });
                  }} title="Print Location Label">
                    <Printer className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-muted-foreground">Or create new</span></div>
            </div>

            <div className="space-y-2">
              <Label>New Location Name</Label>
              <div className="flex gap-2">
                <Input placeholder="e.g. Fridge 3" value={newLocName} onChange={e => setNewLocName(e.target.value)} />
                <Button onClick={handleCreateLocation} disabled={!newLocName || loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <Button className="w-full" size="lg" disabled={!selectedLocationId} onClick={() => setStep(2)}>
              Next Step <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* STEP 2: TASK / PRODUCT */}
      {step === 2 && (
        <Card className="animate-in fade-in">
          <CardHeader>
            <CardTitle className="flex items-center"><Package className="mr-2 h-5 w-5 text-blue-600" /> 2. What are you doing?</CardTitle>
            <CardDescription>Choose your task for this session.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <label className={`flex items-start space-x-3 p-4 border rounded-lg cursor-pointer transition-colors ${taskType === 'GENERAL' ? 'border-blue-600 bg-blue-50' : 'hover:bg-gray-50'}`}>
                <input type="radio" className="mt-1" checked={taskType === 'GENERAL'} onChange={() => setTaskType('GENERAL')} />
                <div>
                  <p className="font-medium text-gray-900">General Inventory Check</p>
                  <p className="text-sm text-gray-500">I am walking around and scanning various existing items.</p>
                </div>
              </label>

              <label className={`flex items-start space-x-3 p-4 border rounded-lg cursor-pointer transition-colors ${taskType === 'SPECIFIC' ? 'border-blue-600 bg-blue-50' : 'hover:bg-gray-50'}`}>
                <input type="radio" className="mt-1" checked={taskType === 'SPECIFIC'} onChange={() => setTaskType('SPECIFIC')} />
                <div>
                  <p className="font-medium text-gray-900">Setup Baskets / Trays</p>
                  <p className="text-sm text-gray-500">I need to print new QR codes for baskets or trays of a specific product.</p>
                </div>
              </label>

              <label className={`flex items-start space-x-3 p-4 border rounded-lg cursor-pointer transition-colors ${taskType === 'GUIDED' ? 'border-blue-600 bg-blue-50' : 'hover:bg-gray-50'}`}>
                <input type="radio" className="mt-1" checked={taskType === 'GUIDED'} onChange={() => setTaskType('GUIDED')} />
                <div>
                  <p className="font-medium text-gray-900">Guided Inventory Count</p>
                  <p className="text-sm text-gray-500">Step-by-step: Select Container &rarr; Select Product &rarr; Enter Qty &rarr; Lock it in.</p>
                </div>
              </label>
            </div>

            {taskType === 'SPECIFIC' && (
              <div className="p-4 bg-gray-50 rounded-lg space-y-4 border">
                <div className="space-y-2">
                  <Label>Select Product</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                  >
                    <option value="">-- Choose Product --</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>

                {selectedProductId && (
                  <div className="space-y-3 pt-2 border-t mt-4">
                    <Label className="text-sm font-semibold text-blue-800">Create New Basket</Label>
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-500">Basket Name (e.g. Basket A)</Label>
                      <Input value={basketName} onChange={e => setBasketName(e.target.value)} placeholder="Basket Name" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-500">Trays</Label>
                        <Input type="number" min="0" value={basketTrayCount} onChange={e => setBasketTrayCount(parseInt(e.target.value) || 0)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-500">Vials/Tray</Label>
                        <Input type="number" min="1" value={basketVialsPerTray} onChange={e => setBasketVialsPerTray(parseInt(e.target.value) || 25)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-500">Loose Vials</Label>
                        <Input type="number" min="0" value={basketLooseVials} onChange={e => setBasketLooseVials(parseInt(e.target.value) || 0)} />
                      </div>
                    </div>
                    <Button
                      className="w-full"
                      onClick={handleGenerateContainerCode}
                      disabled={loading || !basketName}
                    >
                      <Printer className="h-4 w-4 mr-2" /> Print Basket Label
                    </Button>
                  </div>
                )}

                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                  <div className="relative flex justify-center text-xs uppercase"><span className="bg-gray-50 px-2 text-muted-foreground">Or create new product</span></div>
                </div>

                <div className="space-y-2">
                  <Label>New Product Name</Label>
                  <Input placeholder="e.g. Amoxicillin 500mg" value={newProdName} onChange={e => setNewProdName(e.target.value)} />
                  <div className="flex gap-2 mt-2">
                    <Input placeholder="Category" value={newProdCategory} onChange={e => setNewProdCategory(e.target.value)} />
                    <Button onClick={handleCreateProduct} disabled={!newProdName || !newProdCategory || loading}>
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button className="flex-1" size="lg" onClick={handleStartScanning}>
                Start Scanning <Camera className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 3: SCANNING */}
      {step === 3 && (
        <div className="space-y-4 animate-in fade-in">
          <div className="flex justify-between items-center bg-blue-50 border border-blue-100 p-3 rounded-lg">
            <div className="flex items-center">
              <MapPin className="h-5 w-5 text-blue-600 mr-2" />
              <div>
                <p className="text-xs text-blue-600 font-bold uppercase">Current Location</p>
                <p className="font-medium text-sm">{locations.find(l => l.id === selectedLocationId)?.name}</p>
              </div>
            </div>
            <div className="flex space-x-2">
              <Button variant="outline" size="sm" onClick={() => setStep(1)}>Change</Button>
              <Button variant="destructive" size="sm" onClick={handleEndSession}>
                <StopCircle className="h-4 w-4 mr-1" /> End
              </Button>
            </div>
          </div>

          {taskType === 'GUIDED' ? (
            <Card className="border-blue-200 shadow-md">
              <CardHeader className="bg-blue-50 border-b border-blue-100 pb-4">
                <CardTitle className="text-lg text-blue-800">Guided Count</CardTitle>
                <div className="flex space-x-2 mt-2">
                  <div className={`h-1.5 flex-1 rounded-full ${guidedStep === 'CONTAINER' ? 'bg-blue-600' : 'bg-blue-200'}`} />
                  <div className={`h-1.5 flex-1 rounded-full ${guidedStep === 'PRODUCT' ? 'bg-blue-600' : 'bg-blue-200'}`} />
                  <div className={`h-1.5 flex-1 rounded-full ${guidedStep === 'QTY' ? 'bg-blue-600' : 'bg-blue-200'}`} />
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                {guidedStep === 'CONTAINER' && (
                  <div className="space-y-4 animate-in fade-in">
                    <Label className="text-base">1. What do you see?</Label>
                    <div className="grid grid-cols-2 gap-3">
                      <Button
                        variant={guidedContainerType === 'Basket' ? 'default' : 'outline'}
                        className="h-20 text-lg"
                        onClick={() => { setGuidedContainerType('Basket'); setGuidedQty(150); setGuidedStep('PRODUCT'); }}
                      >
                        Basket
                      </Button>
                      <Button
                        variant={guidedContainerType === 'Tray' ? 'default' : 'outline'}
                        className="h-20 text-lg"
                        onClick={() => { setGuidedContainerType('Tray'); setGuidedQty(25); setGuidedStep('PRODUCT'); }}
                      >
                        Tray
                      </Button>
                    </div>
                  </div>
                )}

                {guidedStep === 'PRODUCT' && (
                  <div className="space-y-4 animate-in fade-in">
                    <Label className="text-base">2. Select Product in {guidedContainerType}</Label>
                    <select
                      className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={guidedProductId}
                      onChange={(e) => setGuidedProductId(e.target.value)}
                    >
                      <option value="">-- Choose Product --</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <div className="flex gap-2 pt-2">
                      <Button variant="outline" onClick={() => setGuidedStep('CONTAINER')}>Back</Button>
                      <Button className="flex-1" disabled={!guidedProductId} onClick={() => setGuidedStep('QTY')}>Next</Button>
                    </div>
                  </div>
                )}

                {guidedStep === 'QTY' && (
                  <div className="space-y-4 animate-in fade-in">
                    <Label className="text-base">3. Confirm Quantity</Label>
                    <div className="flex items-center space-x-3">
                      <Button variant="outline" size="lg" onClick={() => setGuidedQty(Math.max(0, guidedQty - 1))}>-1</Button>
                      <Input
                        type="number"
                        value={guidedQty}
                        onChange={(e) => setGuidedQty(parseInt(e.target.value) || 0)}
                        className="text-center font-bold text-2xl h-14"
                      />
                      <Button variant="outline" size="lg" onClick={() => setGuidedQty(guidedQty + 1)}>+1</Button>
                    </div>

                    {guidedContainerType === 'Tray' && (
                      <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
                        <Label className="text-sm font-medium">AI Vial Detection</Label>
                        <div className="space-y-3">
                          <div className="flex gap-2">
                            <Input
                              type="file"
                              accept="image/*"
                              onChange={handleImageUpload}
                              className="flex-1"
                            />
                            <Button
                              variant="outline"
                              onClick={() => setShowVialDetectionDialog(true)}
                            >
                              <Camera className="h-4 w-4 mr-2" />
                              Camera
                            </Button>
                          </div>
                          {vialDetectionImage && (
                            <div className="space-y-2">
                              <img
                                src={vialDetectionImage}
                                alt="Tray preview"
                                className="w-full h-32 object-cover rounded border"
                              />
                              <Button
                                variant="default"
                                size="sm"
                                onClick={analyzeVialTray}
                                disabled={vialDetectionLoading}
                                className="w-full"
                              >
                                {vialDetectionLoading ? (
                                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                ) : (
                                  <Upload className="h-4 w-4 mr-2" />
                                )}
                                Count Vials with AI
                              </Button>
                              {vialCount > 0 && (
                                <div className="text-center text-sm text-green-600 font-medium">
                                  Detected: {vialCount} vials
                                </div>
                              )}
                            </div>
                          )}
                          {vialDetectionError && (
                            <div className="text-red-600 text-sm p-2 bg-red-50 rounded border border-red-200">
                              {vialDetectionError}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <Button variant="outline" onClick={() => setGuidedStep('PRODUCT')}>Back</Button>
                      <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" disabled={loading} onClick={handleGuidedLockIn}>
                        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <><CheckCircle2 className="mr-2 h-5 w-5" /> Lock It In</>}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              {taskType === 'SPECIFIC' && selectedProductId && (
                <Card className="bg-blue-600 text-white border-none shadow-md">
                  <CardContent className="p-4 flex justify-between items-center">
                    <div>
                      <p className="text-xs text-blue-200 font-bold uppercase">Active Product</p>
                      <p className="font-medium">{products.find(p => p.id === selectedProductId)?.name}</p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const prod = products.find(p => p.id === selectedProductId);
                        if (prod) {
                          setCurrentProduct({ id: prod.id, name: prod.name, stock: prod.currentStock });
                          setActionAmount(1);
                          setShowProductDialog(true);
                        }
                      }}
                    >
                      Adjust Stock
                    </Button>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardContent className="p-0 overflow-hidden">
                  <div id="reader" className="w-full border-none bg-black"></div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <form onSubmit={handleManualSubmit} className="flex gap-2">
                    <Input
                      placeholder="Manual code entry (e.g. PRODUCT:123)"
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value)}
                    />
                    <Button type="submit" disabled={!manualCode || loading}>
                      <Search className="h-4 w-4" />
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* Product Action Dialog */}
      <Dialog open={showProductDialog} onOpenChange={setShowProductDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex justify-between items-center pr-6">
              <span>Update Inventory: {currentProduct?.name}</span>
              <Button variant="outline" size="sm" onClick={() => setPrintData({ code: `PRODUCT:${currentProduct?.id}`, title: currentProduct?.name || '', subtitle: 'Product' })}>
                <Printer className="h-4 w-4 mr-2" /> Print Label
              </Button>
            </DialogTitle>
            <CardDescription>Current Stock: {currentProduct?.stock}</CardDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-3">
              <Label>Amount</Label>
              <div className="flex items-center space-x-2">
                <Button variant="outline" className="px-2" onClick={() => setActionAmount(Math.max(1, actionAmount - 10))}>-10</Button>
                <Button variant="outline" className="px-3" onClick={() => setActionAmount(Math.max(1, actionAmount - 1))}>-1</Button>
                <Input type="number" value={actionAmount} onChange={(e) => setActionAmount(parseInt(e.target.value) || 0)} className="text-center font-bold text-lg" />
                <Button variant="outline" className="px-3" onClick={() => setActionAmount(actionAmount + 1)}>+1</Button>
                <Button variant="outline" className="px-2" onClick={() => setActionAmount(actionAmount + 10)}>+10</Button>
              </div>

              <div className="space-y-2 pt-2">
                <Label className="text-xs text-gray-500 uppercase">Quick Presets</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setActionAmount(25)}>Tray (25)</Button>
                  <Button variant="secondary" size="sm" onClick={() => setActionAmount(50)}>Box (50)</Button>
                  <Button variant="secondary" size="sm" onClick={() => setActionAmount(150)}>Basket (150)</Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Reason (Optional for Add/Remove)</Label>
              <Input value={actionReason} onChange={(e) => setActionReason(e.target.value)} placeholder="e.g. Restock, Expired, Dispensed" />
            </div>
          </div>

          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button variant="destructive" onClick={() => handleProductAction('REMOVE')} disabled={loading}>
              Remove
            </Button>
            <Button variant="default" onClick={() => handleProductAction('ADD')} disabled={loading}>
              Add
            </Button>
            <Button variant="outline" onClick={() => handleProductAction('ADJUST')} disabled={loading}>
              Set Exact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vial Detection Dialog */}
      <Dialog open={showVialDetectionDialog} onOpenChange={setShowVialDetectionDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>AI Vial Detection</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Upload Tray Image</Label>
              <Input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="w-full"
              />
            </div>

            {vialDetectionImage && (
              <div className="space-y-3">
                <img
                  src={vialDetectionImage}
                  alt="Tray preview"
                  className="w-full h-48 object-cover rounded border"
                />
                <Button
                  variant="default"
                  onClick={analyzeVialTray}
                  disabled={vialDetectionLoading}
                  className="w-full"
                >
                  {vialDetectionLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Analyze with AI
                </Button>
                {vialCount > 0 && (
                  <div className="text-center p-3 bg-green-50 rounded-lg">
                    <div className="text-green-800 font-medium">Detected {vialCount} vials</div>
                    <div className="text-sm text-green-600">Use this count for your inventory</div>
                  </div>
                )}
              </div>
            )}
            {vialDetectionError && (
              <div className="text-red-600 text-sm p-3 bg-red-50 rounded border border-red-200">
                {vialDetectionError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVialDetectionDialog(false)}>
              Close
            </Button>
            {vialCount > 0 && (
              <Button
                variant="default"
                onClick={() => {
                  setGuidedQty(vialCount);
                  setShowVialDetectionDialog(false);
                }}
              >
                Use {vialCount} Vials
              </Button>
            )}
          </DialogFooter>
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
