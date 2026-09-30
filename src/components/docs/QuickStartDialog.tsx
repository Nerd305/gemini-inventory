import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { BookOpen, ExternalLink, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { APP_VERSION } from '../../lib/version';
import { GITHUB_REPO_URL } from '../../lib/links';

export const QUICKSTART_GITHUB_URL = `${GITHUB_REPO_URL}/blob/main/docs/QUICKSTART.md`;
/** Fired from anywhere (e.g. Settings) to open the guide: window.dispatchEvent(new Event(OPEN_QUICKSTART_EVENT)). */
export const OPEN_QUICKSTART_EVENT = 'vialtrack:open-quickstart';

const STORAGE_KEY = 'vialtrack.quickstart.seen';
/** Bump when the guide changes enough that everyone should see it again on launch. */
export const QUICKSTART_REVISION = '2026-09-30';

// The guide is the same file that lives in the repo (docs/QUICKSTART.md), bundled as text and
// rendered on demand so it stays out of the main bundle.
const QuickStartBody = lazy(async () => {
  const [{ default: markdown }, { default: MarkdownDoc }] = await Promise.all([
    import('../../../docs/QUICKSTART.md?raw'),
    import('./MarkdownDoc'),
  ]);
  return { default: () => <MarkdownDoc markdown={markdown} /> };
});

/**
 * Open on the first launch (per browser) and whenever the app is asked to via OPEN_QUICKSTART_EVENT.
 * Closing remembers the current guide revision.
 */
export function useQuickStartDialog(): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== QUICKSTART_REVISION;
    } catch {
      return false;
    }
  });

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (!next) {
      try {
        localStorage.setItem(STORAGE_KEY, QUICKSTART_REVISION);
      } catch {
        // storage unavailable — the guide just shows again next time
      }
    }
  }, []);

  useEffect(() => {
    const handler = () => setOpenState(true);
    window.addEventListener(OPEN_QUICKSTART_EVENT, handler);
    return () => window.removeEventListener(OPEN_QUICKSTART_EVENT, handler);
  }, []);

  return [open, setOpen];
}

interface QuickStartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function QuickStartDialog({ open, onOpenChange }: QuickStartDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center text-teal-800">
            <BookOpen className="h-5 w-5 mr-2" /> Quick start
          </DialogTitle>
          <DialogDescription>
            Setup, counting, FIFO, printing, exports. Same guide as <code>docs/QUICKSTART.md</code> on GitHub. Reopen it any
            time with the <strong>?</strong> button in the header. App v{APP_VERSION}.
          </DialogDescription>
        </DialogHeader>
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-10 text-gray-500 text-sm">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading guide…
            </div>
          }
        >
          <QuickStartBody />
        </Suspense>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-gray-200">
          <a
            href={QUICKSTART_GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center text-sm text-teal-700 underline underline-offset-2"
          >
            <ExternalLink className="h-4 w-4 mr-1" /> Open on GitHub
          </a>
          <Button onClick={() => onOpenChange(false)} className="bg-teal-600 hover:bg-teal-700">
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
