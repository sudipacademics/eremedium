'use client';

import { FormEvent, useState } from 'react';
import { appPath } from '@rfms/utils';

type Availability = { place: string; fofo: number; foco: number; scope?: string };
type LiveAvailability = { match_found: boolean; scope?: string; place: string; fofo_available: number; foco_available: number };
const API_BASE = process.env.NEXT_PUBLIC_RFMS_API_URL ?? 'http://localhost:8080/api/v1';

const districts: Record<string, Availability> = {
  'alipurduar': { place: 'Alipurduar', fofo: 3, foco: 1 },
  'bankura': { place: 'Bankura', fofo: 2, foco: 1 },
  'bardhaman': { place: 'Purba Bardhaman', fofo: 2, foco: 2 },
  'purba bardhaman': { place: 'Purba Bardhaman', fofo: 2, foco: 2 },
  'paschim bardhaman': { place: 'Paschim Bardhaman', fofo: 3, foco: 1 },
  'birbhum': { place: 'Birbhum', fofo: 3, foco: 1 },
  'cooch behar': { place: 'Cooch Behar', fofo: 2, foco: 1 },
  'darjeeling': { place: 'Darjeeling', fofo: 3, foco: 1 },
  'dakshin dinajpur': { place: 'Dakshin Dinajpur', fofo: 2, foco: 1 },
  'uttar dinajpur': { place: 'Uttar Dinajpur', fofo: 2, foco: 1 },
  'hooghly': { place: 'Hooghly', fofo: 3, foco: 2 },
  'howrah': { place: 'Howrah', fofo: 3, foco: 1 },
  'jalpaiguri': { place: 'Jalpaiguri', fofo: 3, foco: 1 },
  'jhargram': { place: 'Jhargram', fofo: 2, foco: 1 },
  'kalimpong': { place: 'Kalimpong', fofo: 2, foco: 1 },
  'kolkata': { place: 'Kolkata', fofo: 4, foco: 2 },
  'malda': { place: 'Malda', fofo: 3, foco: 1 },
  'murshidabad': { place: 'Murshidabad', fofo: 3, foco: 2 },
  'nadia': { place: 'Nadia', fofo: 3, foco: 1 },
  'north 24 parganas': { place: 'North 24 Parganas', fofo: 4, foco: 2 },
  'north 24 pargana': { place: 'North 24 Parganas', fofo: 4, foco: 2 },
  'south 24 parganas': { place: 'South 24 Parganas', fofo: 3, foco: 2 },
  'south 24 pargana': { place: 'South 24 Parganas', fofo: 3, foco: 2 },
  'purulia': { place: 'Purulia', fofo: 2, foco: 1 },
  'paschim medinipur': { place: 'Paschim Medinipur', fofo: 3, foco: 1 },
  'purba medinipur': { place: 'Purba Medinipur', fofo: 3, foco: 2 },
  'siliguri': { place: 'Siliguri', fofo: 5, foco: 2 },
};

const pincodePrefixes: Record<string, Availability> = {
  '700': districts.kolkata,
  '711': districts.howrah,
  '712': districts.hooghly,
  '713': districts.bardhaman,
  '714': districts.birbhum,
  '721': districts['paschim medinipur'],
  '722': districts.bankura,
  '723': districts.purulia,
  '731': districts.murshidabad,
  '732': districts.malda,
  '733': districts['uttar dinajpur'],
  '734': districts.siliguri,
  '735': districts.jalpaiguri,
  '736': districts['cooch behar'],
  '741': districts.nadia,
  '742': districts.murshidabad,
  '743': districts['north 24 parganas'],
};

function findAvailability(value: string): Availability | null {
  const query = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!query) return null;

  if (/^\d{6}$/.test(query)) {
    const match = pincodePrefixes[query.slice(0, 3)];
    return match ? { ...match, place: `${match.place} - PIN ${query}` } : null;
  }

  if (districts[query]) return districts[query];
  return Object.entries(districts).find(([district]) => district.includes(query) || query.includes(district))?.[1] ?? null;
}

export function TerritoryChecker() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<Availability | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value) { setResult(null); setError('Enter a West Bengal district, area or six-digit PIN code.'); return; }
    setChecking(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/territories/availability?query=${encodeURIComponent(value)}`);
      const payload = await response.json() as { success?: boolean; data?: LiveAvailability };
      if (!response.ok || !payload.success || !payload.data) throw new Error('Live territory availability is unavailable.');
      if (!payload.data.match_found) { setResult(null); setError('This location is not yet configured in the live territory register. Please send an enquiry and the franchise team will review it.'); return; }
      const scope = payload.data.scope ?? 'search';
      const scopeLabel = scope === 'pincode' ? 'PIN code' : scope === 'area' ? 'Area' : scope === 'subdivision' ? 'Subdivision' : scope === 'district' ? 'District' : scope === 'state' ? 'State' : 'Territory';
      setResult({ place: `${scopeLabel}: ${payload.data.place}`, fofo: payload.data.fofo_available, foco: payload.data.foco_available, scope });
    } catch {
      setResult(null);
      setError('Live PIN-code availability could not be reached. Please try again after the RFMS local service has started.');
    } finally { setChecking(false); }
  }

  return (
    <section id="territory" className="territory-band" aria-labelledby="territory-title">
      <div className="wb-actual">
        <img
          src="https://upload.wikimedia.org/wikipedia/commons/b/bd/West_Bengal_Map.svg"
          alt="Map of West Bengal"
          loading="lazy"
        />
      </div>
      <div className="territory-content">
        <h2 id="territory-title">Find your place in West Bengal.</h2>
        <p>Search a configured PIN code, area, subdivision, district or state to view the exact aggregated FOFO and FOCO availability.</p>
        <form className="territory-search" onSubmit={check}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="PIN code, area, subdivision or district"
            aria-label="PIN code, area, subdivision or district"
          />
          <button type="submit" disabled={checking}>{checking ? 'Checking...' : 'Check availability'}</button>
        </form>
        {error ? <p className="territory-error" role="alert">{error}</p> : <small>Availability is indicative and subject to exclusive-territory review.</small>}
        <div className="territory-examples" aria-label="Example searches">
          {['Kolkata', 'Howrah', 'Siliguri', '700156'].map((example) => (
            <button key={example} type="button" onClick={() => setQuery(example)}>{example}</button>
          ))}
        </div>
      </div>

      {result && (
        <div className="availability-backdrop" role="presentation" onMouseDown={() => setResult(null)}>
          <section className="availability-popup" role="dialog" aria-modal="true" aria-labelledby="availability-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="availability-close" type="button" aria-label="Close availability result" onClick={() => setResult(null)}>x</button>
            <p className="eyebrow">Territory availability</p>
            <h3 id="availability-title">{result.place}</h3>
            <p className="availability-note">Current indicative opportunity count</p>
            <div className="availability-counts">
              <a className="availability-card" href={appPath('/fofo')} aria-label="View FOFO franchise details">
                <strong>{result.fofo}</strong><span>FOFO available</span><small>View FOFO details</small>
              </a>
              <a className="availability-card" href={appPath('/foco')} aria-label="View FOCO franchise details">
                <strong>{result.foco}</strong><span>FOCO available</span><small>View FOCO details</small>
              </a>
            </div>
            <a className="availability-apply" href={appPath('/#apply')} onClick={() => setResult(null)}>Apply for this territory</a>
          </section>
        </div>
      )}
    </section>
  );
}
