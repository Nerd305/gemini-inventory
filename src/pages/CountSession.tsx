import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Boxes, MapPin, StopCircle } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Button } from '../components/ui/button';
import {
  CountingSessionProvider,
  useCountingSession,
} from '../contexts/CountingSessionContext';
import BottomPanel from '../components/counting/BottomPanel';
import CameraHUD from '../components/counting/CameraHUD';
import { SessionReview } from '../components/counting/SessionReview';
import { CapColorMap, loadAppSettings } from '../lib/config';

const READER_ID = 'count-session-reader';

function CameraView() {
  const { handleScan } = useCountingSession();
  const handleScanRef = useRef(handleScan);
  handleScanRef.current = handleScan;

  const [error, setError] = useState<string | null>(null);
  const [hudEnabled, setHudEnabled] = useState(false);
  const [capColorMap, setCapColorMap] = useState<CapColorMap>({});

  useEffect(() => {
    let cancelled = false;
    loadAppSettings()
      .then((settings) => {
        if (cancelled) return;
        setHudEnabled(settings.hudEnabled);
        setCapColorMap(settings.capColorMap);
      })
      .catch((err) => console.error('Failed to load HUD settings', err));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let scanner: Html5Qrcode | null = null;
    let cancelled = false;

    const start = async () => {
      try {
        scanner = new Html5Qrcode(READER_ID);
        const config = { fps: 10, qrbox: { width: 260, height: 260 } };
        try {
          await scanner.start(
            { facingMode: 'environment' },
            config,
            (decoded) => handleScanRef.current(decoded),
            () => {}
          );
        } catch {
          if (cancelled) return;
          await scanner.start(
            { facingMode: 'user' },
            config,
            (decoded) => handleScanRef.current(decoded),
            () => {}
          );
        }
      } catch (err) {
        console.error('Camera start failed', err);
        if (!cancelled) setError('Unable to access camera. Please grant permission and reload.');
      }
    };

    start();

    return () => {
      cancelled = true;
      if (scanner && scanner.isScanning) {
        scanner
          .stop()
          .then(() => scanner?.clear())
          .catch((err) => console.error('Camera stop failed', err));
      }
    };
  }, []);

  return (
    <div className="relative h-full w-full bg-black">
      <div id={READER_ID} className="h-full w-full [&>video]:h-full [&>video]:w-full [&>video]:object-cover" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white p-6 text-center">
          <p className="text-sm">{error}</p>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-56 w-56 rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
      </div>
      {hudEnabled && (
        <CameraHUD
          videoSelector={`#${READER_ID} video`}
          capColorMap={capColorMap}
          live
        />
      )}
    </div>
  );
}

function TopBar({ onEndSession }: { onEndSession: () => void }) {
  const navigate = useNavigate();
  const { activeShelfId, activeBasketId, sessionProgress } = useCountingSession();
  const deltaSign = sessionProgress.totalVialsDelta > 0 ? '+' : '';

  return (
    <div className="flex items-center gap-3 bg-gray-900 text-white px-3 h-12 shrink-0 pt-safe box-content">
      <Button
        variant="ghost"
        size="icon"
        className="text-white hover:bg-white/10 h-9 w-9"
        onClick={() => navigate('/')}
        aria-label="Back to dashboard"
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <div className="flex items-center gap-2 min-w-0">
        <MapPin className="h-4 w-4 text-teal-400 shrink-0" />
        <div className="text-sm truncate">
          {activeShelfId ? (
            <>
              <span className="text-white/60">Shelf </span>
              <span className="font-semibold">{activeShelfId}</span>
              {activeBasketId && (
                <>
                  <span className="text-white/40 mx-1">/</span>
                  <span className="text-white/60">Basket </span>
                  <span className="font-semibold">{activeBasketId}</span>
                </>
              )}
            </>
          ) : (
            <span className="text-white/70">Scan a shelf to begin</span>
          )}
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-2 ml-2">
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 bg-teal-500/20 text-teal-200 rounded-full text-xs font-medium tabular-nums"
          title="Baskets touched in this session"
        >
          <Boxes className="h-3 w-3" />
          {sessionProgress.basketsCount} baskets
        </div>
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-500/20 text-purple-200 rounded-full text-xs font-medium tabular-nums"
          title="Net vial change vs. previous count"
        >
          Δ {deltaSign}
          {sessionProgress.totalVialsDelta} vials
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto text-red-400 hover:text-red-300 hover:bg-red-400/10"
        onClick={onEndSession}
      >
        <StopCircle className="h-4 w-4 mr-1.5" /> End
      </Button>
    </div>
  );
}

function CountSessionLayout() {
  const navigate = useNavigate();
  const { sessionId, completeSession } = useCountingSession();
  const [showReview, setShowReview] = useState(false);
  const [sessionData, setSessionData] = useState<any>(null);

  useEffect(() => {
    if (showReview && sessionId) {
      getDoc(doc(db, 'countingSessions', sessionId)).then(snap => {
        if (snap.exists()) setSessionData(snap.data());
      }).catch(console.error);
    }
  }, [showReview, sessionId]);

  if (showReview) {
    return (
      <div className="fixed inset-0 flex flex-col bg-white overflow-hidden pt-safe pb-safe">
        <SessionReview
          session={sessionData} 
          onComplete={async () => {
            await completeSession();
            navigate('/');
          }}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-black overflow-hidden">
      <TopBar onEndSession={() => setShowReview(true)} />
      <div className="flex-1 min-h-0 basis-2/3">
        <CameraView />
      </div>
      <div className="basis-1/3 min-h-0 pb-safe bg-white">
        <BottomPanel />
      </div>
    </div>
  );
}

export default function CountSession() {
  return (
    <CountingSessionProvider>
      <CountSessionLayout />
    </CountingSessionProvider>
  );
}
