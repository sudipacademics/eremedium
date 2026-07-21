import { useEffect } from 'react';

/** Refetch ERPNext-backed data when user returns to the tab, and optionally on an interval. */
export function useLiveRefresh(onRefresh: () => void, intervalMs?: number) {
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') {
        onRefresh();
      }
    };
    document.addEventListener('visibilitychange', handler);
    const timer =
      intervalMs && intervalMs > 0 ? window.setInterval(onRefresh, intervalMs) : undefined;
    return () => {
      document.removeEventListener('visibilitychange', handler);
      if (timer) window.clearInterval(timer);
    };
  }, [onRefresh, intervalMs]);
}
