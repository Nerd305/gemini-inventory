import { contextBridge, ipcRenderer } from 'electron';

interface FormatConfig {
  cupsPrinter: string;
  pageSize: { widthIn: number; heightIn: number };
  margins: { top: number; right: number; bottom: number; left: number };
  stickyRegion?: { xIn: number; yIn: number; widthIn: number; heightIn: number };
  lpOptions: string[];
}

const api = {
  printPdf: (req: { jobId: string; format: string; title: string; pdfBase64: string }) => ipcRenderer.invoke('print-pdf', req),
  getFormats: () => ipcRenderer.invoke('config:get-formats'),
  getConfigPath: () => ipcRenderer.invoke('config:get-path'),
  saveFormats: (formats: Record<string, FormatConfig>) => ipcRenderer.invoke('config:save-formats', formats),
  onConfigReload: (cb: (next: unknown) => void) => {
    const listener = (_event: unknown, next: unknown) => cb(next);
    ipcRenderer.on('config:reload', listener);
    return () => ipcRenderer.removeListener('config:reload', listener);
  },
  listPrinters: () => ipcRenderer.invoke('system:list-printers'),
  printerMedia: (device: string) => ipcRenderer.invoke('system:printer-media', device),
  openPrinterSettings: () => ipcRenderer.invoke('system:open-printer-settings'),
};

contextBridge.exposeInMainWorld('printServer', api);
