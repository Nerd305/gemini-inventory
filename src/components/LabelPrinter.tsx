import React, { useState } from 'react';
import { collection, addDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { QRCodeSVG } from 'qrcode.react';
// @ts-ignore
import Barcode from 'react-barcode';
import { Printer, Send } from 'lucide-react';
import { LabelContent } from '../shared/LabelContent';
import type { LabelFormat } from '../shared/types';

export type { LabelFormat };

interface LabelPrinterProps {
  isOpen: boolean;
  onClose: () => void;
  code: string;
  title: string;
  subtitle?: string;
}

const PAGE_SIZES: Record<LabelFormat, string> = {
  '4x3': '4in 3in',
  '1.5x1.5': '1.5in 1.5in',
  '2.5x0.7': '2.5in 0.7in',
  '2.5x1.5': '2.5in 1.5in',
  'canon-integrated': '8.5in 11in',
};

export function LabelPrinter({ isOpen, onClose, code, title, subtitle }: LabelPrinterProps) {
  const [format, setFormat] = useState<LabelFormat>('4x3');
  const [isSending, setIsSending] = useState(false);

  const handleSendToPrintStation = async () => {
    setIsSending(true);
    try {
      await addDoc(collection(db, 'printJobs'), {
        code,
        title,
        subtitle: subtitle || '',
        format,
        status: 'pending',
        createdAt: new Date().toISOString()
      });
      alert('Sent to Print Station!');
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'printJobs');
      alert('Failed to send to Print Station.');
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
            @page { size: ${PAGE_SIZES[format]}; margin: 0; }
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

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-md print:hidden">
          <DialogHeader>
            <DialogTitle>Print Label</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Select Printer / Label Size</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={format}
                onChange={(e) => setFormat(e.target.value as LabelFormat)}
              >
                <option value="4x3">Zebra (4" x 3") - Large QR</option>
                <option value="1.5x1.5">Epson (1.5" x 1.5") - Square QR</option>
                <option value="2.5x1.5">Epson (2.5" x 1.5") - Rectangle QR</option>
                <option value="2.5x0.7">Epson (2.5" x 0.7") - Long Barcode</option>
                <option value="canon-integrated">Canon Integrated Form (8.5" x 11" sheet)</option>
              </select>
              <div className="text-xs text-gray-600 bg-blue-50 p-3 rounded-md border border-blue-100 mt-2 space-y-1">
                <p><strong>Which format is best?</strong></p>
                <p>• <strong>QR Codes</strong>: Best overall. Scans instantly from any angle.</p>
                <p>• <strong>Long Barcode (2.5x0.7)</strong>: Best for slim spaces (like vial edges). Must be scanned horizontally.</p>
                <p>• <strong>Canon Integrated Form</strong>: Full-sheet layout with adhesive label region toward the bottom.</p>
              </div>
            </div>

            <div className="border rounded-lg p-4 bg-gray-50 flex flex-col items-center justify-center min-h-[200px] overflow-hidden">
              <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Preview</p>
              <div className="bg-white shadow-sm border flex items-center justify-center overflow-hidden"
                   style={{
                     width: format === '4x3' ? '100%' : format === '1.5x1.5' ? '150px' : format === '2.5x1.5' ? '250px' : format === '2.5x0.7' ? '250px' : '220px',
                     height: format === '4x3' ? '200px' : format === '1.5x1.5' ? '150px' : format === '2.5x1.5' ? '150px' : format === '2.5x0.7' ? '70px' : '285px',
                     transform: format === '4x3' ? 'scale(0.8)' : 'scale(1)',
                     transformOrigin: 'center'
                   }}>
                {format === '4x3' && (
                  <div className="flex flex-col items-center justify-center p-4 text-center w-full h-full">
                    <h1 className="text-xl font-bold mb-1 truncate w-full">{title}</h1>
                    {subtitle && <p className="text-sm mb-2 truncate w-full text-gray-500">{subtitle}</p>}
                    <QRCodeSVG value={code} size={100} />
                    <p className="mt-1 text-xs font-mono">{code}</p>
                  </div>
                )}
                {format === '1.5x1.5' && (
                  <div className="flex flex-col items-center justify-center p-2 text-center w-full h-full">
                    <h1 className="text-[10px] font-bold mb-1 truncate w-full leading-tight">{title}</h1>
                    <QRCodeSVG value={code} size={80} />
                  </div>
                )}
                {format === '2.5x1.5' && (
                  <div className="flex flex-col items-center justify-center p-2 text-center w-full h-full">
                    <h1 className="text-sm font-bold mb-1 truncate w-full leading-tight">{title}</h1>
                    {subtitle && <p className="text-[10px] mb-1 truncate w-full text-gray-500">{subtitle}</p>}
                    <QRCodeSVG value={code} size={70} />
                  </div>
                )}
                {format === '2.5x0.7' && (
                  <div className="flex flex-col items-center justify-center p-1 text-center w-full h-full">
                    <Barcode value={code} width={1.2} height={30} fontSize={10} margin={0} displayValue={true} />
                    <h1 className="text-[8px] font-bold truncate w-full mt-0.5">{title}</h1>
                  </div>
                )}
                {format === 'canon-integrated' && (
                  <div className="flex flex-col w-full h-full relative bg-white">
                    <div className="flex-1 border-b border-dashed border-gray-300 flex items-center justify-center text-[9px] text-gray-400">
                      packing slip area
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center p-2 text-center bg-yellow-50">
                      <span className="text-[7px] text-amber-700 uppercase tracking-wider mb-1">adhesive</span>
                      <h1 className="text-[9px] font-bold truncate w-full">{title}</h1>
                      {subtitle && <p className="text-[7px] truncate w-full text-gray-500">{subtitle}</p>}
                      <QRCodeSVG value={code} size={60} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={handlePrint} className="w-full sm:w-auto">
              <Printer className="mr-2 h-4 w-4" /> Print Locally
            </Button>
            <Button onClick={handleSendToPrintStation} disabled={isSending} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700">
              <Send className="mr-2 h-4 w-4" /> {isSending ? 'Sending...' : 'Send to Print Station'}
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
