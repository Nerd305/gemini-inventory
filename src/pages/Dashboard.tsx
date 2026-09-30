import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { collection, query, onSnapshot, orderBy, limit, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { AlertTriangle, Activity, Loader2, ScanLine, RefreshCcw, ClipboardCheck, Boxes, ListChecks, Star } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { LiveSessionCard, type CountingSessionData } from '../components/counting/LiveSessionCard';
import { HelpTooltip } from '../components/HelpTooltip';
import { activeTraysQuery, basketTotal, budStatus, daysUntilBud, describeShelf, fifoOrder, formatBud, trayRecordFromSnapshot, type BasketDoc, type TrayRecord } from '../lib/inventory';
import { useLocations } from '../hooks/useLocations';
import SetupGuide, { readSetupGuideStore, writeSetupGuideStore } from '../components/SetupGuide';

interface Product {
  id: string;
  name: string;
  currentStock: number;
  reorderPoint: number;
}

interface Log {
  id: string;
  productId: string;
  action: string;
  amount: number;
  reason: string;
  timestamp: string;
  productName?: string;
}

interface BinRecord extends BasketDoc {
  id: string;
}

const LIVE_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 7;

export default function Dashboard() {
  const navigate = useNavigate();
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([]);
  const [recentLogs, setRecentLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [productsMap, setProductsMap] = useState<Record<string, string>>({});
  const [activeSessions, setActiveSessions] = useState<CountingSessionData[]>([]);
  const [bins, setBins] = useState<BinRecord[]>([]);
  const [trays, setTrays] = useState<TrayRecord[]>([]);
  const { nameOf } = useLocations();
  const [productCount, setProductCount] = useState(0);
  const [guideHidden, setGuideHidden] = useState<boolean>(() => Boolean(readSetupGuideStore().hidden));

  const setGuideVisibility = (hidden: boolean) => {
    setGuideHidden(hidden);
    writeSetupGuideStore({ ...readSetupGuideStore(), hidden });
  };

  useEffect(() => {
    // Listen to all products to build map and find low stock
    const qProducts = query(collection(db, 'products'));
    const unsubProducts = onSnapshot(
      qProducts,
      (snapshot) => {
        const prods: Product[] = [];
        const pMap: Record<string, string> = {};

        snapshot.forEach((d) => {
          const data = d.data();
          pMap[d.id] = data.name;
          if (data.currentStock <= data.reorderPoint) {
            prods.push({ id: d.id, ...data } as Product);
          }
        });

        setProductsMap(pMap);
        setProductCount(snapshot.size);
        setLowStockProducts(prods);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'products');
      },
    );

    // Listen to recent logs
    const qLogs = query(collection(db, 'inventoryLogs'), orderBy('timestamp', 'desc'), limit(10));
    const unsubLogs = onSnapshot(
      qLogs,
      (snapshot) => {
        const logs: Log[] = [];
        snapshot.forEach((d) => {
          logs.push({ id: d.id, ...d.data() } as Log);
        });
        setRecentLogs(logs);
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'inventoryLogs');
      },
    );

    // Listen to active counting sessions (only ones started in the last 24h — older paused
    // sessions can't be resumed and would sit here forever).
    const qSessions = query(collection(db, 'countingSessions'), where('status', 'in', ['active', 'paused']));
    const unsubSessions = onSnapshot(
      qSessions,
      (snapshot) => {
        const cutoff = Date.now() - LIVE_SESSION_WINDOW_MS;
        const sessions: CountingSessionData[] = [];
        snapshot.forEach((d) => {
          const s = { id: d.id, ...d.data() } as CountingSessionData;
          const started = Date.parse(s.startedAt);
          if (Number.isFinite(started) && started < cutoff) return;
          sessions.push(s);
        });
        sessions.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
        setActiveSessions(sessions);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'countingSessions');
      },
    );

    // Bins → count coverage
    const unsubBins = onSnapshot(
      query(collection(db, 'baskets')),
      (snapshot) => {
        const next: BinRecord[] = [];
        snapshot.forEach((d) => next.push({ id: d.id, ...(d.data() as BasketDoc) }));
        setBins(next);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'baskets');
      },
    );

    // Active trays → FIFO / expiring card
    const unsubTrays = onSnapshot(
      activeTraysQuery(),
      (snapshot) => {
        const next: TrayRecord[] = [];
        snapshot.forEach((d) => {
          const t = trayRecordFromSnapshot(d.id, d.data());
          if (t) next.push(t);
        });
        setTrays(next);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'trays');
      },
    );

    return () => {
      unsubProducts();
      unsubLogs();
      unsubSessions();
      unsubBins();
      unsubTrays();
    };
  }, []);

  const coverage = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const staleCutoff = now.getTime() - STALE_DAYS * 86_400_000;
    let countedToday = 0;
    let vialsOnHand = 0;
    const stale: BinRecord[] = [];
    for (const b of bins) {
      vialsOnHand += basketTotal(b);
      const t = b.lastCountedAt ? Date.parse(b.lastCountedAt) : NaN;
      if (Number.isFinite(t) && t >= startOfToday) countedToday++;
      if (!Number.isFinite(t) || t < staleCutoff) stale.push(b);
    }
    stale.sort((a, b) => {
      const ta = a.lastCountedAt ? Date.parse(a.lastCountedAt) : 0;
      const tb = b.lastCountedAt ? Date.parse(b.lastCountedAt) : 0;
      return ta - tb;
    });
    return { total: bins.length, countedToday, vialsOnHand, stale };
  }, [bins]);

  const coveragePct = coverage.total === 0 ? 0 : Math.round((100 * coverage.countedToday) / coverage.total);

  // Trays with a BUD, soonest first: expired, then within 60 days.
  const fifo = useMemo(() => {
    const ordered = fifoOrder(trays).filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.bud ?? ''));
    const upcoming = ordered.filter((t) => {
      const d = daysUntilBud(t.bud);
      return d !== null && d <= 60;
    });
    return { dated: ordered.length, upcoming, expired: ordered.filter((t) => budStatus(t.bud) === 'expired').length };
  }, [trays]);
  const binById = useMemo(() => {
    const m: Record<string, BinRecord> = {};
    for (const b of bins) m[b.id] = b;
    return m;
  }, [bins]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex items-center gap-2">
          {guideHidden && (
            <button
              type="button"
              onClick={() => setGuideVisibility(false)}
              className="flex items-center text-xs px-2.5 py-1.5 text-blue-700 bg-blue-50 rounded-full border border-blue-200 hover:bg-blue-100"
              title="Show the setup checklist"
            >
              <ListChecks className="h-3.5 w-3.5 mr-1.5" /> Setup guide
            </button>
          )}
          <div className="flex items-center text-sm px-3 py-1.5 bg-green-50 text-green-700 rounded-full border border-green-200 shadow-sm">
            <RefreshCcw className="h-3.5 w-3.5 mr-2" />
            <span className="font-medium">API Sync: Active</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {!guideHidden && (
          <SetupGuide bins={bins} productCount={productCount} ready={!loading} onHide={() => setGuideVisibility(true)} />
        )}

        {activeSessions.length > 0 && (
          <div className="md:col-span-2">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <ScanLine className="h-5 w-5 mr-2 text-teal-600" />
              Live Counting Sessions
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeSessions.map((session) => (
                <LiveSessionCard key={session.id} session={session} />
              ))}
            </div>
          </div>
        )}

        {/* Count coverage */}
        <Card className="border-teal-200 md:col-span-2">
          <CardHeader className="bg-teal-50 border-b border-teal-100 pb-4">
            <CardTitle className="flex items-center text-teal-800">
              <ClipboardCheck className="h-5 w-5 mr-2" />
              Today's Count
              <HelpTooltip content="How many bins have been finished in a counting session today, and which bins haven't been counted in over a week." />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            {coverage.total === 0 ? (
              <div className="text-center text-gray-500 text-sm">
                No bins set up yet.{' '}
                <Link to="/bins" className="text-teal-700 underline">
                  Add bins
                </Link>{' '}
                for each basket in the fridge to track counts per bin.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <div className="flex items-end justify-between mb-2">
                    <div>
                      <p className="text-3xl font-bold text-gray-900 tabular-nums">
                        {coverage.countedToday}
                        <span className="text-lg font-medium text-gray-400"> / {coverage.total} bins</span>
                      </p>
                      <p className="text-sm text-gray-500">counted today</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-teal-700 tabular-nums">{coverage.vialsOnHand.toLocaleString()}</p>
                      <p className="text-sm text-gray-500">vials on hand</p>
                    </div>
                  </div>
                  <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-teal-500 transition-all" style={{ width: `${coveragePct}%` }} />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{coveragePct}% of bins finished today</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5 flex items-center">
                    <Boxes className="h-3.5 w-3.5 mr-1" /> Needs a count ({coverage.stale.length})
                  </p>
                  {coverage.stale.length === 0 ? (
                    <p className="text-sm text-green-700">Every bin was counted in the last {STALE_DAYS} days.</p>
                  ) : (
                    <ul className="space-y-1">
                      {coverage.stale.slice(0, 5).map((b) => (
                        <li key={b.id} className="text-sm flex justify-between gap-2">
                          <span className="truncate text-gray-800">{b.name || productsMap[b.productId] || b.id}</span>
                          <span className="text-xs text-amber-600 shrink-0">
                            {b.lastCountedAt ? `${formatDistanceToNow(new Date(b.lastCountedAt))} ago` : 'never'}
                          </span>
                        </li>
                      ))}
                      {coverage.stale.length > 5 && (
                        <li className="text-xs text-gray-500">
                          <Link to="/bins" className="underline">
                            +{coverage.stale.length - 5} more under Bins
                          </Link>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* FIFO: which trays to use first / expiring BUDs */}
        <Card className="border-amber-200 md:col-span-2">
          <CardHeader className="bg-amber-50 border-b border-amber-100 pb-4">
            <CardTitle className="flex items-center text-amber-900">
              <Star className="h-5 w-5 mr-2" />
              Use First · Expiring BUDs
              <HelpTooltip content="Trays whose beyond-use date is past or within 60 days, earliest first, across every bin. Pull from these before anything else. BUDs come from the tray label (AI-read during a count, or entered under Bins)." />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {fifo.dated === 0 ? (
              <div className="p-6 text-center text-gray-500 text-sm">
                No tray BUDs recorded yet. Photograph the tray label during a count (AI count) or add lot / BUD to each tray under{' '}
                <Link to="/bins" className="text-teal-700 underline">Bins</Link>.
              </div>
            ) : fifo.upcoming.length === 0 ? (
              <div className="p-6 text-center text-green-700 text-sm">Nothing expires in the next 60 days across {fifo.dated} dated trays.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product · bin</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead className="text-right">BUD</TableHead>
                    <TableHead className="text-right">Vials</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fifo.upcoming.slice(0, 8).map((t) => {
                    const bin = binById[t.basketId];
                    const days = daysUntilBud(t.bud);
                    const status = budStatus(t.bud);
                    return (
                      <TableRow key={t.id}>
                        <TableCell>
                          <p className="font-medium text-gray-900">{productsMap[t.productId] || bin?.name || 'Product'}</p>
                          <p className="text-xs text-gray-500">
                            {bin?.name ? `${bin.name} · ` : ''}Tray {t.slot}
                            {bin?.shelfId ? ` · ${describeShelf(bin.shelfId, nameOf)}` : ''}
                          </p>
                        </TableCell>
                        <TableCell className="text-sm text-gray-700">{t.lotNumber || '—'}</TableCell>
                        <TableCell className={`text-right text-sm font-semibold ${status === 'expired' ? 'text-red-600' : 'text-amber-700'}`}>
                          {formatBud(t.bud)}
                          <span className="block text-[11px] font-normal">{days !== null && days < 0 ? `expired ${-days}d ago` : `${days}d left`}</span>
                        </TableCell>
                        <TableCell className="text-right font-bold tabular-nums">{t.countedAt ? t.count : '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {fifo.upcoming.length > 8 && (
              <p className="px-4 py-2 text-xs text-gray-500">+{fifo.upcoming.length - 8} more · see each product under Products or Bins.</p>
            )}
          </CardContent>
        </Card>

        {/* Low Stock Alerts */}
        <Card className="border-red-200">
          <CardHeader className="bg-red-50 border-b border-red-100 pb-4">
            <CardTitle className="flex items-center text-red-700">
              <AlertTriangle className="h-5 w-5 mr-2" />
              Low Stock Alerts
              <HelpTooltip content="Products that have reached or fallen below their set minimum reorder point. These items should be restocked immediately." />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-red-500" />
              </div>
            ) : lowStockProducts.length === 0 ? (
              <div className="p-6 text-center text-gray-500">All products are adequately stocked.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Stock / Reorder</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowStockProducts.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell className="font-medium">{product.name}</TableCell>
                      <TableCell className="text-right text-red-600 font-bold">
                        {product.currentStock} / {product.reorderPoint}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader className="bg-gray-50 border-b pb-4">
            <CardTitle className="flex items-center text-gray-700">
              <Activity className="h-5 w-5 mr-2" />
              Recent Activity
              <HelpTooltip content="A live feed of all inventory changes across the facility, including manual adjustments, API syncs, and counting sessions." />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
              </div>
            ) : recentLogs.length === 0 ? (
              <div className="p-6 text-center text-gray-500">No recent activity.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            log.action === 'ADD'
                              ? 'bg-green-100 text-green-800'
                              : log.action === 'REMOVE'
                              ? 'bg-red-100 text-red-800'
                              : log.action === 'COUNT'
                              ? 'bg-teal-100 text-teal-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {log.action} {log.amount}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{productsMap[log.productId] || 'Unknown'}</TableCell>
                      <TableCell className="text-sm text-gray-500">{format(new Date(log.timestamp), 'MMM d, h:mm a')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <button
        type="button"
        onClick={() => navigate('/count')}
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 sm:bottom-8 sm:right-8 z-20 flex items-center gap-2 rounded-full bg-teal-600 px-5 py-3.5 text-white shadow-lg hover:bg-teal-700 active:scale-95 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2"
        aria-label="Start Count"
      >
        <ScanLine className="h-6 w-6" />
        <span className="font-semibold">Start Count</span>
      </button>
    </div>
  );
}
