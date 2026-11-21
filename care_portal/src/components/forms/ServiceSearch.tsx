import { useEffect, useState } from 'react';
import { api } from '../../api';
import { withQuery } from '../../store';
import type { ApptType, Service, ServiceList } from '../../types';
import { useDebounced } from '../ui';

/* Searches the price list on the server (lab tests include the full ERP test master). */
export function useServiceSearch(category: ApptType, q: string, limit = 24) {
  const term = useDebounced(q.trim(), 250);
  const [items, setItems] = useState<Service[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<ServiceList>(withQuery('/services', { category, q: term, limit }))
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setTotal(r.total);
      })
      .catch(() => alive && setItems([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [category, term, limit]);
  return { items, total, loading, term };
}
