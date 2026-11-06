import React, { useEffect, useState } from 'react';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Loader2, Printer, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import { LabelContent } from '../shared/LabelContent';
import { usePrintJobQueue } from '../shared/printJobSubscription';
import type { PrintJob } from '../shared/types';

// Auto-printing marks every pending label as printed, so it is a deliberate, per-device switch that
// defaults to OFF: phones and second computers only look at the queue (the iMac print server or the
// one computer wired to the printers does the printing).
const AUTO_PRINT_KEY = 'vialtrack.printStation.autoPrint';

function readAutoPrint(): boolean {
  try {
    return localStorage.getItem(AUTO_PRINT_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function PrintStation() {
  const [autoPrint, setAutoPrint] = useState<boolean>(readAutoPrint);
  const { jobs, activeJob, isPrinting, completeActive, failActive, reprint } = usePrintJobQueue({ autoProcess: autoPrint });

  const toggleAutoPrint = (next: boolean) => {
    setAutoPrint(next);
    try {
      localStorage.setItem(AUTO_PRINT_KEY, String(next));
    } catch {
      /* private mode: the switch still works until the page is closed */
    }
  };

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

  useEffect(() => {
    if (!activeJob) return;
    if (!autoPrint) {
      failActive();
      return;
    }

    const printContent = document.getElementById('print-station-area');
    if (!printContent) {
      failActive();
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentWindow?.document;
    if (!iframeDoc) {
      document.body.removeChild(iframe);
      failActive();
      return;
    }

    const size =
      activeJob.format === '4x3'
        ? '4in 3in'
        : activeJob.format === '1.5x1.5'
        ? '1.5in 1.5in'
        : activeJob.format === '2.5x1.5'
        ? '2.5in 1.5in'
        : activeJob.format === '2.5x0.7'
        ? '2.5in 0.7in'
        : '8.5in 11in';

    iframeDoc.open();
    iframeDoc.write(`
      <html>
        <head>
          <title>Print Label</title>
          <style>
            @page { size: ${size}; margin: 0; }
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
          completeActive();
        }, 1000);
      }, 500);
    };
  }, [activeJob, autoPrint, completeActive, failActive]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Print Station</h1>
          <p className="text-gray-500">
            Labels sent from phones queue here. The VialTrack Print Server app on the iMac prints them; this page prints them too
            only when auto-print is switched on below.
          </p>
        </div>
        <div className="flex flex-col items-end space-y-2">
          <div className="flex items-center space-x-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-full border border-blue-200">
            {!autoPrint ? (
              <><Clock className="h-4 w-4" /> <span>Queue view only</span></>
            ) : isPrinting ? (
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

      <Card>
        <CardContent className="pt-6">
          <label htmlFor="auto-print" className="flex items-start gap-3 cursor-pointer">
            <input
              id="auto-print"
              type="checkbox"
              className="mt-1 h-5 w-5 accent-blue-600"
              checked={autoPrint}
              onChange={(e) => toggleAutoPrint(e.target.checked)}
            />
            <span>
              <span className="block font-medium text-gray-900">Auto-print on this device {autoPrint ? '(on)' : '(off)'}</span>
              <span className="block text-sm text-gray-600">
                Switch this on only on the one computer wired to the label printers, and only if it is not running the VialTrack Print
                Server app (both would print every label twice). It prints every pending label here and marks it done, so phones and
                other computers must leave it off.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

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
                    </div>
                    <div className="flex items-center space-x-3">
                      {job.status === 'completed' ? (
                        <>
                          <span className="flex items-center text-green-600 text-sm"><CheckCircle2 className="h-4 w-4 mr-1" /> Printed</span>
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-gray-500 hover:text-blue-600" onClick={() => handleReprint(job)}>
                            <RefreshCw className="h-3 w-3 mr-1" /> Reprint
                          </Button>
                        </>
                      ) : (
                        <span className="flex items-center text-amber-600 text-sm"><Clock className="h-4 w-4 mr-1" /> Pending</span>
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
            <p><strong>1. Switch on auto-print (printer computer only) and keep this tab open:</strong> the page then receives and processes print jobs. On a phone, leave it off.</p>
            <p><strong>2. Browser Pop-ups:</strong> Ensure your browser allows pop-ups and automatic printing for this site.</p>
            <p><strong>3. Printer Selection:</strong> When the first print dialog appears, make sure to select your specialized label printer and set the correct paper size. Subsequent prints should remember these settings.</p>
            <p><strong>4. Mobile Printing:</strong> On your mobile device, use the "Send to Print Station" button instead of "Print Label".</p>
          </CardContent>
        </Card>
      </div>

      {activeJob && (
        <div id="print-station-area" className="hidden">
          <LabelContent
            code={activeJob.code}
            title={activeJob.title}
            subtitle={activeJob.subtitle}
            format={activeJob.format}
          />
        </div>
      )}
    </div>
  );
}
