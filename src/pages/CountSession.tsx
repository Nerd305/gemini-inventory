import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, CameraOff, ChevronRight, Keyboard, Loader2, StopCircle } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Button } from '../components/ui/button';
import {
  CountingSessionProvider,
  useCountingSession,
  type ScanEvent,
} from '../contexts/CountingSessionContext';
import BottomPanel from '../components/counting/BottomPanel';
import CameraHUD from '../components/counting/CameraHUD';
import { SessionReview } from '../components/counting/SessionReview';
import { CapColorMap, loadAppSettings } from '../lib/config';
import { primeAudio } from '../lib/feedback';

const READER_ID = 'count-session-reader';
const CAMERA_PREF_KEY = 'vialtrack.count.cameraOn';

interface CameraInfo {
  id: string;
  label: string;
}

/**
 * iPhone Pro models expose several rear cameras. `facingMode: environment`
 * often lands on the ultra-wide or a virtual dual/triple device, which cannot
 * focus on a 2-inch label held close. Prefer the plain "Back Camera".
 */
function pickBackCamera(cameras: CameraInfo[]): CameraInfo | null {
  const score = (label: string): number => {
    const l = label.toLowerCase();
    if (!l) return 0;
    const isBack = l.includes('back') || l.includes('rear') || l.includes('environment') || l.includes('world');
    if (!isBack) return -1;
    if (l.includes('ultra')) return 1;
    if (l.includes('tele')) return 2;
    if (l.includes('triple') || l.includes('dual')) return 3;
    return 10;
  };
  let best: CameraInfo | null = null;
  let bestScore = 0;
  for (const cam of cameras) {
    const s = score(cam.label ?? '');
    if (s > bestScore) {
      best = cam;
      bestScore = s;
    }
  }
  return best;
}

function readCameraPref(): boolean {
  try {
    const v = window.localStorage.getItem(CAMERA_PREF_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

function writeCameraPref(on: boolean) {
  try {
    window.localStorage.setItem(CAMERA_PREF_KEY, on ? '1' : '0');
  } catch {
    // ignore
  }
}

function ManualEntry({ compact }: { compact?: boolean }) {
  const { handleScan } = useCountingSession();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(!compact);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    handleScan(v);
    setValue('');
  };

  if (compact && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/55 text-white/90 text-xs px-3 py-1.5"
      >
        <Keyboard className="h-3.5 w-3.5" /> Type a code
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="pointer-events-auto flex items-center gap-1.5 w-full">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="BSKT:… / SHELF:… / LOC:…"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className="h-9 flex-1 min-w-0 rounded-md border border-white/20 bg-black/55 text-white placeholder:text-white/40 px-3 text-sm"
      />
      <Button type="submit" size="sm" className="h-9 bg-teal-600 hover:bg-teal-700 text-white">
        Go
      </Button>
    </form>
  );
}

function CameraView() {
  const { handleScan, resolving } = useCountingSession();
  const handleScanRef = useRef(handleScan);
  handleScanRef.current = handleScan;

  const [error, setError] = useState<string | null>(null);
  const [cameraLabel, setCameraLabel] = useState<string | null>(null);
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

    const stopScanner = async () => {
      const s = scanner;
      scanner = null;
      if (!s) return;
      try {
        if (s.isScanning) await s.stop();
        s.clear();
      } catch (err) {
        console.error('Camera stop failed', err);
      }
    };

    const start = async () => {
      try {
        scanner = new Html5Qrcode(READER_ID, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.DATA_MATRIX,
          ],
          useBarCodeDetectorIfSupported: true,
          verbose: false,
        });
        const config = {
          fps: 10,
          qrbox: (w: number, h: number) => {
            const side = Math.max(120, Math.floor(Math.min(w, h) * 0.72));
            return { width: side, height: side };
          },
          disableFlip: true,
        };
        const onDecode = (decoded: string) => handleScanRef.current(decoded);
        const onDecodeError = () => {};

        let preferred: CameraInfo | null = null;
        try {
          const cams = await Html5Qrcode.getCameras();
          preferred = pickBackCamera(cams);
        } catch (err) {
          console.warn('Camera enumeration failed, falling back to facingMode', err);
        }
        if (cancelled) return;

        // Try the main back camera by id first, then any rear camera, then whatever exists.
        const attempts: Array<{ source: string | MediaTrackConstraints; label: string | null }> = [];
        if (preferred) attempts.push({ source: preferred.id, label: preferred.label || null });
        attempts.push({ source: { facingMode: 'environment' }, label: null });
        attempts.push({ source: { facingMode: 'user' }, label: null });

        let started = false;
        let lastErr: unknown = null;
        for (const attempt of attempts) {
          if (cancelled) return;
          try {
            await scanner.start(attempt.source, config, onDecode, onDecodeError);
            setCameraLabel(attempt.label);
            started = true;
            break;
          } catch (err) {
            lastErr = err;
            console.warn('Camera start attempt failed', attempt.source, err);
          }
        }
        if (!started) throw lastErr ?? new Error('No camera available');
        if (cancelled) await stopScanner();
      } catch (err) {
        console.error('Camera start failed', err);
        if (!cancelled) {
          setError('Unable to access the camera. Allow camera access for this site (iPhone: Settings → Safari → Camera), then reload.');
        }
      }
    };

    start();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, []);

  return (
    <div className="relative h-full w-full bg-black overflow-hidden">
      <div id={READER_ID} className="h-full w-full [&>video]:h-full [&>video]:w-full [&>video]:object-cover" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white p-6 text-center">
          <p className="text-sm">{error}</p>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[62%] aspect-square max-w-[80%] rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
      </div>
      {resolving && (
        <div className="pointer-events-none absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-white">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
      {cameraLabel && (
        <div className="pointer-events-none absolute top-2 left-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] text-white/80">
          {cameraLabel}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex justify-center">
        <ManualEntry compact />
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

function CameraOffBar({ onTurnOn }: { onTurnOn: () => void }) {
  return (
    <div className="bg-gray-900 text-white px-3 py-2 flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-9 bg-transparent border-white/30 text-white hover:bg-white/10 shrink-0"
        onClick={onTurnOn}
      >
        <Camera className="h-4 w-4 mr-1.5" /> Camera
      </Button>
      <ManualEntry />
    </div>
  );
}

function ScanBanner() {
  const { lastEvent } = useCountingSession();
  const [visible, setVisible] = useState<ScanEvent | null>(null);

  useEffect(() => {
    if (!lastEvent) return;
    setVisible(lastEvent);
    const t = window.setTimeout(() => setVisible(null), 2400);
    return () => window.clearTimeout(t);
  }, [lastEvent]);

  if (!visible) return null;
  const color =
    visible.kind === 'error' ? 'bg-red-600' : visible.kind === 'info' ? 'bg-gray-800' : 'bg-teal-600';
  return (
    <div
      key={visible.id}
      className={`pointer-events-none absolute left-3 right-3 top-2 z-30 rounded-lg ${color} text-white text-sm font-medium px-3 py-2 shadow-lg`}
    >
      {visible.message}
    </div>
  );
}

function TopBar({
  onEndSession,
  cameraOn,
  onToggleCamera,
}: {
  onEndSession: () => void;
  cameraOn: boolean;
  onToggleCamera: () => void;
}) {
  const navigate = useNavigate();
  const { fridge, shelfNumber, activeBasketId, goBack, selectFridge, selectShelf, sessionProgress } = useCountingSession();
  const deltaSign = sessionProgress.netDelta > 0 ? '+' : '';

  return (
    <div className="bg-gray-900 text-white pt-safe shrink-0">
      <div className="flex items-center gap-1 px-2 h-12">
        <Button
          variant="ghost"
          size="icon"
          className="text-white hover:bg-white/10 h-9 w-9 shrink-0"
          onClick={() => (fridge ? goBack() : navigate('/'))}
          aria-label={fridge ? 'Back' : 'Back to dashboard'}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0 flex items-center text-sm overflow-hidden">
          {!fridge ? (
            <span className="text-white/70 truncate">Scan or pick a fridge to start</span>
          ) : (
            <>
              <button type="button" onClick={() => selectFridge(fridge)} className="truncate font-semibold max-w-[50%]">
                {fridge.name}
              </button>
              {shelfNumber !== null && (
                <>
                  <ChevronRight className="h-4 w-4 text-white/40 shrink-0" />
                  <button type="button" onClick={() => selectShelf(shelfNumber)} className="shrink-0 font-semibold">
                    {shelfNumber === 0 ? 'Unshelved' : `Shelf ${shelfNumber}`}
                  </button>
                </>
              )}
              {activeBasketId && (
                <>
                  <ChevronRight className="h-4 w-4 text-white/40 shrink-0" />
                  <span className="truncate text-white/80">Basket</span>
                </>
              )}
            </>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className={`h-9 w-9 shrink-0 hover:bg-white/10 ${cameraOn ? 'text-white' : 'text-amber-300'}`}
          onClick={onToggleCamera}
          aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
        >
          {cameraOn ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2 text-red-400 hover:text-red-300 hover:bg-red-400/10 shrink-0"
          onClick={onEndSession}
        >
          <StopCircle className="h-4 w-4 mr-1" /> End
        </Button>
      </div>
      <div className="flex items-center gap-2 px-3 pb-1.5 text-[11px] text-white/70 tabular-nums">
        <span>{sessionProgress.basketsCount} {sessionProgress.basketsCount === 1 ? 'basket' : 'baskets'}</span>
        <span className="text-white/30">·</span>
        <span>{sessionProgress.vialsCounted} vials counted</span>
        <span className="text-white/30">·</span>
        <span className={sessionProgress.netDelta === 0 ? '' : sessionProgress.netDelta > 0 ? 'text-green-300' : 'text-red-300'}>
          Δ {deltaSign}{sessionProgress.netDelta}
        </span>
      </div>
    </div>
  );
}

function CountSessionLayout() {
  const navigate = useNavigate();
  const { sessionId, completeSession } = useCountingSession();
  const [showReview, setShowReview] = useState(false);
  const [sessionData, setSessionData] = useState<any>(null);
  const [cameraOn, setCameraOn] = useState<boolean>(() => readCameraPref());

  const toggleCamera = () => {
    primeAudio();
    setCameraOn((v) => {
      writeCameraPref(!v);
      return !v;
    });
  };

  useEffect(() => {
    if (showReview && sessionId) {
      getDoc(doc(db, 'countingSessions', sessionId))
        .then((snap) => {
          if (snap.exists()) setSessionData(snap.data());
        })
        .catch(console.error);
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
          onResume={() => setShowReview(false)}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-black overflow-hidden" onPointerDownCapture={primeAudio}>
      <TopBar onEndSession={() => setShowReview(true)} cameraOn={cameraOn} onToggleCamera={toggleCamera} />
      <div className="relative flex-1 min-h-0 flex flex-col">
        <ScanBanner />
        {cameraOn ? (
          <div className="basis-[38%] shrink-0 min-h-[170px]">
            <CameraView />
          </div>
        ) : (
          <CameraOffBar onTurnOn={toggleCamera} />
        )}
        <div className="flex-1 min-h-0 bg-white pb-safe">
          <BottomPanel />
        </div>
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
