import React, { useEffect, useMemo } from 'react';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Loader2, Printer, CheckCircle2, Clock, RefreshCw, AlertTriangle } from 'lucide-react';
import { printStationId, usePrintJobQueue } from '../shared/printJobSubscription';
import { LABEL_PAGE_SIZES, layoutLabels, layoutToSvg } from '../shared/labelRender';
import type { PrintJob } from '../shared/types';

export default function PrintStation() {
  const station = useMemo(() => ({ id: printStationId(), name: 'Browser Print Station' }), []);
  const { jobs, activeJob, isPrinting, completeActive, failActive, reprint, legacyRules } = usePrintJobQueue(station);

  const handleSendTestPrint = async () => {
    try {
      await addDoc(collection(db, 'printJobs'), {
        code: 'TEST-123',
        title: 'Test Print',
        subtitle: 'Connection Successful',
        format: '4x3',
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    } catch (error: any) {
      alert(`Failed to send test print: ${error.message}`);
    }
  };

  const handleReprint = async (job: PrintJob) => {
    try {
      await reprint(job);
    } catch (error: any) {
      alert(`Failed to reprint: ${error.message}`);
    }
  };

  // Print the claimed job through the browser's dialog: the same layout as the PDFs, sized in real
  // inches, with @page set to the label so the dialog defaults to the right paper.
  useEffect(() => {
    if (!activeJob) return;
    let cancelled = false;
    (async () => {
      let svg: string;
      try {
        const [layout] = await layoutLabels([{ code: activeJob.code, title: activeJob.title, subtitle: activeJob.subtitle }], activeJob.format);
        svg = layoutToSvg(layout);
      } catch (err) {
        if (!cancelled) void failActive(err instanceof Error ? err.message : 'Could not lay out the label');
        return;
      }
      if (cancelled) return;
      const page = LABEL_PAGE_SIZES[activeJob.format] ?? LABEL_PAGE_SIZES['4x3'];
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);
      const iframeDoc = iframe.contentWindow?.document;
      if (!iframeDoc) {
        iframe.remove();
        void failActive('This browser blocked the print frame');
        return;
      }
      iframeDoc.open();
      iframeDoc.write(`<!doctype html><html><head><title>${activeJob.title.replace(/</g, '')}</title><style>
        @page { size: ${page.widthIn}in ${page.heightIn}in; margin: 0; }
        html, body { margin: 0; padding: 0; width: ${page.widthIn}in; height: ${page.heightIn}in; overflow: hidden; }
        svg { display: block; width: ${page.widthIn}in; height: ${page.heightIn}in; }
      </style></head><body>${svg}</body></html>`);
      iframeDoc.close();
      window.setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print(); // blocks until the dialog closes in most browsers
          void completeActive();
        } catch (err) {
          void failActive(err instanceof Error ? err.message : 'Print dialog failed');
        } finally {
          window.setTimeout(() => iframe.remove(), 1000);
        }
      }, 300);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeJob, completeActive, failActive]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Print Station</h1>
          <p className="text-gray-500">Leave this page open on your iMac to automatically print labels sent from mobile devices.</p>
          {legacyRules && (
            <p className="text-xs text-amber-700 mt-1">
              The live database rules are older than this version: labels still print, but failures can't be recorded. Publish firestore.rules.
            </p>
          )}
        </div>
        <div className="flex flex-col items-end space-y-2">
          <div className="flex items-center space-x-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-full border border-blue-200">
            {isPrinting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> <span>Printing...</span></>
            ) : (
              <><Printer className="h-4 w-4 animate-pulse" /> <span>Listening for jobs</span></>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={handleSendTestPrint}>
            Send Test Print
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent Print Jobs</CardTitle>
            <CardDescription>History of labels sent to this station</CardDescription>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No print jobs yet. Send a label from the scanner app.
              </div>
            ) : (
              <div className="space-y-4">
                {jobs.slice(0, 10).map(job => (
                  <div key={job.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
                    <div>
                      <p className="font-medium">{job.title}</p>
                      <p className="text-xs text-gray-500">{job.code} • {job.format}</p>
                      {job.lastError && job.status !== 'completed' && <p className="text-xs text-red-600 mt-0.5">{job.lastError}</p>}
                    </div>
                    <div className="flex items-center space-x-3">
                      {job.status === 'completed' ? (
                        <>
                          <span className="flex items-center text-green-600 text-sm" title={job.printedBy ? `Printed by ${job.printedBy}` : undefined}>
                            <CheckCircle2 className="h-4 w-4 mr-1" /> Printed
                          </span>
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-gray-500 hover:text-blue-600" onClick={() => handleReprint(job)}>
                            <RefreshCw className="h-3 w-3 mr-1" /> Reprint
                          </Button>
                        </>
                      ) : job.status === 'failed' ? (
                        <>
                          <span className="flex items-center text-red-600 text-sm" title={job.lastError}>
                            <AlertTriangle className="h-4 w-4 mr-1" /> Failed
                          </span>
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-gray-500 hover:text-blue-600" onClick={() => handleReprint(job)}>
                            <RefreshCw className="h-3 w-3 mr-1" /> Retry
                          </Button>
                        </>
                      ) : job.status === 'printing' ? (
                        <span className="flex items-center text-blue-600 text-sm">
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" /> {job.claimedByName ?? 'Printing'}
                        </span>
                      ) : (
                        <span className="flex items-center text-amber-600 text-sm" title={job.lastError || undefined}>
                          <Clock className="h-4 w-4 mr-1" /> {job.attempts ? `Retrying (${job.attempts})` : 'Pending'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Instructions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-gray-600">
            <p><strong>1. Keep this tab open:</strong> This page needs to remain open in your browser to receive and process print jobs.</p>
            <p><strong>2. Browser Pop-ups:</strong> Ensure your browser allows pop-ups and automatic printing for this site.</p>
            <p><strong>3. Printer Selection:</strong> When the first print dialog appears, select the label printer. The page is already set to the label size; keep scale at 100% / "Actual size". Subsequent prints remember these settings.</p>
            <p><strong>Prefer the Mac app:</strong> the VialTrack Print Server prints without dialogs and routes each label size to its own printer. This tab and the Mac app can run together; each label is printed once.</p>
            <p><strong>4. Mobile Printing:</strong> On your mobile device, use the "Send to Print Station" button instead of "Print Label".</p>
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
