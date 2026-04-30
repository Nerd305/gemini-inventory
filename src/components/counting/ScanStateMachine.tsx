import { useCountingSession } from '../../contexts/CountingSessionContext';
import { Layers, Package, Boxes, ScanLine, AlertCircle } from 'lucide-react';

export default function ScanStateMachine() {
  const { lastScan, activeShelfId, activeBasketId } = useCountingSession();

  if (!lastScan) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center px-6 text-gray-500">
        <ScanLine className="h-10 w-10 mb-3 text-teal-500" />
        <p className="text-base font-medium text-gray-800">Ready to scan</p>
        <p className="text-sm mt-1">Point the camera at a Shelf, Basket, or Tray QR code.</p>
      </div>
    );
  }

  if (lastScan.prefix === 'SHELF') {
    return (
      <div className="flex h-full flex-col justify-center px-6">
        <div className="flex items-center text-teal-700 mb-2">
          <Layers className="h-5 w-5 mr-2" />
          <span className="text-xs font-bold uppercase tracking-wide">Shelf Selected</span>
        </div>
        <p className="text-2xl font-semibold text-gray-900">Shelf {activeShelfId}</p>
        <p className="text-sm text-gray-600 mt-2">Pull a basket and scan its QR code.</p>
      </div>
    );
  }

  if (lastScan.prefix === 'BSKT') {
    return (
      <div className="flex h-full flex-col justify-center px-6">
        <div className="flex items-center text-teal-700 mb-2">
          <Package className="h-5 w-5 mr-2" />
          <span className="text-xs font-bold uppercase tracking-wide">Basket Scanned</span>
        </div>
        <p className="text-2xl font-semibold text-gray-900">Basket {activeBasketId}</p>
        <p className="text-sm text-gray-600 mt-2">Details [To be built in Phase 3]</p>
      </div>
    );
  }

  if (lastScan.prefix === 'TRAY') {
    return (
      <div className="flex h-full flex-col justify-center px-6">
        <div className="flex items-center text-teal-700 mb-2">
          <Boxes className="h-5 w-5 mr-2" />
          <span className="text-xs font-bold uppercase tracking-wide">Tray Scanned</span>
        </div>
        <p className="text-2xl font-semibold text-gray-900">Tray {lastScan.id}</p>
        <p className="text-sm text-gray-600 mt-2">Count [To be built in Phase 3]</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center text-center px-6 text-gray-500">
      <AlertCircle className="h-8 w-8 mb-2 text-amber-500" />
      <p className="text-sm font-medium text-gray-800">Unrecognized code</p>
      <p className="text-xs mt-1 break-all">{lastScan.raw}</p>
      <p className="text-xs mt-2">Expected SHELF:, BSKT:, or TRAY: prefix.</p>
    </div>
  );
}
