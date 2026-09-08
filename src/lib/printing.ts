import { db } from '../firebase';
import { enqueuePrintJob as enqueue, type PrintJobInput } from '../shared/printJobs';

export type { PrintJobInput };
export { describePrintError } from '../shared/printJobs';

/** Queue a label for the print station / desktop print server (web app binding). */
export const enqueuePrintJob = (input: PrintJobInput) => enqueue(db, input);
