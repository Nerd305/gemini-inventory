import { ipcMain, BrowserWindow, shell } from 'electron';
import { dispatchPdf, type PrintPdfRequest } from './printDispatcher';
import { getConfig, getConfigPath, onConfigChange, saveConfig, type FormatConfig } from './configLoader';
import { listPrinters, printerMediaSizes } from './cups';

export function registerIpc() {
  ipcMain.handle('print-pdf', async (_event, req: PrintPdfRequest) => dispatchPdf(req));

  ipcMain.handle('config:get-formats', () => getConfig().formats);

  ipcMain.handle('config:get-path', () => getConfigPath());

  ipcMain.handle('config:save-formats', (_event, formats: Record<string, FormatConfig>) => {
    try {
      const saved = saveConfig({ formats });
      return { success: true, formats: saved.formats };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('system:list-printers', async () => {
    try {
      return await listPrinters();
    } catch {
      return [];
    }
  });

  ipcMain.handle('system:printer-media', async (_event, device: string) => {
    if (typeof device !== 'string' || !/^[^\s/#]{1,127}$/.test(device)) return [];
    try {
      return await printerMediaSizes(device);
    } catch {
      return [];
    }
  });

  /** Opens System Settings → Printers & Scanners, where new printers are added on macOS. */
  ipcMain.handle('system:open-printer-settings', async () => {
    try {
      await shell.openExternal('x-apple.systempreferences:com.apple.Print-Scanner-Settings.extension');
      return true;
    } catch {
      return false;
    }
  });

  onConfigChange((config) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('config:reload', config.formats);
    });
  });
}
