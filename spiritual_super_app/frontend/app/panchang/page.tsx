'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
  // Civil date where the user is looking, not where the server sits.
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

function formatEnd(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
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

export function PanchangResult({ panchang, placeLabel }: { panchang: Panchang; placeLabel: string }) {
  const angas = [
    {
      label: 'Tithi',
      value: panchang.tithi.name,
      detail: panchang.tithi.paksha ? `${panchang.tithi.paksha} paksha` : null,
      end: panchang.tithi.end_utc,
    },
    {
      label: 'Nakshatra',
      value: panchang.nakshatra.name,
      detail: panchang.nakshatra.pada ? `pada ${panchang.nakshatra.pada}` : null,
      end: panchang.nakshatra.end_utc,
    },
    {
      label: 'Yoga',
      value: panchang.yoga.name,
      detail: null,
      end: panchang.yoga.end_utc,
    },
    {
      label: 'Karana',
      value: panchang.karana.name,
      detail: null,
      end: panchang.karana.end_utc,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Vaara</p>
            <p className="text-2xl font-semibold">{panchang.vaara}</p>
            <p className="mt-1 text-sm text-slate-400">
              {placeLabel} · {panchang.date}
            </p>
          </div>
          <div className="text-right text-sm">
            <p>
              <span className="text-slate-500">Sunrise </span>
              <span className="tabular font-medium">{panchang.sunrise.local.slice(0, 5)}</span>
            </p>
            <p>
              <span className="text-slate-500">Sunset </span>
              <span className="tabular font-medium">{panchang.sunset.local.slice(0, 5)}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {angas.map((anga) => (
          <div key={anga.label} className="card">
            <p className="text-xs uppercase tracking-wide text-slate-500">{anga.label}</p>
            <p className="mt-1 text-lg font-semibold">{anga.value}</p>
            {anga.detail && <p className="text-xs text-slate-400">{anga.detail}</p>}
            <p className="mt-2 text-xs text-slate-500">
              until {formatEnd(anga.end, panchang.timezone)}
            </p>
          </div>
        ))}
      </div>

      <div className="card flex flex-wrap gap-6 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Surya</p>
          <p className="font-medium">{panchang.sun_sign}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Chandra</p>
          <p className="font-medium">{panchang.moon_sign}</p>
        </div>
      </div>

      <p className="text-center text-[11px] text-slate-600">
        {panchang.ayanamsha_system.replaceAll('_', ' ').toLowerCase()} ayanamsha{' '}
        {panchang.ayanamsha.toFixed(4)}° · evaluated at local sunrise
      </p>
    </div>
  );
}
