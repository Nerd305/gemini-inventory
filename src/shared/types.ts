export type LabelFormat =
  | '4x3'
  | '1.5x1.5'
  | '2.5x0.7'
  | '2.5x1.5'
  | 'canon-integrated';

export type PrintJobStatus = 'pending' | 'printing' | 'completed' | 'failed';

export interface PrintJob {
  id: string;
  code: string;
  title: string;
  subtitle?: string;
  format: LabelFormat;
  status: PrintJobStatus;
  createdAt: string;
  /** Station that is printing it (pending → printing claim); see usePrintJobQueue. */
  claimedBy?: string;
  claimedByName?: string;
  claimedAt?: string;
  /** Failed attempts so far, the last error, and when the next attempt may start. */
  attempts?: number;
  lastError?: string;
  nextAttemptAt?: string;
  printedAt?: string;
  printedBy?: string;
}

export interface StickyRegion {
  xIn: number;
  yIn: number;
  widthIn: number;
  heightIn: number;
}
