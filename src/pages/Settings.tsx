import React, { useState } from 'react';
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { AlertTriangle, Loader2, Settings as SettingsIcon } from 'lucide-react';

export default function Settings() {
  const { user } = useAuth();
  const [step, setStep] = useState(0); // 0: none, 1: first confirm, 2: second confirm
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const handleFactoryReset = async () => {
    if (confirmText !== 'RESET') return;
    setIsDeleting(true);
    try {
      const collections = ['products', 'locations', 'baskets', 'inventoryLogs', 'printJobs'];
      
      for (const col of collections) {
        const snapshot = await getDocs(collection(db, col));
        const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, col, d.id)));
        await Promise.all(deletePromises);
      }
      
      alert('Factory reset complete. All data has been purged.');
      setStep(0);
      setConfirmText('');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.DELETE, 'multiple');
      alert(`Error during reset: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      </div>

      <Card className="border-red-200 bg-red-50/30">
        <CardHeader>
          <CardTitle className="text-red-700 flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            Danger Zone
          </CardTitle>
          <CardDescription className="text-red-600/80">
            Irreversible actions that affect the entire application.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 bg-white rounded-lg border border-red-100 shadow-sm">
            <div className="mb-4 sm:mb-0">
              <h3 className="font-semibold text-gray-900">Factory Reset</h3>
              <p className="text-sm text-gray-500">Permanently delete all products, locations, inventory logs, and print jobs.</p>
            </div>
            <Button variant="destructive" onClick={() => setStep(1)}>
              Factory Reset App
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* First Confirmation Dialog */}
      <Dialog open={step === 1} onOpenChange={(open) => !open && setStep(0)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2" />
              Are you absolutely sure?
            </DialogTitle>
            <DialogDescription className="pt-4 text-base text-gray-700">
              This action will <strong>permanently delete</strong> all data in the application, including:
              <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
                <li>All Products</li>
                <li>All Locations</li>
                <li>All Baskets and Inventory Counts</li>
                <li>All History and Logs</li>
                <li>All Print Jobs</li>
              </ul>
              <br />
              This action cannot be undone. Do you wish to proceed?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setStep(0)}>Cancel</Button>
            <Button variant="destructive" onClick={() => setStep(2)}>Yes, I understand</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Second Confirmation Dialog */}
      <Dialog open={step === 2} onOpenChange={(open) => !open && setStep(0)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Final Confirmation</DialogTitle>
            <DialogDescription className="pt-2">
              To confirm the factory reset, please type <strong>RESET</strong> in the box below.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="confirm" className="sr-only">Confirm Reset</Label>
            <Input 
              id="confirm" 
              value={confirmText} 
              onChange={(e) => setConfirmText(e.target.value)} 
              placeholder="Type RESET here"
              className="border-red-300 focus-visible:ring-red-500"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setStep(0); setConfirmText(''); }} disabled={isDeleting}>Cancel</Button>
            <Button 
              variant="destructive" 
              onClick={handleFactoryReset} 
              disabled={confirmText !== 'RESET' || isDeleting}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isDeleting ? 'Purging Data...' : 'Purge All Data'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
