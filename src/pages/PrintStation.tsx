import React, { useEffect } from 'react';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Loader2, Printer, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import { LabelContent } from '../shared/LabelContent';
import { usePrintJobQueue } from '../shared/printJobSubscription';
import { labelPageSize } from '../shared/labelFormats';
import type { PrintJob } from '../shared/types';

export default function PrintStation() {
  const { jobs, activeJob, isPrinting, completeActive, failActive, reprint } = usePrintJobQueue();

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

    const size = labelPageSize(activeJob.format);

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
  }, [activeJob, completeActive, failActive]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Print Station</h1>
          <p className="text-gray-500">Leave this page open on your iMac to automatically print labels sent from mobile devices.</p>
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
            <p><strong>1. Keep this tab open:</strong> This page needs to remain open in your browser to receive and process print jobs.</p>
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
