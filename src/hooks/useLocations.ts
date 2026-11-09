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
        snap.forEach((d) => {
          const data = d.data() as Partial<LocationDoc>;
          // A location without a name (old prototype data) used to throw in the sort below and
          // leave every fridge dropdown empty; show it under a placeholder instead.
          next.push({ id: d.id, ...(data as LocationDoc), name: typeof data.name === 'string' && data.name.trim() ? data.name : '(unnamed fridge)' });
        });
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
