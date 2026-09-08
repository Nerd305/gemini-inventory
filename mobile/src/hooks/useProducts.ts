import { useEffect, useMemo, useState } from 'react';
import { subscribeProducts, type ProductSummary } from '../core';

export function useProducts() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(
    () =>
      subscribeProducts(
        (list) => {
          setProducts(list);
          setLoading(false);
        },
        (err) => {
          console.error('Products subscription failed', err);
          setLoading(false);
        },
      ),
    [],
  );
  const byId = useMemo(() => {
    const map: Record<string, ProductSummary> = {};
    for (const p of products) map[p.id] = p;
    return map;
  }, [products]);
  return { products, byId, loading };
}
