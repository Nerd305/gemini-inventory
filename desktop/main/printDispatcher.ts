import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConfig } from './configLoader';
import { printerProblem, submitPdf } from './cups';

/**
 * Print one label PDF. The renderer builds the PDF with the shared label engine
 * (src/shared/labelRender.ts), one exact-size page per label, so there is no hidden window
 * to render and no render timeout to race. Here we only check the printer and hand the file to CUPS.
 */

export interface PrintPdfRequest {
  jobId: string;
  format: string;
  title: string;
  /** Base64 PDF bytes. */
  pdfBase64: string;
}

export interface PrintResult {
  success: boolean;
  error?: string;
  requestId?: string;
}

const MAX_PDF_BYTES = 20 * 1024 * 1024;

export async function dispatchPdf(req: PrintPdfRequest): Promise<PrintResult> {
  const cfg = getConfig().formats[req.format];
  if (!cfg) return { success: false, error: `No printer is set for label size "${req.format}". Pick one in Settings → Label sizes.` };
  if (!cfg.cupsPrinter) return { success: false, error: `No printer is chosen for label size "${req.format}". Pick one in Settings → Label sizes.` };

  const pdf = Buffer.from(req.pdfBase64 || '', 'base64');
  if (pdf.length < 100 || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') return { success: false, error: 'The label PDF was empty or damaged.' };
  if (pdf.length > MAX_PDF_BYTES) return { success: false, error: 'The label PDF is unexpectedly large.' };

  const problem = await printerProblem(cfg.cupsPrinter);
  if (problem) return { success: false, error: problem };

  const safeId = req.jobId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'job';
  const tmpPdf = path.join(os.tmpdir(), `vialtrack-${safeId}-${Date.now()}.pdf`);
  try {
    fs.writeFileSync(tmpPdf, pdf);
    const requestId = await submitPdf(cfg.cupsPrinter, tmpPdf, cfg.lpOptions, `VialTrack ${req.title}`);
    console.log(`Printed ${req.jobId} (${req.format}) on ${cfg.cupsPrinter}${requestId ? ` as ${requestId}` : ''}`);
    return { success: true, requestId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Print failed for ${req.jobId} on ${cfg.cupsPrinter}:`, message);
    return { success: false, error: message };
  } finally {
    // lp copies the file into the CUPS spool before it returns; keep it briefly for debugging.
    setTimeout(() => fs.rm(tmpPdf, { force: true }, () => {}), 30_000);
  }
}
