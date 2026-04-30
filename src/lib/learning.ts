import {
  addDoc,
  collection,
  getCountFromServer,
  getAggregateFromServer,
  getDocs,
  query,
  sum,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';

export type LearningRecord = {
  imageBase64?: string;
  aiPrediction?: number;
  userFinalCount: number;
  delta: number;
  capColors?: string[];
  productId: string;
  trayId: string;
  basketId: string;
  userId: string;
  timestamp: string;
  notes?: string;
};

export async function saveLearningRecord(record: Omit<LearningRecord, 'timestamp' | 'delta'>) {
  try {
    const fullRecord: LearningRecord = {
      ...record,
      delta: record.userFinalCount - (record.aiPrediction || 0),
      timestamp: new Date().toISOString()
    };

    await addDoc(collection(db, 'learningData'), fullRecord);
    return true;
  } catch (error) {
    console.error('Failed to save learning record', error);
    return false;
  }
}

export type WeeklyTrend = {
  week: string;
  accuracy: number | null;
  sampleCount: number;
};

export type AiStats = {
  totalSamples: number;
  vialsCounted: number;
  accuracyPct: number | null;
  weeklyTrend: WeeklyTrend[];
  model: string;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function bucketByWeek(records: LearningRecord[], now: number): WeeklyTrend[] {
  const buckets = Array.from({ length: 4 }, (_, i) => {
    const to = now - (3 - i) * WEEK_MS;
    return { from: to - WEEK_MS, to, samples: [] as LearningRecord[] };
  });
  for (const r of records) {
    const t = Date.parse(r.timestamp);
    if (!Number.isFinite(t)) continue;
    const b = buckets.find((b) => t >= b.from && t < b.to);
    if (b) b.samples.push(r);
  }
  return buckets.map((b, i) => {
    const withinTolerance = b.samples.filter((r) => Math.abs(r.delta) <= 1).length;
    return {
      week: `W${i + 1}`,
      sampleCount: b.samples.length,
      accuracy:
        b.samples.length === 0 ? null : Math.round((100 * withinTolerance) / b.samples.length),
    };
  });
}

export async function loadAiStats(): Promise<AiStats> {
  const col = collection(db, 'learningData');

  const [countSnap, sumSnap] = await Promise.all([
    getCountFromServer(col),
    getAggregateFromServer(col, { vialsCounted: sum('userFinalCount') }),
  ]);

  const now = Date.now();
  const since = new Date(now - 4 * WEEK_MS).toISOString();
  const recentSnap = await getDocs(query(col, where('timestamp', '>=', since)));
  const recent = recentSnap.docs
    .map((d) => d.data() as LearningRecord)
    .filter((r) => typeof r.aiPrediction === 'number');

  const accuracyPct =
    recent.length === 0
      ? null
      : Math.round((100 * recent.filter((r) => Math.abs(r.delta) <= 1).length) / recent.length);

  return {
    totalSamples: countSnap.data().count,
    vialsCounted: Number(sumSnap.data().vialsCounted) || 0,
    accuracyPct,
    weeklyTrend: bucketByWeek(recent, now),
    model: 'gemini-2.5-flash',
  };
}
