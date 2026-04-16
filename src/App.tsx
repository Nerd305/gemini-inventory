/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Loader2 } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Scanner from './pages/Scanner';
import Products from './pages/Products';
import Locations from './pages/Locations';
import Reports from './pages/Reports';
import PrintStation from './pages/PrintStation';
import Settings from './pages/Settings';
import Layout from './components/Layout';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" />;
  }
  
  return <>{children}</>;
}

function Login() {
  const { user, signIn } = useAuth();
  
  if (user) {
    return <Navigate to="/" />;
  }
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold flex items-center justify-center">
            MedInventory
            <span className="ml-2 text-[10px] font-mono bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">v1.0.2</span>
          </CardTitle>
          <CardDescription>Sign in to manage medication inventory</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button onClick={signIn} size="lg" className="w-full">
            Sign in with Google
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="scan" element={<Scanner />} />
            <Route path="products" element={<Products />} />
            <Route path="locations" element={<Locations />} />
            <Route path="reports" element={<Reports />} />
            <Route path="print-station" element={<PrintStation />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
}
