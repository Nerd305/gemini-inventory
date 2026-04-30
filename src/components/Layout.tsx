import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { LayoutDashboard, ScanLine, Package, MapPin, BarChart3, LogOut, Printer, Wifi, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { APP_VERSION } from '../lib/version';
import { collection, getDocs, query, limit } from 'firebase/firestore';
import { db } from '../firebase';

export default function Layout() {
  const { logOut, user } = useAuth();
  const location = useLocation();
  const [isPinging, setIsPinging] = useState(false);

  const handlePing = async () => {
    setIsPinging(true);
    try {
      const start = Date.now();
      await getDocs(query(collection(db, 'products'), limit(1)));
      const end = Date.now();
      alert(`Database connection established! Ping: ${end - start}ms`);
    } catch (error: any) {
      alert(`Connection error: ${error.message}`);
    } finally {
      setIsPinging(false);
    }
  };

  const navItems = [
    { name: 'Dashboard', shortName: 'Home', path: '/', icon: LayoutDashboard },
    { name: 'Scan', shortName: 'Scan', path: '/scan', icon: ScanLine },
    { name: 'Products', shortName: 'Items', path: '/products', icon: Package },
    { name: 'Locations', shortName: 'Places', path: '/locations', icon: MapPin },
    { name: 'Reports', shortName: 'Stats', path: '/reports', icon: BarChart3 },
    { name: 'Print Station', shortName: 'Print', path: '/print-station', icon: Printer },
    { name: 'Settings', shortName: 'More', path: '/settings', icon: SettingsIcon },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b sticky top-0 z-10 pt-safe">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <span className="text-xl font-bold text-blue-600">MedInventory</span>
              <span className="ml-2 text-[10px] font-mono bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">v{APP_VERSION}</span>
            </div>
            <div className="flex items-center space-x-2 sm:space-x-4">
              <Button variant="outline" size="sm" onClick={handlePing} disabled={isPinging} className="hidden sm:flex h-8">
                <Wifi className={cn("h-4 w-4 mr-2", isPinging && "animate-pulse text-blue-500")} />
                {isPinging ? 'Pinging...' : 'Test DB'}
              </Button>
              <span className="text-sm text-gray-500 hidden sm:block">{user?.email}</span>
              <Button variant="ghost" size="icon" onClick={logOut} title="Log out">
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-8">
        <Outlet />
      </main>

      {/* Mobile Navigation */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around px-1 pt-2 pb-safe z-10">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-1 flex-col items-center justify-center px-1 py-1.5 rounded-lg text-[10px] font-medium min-w-0",
                isActive ? "text-blue-600" : "text-gray-500 hover:text-gray-900"
              )}
            >
              <Icon className="h-5 w-5 mb-0.5 shrink-0" />
              <span className="truncate w-full text-center leading-tight">{item.shortName}</span>
            </Link>
          );
        })}
      </nav>

      {/* Desktop Navigation (Sidebar-like, but we'll use top nav for simplicity or just keep it simple) */}
      <div className="hidden sm:flex fixed left-0 top-16 bottom-0 w-64 bg-white border-r flex-col py-4">
        <div className="flex-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center px-6 py-3 text-sm font-medium",
                  isActive ? "bg-blue-50 text-blue-600 border-r-2 border-blue-600" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <Icon className="h-5 w-5 mr-3" />
                {item.name}
              </Link>
            );
          })}
        </div>
        <div className="px-6 py-4 border-t">
          <p className="text-xs text-gray-400 font-mono">v{APP_VERSION}</p>
        </div>
      </div>
      
      {/* Adjust main content margin for desktop sidebar */}
      <style>{`
        @media (min-width: 640px) {
          main {
            margin-left: 16rem;
            width: calc(100% - 16rem);
          }
        }
      `}</style>
    </div>
  );
}
