'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { PanchangResult } from '@/components/PanchangResult';
import { ApiError, api, type Panchang, type PlaceMatch } from '@/lib/api';

const DEFAULT_PLACE: PlaceMatch = {
  label: 'Varanasi, IN',
  name: 'Varanasi',
  country: 'IN',
  latitude: 25.317645,
  longitude: 83.005495,
  timezone: 'Asia/Kolkata',
  population: 1_164_404,
};

function todayInZone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export default function PanchangPage() {
  const [place, setPlace] = useState<PlaceMatch>(() => {
    if (typeof window === 'undefined') return DEFAULT_PLACE;
    try {
      const raw = window.localStorage.getItem('ssa.panchang.place');
      return raw ? (JSON.parse(raw) as PlaceMatch) : DEFAULT_PLACE;
    } catch {
      return DEFAULT_PLACE;
    }
  });
  const [date, setDate] = useState(() => todayInZone(place.timezone));
  const [panchang, setPanchang] = useState<Panchang | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextPlace: PlaceMatch, nextDate: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.post<Panchang>('vedic/panchang', {
        date: nextDate,
        latitude: nextPlace.latitude,
        longitude: nextPlace.longitude,
        timezone: nextPlace.timezone,
      });
      setPanchang(result);
      window.localStorage.setItem('ssa.panchang.place', JSON.stringify(nextPlace));
    } catch (caught) {
      setPanchang(null);
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'Could not load the panchang',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(place, date);
  }, [place, date, load]);

  return (
    <div className="space-y-5">
      <div className="card bg-gradient-to-br from-saffron-500/15 to-transparent">
        <h1 className="text-xl font-semibold">Today&apos;s panchang</h1>
        <p className="mt-1 text-sm text-slate-400">
          Tithi, nakshatra, yoga and karana from Lahiri sidereal Sun and Moon, anchored at local
          sunrise — the start of a Vedic day.
        </p>
      </div>

      <PlaceAndDate
        place={place}
        date={date}
        onPlace={(next) => {
          setPlace(next);
          setDate(todayInZone(next.timezone));
        }}
        onDate={setDate}
      />

      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      {loading && !panchang && <p className="text-sm text-slate-400">Casting…</p>}

      {panchang && <PanchangResult panchang={panchang} placeLabel={place.label} />}
    </div>
  );
}

function PlaceAndDate({
  place,
  date,
  onPlace,
  onDate,
}: {
  place: PlaceMatch;
  date: string;
  onPlace: (place: PlaceMatch) => void;
  onDate: (date: string) => void;
}) {
  const [query, setQuery] = useState(place.label);
  const [matches, setMatches] = useState<PlaceMatch[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (value: string) => {
    setQuery(value);
    if (debounce.current) clearTimeout(debounce.current);
    if (value.trim().length < 2) {
      setMatches([]);
      return;
    }
    debounce.current = setTimeout(() => {
      void api
        .get<{ places: PlaceMatch[] }>(`vedic/places?q=${encodeURIComponent(value.trim())}`)
        .then((result) => setMatches(result.places))
        .catch(() => setMatches([]));
    }, 250);
  };

  return (
    <div className="card space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="panchang-date">
            Date
          </label>
          <input
            id="panchang-date"
            type="date"
            className="input"
            value={date}
            onChange={(event) => onDate(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="panchang-place">
            Place
          </label>
          <input
            id="panchang-place"
            className="input"
            value={query}
            onChange={(event) => search(event.target.value)}
            autoComplete="off"
            placeholder="Varanasi"
          />
          {matches.length > 0 && (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-night-950">
              {matches.map((match) => (
                <li key={`${match.name}:${match.latitude}:${match.longitude}`}>
                  <button
                    type="button"
                    className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-white/5"
                    onClick={() => {
                      onPlace(match);
                      setQuery(match.label);
                      setMatches([]);
                    }}
                  >
                    <span>{match.label}</span>
                    <span className="text-xs text-slate-500">{match.timezone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        <span className="tabular">
          {place.latitude.toFixed(4)}°, {place.longitude.toFixed(4)}°
        </span>{' '}
        · {place.timezone}
      </p>
    </div>
  );
}
