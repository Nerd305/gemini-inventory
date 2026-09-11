import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { LocationDoc } from '../lib/inventory';

export interface LocationRecord extends LocationDoc {
  id: string;
}

/** Live map of every storage location (fridge / cabinet / shelf) keyed by doc ID. */
export function useLocations() {
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'locations')),
      (snap) => {
        const next: LocationRecord[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as LocationDoc) }));
        next.sort((a, b) => a.name.localeCompare(b.name));
        setLocations(next);
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'locations');
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const byId = useMemo(() => {
    const map: Record<string, LocationRecord> = {};
    for (const l of locations) map[l.id] = l;
    return map;
  }, [locations]);

  const nameOf = useMemo(() => (id: string) => byId[id]?.name, [byId]);

  return { locations, byId, nameOf, loading };
}
