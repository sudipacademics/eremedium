'use client';

import { useCallback, useEffect, useState } from 'react';
import { RFMS_API_BASE } from '@rfms/utils';
import './available-territories.css';

export type AvailableTerritory = {
  id: string;
  name: string;
  district: string;
  subdivision: string;
  pincode: string;
};

const API_BASE = RFMS_API_BASE;
const REFRESH_MS = 30000;

function LocationPinIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c-3.59 0-6.5 2.91-6.5 6.5 0 4.88 6.5 12.5 6.5 12.5s6.5-7.62 6.5-12.5c0-3.59-2.91-6.5-6.5-6.5Zm0 8.8a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6Z" fill="currentColor" /></svg>;
}

function ShieldCheckIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 5 5.5v5.8c0 4.2 3 8.1 7 9.2 4-1.1 7-5 7-9.2V5.5L12 2.5Zm-1.1 11.8-2.6-2.6 1.2-1.2 1.4 1.4 3.8-3.8 1.2 1.2-5 5Z" fill="currentColor" /></svg>;
}

export function useAvailableTerritories(model: 'FOFO' | 'FOCO') {
  const [territories, setTerritories] = useState<AvailableTerritory[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/content/available-territories?model=${model}`, { cache: 'no-store' });
      const payload = await response.json() as { success?: boolean; data?: { territories?: AvailableTerritory[] } };
      if (response.ok && payload?.success && Array.isArray(payload.data?.territories)) {
        setTerritories(payload.data.territories);
      }
    } catch {
      setTerritories([]);
    } finally {
      setLoading(false);
    }
  }, [model]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, REFRESH_MS);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  return { territories, loading };
}

export function AvailableTerritorySection({
  model,
  title = 'West Bengal Opportunity',
  subtitle = 'Explore available territories across West Bengal.',
  footerNote = 'Territory availability is verified before final approval.',
}: {
  model: 'FOFO' | 'FOCO';
  title?: string;
  subtitle?: string;
  footerNote?: string;
}) {
  const { territories, loading } = useAvailableTerritories(model);

  return (
    <section className="territory-opportunity" aria-labelledby="territory-opportunity-title">
      <header className="territory-opportunity-head">
        <h2 id="territory-opportunity-title">{title}</h2>
        <p className="territory-opportunity-subtitle">{subtitle}</p>
      </header>

      <div className="territory-opportunity-scroll-shell">
        <div className="territory-opportunity-scroll" role="list" aria-label={`Available ${model} territories`}>
          {loading && !territories.length ? <p className="territory-opportunity-empty">Loading available territories…</p> : null}
          {!loading && !territories.length ? <p className="territory-opportunity-empty">No {model} territories are currently available. Please check back soon.</p> : null}
          {territories.map((territory) => (
            <article key={territory.id} className="territory-opportunity-card" role="listitem">
              <span className="territory-opportunity-icon" aria-hidden="true"><LocationPinIcon /></span>
              <div className="territory-opportunity-line">
                <strong>{territory.name}</strong>
                <span className="territory-opportunity-meta">
                  {territory.district}{territory.subdivision ? ` • ${territory.subdivision}` : ''}
                </span>
                <em>PIN {territory.pincode}</em>
              </div>
              <span className="territory-opportunity-badge"><i aria-hidden="true" /> Available</span>
            </article>
          ))}
        </div>
      </div>

      <footer className="territory-opportunity-foot">
        <span className="territory-opportunity-shield" aria-hidden="true"><ShieldCheckIcon /></span>
        <p>{footerNote}</p>
      </footer>
    </section>
  );
}
