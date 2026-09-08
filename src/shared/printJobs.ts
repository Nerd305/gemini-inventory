import { addDoc, collection, type Firestore } from 'firebase/firestore';
import type { LabelFormat } from './types';
import { DEFAULT_LABEL_FORMAT } from './labelFormats';

export interface PrintJobInput {
  code: string;
  title: string;
  subtitle?: string;
  format?: LabelFormat;
}

/**
 * Queue a label for the print station / desktop print server.
 * Returns the new `printJobs` doc id. Shared by the web and Expo apps.
 */
export async function enqueuePrintJob(db: Firestore, input: PrintJobInput): Promise<string> {
  const ref = await addDoc(collection(db, 'printJobs'), {
    code: input.code,
    title: input.title,
    subtitle: input.subtitle ?? '',
    format: input.format ?? DEFAULT_LABEL_FORMAT,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}

/** Turn a Firestore error from `enqueuePrintJob` into an actionable message. */
export function describePrintError(error: unknown, format: LabelFormat): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  const message = error instanceof Error ? error.message : String(error);
  if (code === 'permission-denied' || /permission/i.test(message)) {
    return (
      `Firestore rejected the print job (format "${format}"). ` +
      'If this is a newly added label size, deploy the latest firestore.rules ' +
      '(firebase deploy --only firestore:rules) or choose another size.'
    );
  }
  return `Could not queue label: ${message}`;
}
