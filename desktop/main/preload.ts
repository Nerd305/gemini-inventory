import { contextBridge, ipcRenderer } from 'electron';

interface FormatConfig {
  cupsPrinter: string;
  pageSize: { widthIn: number; heightIn: number };
  margins: { top: number; right: number; bottom: number; left: number };
  stickyRegion?: { xIn: number; yIn: number; widthIn: number; heightIn: number };
  lpOptions: string[];
}

const api = {
  printJob: (job: unknown) => ipcRenderer.invoke('print-job', job),
  getFormats: () => ipcRenderer.invoke('config:get-formats'),
  saveFormats: (formats: Record<string, FormatConfig>) => ipcRenderer.invoke('config:save-formats', formats),
  onConfigReload: (cb: (next: unknown) => void) => {
    const listener = (_event: unknown, next: unknown) => cb(next);
    ipcRenderer.on('config:reload', listener);
    return () => ipcRenderer.removeListener('config:reload', listener);
  },
  getRenderJob: () => ipcRenderer.invoke('render:get-job'),
  getStickyRegion: (format: string) => ipcRenderer.invoke('render:get-sticky-region', format),
  signalRenderReady: () => ipcRenderer.send('render:ready'),
  listPrinters: () => ipcRenderer.invoke('system:list-printers'),
  testPrint: (format: string) => ipcRenderer.invoke('system:test-print', format),
};

contextBridge.exposeInMainWorld('printServer', api);
