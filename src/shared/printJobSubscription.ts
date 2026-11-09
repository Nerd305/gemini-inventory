import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, runTransaction, updateDoc, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { PrintJob } from './types';

/**
 * Print queue shared by the desktop print server and the browser Print Station.
 *
 * - Claim before printing: a job goes pending → printing (claimedBy / claimedAt) in a transaction,
 *   so two stations (the Mac app and a Print Station tab) never print the same label twice.
 *   A claim older than CLAIM_STALE_MS (station crashed mid-job) can be taken over.
 * - Retry with backoff: a failed attempt records attempts / lastError / nextAttemptAt and goes back
 *   to pending; after MAX_ATTEMPTS it becomes `failed` (shown with a Retry button) instead of being
 *   silently dropped until the next restart.
 * - Old rules: until the updated firestore.rules are published, `printing` / `failed` are rejected.
 *   The queue then prints without claiming and keeps failures pending (the pre-1.0.19 behaviour).
 */

export const MAX_ATTEMPTS = 3;
const CLAIM_STALE_MS = 3 * 60_000;
const BACKOFF_MS = [15_000, 60_000, 180_000];
const TICK_MS = 10_000;

export interface PrintStation {
  /** Stable per install / browser. */
  id: string;
  /** Shown on jobs this station printed, e.g. "iMac print server". */
  name: string;
}

const STATION_KEY = 'vialtrack:printStationId';

/** Stable ID for this browser / desktop install (localStorage). */
export function printStationId(): string {
  try {
    const existing = localStorage.getItem(STATION_KEY);
    if (existing) return existing;
    const id = `station-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(STATION_KEY, id);
    return id;
  } catch {
    return `station-${Math.random().toString(36).slice(2, 10)}`;
  }
}

const isPermissionDenied = (e: unknown) => (e as { code?: string })?.code === 'permission-denied';
const time = (iso?: string) => (iso ? new Date(iso).getTime() || 0 : 0);

export function usePrintJobQueue(station?: PrintStation) {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [activeJob, setActiveJob] = useState<PrintJob | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [legacyRules, setLegacyRules] = useState(false);

  const stationRef = useRef<PrintStation>(station ?? { id: printStationId(), name: 'Print Station' });
  if (station) stationRef.current = station;
  const activeRef = useRef<PrintJob | null>(null);
  const busyRef = useRef(false);
  const openJobsRef = useRef<PrintJob[]>([]);
  const legacyRef = useRef(false);
  /** In-memory backoff for when the rules won't let us write nextAttemptAt / failed. */
  const localBackoffRef = useRef(new Map<string, { attempts: number; until: number }>());

  const markLegacy = () => {
    if (!legacyRef.current) {
      legacyRef.current = true;
      setLegacyRules(true);
      console.warn('Print queue: firestore.rules predate job claiming; printing without claims. Publish the updated rules.');
    }
  };

  const eligible = useCallback((j: PrintJob, now: number) => {
    const local = localBackoffRef.current.get(j.id);
    if (local && local.until > now) return false;
    if (j.status === 'pending') return time(j.nextAttemptAt) <= now;
    if (j.status === 'printing') return now - time(j.claimedAt) > CLAIM_STALE_MS;
    return false;
  }, []);

  /** Pick the oldest eligible job and claim it. */
  const processNext = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const now = Date.now();
      const candidates = openJobsRef.current.filter((j) => eligible(j, now)).sort((a, b) => time(a.createdAt) - time(b.createdAt));
      for (const job of candidates) {
        const me = stationRef.current;
        if (legacyRef.current) {
          activeRef.current = job;
          setActiveJob(job);
          setIsPrinting(true);
          return;
        }
        try {
          const claimed = await runTransaction(db, async (tx) => {
            const ref = doc(db, 'printJobs', job.id);
            const snap = await tx.get(ref);
            if (!snap.exists()) return null;
            const data = { id: snap.id, ...snap.data() } as PrintJob;
            if (!eligible(data, Date.now())) return null;
            const claimedAt = new Date().toISOString();
            tx.update(ref, { status: 'printing', claimedBy: me.id, claimedByName: me.name, claimedAt });
            return { ...data, status: 'printing' as const, claimedBy: me.id, claimedByName: me.name, claimedAt };
          });
          if (!claimed) continue; // another station got it first
          activeRef.current = claimed;
          setActiveJob(claimed);
          setIsPrinting(true);
          return;
        } catch (e) {
          if (isPermissionDenied(e)) {
            markLegacy();
            activeRef.current = job;
            setActiveJob(job);
            setIsPrinting(true);
            return;
          }
          console.error('Could not claim print job', job.id, e);
        }
      }
    } finally {
      // Keep busy while a job is active; release only when nothing was picked.
      if (!activeRef.current) busyRef.current = false;
    }
  }, [eligible]);

  // Open jobs (pending / printing) drive the queue; recent history is for display.
  useEffect(() => {
    const unsubOpen = onSnapshot(
      query(collection(db, 'printJobs'), where('status', 'in', ['pending', 'printing'])),
      (snap) => {
        openJobsRef.current = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PrintJob);
        void processNext();
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'printJobs'),
    );
    const unsubRecent = onSnapshot(
      query(collection(db, 'printJobs'), orderBy('createdAt', 'desc'), limit(50)),
      (snap) => setJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PrintJob)),
      (error) => handleFirestoreError(error, OperationType.LIST, 'printJobs'),
    );
    // Backoffs expire and stale claims age without any snapshot change: re-check on a timer.
    const tick = window.setInterval(() => void processNext(), TICK_MS);
    return () => {
      unsubOpen();
      unsubRecent();
      window.clearInterval(tick);
    };
  }, [processNext]);

  const release = useCallback(() => {
    activeRef.current = null;
    setActiveJob(null);
    setIsPrinting(false);
    busyRef.current = false;
    window.setTimeout(() => void processNext(), 0);
  }, [processNext]);

  const completeActive = useCallback(async () => {
    const current = activeRef.current;
    if (!current) return;
    const me = stationRef.current;
    localBackoffRef.current.delete(current.id);
    try {
      await updateDoc(doc(db, 'printJobs', current.id), {
        status: 'completed',
        printedAt: new Date().toISOString(),
        printedBy: me.name,
        lastError: '',
      });
    } catch (e) {
      console.error('Failed to mark job completed', e);
    }
    release();
  }, [release]);

  /** Record a failed attempt: retry later with backoff, or give up after MAX_ATTEMPTS. */
  const failActive = useCallback(
    async (error?: string) => {
      const current = activeRef.current;
      if (!current) return;
      const attempts = (current.attempts ?? 0) + 1;
      const message = (error || 'Print failed').slice(0, 500);
      const giveUp = attempts >= MAX_ATTEMPTS;
      const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
      localBackoffRef.current.set(current.id, { attempts, until: Date.now() + delay });
      try {
        await updateDoc(doc(db, 'printJobs', current.id), {
          status: giveUp ? 'failed' : 'pending',
          attempts,
          lastError: message,
          nextAttemptAt: new Date(Date.now() + delay).toISOString(),
        });
      } catch (e) {
        if (isPermissionDenied(e)) {
          markLegacy();
          // Old rules: keep it pending but stop hammering the printer until the app restarts.
          if (giveUp) localBackoffRef.current.set(current.id, { attempts, until: Number.MAX_SAFE_INTEGER });
          updateDoc(doc(db, 'printJobs', current.id), { status: 'pending', attempts, lastError: message }).catch(() => {});
        } else {
          console.error('Failed to record print failure', e);
        }
      }
      release();
    },
    [release],
  );

  /** Print a completed job again, or retry a failed one now. */
  const reprint = useCallback(async (job: PrintJob) => {
    localBackoffRef.current.delete(job.id);
    await updateDoc(doc(db, 'printJobs', job.id), {
      status: 'pending',
      attempts: 0,
      lastError: '',
      nextAttemptAt: '',
      createdAt: new Date().toISOString(),
    });
  }, []);

  return { jobs, activeJob, isPrinting, completeActive, failActive, reprint, legacyRules, station: stationRef.current };
}
