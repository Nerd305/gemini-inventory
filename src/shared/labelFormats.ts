import type { LabelFormat } from './types';

/**
 * Single source of truth (web side) for the physical label formats.
 *
 * The same keys must exist in:
 *   - `LabelFormat` in ./types.ts
 *   - the `format` enum in firestore.rules (`isValidPrintJob`)
 *   - `desktop/config/printers.json` and `DEFAULT_CONFIG` in desktop/main/configLoader.ts
 */
export interface LabelFormatSpec {
  key: LabelFormat;
  /** Human readable option text. */
  label: string;
  widthIn: number;
  heightIn: number;
}

export const LABEL_FORMAT_SPECS: LabelFormatSpec[] = [
  { key: '2x1.5', label: 'Epson (2" x 1.5") - Basket / Shelf / Fridge label', widthIn: 2, heightIn: 1.5 },
  { key: '2.5x1.5', label: 'Epson (2.5" x 1.5") - Rectangle QR', widthIn: 2.5, heightIn: 1.5 },
  { key: '1.5x1.5', label: 'Epson (1.5" x 1.5") - Square QR', widthIn: 1.5, heightIn: 1.5 },
  { key: '2.5x0.7', label: 'Epson (2.5" x 0.7") - Long Barcode', widthIn: 2.5, heightIn: 0.7 },
  { key: '4x3', label: 'Zebra (4" x 3") - Large QR', widthIn: 4, heightIn: 3 },
  { key: 'canon-integrated', label: 'Canon Integrated Form (8.5" x 11" sheet)', widthIn: 8.5, heightIn: 11 },
];

/** Format used for the labels printed from the counting flow. */
export const DEFAULT_LABEL_FORMAT: LabelFormat = '2x1.5';

const SPEC_BY_KEY: Record<LabelFormat, LabelFormatSpec> = LABEL_FORMAT_SPECS.reduce(
  (acc, spec) => {
    acc[spec.key] = spec;
    return acc;
  },
  {} as Record<LabelFormat, LabelFormatSpec>,
);

export function labelSpec(format: LabelFormat): LabelFormatSpec {
  return SPEC_BY_KEY[format] ?? SPEC_BY_KEY['4x3'];
}

/** CSS `@page { size: ... }` value for a format, e.g. `2in 1.5in`. */
export function labelPageSize(format: LabelFormat): string {
  const spec = labelSpec(format);
  return `${spec.widthIn}in ${spec.heightIn}in`;
}

export function isLabelFormat(value: unknown): value is LabelFormat {
  return typeof value === 'string' && value in SPEC_BY_KEY;
}
