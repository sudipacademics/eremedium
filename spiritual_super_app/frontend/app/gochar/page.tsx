'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, api, type BirthProfile, type Gochar, type PlaceMatch } from '@/lib/api';

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

function nowTimeInZone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch {
    return '12:00';
  }
}

export default function GocharPage() {
  const [place, setPlace] = useState<PlaceMatch>(DEFAULT_PLACE);
  const [date, setDate] = useState(() => todayInZone(DEFAULT_PLACE.timezone));
  const [time, setTime] = useState(() => nowTimeInZone(DEFAULT_PLACE.timezone));
  const [gochar, setGochar] = useState<Gochar | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<BirthProfile>('vedic/birth-profile')
      .then((profile) => {
        if (!profile.complete || profile.latitude === null || profile.longitude === null) return;
        const next: PlaceMatch = {
          label: profile.placeLabel ?? 'Birth place',
          name: profile.placeLabel ?? 'Birth',
          country: '',
          latitude: profile.latitude,
          longitude: profile.longitude,
          timezone: profile.timezone ?? 'Asia/Kolkata',
          population: 0,
        };
        setPlace(next);
        setDate(todayInZone(next.timezone));
        setTime(nowTimeInZone(next.timezone));
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async (nextPlace: PlaceMatch, nextDate: string, nextTime: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.post<Gochar>('vedic/gochar', {
        date: nextDate,
        time: nextTime,
        latitude: nextPlace.latitude,
        longitude: nextPlace.longitude,
        timezone: nextPlace.timezone,
        useNatalOverlay: true,
      });
      setGochar(result);
    } catch (caught) {
      setGochar(null);
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'Could not cast gochar',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(place, date, time);
  }, [place, date, time, load]);

  return (
    <div className="space-y-5">
      <div className="card bg-ved-green-50 border-ved-green-900/10">
        <h1 className="text-xl font-semibold">Gochar</h1>
        <p className="mt-1 text-sm text-ved-green-800/60">
          Transit sky in Chitra Paksha (Lahiri) with true node — houses counted from your natal Lagna
          when a birth profile is saved.
        </p>
      </div>

      <PlaceDateTime
        place={place}
        date={date}
        time={time}
        onPlace={(next) => {
          setPlace(next);
          setDate(todayInZone(next.timezone));
          setTime(nowTimeInZone(next.timezone));
        }}
        onDate={setDate}
        onTime={setTime}
      />

      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      {loading && !gochar && <p className="text-sm text-ved-green-800/60">Casting…</p>}

      {gochar && <GocharResult gochar={gochar} placeLabel={place.label} />}
    </div>
  );
}

function PlaceDateTime({
  place,
  date,
  time,
  onPlace,
  onDate,
  onTime,
}: {
  place: PlaceMatch;
  date: string;
  time: string;
  onPlace: (place: PlaceMatch) => void;
  onDate: (date: string) => void;
  onTime: (time: string) => void;
}) {
  const [query, setQuery] = useState(place.label);
  const [matches, setMatches] = useState<PlaceMatch[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(place.label);
  }, [place.label]);

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
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="gochar-date">
            Date
          </label>
          <input
            id="gochar-date"
            type="date"
            className="input"
            value={date}
            onChange={(e) => onDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="gochar-time">
            Time
          </label>
          <input
            id="gochar-time"
            type="time"
            className="input"
            value={time}
            onChange={(e) => onTime(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="gochar-place">
            Place
          </label>
          <input
            id="gochar-place"
            className="input"
            value={query}
            onChange={(e) => search(e.target.value)}
            autoComplete="off"
            placeholder="Varanasi"
          />
          {matches.length > 0 && (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-ved-green-900/10 bg-white">
              {matches.map((match) => (
                <li key={`${match.name}:${match.latitude}:${match.longitude}`}>
                  <button
                    type="button"
                    className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-ved-cream-200/80"
                    onClick={() => {
                      onPlace(match);
                      setQuery(match.label);
                      setMatches([]);
                    }}
                  >
                    <span>{match.label}</span>
                    <span className="text-xs text-ved-green-800/50">{match.timezone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="text-xs text-ved-green-800/50">
        <span className="tabular">
          {place.latitude.toFixed(4)}°, {place.longitude.toFixed(4)}°
        </span>{' '}
        · {place.timezone}
      </p>
    </div>
  );
}

function GocharResult({ gochar, placeLabel }: { gochar: Gochar; placeLabel: string }) {
  return (
    <div className="card space-y-4">
      <div>
        <p className="text-sm text-ved-green-800/60">
          {placeLabel} · {gochar.local.date} {gochar.local.time} ({gochar.local.timezone}{' '}
          {gochar.local.offset})
        </p>
        <p className="mt-1 text-sm">
          Transit Lagna {gochar.transit_ascendant.zodiac_sign_name}{' '}
          <span className="tabular text-ved-green-800/60">
            {gochar.transit_ascendant.degrees_in_sign.toFixed(1)}°
          </span>
        </p>
        {gochar.natalOverlayApplied ? (
          <p className="mt-1 text-xs text-ved-green-800/50">
            Houses from your natal Lagna
            {gochar.birthTimeAssumed ? ' (birth time assumed noon — Lagna approximate)' : ''}
            {gochar.natal_moon_sign
              ? ` · natal Moon ${gochar.natal_moon_sign}${
                  gochar.natal_moon_nakshatra ? ` / ${gochar.natal_moon_nakshatra}` : ''
                }`
              : ''}
          </p>
        ) : (
          <p className="mt-1 text-xs text-amber-200/80">
            Save a kundali birth profile to see houses from your natal Lagna.
          </p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-ved-green-800/50">
            <tr>
              <th className="py-2 pr-3">Graha</th>
              <th className="py-2 pr-3">Sign</th>
              <th className="py-2 pr-3">Nakshatra</th>
              <th className="py-2 pr-3">Natal house</th>
              <th className="py-2">Motion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {gochar.planets.map((planet) => (
              <tr key={planet.body}>
                <td className="py-2 pr-3 font-medium">{planet.body}</td>
                <td className="py-2 pr-3">
                  {planet.zodiac_sign_name}{' '}
                  <span className="tabular text-ved-green-800/50">{planet.degrees_in_sign.toFixed(1)}°</span>
                </td>
                <td className="py-2 pr-3">
                  {planet.nakshatra_name}{' '}
                  <span className="text-ved-green-800/50">p{planet.nakshatra_pada}</span>
                </td>
                <td className="py-2 pr-3 tabular">
                  {planet.house_from_natal_lagna ?? '—'}
                </td>
                <td className="py-2 text-ved-green-800/60">
                  {planet.is_retrograde ? 'R' : 'D'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ved-green-800/50">
        {gochar.ayanamsha_system.replaceAll('_', ' ').toLowerCase()} ayanamsha{' '}
        {gochar.ayanamsha.toFixed(4)}° · {gochar.node_type.replaceAll('_', ' ').toLowerCase()}
      </p>
    </div>
  );
}
