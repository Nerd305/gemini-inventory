export type LabelFormat =
  | '4x3'
  | '2x1.5'
  | '1.5x1.5'
  | '2.5x0.7'
  | '2.5x1.5'
  | 'canon-integrated';

export interface PrintJob {
  id: string;
  code: string;
  title: string;
  subtitle?: string;
  format: LabelFormat;
  status: 'pending' | 'completed';
  createdAt: string;
}

export interface StickyRegion {
  xIn: number;
  yIn: number;
  widthIn: number;
  heightIn: number;
}
