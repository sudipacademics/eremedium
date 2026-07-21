import { useEffect, useState } from 'react';

export type ViewMode = 'cards' | 'list';

export function useViewMode(storageKey: string, defaultMode: ViewMode = 'cards') {
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === 'list' || stored === 'cards' ? stored : defaultMode;
    } catch {
      return defaultMode;
    }
  });

  useEffect(() => {
    localStorage.setItem(storageKey, mode);
  }, [storageKey, mode]);

  return [mode, setMode] as const;
}
