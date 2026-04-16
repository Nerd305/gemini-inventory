import { useEffect, useRef, useState, useCallback } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
  doc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { PrintJob } from './types';

export function usePrintJobQueue() {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [activeJob, setActiveJob] = useState<PrintJob | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const queue = useRef<PrintJob[]>([]);
  const activeJobRef = useRef<PrintJob | null>(null);

  useEffect(() => {
    activeJobRef.current = activeJob;
  }, [activeJob]);

  const processNext = useCallback(() => {
    setIsPrinting((printing) => {
      if (printing) return printing;
      if (queue.current.length === 0) return printing;
      const next = queue.current.shift()!;
      setActiveJob(next);
      return true;
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'printJobs'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const fetched: PrintJob[] = [];
        snapshot.forEach((d) => {
          fetched.push({ id: d.id, ...d.data() } as PrintJob);
        });
        setJobs(fetched);

        const pending = fetched
          .filter((j) => j.status === 'pending')
          .sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );

        pending.forEach((job) => {
          const inQueue = queue.current.find((j) => j.id === job.id);
          const isActive = activeJobRef.current?.id === job.id;
          if (!inQueue && !isActive) {
            queue.current.push(job);
          }
        });

        processNext();
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'printJobs');
      },
    );

    return () => unsub();
  }, [processNext]);

  const completeActive = useCallback(async () => {
    const current = activeJobRef.current;
    if (!current) return;
    try {
      await updateDoc(doc(db, 'printJobs', current.id), { status: 'completed' });
    } catch (e) {
      console.error('Failed to mark job completed', e);
    }
    setActiveJob(null);
    setIsPrinting(false);
    setTimeout(processNext, 0);
  }, [processNext]);

  const failActive = useCallback(() => {
    setActiveJob(null);
    setIsPrinting(false);
    setTimeout(processNext, 0);
  }, [processNext]);

  const reprint = useCallback(async (job: PrintJob) => {
    await updateDoc(doc(db, 'printJobs', job.id), {
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
  }, []);

  return { jobs, activeJob, isPrinting, completeActive, failActive, reprint };
}
