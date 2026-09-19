'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, api, type BirthProfile, type MatchResult, type PlaceMatch } from '@/lib/api';

type PersonDraft = {
  label: string;
  birthDate: string;
  birthTime: string;
  timeKnown: boolean;
  place: PlaceMatch | null;
  query: string;
};

const EMPTY: PersonDraft = {
  label: '',
  birthDate: '',
  birthTime: '',
  timeKnown: true,
  place: null,
  query: '',
};

export default function MatchPage() {
  const [boy, setBoy] = useState<PersonDraft>({ ...EMPTY, label: 'Boy' });
  const [girl, setGirl] = useState<PersonDraft>({ ...EMPTY, label: 'Girl' });
  const [result, setResult] = useState<MatchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    void api
      .get<BirthProfile>('vedic/birth-profile')
      .then((profile) => {
        if (!profile.complete || profile.latitude === null || profile.longitude === null) return;
        setBoy((prev) => ({
          ...prev,
          label: 'You',
          birthDate: profile.birthDate ?? '',
          birthTime: profile.birthTime ?? '',
          timeKnown: profile.birthTimeKnown,
          place: {
            label: profile.placeLabel ?? 'Birth place',
            name: profile.placeLabel ?? 'Birth',
            country: '',
            latitude: profile.latitude!,
            longitude: profile.longitude!,
            timezone: profile.timezone ?? 'Asia/Kolkata',
            population: 0,
          },
          query: profile.placeLabel ?? '',
        }));
      })
      .catch(() => undefined)
      .finally(() => setProfileLoaded(true));
  }, []);

  const submit = useCallback(async () => {
    if (!boy.place || !girl.place || !boy.birthDate || !girl.birthDate) {
      setError('Both people need a birth date and place');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = {
        boy: {
          label: boy.label || 'Boy',
          birthDate: boy.birthDate,
          ...(boy.timeKnown && boy.birthTime ? { birthTime: boy.birthTime } : {}),
          timezone: boy.place.timezone,
          latitude: boy.place.latitude,
          longitude: boy.place.longitude,
          placeLabel: boy.place.label,
        },
        girl: {
          label: girl.label || 'Girl',
          birthDate: girl.birthDate,
          ...(girl.timeKnown && girl.birthTime ? { birthTime: girl.birthTime } : {}),
          timezone: girl.place.timezone,
          latitude: girl.place.latitude,
          longitude: girl.place.longitude,
          placeLabel: girl.place.label,
        },
      };
      setResult(await api.post<MatchResult>('vedic/match', payload));
    } catch (caught) {
      setResult(null);
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'Could not score the match',
      );
    } finally {
      setLoading(false);
    }
  }, [boy, girl]);

  return (
    <div className="space-y-5">
      <div className="card bg-gradient-to-br from-saffron-500/15 to-transparent">
        <h1 className="text-xl font-semibold">Guna Milan</h1>
        <p className="mt-1 text-sm text-slate-400">
          Ashtakoot matching from Lahiri Moon nakshatras — eight kootas out of 36, plus Manglik when
          birth times are known.
        </p>
      </div>

      {!profileLoaded ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <PersonCard title="Boy / Person A" draft={boy} onChange={setBoy} />
          <PersonCard title="Girl / Person B" draft={girl} onChange={setGirl} />
        </div>
      )}

      <button type="button" className="btn-primary" disabled={loading} onClick={() => void submit()}>
        {loading ? 'Scoring…' : 'Match'}
      </button>

      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      {result && <MatchScore result={result} />}
    </div>
  );
}

function PersonCard({
  title,
  draft,
  onChange,
}: {
  title: string;
  draft: PersonDraft;
  onChange: (next: PersonDraft) => void;
}) {
  const [matches, setMatches] = useState<PlaceMatch[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (value: string) => {
    onChange({ ...draft, query: value });
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
      <h2 className="text-sm font-medium text-slate-300">{title}</h2>
      <div>
        <label className="label">Name (optional)</label>
        <input
          className="input"
          value={draft.label}
          onChange={(e) => onChange({ ...draft, label: e.target.value })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Birth date</label>
          <input
            type="date"
            className="input"
            value={draft.birthDate}
            onChange={(e) => onChange({ ...draft, birthDate: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Birth time</label>
          <input
            type="time"
            className="input"
            value={draft.birthTime}
            disabled={!draft.timeKnown}
            onChange={(e) => onChange({ ...draft, birthTime: e.target.value })}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-400">
        <input
          type="checkbox"
          checked={!draft.timeKnown}
          onChange={(e) => onChange({ ...draft, timeKnown: !e.target.checked, birthTime: '' })}
        />
        Time unknown (Manglik skipped)
      </label>
      <div>
        <label className="label">Birth place</label>
        <input
          className="input"
          value={draft.query}
          onChange={(e) => search(e.target.value)}
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
                    onChange({ ...draft, place: match, query: match.label });
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
        {draft.place && (
          <p className="mt-1 text-xs text-slate-500">
            <span className="tabular">
              {draft.place.latitude.toFixed(4)}°, {draft.place.longitude.toFixed(4)}°
            </span>{' '}
            · {draft.place.timezone}
          </p>
        )}
      </div>
    </div>
  );
}

function MatchScore({ result }: { result: MatchResult }) {
  const pct = Math.round((result.total_guna / result.max_guna) * 100);
  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">Total guna</p>
          <p className="text-3xl font-semibold tabular">
            {result.total_guna}
            <span className="text-lg text-slate-500"> / {result.max_guna}</span>
          </p>
        </div>
        <p className="text-sm text-slate-400">{pct}%</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 text-sm">
        <MoonSummary side={result.boy} />
        <MoonSummary side={result.girl} />
      </div>

      <ul className="divide-y divide-white/5">
        {result.kootas.map((koota) => (
          <li key={koota.name} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div>
              <p className="font-medium">{koota.name}</p>
              <p className="text-xs text-slate-500">{koota.detail}</p>
            </div>
            <p className="tabular text-slate-300">
              {koota.score}/{koota.max_points}
            </p>
          </li>
        ))}
      </ul>

      {result.manglik && (
        <div className="rounded-lg border border-white/10 p-3 text-sm space-y-1">
          <p className="font-medium">Manglik</p>
          <p className="text-slate-400">{result.manglik.boy.notes}</p>
          <p className="text-slate-400">{result.manglik.girl.notes}</p>
          {result.manglik.compatible === true && (
            <p className="text-emerald-300">Manglik status matches (both or neither).</p>
          )}
          {result.manglik.compatible === false && (
            <p className="text-amber-200">Manglik mismatch — traditionally needs remedies or review.</p>
          )}
          {result.manglik.compatible === null && (
            <p className="text-slate-500">Needs birth times on both sides to compare.</p>
          )}
        </div>
      )}
    </div>
  );
}

function MoonSummary({
  side,
}: {
  side: MatchResult['boy'];
}) {
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <p className="font-medium">{side.label}</p>
      <p className="text-slate-400">
        Moon in {side.moonSign} · {side.moonNakshatra} pada {side.moonPada}
      </p>
    </div>
  );
}
