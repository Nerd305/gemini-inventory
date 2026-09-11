import { collection, doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import type { LabelFormat } from '../shared/types';

export interface LabelSpec {
  code: string;
  title: string;
  subtitle?: string;
}

/** Physical label sizes offered in the print dialogs. */
export const LABEL_FORMAT_OPTIONS: { value: LabelFormat; label: string }[] = [
  { value: '2.5x1.5', label: 'Epson 2.5" × 1.5" — bin sleeve / tray tag' },
  { value: '4x3', label: 'Zebra 4" × 3" — large QR' },
  { value: '1.5x1.5', label: 'Epson 1.5" × 1.5" — square QR' },
  { value: '2.5x0.7', label: 'Epson 2.5" × 0.7" — slim barcode' },
  { value: 'canon-integrated', label: 'Canon integrated form (Letter sheet)' },
];

const MAX_BATCH = 400; // Firestore batch limit is 500 writes

/** Queue label print jobs for the Print Station / desktop print server. */
export async function sendPrintJobs(labels: LabelSpec[], format: LabelFormat): Promise<number> {
  if (labels.length === 0) return 0;
  let sent = 0;
  for (let i = 0; i < labels.length; i += MAX_BATCH) {
    const chunk = labels.slice(i, i + MAX_BATCH);
    const batch = writeBatch(db);
    const base = Date.now();
    chunk.forEach((label, idx) => {
      const ref = doc(collection(db, 'printJobs'));
      batch.set(ref, {
        code: label.code,
        title: label.title,
        subtitle: label.subtitle ?? '',
        format,
        status: 'pending',
        // Stagger timestamps so the FIFO queue prints in the order given.
        createdAt: new Date(base + idx).toISOString(),
      });
    });
    await batch.commit();
    sent += chunk.length;
  }
  return sent;
}
