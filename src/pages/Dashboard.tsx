import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, orderBy, limit, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { AlertTriangle, Package, Activity, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

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

export default function Dashboard() {
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([]);
  const [recentLogs, setRecentLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [productsMap, setProductsMap] = useState<Record<string, string>>({});

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

    return () => {
      unsubProducts();
      unsubLogs();
    };
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Low Stock Alerts */}
        <Card className="border-red-200">
          <CardHeader className="bg-red-50 border-b border-red-100 pb-4">
            <CardTitle className="flex items-center text-red-700">
              <AlertTriangle className="h-5 w-5 mr-2" />
              Low Stock Alerts
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
    </div>
  );
}
