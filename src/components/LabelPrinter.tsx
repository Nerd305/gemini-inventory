import { useEffect, useState } from 'react';
import { handleFirestoreError, OperationType } from '../firebase';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Printer, Send, CheckCircle2, Loader2 } from 'lucide-react';
import { LabelContent } from '../shared/LabelContent';
import type { LabelFormat } from '../shared/types';
import {
  DEFAULT_LABEL_FORMAT,
  LABEL_FORMAT_SPECS,
  labelPageSize,
  labelSpec,
} from '../shared/labelFormats';
import { describePrintError, enqueuePrintJob } from '../lib/printing';

export type { LabelFormat };

interface LabelPrinterProps {
  isOpen: boolean;
  onClose: () => void;
  code: string;
  title: string;
  subtitle?: string;
  /** Format pre-selected when the dialog opens. Defaults to the 2x1.5 basket label. */
  defaultFormat?: LabelFormat;
}

const PREVIEW_MAX_WIDTH = 280;

export function LabelPrinter({ isOpen, onClose, code, title, subtitle, defaultFormat }: LabelPrinterProps) {
  const [format, setFormat] = useState<LabelFormat>(defaultFormat ?? DEFAULT_LABEL_FORMAT);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset per open so each label starts from the caller's preferred size.
  useEffect(() => {
    if (isOpen) {
      setFormat(defaultFormat ?? DEFAULT_LABEL_FORMAT);
      setSent(false);
      setError(null);
    }
  }, [isOpen, defaultFormat]);

  const handleSendToPrintStation = async () => {
    setIsSending(true);
    setError(null);
    try {
      await enqueuePrintJob({ code, title, subtitle, format });
      setSent(true);
      window.setTimeout(onClose, 900);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'printJobs');
      setError(describePrintError(err, format));
    } finally {
      setIsSending(false);
    }
  };

  const handlePrint = () => {
    const printContent = document.getElementById('print-area');
    if (!printContent) return;

    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentWindow?.document;
    if (!iframeDoc) return;

    iframeDoc.open();
    iframeDoc.write(`
      <html>
        <head>
          <title>Print Label</title>
          <style>
            @page { size: ${labelPageSize(format)}; margin: 0; }
            body { margin: 0; padding: 0; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; }
          </style>
        </head>
        <body>
          ${printContent.innerHTML}
        </body>
      </html>
    `);
    iframeDoc.close();

    iframe.onload = () => {
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1000);
      }, 500);
    };
  };

  if (!isOpen) return null;

  const spec = labelSpec(format);
  const naturalW = spec.widthIn * 96;
  const naturalH = spec.heightIn * 96;
  const scale = Math.min(1, PREVIEW_MAX_WIDTH / naturalW);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-md print:hidden">
          <DialogHeader>
            <DialogTitle>Print Label</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Printer / label size</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={format}
                onChange={(e) => setFormat(e.target.value as LabelFormat)}
              >
                {LABEL_FORMAT_SPECS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="border rounded-lg p-4 bg-gray-50 flex flex-col items-center justify-center overflow-hidden">
              <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">
                Preview · {spec.widthIn}" × {spec.heightIn}"
              </p>
              <div
                className="bg-white shadow-sm border overflow-hidden"
                style={{ width: naturalW * scale, height: naturalH * scale }}
              >
                <div
                  style={{
                    width: naturalW,
                    height: naturalH,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                  }}
                >
                  <LabelContent code={code} title={title} subtitle={subtitle} format={format} />
                </div>
              </div>
              <p className="mt-2 text-[11px] font-mono text-gray-500 break-all text-center">{code}</p>
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{error}</p>
            )}
          </div>

          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={handlePrint} className="w-full sm:w-auto">
              <Printer className="mr-2 h-4 w-4" /> Print Locally
            </Button>
            <Button
              onClick={handleSendToPrintStation}
              disabled={isSending || sent}
              className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700"
            >
              {sent ? (
                <><CheckCircle2 className="mr-2 h-4 w-4" /> Queued</>
              ) : isSending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</>
              ) : (
                <><Send className="mr-2 h-4 w-4" /> Send to Print Station</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div id="print-area" className="hidden">
        <LabelContent code={code} title={title} subtitle={subtitle} format={format} />
      </div>
    </>
  );
}
