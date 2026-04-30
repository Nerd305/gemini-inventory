import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, onSnapshot, orderBy, limit, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { AlertTriangle, Activity, Loader2, ScanLine, RefreshCcw } from 'lucide-react';
import { format } from 'date-fns';
import { LiveSessionCard } from '../components/counting/LiveSessionCard';
import { HelpTooltip } from '../components/HelpTooltip';

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

interface CountingSession {
  id: string;
  userName: string;
  status: string;
  progress: {
    basketsCounted: number;
    totalVials: number;
  };
  startedAt: string;
  locationId: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([]);
  const [recentLogs, setRecentLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [productsMap, setProductsMap] = useState<Record<string, string>>({});
  const [activeSessions, setActiveSessions] = useState<CountingSession[]>([]);

  useEffect(() => {
    // Listen to all products to build map and find low stock
    const qProducts = query(collection(db, 'products'));
    const unsubProducts = onSnapshot(qProducts, (snapshot) => {
      const prods: Product[] = [];
      const pMap: Record<string, string> = {};
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        pMap[doc.id] = data.name;
        if (data.currentStock <= data.reorderPoint) {
          prods.push({ id: doc.id, ...data } as Product);
        }
      });
      
      setProductsMap(pMap);
      setLowStockProducts(prods);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'products');
    });

    // Listen to recent logs
    const qLogs = query(collection(db, 'inventoryLogs'), orderBy('timestamp', 'desc'), limit(10));
    const unsubLogs = onSnapshot(qLogs, (snapshot) => {
      const logs: Log[] = [];
      snapshot.forEach((doc) => {
        logs.push({ id: doc.id, ...doc.data() } as Log);
      });
      setRecentLogs(logs);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'inventoryLogs');
    });

    // Listen to active counting sessions
    const qSessions = query(collection(db, 'countingSessions'), where('status', 'in', ['active', 'paused']));
    const unsubSessions = onSnapshot(qSessions, (snapshot) => {
      const sessions: CountingSession[] = [];
      snapshot.forEach((doc) => {
        sessions.push({ id: doc.id, ...doc.data() } as CountingSession);
      });
      setActiveSessions(sessions);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'countingSessions');
    });

    return () => {
      unsubProducts();
      unsubLogs();
      unsubSessions();
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex items-center text-sm px-3 py-1.5 bg-green-50 text-green-700 rounded-full border border-green-200 shadow-sm">
          <RefreshCcw className="h-3.5 w-3.5 mr-2" />
          <span className="font-medium">API Sync: Active</span>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {activeSessions.length > 0 && (
          <div className="md:col-span-2">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <ScanLine className="h-5 w-5 mr-2 text-teal-600" />
              Live Counting Sessions
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeSessions.map(session => (
                <LiveSessionCard key={session.id} session={session} />
              ))}
            </div>
          </div>
        )}
        
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
              <div className="p-6 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-red-500" /></div>
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
                  {lowStockProducts.map(product => (
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
              <div className="p-6 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-500" /></div>
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
                  {recentLogs.map(log => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          log.action === 'ADD' ? 'bg-green-100 text-green-800' : 
                          log.action === 'REMOVE' ? 'bg-red-100 text-red-800' : 
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {log.action} {log.amount}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{productsMap[log.productId] || 'Unknown'}</TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {format(new Date(log.timestamp), 'MMM d, h:mm a')}
                      </TableCell>
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
