import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Download, CheckCircle, Upload, Loader2, ArrowLeft } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { basketTotal, getLocation, toBasketRecord, type FridgeLocation } from '../../lib/inventory';
import { parseShelfId } from '../../lib/scanCodes';

interface SessionReviewProps {
  session: any; // raw countingSessions doc data
  onComplete: () => void | Promise<void>;
  onResume?: () => void;
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function SessionReview({ session, onComplete, onResume }: SessionReviewProps) {
  const [isCompleting, setIsCompleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleComplete = async () => {
    setIsCompleting(true);
    await onComplete();
    setIsCompleting(false);
  };

  const handleExport = async () => {
    const ids: string[] = Array.isArray(session?.countedBaskets) ? session.countedBaskets : [];
    if (ids.length === 0) {
      alert('No baskets counted in this session.');
      return;
    }

    setIsExporting(true);
    try {
      const rows: string[][] = [
        ['Basket ID', 'Product', 'Lot', 'Fridge', 'Shelf', 'Slot', 'Full trays', 'Vials per tray', 'Loose vials', 'Total vials', 'Last counted'],
      ];
      const productNames = new Map<string, string>();
      const locations = new Map<string, FridgeLocation | null>();

      for (const basketId of ids) {
        const basketSnap = await getDoc(doc(db, 'baskets', basketId));
        if (!basketSnap.exists()) continue;
        const basket = toBasketRecord(basketSnap.id, basketSnap.data());

        let productName = productNames.get(basket.productId);
        if (productName === undefined) {
          productName = basket.name || basket.productId;
          try {
            const prodSnap = await getDoc(doc(db, 'products', basket.productId));
            if (prodSnap.exists()) productName = prodSnap.data().name || productName;
          } catch {
            // keep fallback
          }
          productNames.set(basket.productId, productName);
        }

        if (!locations.has(basket.locationId)) {
          locations.set(basket.locationId, await getLocation(basket.locationId).catch(() => null));
        }
        const fridgeName = locations.get(basket.locationId)?.name ?? basket.locationId;
        const shelf = parseShelfId(basket.shelfId);

        rows.push([
          basket.id,
          productName,
          basket.lotNumber,
          fridgeName,
          shelf ? String(shelf.shelfNumber) : basket.shelfId ?? '',
          basket.shelfPosition ? String(basket.shelfPosition) : '',
          String(basket.trayCount),
          String(basket.vialsPerTray),
          String(basket.looseVials),
          String(basketTotal(basket)),
          basket.lastCountedAt ?? '',
        ]);
      }

      const csvContent = rows.map((r) => r.map(csvCell).join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `count_${new Date().toISOString().split('T')[0]}.csv`);
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

  const baskets = session?.countedBaskets?.length || session?.progress?.basketsCounted || 0;
  const vials = session?.progress?.totalVials || 0;
  const net = Number(session?.progress?.netDelta) || 0;

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
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">Baskets</p>
              <p className="text-2xl font-bold text-gray-900 tabular-nums">{baskets}</p>
            </div>
            <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">Vials counted</p>
              <p className="text-2xl font-bold text-teal-600 tabular-nums">{vials}</p>
            </div>
            <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">Net change</p>
              <p className={`text-2xl font-bold tabular-nums ${net > 0 ? 'text-green-600' : net < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {net > 0 ? '+' : ''}
                {net}
              </p>
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
            {onResume && (
              <button
                onClick={onResume}
                className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-lg text-teal-800 bg-teal-50 hover:bg-teal-100 font-medium transition-colors"
              >
                <ArrowLeft className="h-4 w-4" /> Keep counting
              </button>
            )}
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
              Complete session
            </>
          )}
        </button>
      </div>
    </div>
  );
}
