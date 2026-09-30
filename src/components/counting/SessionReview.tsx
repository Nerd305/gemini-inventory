import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Download, CheckCircle, Upload, Loader2, ArrowLeft, AlertTriangle } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useLocations } from '../../hooks/useLocations';
import {
  activeTrays,
  clampInt,
  countedInSession,
  describeShelf,
  fetchTraysForBasket,
  liveBasketTotal,
  syncProductStockFromBaskets,
  type BasketDoc,
  type StockSyncResult,
} from '../../lib/inventory';

interface SessionReviewProps {
  sessionId: string | null;
  onComplete: () => Promise<void> | void;
  onBack: () => void;
}

interface BinRow {
  basketId: string;
  productId: string;
  productName: string;
  binName: string;
  shelfId: string | null;
  trayCount: number;
  traysCounted: number;
  looseVials: number;
  total: number;
  lots: string[];
}

export function SessionReview({ sessionId, onComplete, onBack }: SessionReviewProps) {
  const { user } = useAuth();
  const { nameOf } = useLocations();
  const [session, setSession] = useState<any>(null);
  const [rows, setRows] = useState<BinRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [syncResults, setSyncResults] = useState<StockSyncResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sessionId) {
        setLoading(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'countingSessions', sessionId));
        const data = snap.exists() ? snap.data() : null;
        if (cancelled) return;
        setSession(data);
        const basketIds: string[] = Array.isArray(data?.countedBaskets) ? data!.countedBaskets : [];
        const productNames = new Map<string, string>();
        const next: BinRow[] = [];
        for (const basketId of basketIds) {
          const basketSnap = await getDoc(doc(db, 'baskets', basketId));
          if (!basketSnap.exists()) continue;
          const b = basketSnap.data() as BasketDoc;
          if (!productNames.has(b.productId)) {
            try {
              const p = await getDoc(doc(db, 'products', b.productId));
              productNames.set(b.productId, p.exists() ? (p.data().name as string) || b.productId : b.productId);
            } catch {
              productNames.set(b.productId, b.productId);
            }
          }
          const trays = await fetchTraysForBasket(basketId);
          const active = activeTrays(trays);
          const lots = new Set<string>();
          let traysCounted = 0;
          for (const t of active) {
            if (countedInSession(t, sessionId)) traysCounted++;
            if (t.lotNumber) lots.add(t.lotNumber);
          }
          next.push({
            basketId,
            productId: b.productId,
            productName: productNames.get(b.productId) ?? b.productId,
            binName: b.name,
            shelfId: b.shelfId ?? null,
            trayCount: active.length,
            traysCounted,
            looseVials: clampInt(b.looseVials),
            total: typeof b.totalVials === 'number' ? b.totalVials : liveBasketTotal(trays, clampInt(b.looseVials)),
            lots: Array.from(lots),
          });
        }
        if (!cancelled) setRows(next);
      } catch (e) {
        console.error('Failed to load session review', e);
        if (!cancelled) setError('Could not load the session summary.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const totals = useMemo(() => {
    const vials = rows.reduce((s, r) => s + r.total, 0);
    const trays = rows.reduce((s, r) => s + r.traysCounted, 0);
    return { vials, trays, bins: rows.length };
  }, [rows]);

  const handleComplete = async () => {
    setIsCompleting(true);
    setError(null);
    try {
      if (user && rows.length > 0) {
        const results = await syncProductStockFromBaskets(
          rows.map((r) => r.productId),
          user.uid,
          sessionId,
        );
        setSyncResults(results);
      }
      await onComplete();
    } catch (e) {
      console.error('Complete & sync failed', e);
      setError(e instanceof Error ? e.message : 'Failed to sync product stock.');
    } finally {
      setIsCompleting(false);
    }
  };

  const handleExport = () => {
    if (rows.length === 0) {
      alert('No bins counted in this session.');
      return;
    }
    setIsExporting(true);
    try {
      const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
      const header = ['Bin ID', 'Bin', 'Product', 'Shelf', 'Trays', 'Trays Counted', 'Loose Vials', 'Total Vials', 'Lots'];
      const lines = [header.map(esc).join(',')];
      for (const r of rows) {
        lines.push(
          [
            r.basketId,
            r.binName,
            r.productName,
            describeShelf(r.shelfId, nameOf) || 'Unassigned',
            r.trayCount,
            r.traysCounted,
            r.looseVials,
            r.total,
            r.lots.join(' | '),
          ]
            .map(esc)
            .join(','),
        );
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `count_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <button type="button" onClick={onBack} className="flex items-center text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4 mr-1" /> Keep counting
        </button>
        <span className="text-xs text-gray-400">{session?.userName ?? ''}</span>
      </div>

      <Card className="mb-4">
        <CardHeader className="bg-teal-50 border-b border-teal-100">
          <CardTitle className="text-teal-800 flex items-center justify-between">
            <span>Session Summary</span>
            <CheckCircle className="h-5 w-5" />
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                  <p className="text-xs text-gray-500 mb-1">Vials</p>
                  <p className="text-2xl font-bold text-teal-600 tabular-nums">{totals.vials}</p>
                </div>
                <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                  <p className="text-xs text-gray-500 mb-1">Trays</p>
                  <p className="text-2xl font-bold text-gray-900 tabular-nums">{totals.trays}</p>
                </div>
                <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                  <p className="text-xs text-gray-500 mb-1">Bins</p>
                  <p className="text-2xl font-bold text-gray-900 tabular-nums">{totals.bins}</p>
                </div>
              </div>

              {rows.length === 0 ? (
                <p className="text-sm text-gray-500 text-center mt-4">
                  Nothing was counted in this session. Go back and scan a shelf, then a bin.
                </p>
              ) : (
                <div className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
                  {rows.map((r) => (
                    <div key={r.basketId} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{r.productName}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {r.binName}
                          {r.shelfId ? ` · ${describeShelf(r.shelfId, nameOf)}` : ''} · {r.traysCounted}/{r.trayCount} trays
                          {r.looseVials ? ` + ${r.looseVials} loose` : ''}
                          {r.traysCounted < r.trayCount ? ' · incomplete' : ''}
                        </p>
                      </div>
                      <p className="font-bold text-teal-700 tabular-nums ml-3">{r.total}</p>
                    </div>
                  ))}
                </div>
              )}

              {syncResults && syncResults.length > 0 && (
                <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
                  <p className="font-medium text-green-900 mb-1">Product stock updated</p>
                  {syncResults.map((r) => (
                    <p key={r.productId} className="text-green-800 text-xs">
                      {r.productName}: {r.previousStock} → <span className="font-bold">{r.newStock}</span> ({r.binCount} bin
                      {r.binCount === 1 ? '' : 's'})
                    </p>
                  ))}
                </div>
              )}

              {error && (
                <p className="mt-3 text-sm text-red-600 flex items-center">
                  <AlertTriangle className="h-4 w-4 mr-1" /> {error}
                </p>
              )}

              <div className="mt-4">
                <button
                  onClick={handleExport}
                  disabled={isExporting || rows.length === 0}
                  className="flex items-center justify-center gap-2 w-full py-3 px-4 border border-gray-300 rounded-lg text-gray-700 bg-white hover:bg-gray-50 font-medium transition-colors disabled:opacity-60"
                >
                  {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Export to CSV
                </button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="mt-auto pt-2">
        <p className="text-[11px] text-gray-500 text-center mb-2">
          Complete & Sync sets each counted product's stock to the total across all of its bins and logs a COUNT entry.
        </p>
        <button
          onClick={handleComplete}
          disabled={isCompleting || loading}
          className="w-full bg-teal-600 hover:bg-teal-700 text-white rounded-xl py-4 font-semibold text-lg flex items-center justify-center gap-2 shadow-md disabled:opacity-70"
        >
          {isCompleting ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></span>
              Syncing…
            </span>
          ) : (
            <>
              <Upload className="h-5 w-5" />
              {rows.length === 0 ? 'Close Session' : 'Complete & Sync'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

