import type { PrintJob } from '@shared/types';

export interface FormatConfigSummary {
  cupsPrinter: string;
  pageSize: { widthIn: number; heightIn: number };
  margins: { top: number; right: number; bottom: number; left: number };
  stickyRegion?: { xIn: number; yIn: number; widthIn: number; heightIn: number };
  lpOptions: string[];
}

export interface PrintResult {
  success: boolean;
  error?: string;
}

export interface CupsPrinter {
  device: string;
  status: string;
  model: string;
}

declare global {
  interface Window {
    printServer: {
      printJob: (job: PrintJob) => Promise<PrintResult>;
      getFormats: () => Promise<Record<string, FormatConfigSummary>>;
      saveFormats: (formats: Record<string, FormatConfigSummary>) => Promise<PrintResult>;
      onConfigReload: (cb: (next: Record<string, FormatConfigSummary>) => void) => () => void;
      getRenderJob: () => Promise<PrintJob | null>;
      getStickyRegion: (
        format: string,
      ) => Promise<{ xIn: number; yIn: number; widthIn: number; heightIn: number } | null>;
      signalRenderReady: () => void;
      listPrinters: () => Promise<CupsPrinter[]>;
      testPrint: (format: string) => Promise<PrintResult>;
    };
  }
}

export {};
