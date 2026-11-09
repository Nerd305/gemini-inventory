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
  requestId?: string;
}

export type PrinterState = 'idle' | 'printing' | 'disabled' | 'unknown';

export interface CupsPrinter {
  device: string;
  state: PrinterState;
  enabled: boolean;
  description: string;
  detail: string;
  isDefault: boolean;
}

export interface MediaSize {
  key: string;
  option: string;
  widthIn?: number;
  heightIn?: number;
  isDefault: boolean;
}

declare global {
  interface Window {
    printServer: {
      printPdf: (req: { jobId: string; format: string; title: string; pdfBase64: string }) => Promise<PrintResult>;
      getFormats: () => Promise<Record<string, FormatConfigSummary>>;
      getConfigPath: () => Promise<string | null>;
      saveFormats: (
        formats: Record<string, FormatConfigSummary>,
      ) => Promise<{ success: boolean; error?: string; formats?: Record<string, FormatConfigSummary> }>;
      onConfigReload: (cb: (next: Record<string, FormatConfigSummary>) => void) => () => void;
      listPrinters: () => Promise<CupsPrinter[]>;
      printerMedia: (device: string) => Promise<MediaSize[]>;
      openPrinterSettings: () => Promise<boolean>;
    };
  }
}

export {};
