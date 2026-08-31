'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { KundaliView } from '@/components/KundaliView';
import { ApiError, api, type BirthProfile, type Kundali, type PlaceMatch } from '@/lib/api';

export default function KundaliPage() {
  const [profile, setProfile] = useState<BirthProfile | null>(null);
  const [kundali, setKundali] = useState<Kundali | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const current = await api.get<BirthProfile>('vedic/birth-profile');
      setProfile(current);
      if (current.complete) {
        setKundali(await api.get<Kundali>('vedic/kundali?depth=2'));
      } else {
        setEditing(true);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your kundali');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-slate-400">Loading…</p>;
  }

  return (
    <div className="space-y-5">
      <div className="card bg-gradient-to-br from-saffron-500/15 to-transparent">
        <h1 className="text-xl font-semibold">Your kundali</h1>
        <p className="mt-1 text-sm text-slate-400">
          Cast from Swiss Ephemeris with Chitra Paksha (Lahiri) ayanamsha and true node positions —
          the same conventions your astrologer works with.
        </p>
      </div>

      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      {editing || !profile?.complete ? (
        <BirthDataForm
          profile={profile}
          onSaved={() => {
            setEditing(false);
            setLoading(true);
            void load();
          }}
          onCancel={profile?.complete ? () => setEditing(false) : undefined}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 text-sm">
            <p className="text-slate-400">
              {profile.placeLabel} · {profile.birthDate}
              {profile.birthTime ? ` at ${profile.birthTime}` : ' (time unknown)'}
            </p>
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-xs text-saffron-300 hover:bg-white/5"
              onClick={() => setEditing(true)}
            >
              Edit details
            </button>
          </div>

          {kundali && <KundaliView kundali={kundali} />}
        </>
      )}
    </div>
  );
}

function BirthDataForm({
  profile,
  onSaved,
  onCancel,
}: {
  profile: BirthProfile | null;
  onSaved: () => void;
  onCancel?: (() => void) | undefined;
}) {
  const [birthDate, setBirthDate] = useState(profile?.birthDate ?? '');
  const [birthTime, setBirthTime] = useState(profile?.birthTime ?? '');
  const [timeKnown, setTimeKnown] = useState(profile?.birthTimeKnown ?? true);
  const [query, setQuery] = useState(profile?.placeLabel ?? '');
  const [matches, setMatches] = useState<PlaceMatch[]>([]);
  const [chosen, setChosen] = useState<PlaceMatch | null>(
    profile?.complete && profile.latitude !== null && profile.longitude !== null
      ? {
          label: profile.placeLabel ?? '',
          name: profile.placeLabel ?? '',
          country: '',
          latitude: profile.latitude,
          longitude: profile.longitude,
          timezone: profile.timezone ?? 'Asia/Kolkata',
          population: 0,
        }
      : null,
  );
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchPlaces = (value: string) => {
    setQuery(value);
    setChosen(null);
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

  const save = async () => {
    if (!chosen) {
      setError('Choose your birthplace, or enter its coordinates.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.put('vedic/birth-profile', {
        birthDate,
        ...(timeKnown && birthTime ? { birthTime } : {}),
        timezone: chosen.timezone,
        latitude: chosen.latitude,
        longitude: chosen.longitude,
        placeLabel: chosen.label || query.trim(),
      });
      onSaved();
    } catch (caught) {
      // The gateway rejects impossible dates and wall-clock times that a zone skipped; its message
      // is more useful than anything this form could guess.
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'Could not save your birth details',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-semibold">Birth details</h2>
        <p className="mt-1 text-xs text-slate-400">
          Kept private. Your astrologer can see this only while you are in a consultation with them.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="birthDate">
          Date of birth
        </label>
        <input
          id="birthDate"
          type="date"
          className="input"
          value={birthDate}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(event) => setBirthDate(event.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="birthTime">
          Time of birth
        </label>
        <input
          id="birthTime"
          type="time"
          className="input"
          value={birthTime}
          disabled={!timeKnown}
          onChange={(event) => setBirthTime(event.target.value)}
        />
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={!timeKnown}
            onChange={(event) => setTimeKnown(!event.target.checked)}
          />
          I do not know my birth time
        </label>
        {!timeKnown && (
          <p className="mt-1 text-xs text-amber-200/80">
            Signs and nakshatras will still be correct, but the ascendant and houses cannot be
            calculated without a time.
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="place">
          Place of birth
        </label>
        <input
          id="place"
          className="input"
          value={query}
          onChange={(event) => searchPlaces(event.target.value)}
          placeholder="Varanasi"
          autoComplete="off"
        />

        {matches.length > 0 && !chosen && (
          <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-night-950">
            {matches.map((match) => (
              <li key={`${match.name}:${match.latitude}:${match.longitude}`}>
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-white/5"
                  onClick={() => {
                    setChosen(match);
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

        {/*
          The resolved coordinates are always visible, never hidden behind the place name. Four
          minutes of longitude is a degree of ascendant, and the gazetteer can return the wrong
          settlement of the same name; the user is the only one who can catch that.
        */}
        {chosen && (
          <p className="mt-1 text-xs text-slate-400">
            <span className="tabular">
              {chosen.latitude.toFixed(4)}°, {chosen.longitude.toFixed(4)}°
            </span>{' '}
            · {chosen.timezone}
          </p>
        )}

        <button
          type="button"
          className="mt-2 text-xs text-saffron-300 hover:underline"
          onClick={() => setManual((value) => !value)}
        >
          {manual ? 'Search by name instead' : 'My village is not listed — enter coordinates'}
        </button>
      </div>

      {manual && (
        <ManualCoordinates
          onResolved={(match) => {
            setChosen(match);
            setQuery(match.label);
          }}
        />
      )}

      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            className="btn flex-1 border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          className="btn-primary flex-1"
          onClick={() => void save()}
          disabled={busy || !birthDate || !chosen || (timeKnown && !birthTime)}
        >
          {busy ? 'Casting…' : 'Cast my kundali'}
        </button>
      </div>
    </div>
  );
}

/** Coordinate entry, for the many Indian villages the gazetteer does not list. */
function ManualCoordinates({ onResolved }: { onResolved: (match: PlaceMatch) => void }) {
  const [name, setName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError('Enter both coordinates as decimal degrees.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // Asked for rather than assumed: defaulting to Asia/Kolkata would silently misread the birth
      // time of anyone born elsewhere.
      const resolved = await api.get<{ timezone: string }>(
        `vedic/timezone?latitude=${lat}&longitude=${lng}`,
      );
      onResolved({
        label: name.trim() || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        name: name.trim(),
        country: '',
        latitude: lat,
        longitude: lng,
        timezone: resolved.timezone,
        population: 0,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not resolve a timezone there');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-white/10 p-3">
      <input
        className="input"
        placeholder="Place name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="flex gap-2">
        <input
          className="input tabular"
          inputMode="decimal"
          placeholder="Latitude 25.3176"
          value={latitude}
          onChange={(event) => setLatitude(event.target.value)}
        />
        <input
          className="input tabular"
          inputMode="decimal"
          placeholder="Longitude 83.0055"
          value={longitude}
          onChange={(event) => setLongitude(event.target.value)}
        />
      </div>
      {error && <p className="text-xs text-rose-200">{error}</p>}
      <button
        type="button"
        className="btn-ghost w-full py-1.5 text-xs"
        onClick={() => void apply()}
        disabled={busy}
      >
        {busy ? 'Resolving…' : 'Use these coordinates'}
      </button>
    </div>
  );
}
