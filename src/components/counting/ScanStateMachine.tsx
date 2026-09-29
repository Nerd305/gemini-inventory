import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getCountFromServer } from 'firebase/firestore';
import { db } from '../../firebase';
import { useCountingSession } from '../../contexts/CountingSessionContext';
import { useLocations } from '../../hooks/useLocations';
import { describeShelf } from '../../lib/inventory';
import { Layers, Package, Boxes, ScanLine, AlertCircle } from 'lucide-react';

export default function ScanStateMachine() {
  const { lastScan, activeShelfId, activeBasketId } = useCountingSession();
  const { nameOf } = useLocations();
  const [binCount, setBinCount] = useState<number | null>(null);

  // Nudge first-time users toward setup instead of leaving them with a camera and nothing to scan.
  useEffect(() => {
    let cancelled = false;
    getCountFromServer(collection(db, 'baskets'))
      .then((snap) => {
        if (!cancelled) setBinCount(snap.data().count);
      })
      .catch(() => {
        if (!cancelled) setBinCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!lastScan) {
    if (binCount === 0) {
      return (
        <div className="flex h-full flex-col items-center justify-center text-center px-6 text-gray-500">
          <AlertCircle className="h-8 w-8 mb-2 text-amber-500" />
          <p className="text-base font-medium text-gray-800">No bins set up yet</p>
          <p className="text-sm mt-1">Add a bin for each basket and print its QR label before counting.</p>
          <Link to="/bins" className="mt-3 inline-flex items-center rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700">
            Set up bins
          </Link>
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center text-center px-6 text-gray-500">
        <ScanLine className="h-10 w-10 mb-3 text-teal-500" />
        <p className="text-base font-medium text-gray-800">Ready to scan</p>
        <p className="text-sm mt-1">Step 1: scan the shelf label. Step 2: scan the bin's QR. Then tap each tray to count it.</p>
        <p className="text-xs mt-2 text-gray-400">Tray labels jump straight to that tray. No camera? Use the keyboard button to type a code.</p>
      </div>
    );
  }

  if (lastScan.prefix === 'SHELF') {
    return (
      <div className="flex h-full flex-col justify-center px-6">
        <div className="flex items-center text-teal-700 mb-2">
          <Layers className="h-5 w-5 mr-2" />
          <span className="text-xs font-bold uppercase tracking-wide">Shelf selected</span>
        </div>
        <p className="text-2xl font-semibold text-gray-900">{describeShelf(activeShelfId, nameOf)}</p>
        <p className="text-sm text-gray-600 mt-2">Pull a bin and scan its QR code.</p>
      </div>
    );
  }

  if (lastScan.prefix === 'BSKT' || lastScan.prefix === 'TRAY') {
    const Icon = lastScan.prefix === 'BSKT' ? Package : Boxes;
    return (
      <div className="flex h-full flex-col justify-center px-6">
        <div className="flex items-center text-teal-700 mb-2">
          <Icon className="h-5 w-5 mr-2" />
          <span className="text-xs font-bold uppercase tracking-wide">
            {lastScan.prefix === 'BSKT' ? 'Bin scanned' : 'Tray scanned'}
          </span>
        </div>
        <p className="text-sm text-gray-600">
          {activeBasketId ? 'Loading bin…' : 'Opening bin… If it is being counted by someone else you will get a warning; pick another bin.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center text-center px-6 text-gray-500">
      <AlertCircle className="h-8 w-8 mb-2 text-amber-500" />
      <p className="text-sm font-medium text-gray-800">Unrecognized code</p>
      <p className="text-xs mt-1 break-all">{lastScan.raw}</p>
      <p className="text-xs mt-2">Expected a SHELF:, BSKT:, or TRAY: label printed from Locations or Bins.</p>
    </div>
  );
}
