import { ipcMain, BrowserWindow } from 'electron';
import { execSync } from 'node:child_process';
import { dispatchPrintJob, type MinimalPrintJob } from './printDispatcher';
import { getConfig, onConfigChange, saveConfig, type FormatConfig } from './configLoader';

function summarizeFormats() {
  const { formats } = getConfig();
  const out: Record<string, unknown> = {};
  for (const [key, cfg] of Object.entries(formats)) {
    out[key] = {
      cupsPrinter: cfg.cupsPrinter,
      pageSize: cfg.pageSize,
      margins: cfg.margins,
      stickyRegion: cfg.stickyRegion,
      lpOptions: cfg.lpOptions,
    };
  }
  return out;
}

export function registerIpc() {
  ipcMain.handle('print-job', async (_event, job: MinimalPrintJob) => {
    return dispatchPrintJob(job);
  });

  ipcMain.handle('config:get-formats', () => summarizeFormats());

  ipcMain.handle('config:save-formats', (_event, formats: Record<string, FormatConfig>) => {
    try {
      saveConfig({ formats });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('system:list-printers', () => {
    try {
      const out = execSync('lpstat -p', { encoding: 'utf8' });
      const printers: { device: string; status: string; model: string }[] = [];
      for (const line of out.split('\n')) {
        const match = line.trim().match(/printer (\S+)\s+(\S+)\s+(.+)/);
        if (match) {
          printers.push({ device: match[1], status: match[2], model: match[3] });
        }
      }
      return printers;
    } catch {
      return [];
    }
  });

  ipcMain.handle('system:test-print', async (_event, format: string) => {
    const cfg = getConfig().formats[format];
    if (!cfg) {
      return { success: false, error: `No config for format "${format}"` };
    }
    const testJob: MinimalPrintJob = {
      id: `test-${Date.now()}`,
      code: 'TEST',
      title: 'Alignment Test',
      subtitle: `${format} @ ${cfg.pageSize.widthIn}"x${cfg.pageSize.heightIn}"`,
      format,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    return dispatchPrintJob(testJob);
  });

  onConfigChange(() => {
    const summary = summarizeFormats();
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('config:reload', summary);
    });
  });
}
