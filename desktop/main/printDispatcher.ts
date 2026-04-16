import { BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConfig, type FormatConfig } from './configLoader';

export interface MinimalPrintJob {
  id: string;
  code: string;
  title: string;
  subtitle?: string;
  format: string;
  status: string;
  createdAt: string;
}

export interface PrintResult {
  success: boolean;
  error?: string;
}

const RENDER_READY_EVENT = 'render:ready';

interface PendingRender {
  job: MinimalPrintJob;
  resolveReady: () => void;
  readyPromise: Promise<void>;
}

const pendingByWindowId = new Map<number, PendingRender>();

export function registerRenderBridge() {
  ipcMain.handle('render:get-job', (event) => {
    const pending = pendingByWindowId.get(event.sender.id);
    return pending?.job ?? null;
  });

  ipcMain.handle('render:get-sticky-region', (event, format: string) => {
    const cfg = getConfig().formats[format];
    return cfg?.stickyRegion ?? null;
  });

  ipcMain.on(RENDER_READY_EVENT, (event) => {
    const pending = pendingByWindowId.get(event.sender.id);
    pending?.resolveReady();
  });
}

function resolvePrintUrl(): string {
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) return `${devUrl.replace(/\/$/, '')}/print.html`;
  return `file://${path.join(__dirname, '..', 'renderer', 'print.html')}`;
}

async function renderJobToPdf(job: MinimalPrintJob, cfg: FormatConfig): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: Math.round(cfg.pageSize.widthIn * 96),
    height: Math.round(cfg.pageSize.heightIn * 96),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  let resolveReady!: () => void;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  pendingByWindowId.set(win.webContents.id, { job, resolveReady, readyPromise });

  try {
    await win.loadURL(resolvePrintUrl());

    const settleTimeout = new Promise<void>((resolve) => setTimeout(resolve, 1500));
    await Promise.race([readyPromise, settleTimeout]);

    const pdf = await win.webContents.printToPDF({
      pageSize: {
        width: Math.round(cfg.pageSize.widthIn * 25400),
        height: Math.round(cfg.pageSize.heightIn * 25400),
      },
      margins: { marginType: 'none' },
      printBackground: true,
      landscape: false,
    });

    return pdf;
  } finally {
    pendingByWindowId.delete(win.webContents.id);
    if (!win.isDestroyed()) win.destroy();
  }
}

function spawnLp(pdfPath: string, cfg: FormatConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-d', cfg.cupsPrinter, ...cfg.lpOptions, pdfPath];
    const child = spawn('lp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`lp exited with code ${code}: ${stderr.trim()}`));
      }
    });
  });
}

export async function dispatchPrintJob(job: MinimalPrintJob): Promise<PrintResult> {
  const cfg = getConfig().formats[job.format];
  if (!cfg) {
    return { success: false, error: `No printer mapping for format "${job.format}"` };
  }
  if (!cfg.cupsPrinter) {
    return { success: false, error: `Empty cupsPrinter for format "${job.format}"` };
  }

  let tmpPdf: string | null = null;
  try {
    const pdf = await renderJobToPdf(job, cfg);
    tmpPdf = path.join(os.tmpdir(), `vialtrack-${job.id}-${Date.now()}.pdf`);
    fs.writeFileSync(tmpPdf, pdf);
    await spawnLp(tmpPdf, cfg);
    return { success: true };
  } catch (e: any) {
    console.error('Print dispatch failed', e);
    return { success: false, error: e.message ?? String(e) };
  } finally {
    if (tmpPdf && fs.existsSync(tmpPdf)) {
      setTimeout(() => {
        try {
          fs.unlinkSync(tmpPdf!);
        } catch {}
      }, 5000);
    }
  }
}
