import { useEffect, useMemo, useState } from 'react';
import { subscribeProducts, type ProductSummary } from './inventory';

export function useProducts() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeProducts(
      (list) => {
        setProducts(list);
        setLoading(false);
      },
      (err) => {
        console.error('Products subscription failed', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const byId = useMemo(() => {
    const map: Record<string, ProductSummary> = {};
    for (const p of products) map[p.id] = p;
    return map;
  }, [products]);

  return { products, byId, loading };
}
