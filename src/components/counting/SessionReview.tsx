import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Download, CheckCircle, Upload, Loader2 } from 'lucide-react';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';

interface SessionReviewProps {
  session: any; // Using any for simplicity in this template
  onComplete: () => void;
}

export function SessionReview({ session, onComplete }: SessionReviewProps) {
  const [isCompleting, setIsCompleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleComplete = async () => {
    setIsCompleting(true);
    await onComplete();
    setIsCompleting(false);
  };

  const handleExport = async () => {
    if (!session?.countedBaskets || session.countedBaskets.length === 0) {
      alert('No baskets counted in this session.');
      return;
    }
    
    setIsExporting(true);
    try {
      const rows = [['Basket ID', 'Product Name', 'Shelf ID', 'Total Vials']];
      
      for (const basketId of session.countedBaskets) {
        const basketSnap = await getDoc(doc(db, 'baskets', basketId));
        if (!basketSnap.exists()) continue;
        const basketData = basketSnap.data();
        
        let productName = basketData.productId || 'Unknown';
        if (basketData.productId) {
          const prodSnap = await getDoc(doc(db, 'products', basketData.productId));
          if (prodSnap.exists()) {
            productName = prodSnap.data().name || productName;
          }
        }
        
        const traysSnap = await getDocs(collection(db, 'baskets', basketId, 'trays'));
        let sum = 0;
        traysSnap.forEach(t => {
          sum += t.data().count || 0;
        });
        
        rows.push([
          basketId,
          `"${productName.replace(/"/g, '""')}"`,
          basketData.shelfId || 'Unassigned',
          sum.toString()
        ]);
      }
      
      const csvContent = rows.map(r => r.join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `session_export_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error('Export failed', e);
      alert('Failed to export session data.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 p-4 pb-24">
      <Card className="mb-4">
        <CardHeader className="bg-teal-50 border-b border-teal-100">
          <CardTitle className="text-teal-800 flex items-center justify-between">
            <span>Session Summary</span>
            <CheckCircle className="h-5 w-5" />
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="bg-white p-4 rounded-lg border border-gray-100 shadow-sm">
              <p className="text-sm text-gray-500 mb-1">Total Vials</p>
              <p className="text-3xl font-bold text-teal-600">{session?.progress?.totalVials || 0}</p>
            </div>
            <div className="bg-white p-4 rounded-lg border border-gray-100 shadow-sm">
              <p className="text-sm text-gray-500 mb-1">Baskets</p>
              <p className="text-3xl font-bold text-gray-900">{session?.countedBaskets?.length || session?.progress?.basketsCounted || 0}</p>
            </div>
          </div>
          
          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="flex items-center justify-center gap-2 w-full py-3 px-4 border border-gray-300 rounded-lg text-gray-700 bg-white hover:bg-gray-50 font-medium transition-colors disabled:opacity-70"
            >
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isExporting ? 'Exporting...' : 'Export to CSV'}
            </button>
          </div>
        </CardContent>
      </Card>
      
      <div className="mt-auto pt-4">
        <button
          onClick={handleComplete}
          disabled={isCompleting}
          className="w-full bg-teal-600 hover:bg-teal-700 text-white rounded-xl py-4 font-semibold text-lg flex items-center justify-center gap-2 shadow-md disabled:opacity-70"
        >
          {isCompleting ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></span>
              Completing...
            </span>
          ) : (
            <>
              <Upload className="h-5 w-5" />
              Complete & Sync
            </>
          )}
        </button>
      </div>
    </div>
  );
}
