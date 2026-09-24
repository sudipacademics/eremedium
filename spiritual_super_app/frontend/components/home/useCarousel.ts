'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Scroll track state for a horizontal carousel: which ends are reached, and a page-wise scroll. */
export function useCarousel(itemCount: number) {
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, itemCount]);

  const scroll = useCallback((direction: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.8, 240), behavior: 'smooth' });
  }, []);

  return { track, edges, measure, scroll };
}

export const CAROUSEL_ARROW =
  'hidden h-9 w-9 place-items-center rounded-full border border-ved-green-900/10 bg-white text-ved-green-800 shadow-sm transition hover:border-ved-green-500/30 disabled:opacity-35 sm:grid';
