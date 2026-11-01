import { useEffect, useMemo, useState } from 'react';
import { api, WbGeoHierarchy } from '../api';

export function useWbGeoHierarchy() {
  const [hierarchy, setHierarchy] = useState<WbGeoHierarchy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getWbGeoHierarchy()
      .then((res) => {
        if (!cancelled) setHierarchy(res.data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load WB geo directory');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const districts = useMemo(
    () => (hierarchy?.districts || []).map((d) => d.name).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [hierarchy],
  );

  function subdivisionsFor(district: string): string[] {
    const row = (hierarchy?.districts || []).find((d) => d.name === district);
    return (row?.subdivisions || []).map((s) => s.name).filter(Boolean);
  }

  function pincodesFor(district: string, subdivision?: string): string[] {
    const row = (hierarchy?.districts || []).find((d) => d.name === district);
    if (!row) return [];
    const pins = new Set<string>();
    for (const sub of row.subdivisions || []) {
      if (subdivision && sub.name !== subdivision) continue;
      for (const loc of sub.localities || []) {
        const pin = String(loc.pincode || '').replace(/\D/g, '');
        if (/^\d{6}$/.test(pin)) pins.add(pin);
      }
    }
    return Array.from(pins).sort();
  }

  return { hierarchy, districts, subdivisionsFor, pincodesFor, error, count: hierarchy?.count || 0 };
}
