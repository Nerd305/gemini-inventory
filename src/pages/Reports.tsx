import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, orderBy, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { format, parseISO, subDays } from 'date-fns';
import { Loader2 } from 'lucide-react';

interface Log {
  id: string;
  productId: string;
  action: string;
  amount: number;
  timestamp: string;
}

export default function Reports() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState<any[]>([]);
  const [turnoverData, setTurnoverData] = useState<any[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'inventoryLogs'), orderBy('timestamp', 'asc'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const fetchedLogs: Log[] = [];
      snapshot.forEach((doc) => {
        fetchedLogs.push({ id: doc.id, ...doc.data() } as Log);
      });
      setLogs(fetchedLogs);
      
      // Process data for charts
      const last7Days = Array.from({length: 7}, (_, i) => {
        const d = subDays(new Date(), 6 - i);
        return format(d, 'MMM dd');
      });

      const dailyStats: Record<string, { date: string, added: number, removed: number }> = {};
      last7Days.forEach(day => {
        dailyStats[day] = { date: day, added: 0, removed: 0 };
      });

      // Product turnover
      const productTurnover: Record<string, number> = {};

      // Fetch products to map IDs to names
      const productsSnapshot = await getDocs(collection(db, 'products'));
      const productsMap: Record<string, string> = {};
      productsSnapshot.forEach(doc => {
        productsMap[doc.id] = doc.data().name;
      });

      fetchedLogs.forEach(log => {
        const dateStr = format(parseISO(log.timestamp), 'MMM dd');
        if (dailyStats[dateStr]) {
          if (log.action === 'ADD') dailyStats[dateStr].added += log.amount;
          if (log.action === 'REMOVE') dailyStats[dateStr].removed += log.amount;
        }

        if (log.action === 'REMOVE') {
          const pName = productsMap[log.productId] || log.productId;
          productTurnover[pName] = (productTurnover[pName] || 0) + log.amount;
        }
      });

      setChartData(Object.values(dailyStats));
      
      const tData = Object.entries(productTurnover)
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5); // Top 5
      setTurnoverData(tData);

      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'inventoryLogs');
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Inventory Movement (Last 7 Days)</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="added" stroke="#10b981" name="Items Added" strokeWidth={2} />
                <Line type="monotone" dataKey="removed" stroke="#ef4444" name="Items Removed" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Products Turnover (Usage)</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            {turnoverData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={turnoverData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="amount" fill="#3b82f6" name="Total Dispensed" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                No usage data available yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
