import { useEffect, useState } from 'react';
import { collection, addDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Download, Loader2, Printer, Send } from 'lucide-react';
import { LabelPreview } from './LabelPreview';
import { LABEL_FORMAT_OPTIONS } from '../lib/printing';
import { LOCAL_PRINT_HINT, openLabelsPdf, preparePrintWindow } from '../lib/localPrint';
import { LABEL_PAGE_SIZES } from '../shared/labelRender';
import type { LabelFormat } from '../shared/types';

export type { LabelFormat };

interface LabelPrinterProps {
  isOpen: boolean;
  onClose: () => void;
  code: string;
  title: string;
  subtitle?: string;
  /** Initial label size; the user can still switch it in the dialog. */
  defaultFormat?: LabelFormat;
}

/**
 * One label: preview at true proportions, then either print it here (exact-size PDF → the
 * device's print dialog / AirPrint) or queue it for the Mac print server.
 */
export function LabelPrinter({ isOpen, onClose, code, title, subtitle, defaultFormat = '4x3' }: LabelPrinterProps) {
  const [format, setFormat] = useState<LabelFormat>(defaultFormat);
  const [isSending, setIsSending] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFormat(defaultFormat);
      setStatus(null);
    }
  }, [isOpen, defaultFormat]);

  const handleSendToPrintStation = async () => {
    setIsSending(true);
    try {
      await addDoc(collection(db, 'printJobs'), {
        code,
        title,
        subtitle: subtitle || '',
        format,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      alert('Sent to the print server.');
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'printJobs');
      alert('Failed to send to the print server.');
    } finally {
      setIsSending(false);
    }
  };

  const printHere = async (download: boolean) => {
    // Open the tab inside the tap; iOS blocks it after an await.
    const win = download ? null : preparePrintWindow();
    setPrinting(true);
    setStatus(null);
    try {
      const result = await openLabelsPdf([{ code, title, subtitle }], format, win, { download });
      setStatus(result === 'opened' ? 'Label opened in a new tab: print it from there.' : 'Label PDF downloaded: open it and print.');
    } catch (err) {
      setStatus(`Could not make the label: ${err instanceof Error ? err.message : 'error'}`);
    } finally {
      setPrinting(false);
    }
  };

  if (!isOpen) return null;
  const page = LABEL_PAGE_SIZES[format];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md print:hidden">
        <DialogHeader>
          <DialogTitle>Print label</DialogTitle>
          <DialogDescription>
            {page.widthIn}" × {page.heightIn}" · {code}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="label-format">Label size</Label>
            <select
              id="label-format"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={format}
              onChange={(e) => setFormat(e.target.value as LabelFormat)}
            >
              {LABEL_FORMAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-h-[160px] flex-col items-center justify-center rounded-lg border bg-gray-50 p-4">
            <p className="mb-2 text-xs uppercase tracking-wider text-gray-500">Preview (actual layout)</p>
            <LabelPreview label={{ code, title, subtitle }} format={format} />
          </div>
          <p className="text-xs text-gray-500">{LOCAL_PRINT_HINT}</p>
          {status && <p className="text-xs text-teal-700">{status}</p>}
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => void printHere(false)} disabled={printing} className="w-full sm:w-auto">
            {printing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />} Print here (AirPrint)
          </Button>
          <Button variant="ghost" onClick={() => void printHere(true)} disabled={printing} className="w-full sm:w-auto" title="Download the label PDF">
            <Download className="mr-2 h-4 w-4" /> PDF
          </Button>
          <Button onClick={handleSendToPrintStation} disabled={isSending} className="w-full bg-indigo-600 hover:bg-indigo-700 sm:w-auto">
            <Send className="mr-2 h-4 w-4" /> {isSending ? 'Sending…' : 'Send to print server'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
