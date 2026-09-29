import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { CheckCircle2, ChevronRight, Circle, ListChecks, X } from 'lucide-react';
import { db } from '../firebase';
import { useLocations } from '../hooks/useLocations';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { clampInt, type BasketDoc } from '../lib/inventory';

/**
 * Onboarding / progression checklist shown on the dashboard until the pharmacy is fully
 * set up and has completed its first synced count. Every step is detected from Firestore
 * where possible; the two "print labels" steps can also be marked done by hand because
 * "Print Locally" never creates a printJobs doc.
 */

export type SetupStepId = 'fridge' | 'shelfLabels' | 'products' | 'bins' | 'binLabels' | 'count' | 'sync';

interface SetupStep {
  id: SetupStepId;
  title: string;
  detail: string;
  to: string;
  cta: string;
  done: boolean;
  /** Step can be ticked manually (detection is best-effort). */
  manual?: boolean;
}

const STORAGE_KEY = 'vialtrack.setupGuide.v1';

interface GuideStore {
  hidden?: boolean;
  manual?: Partial<Record<SetupStepId, boolean>>;
}

export function readSetupGuideStore(): GuideStore {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as GuideStore;
  } catch {
    return {};
  }
}

export function writeSetupGuideStore(next: GuideStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // private mode / blocked storage — the guide just won't remember.
  }
}

async function hasPrintJobWithPrefix(prefix: string): Promise<boolean> {
  const snap = await getDocs(
    query(collection(db, 'printJobs'), where('code', '>=', prefix), where('code', '<', `${prefix}`), limit(1)),
  );
  return !snap.empty;
}

async function hasCountLog(): Promise<boolean> {
  const snap = await getDocs(query(collection(db, 'inventoryLogs'), where('action', '==', 'COUNT'), limit(1)));
  return !snap.empty;
}

interface SetupGuideProps {
  bins: (BasketDoc & { id: string })[];
  productCount: number;
  ready: boolean;
  onHide: () => void;
}

export default function SetupGuide({ bins, productCount, ready, onHide }: SetupGuideProps) {
  const { locations } = useLocations();
  const [signals, setSignals] = useState({ shelfPrinted: false, binPrinted: false, synced: false });
  const [manual, setManual] = useState<Partial<Record<SetupStepId, boolean>>>(() => readSetupGuideStore().manual ?? {});

  // Best-effort detection of label printing and the first synced count. Re-checked whenever the
  // upstream counts change (e.g. the user comes back to the dashboard after printing).
  useEffect(() => {
    let cancelled = false;
    Promise.all([hasPrintJobWithPrefix('SHELF:'), hasPrintJobWithPrefix('BSKT:'), hasCountLog()])
      .then(([shelfPrinted, binPrinted, synced]) => {
        if (!cancelled) setSignals({ shelfPrinted, binPrinted, synced });
      })
      .catch((err) => console.error('Setup guide detection failed', err));
    return () => {
      cancelled = true;
    };
  }, [locations.length, bins.length, productCount]);

  const markDone = (id: SetupStepId) => {
    const next = { ...manual, [id]: true };
    setManual(next);
    writeSetupGuideStore({ ...readSetupGuideStore(), manual: next });
  };

  const steps = useMemo<SetupStep[]>(() => {
    const fridgesWithShelves = locations.filter((l) => clampInt(l.shelfCount) > 0).length;
    const anyCounted = bins.some((b) => Boolean(b.lastCountedAt));
    return [
      {
        id: 'fridge',
        title: 'Add your fridges',
        detail: 'One location per fridge or cabinet, with how many shelves it has (counted from the top).',
        to: '/locations',
        cta: 'Go to Locations',
        done: locations.length > 0,
      },
      {
        id: 'shelfLabels',
        title: 'Print shelf labels',
        detail:
          fridgesWithShelves === 0 && locations.length > 0
            ? 'First set a shelf count on each fridge (edit the location), then use "Shelf labels" to print one QR per shelf. Stick each on the front edge of its shelf.'
            : 'Use "Shelf labels" on each fridge to print one QR per shelf and stick it on the front edge. Counters scan it before pulling bins and again when putting them back.',
        to: '/locations',
        cta: 'Print shelf labels',
        done: Boolean(manual.shelfLabels) || (fridgesWithShelves > 0 && signals.shelfPrinted),
        manual: true,
      },
      {
        id: 'products',
        title: 'Add your products',
        detail: 'Every product you stock (e.g. TIRZ 40 mg/mL, BPC-157 5 mg/mL). Bins are tied to a product.',
        to: '/products',
        cta: 'Go to Products',
        done: productCount > 0,
      },
      {
        id: 'bins',
        title: 'Add a bin for every basket',
        detail: 'Product, fridge, shelf, and how many trays are in it right now. Trays per bin can be changed during a count.',
        to: '/bins',
        cta: 'Go to Bins',
        done: bins.length > 0,
      },
      {
        id: 'binLabels',
        title: 'Print bin labels',
        detail: 'Open a bin and print its QR label (2.5" × 1.5" fits the tag sleeve). Tray labels are optional.',
        to: '/bins',
        cta: 'Print bin labels',
        done: Boolean(manual.binLabels) || (bins.length > 0 && signals.binPrinted),
        manual: true,
      },
      {
        id: 'count',
        title: 'Run your first count',
        detail: 'Start Count → scan the shelf → scan a bin → tap each tray (Full 25, AI count, or type it) → Finish → scan the shelf to put it back.',
        to: '/count',
        cta: 'Start Count',
        done: anyCounted,
      },
      {
        id: 'sync',
        title: 'Complete & Sync',
        detail: 'When you end a session, tap Complete & Sync so each product\'s stock matches what you counted.',
        to: '/count',
        cta: 'Start Count',
        done: signals.synced,
      },
    ];
  }, [locations, bins, productCount, signals, manual]);

  const doneCount = steps.filter((s) => s.done).length;
  const current = steps.find((s) => !s.done) ?? null;
  const allDone = current === null;

  if (!ready || allDone) return null;

  return (
    <Card className="border-blue-200 md:col-span-2">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="flex items-center text-sm font-semibold text-blue-900">
              <ListChecks className="h-4 w-4 mr-2" />
              Setup progress · {doneCount} of {steps.length}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Follow these in order. The guide disappears once your first count is synced.
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2 text-gray-400" onClick={onHide} title="Hide setup guide" aria-label="Hide setup guide">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mb-4">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round((100 * doneCount) / steps.length)}%` }} />
        </div>

        <ol className="space-y-1.5">
          {steps.map((step, i) => {
            const isCurrent = current?.id === step.id;
            return (
              <li
                key={step.id}
                className={`rounded-lg border px-3 py-2 ${
                  isCurrent ? 'border-blue-300 bg-blue-50' : step.done ? 'border-transparent' : 'border-gray-100'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {step.done ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                  ) : (
                    <Circle className={`h-5 w-5 shrink-0 ${isCurrent ? 'text-blue-500' : 'text-gray-300'}`} />
                  )}
                  <span className={`text-sm ${step.done ? 'text-gray-400 line-through' : isCurrent ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                    {i + 1}. {step.title}
                  </span>
                  {isCurrent && <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-blue-700">Next</span>}
                </div>
                {isCurrent && (
                  <div className="mt-2 pl-7">
                    <p className="text-sm text-gray-700">{step.detail}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Button asChild size="sm" className="bg-blue-600 hover:bg-blue-700">
                        <Link to={step.to}>
                          {step.cta} <ChevronRight className="h-4 w-4 ml-1" />
                        </Link>
                      </Button>
                      {step.manual && (
                        <Button variant="outline" size="sm" onClick={() => markDone(step.id)}>
                          Already printed
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
