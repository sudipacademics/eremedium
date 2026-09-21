'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { api, session, type UserProfileDetails } from '@/lib/api';

export default function ProfilePage() {
  const [data, setData] = useState<UserProfileDetails | null>(null);
  const [name, setName] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [gotra, setGotra] = useState('');
  const [dobLocal, setDobLocal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api
      .get<UserProfileDetails>('auth/profile')
      .then((profile) => {
        setData(profile);
        setName(profile.name ?? '');
        setBirthPlace(profile.birthPlace ?? '');
        setGotra(profile.gotra ?? '');
        setDobLocal(profile.dob ? profile.dob.slice(0, 10) : '');
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load profile'),
      );
  }, []);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const dob =
        dobLocal.trim().length > 0 ? new Date(`${dobLocal}T00:00:00.000Z`).toISOString() : null;
      const updated = await api.patch<UserProfileDetails>('auth/profile', {
        name: name.trim(),
        birthPlace: birthPlace.trim() || null,
        gotra: gotra.trim() || null,
        dob,
      });
      setData(updated);
      session.updateProfile({ name: updated.name });
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) {
    return <p className="text-sm text-ved-green-800/60">Loading profile…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider text-ved-gold-600">Account</p>
        <h1 className="font-display text-3xl font-semibold text-ved-green-800">Your profile</h1>
        <p className="mt-1 text-sm text-ved-green-800/65">
          Phone is your login. Update name and birth details used across kundali and sankalp.
        </p>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      {saved && <p className="text-sm text-ved-green-600">Saved.</p>}

      {data && (
        <form onSubmit={(e) => void onSave(e)} className="card max-w-xl space-y-4">
          <div>
            <label className="label">Phone</label>
            <input className="input bg-ved-cream-100" value={data.phone} readOnly />
          </div>
          <div>
            <label className="label" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
            />
          </div>
          <div>
            <label className="label" htmlFor="dob">
              Date of birth
            </label>
            <input
              id="dob"
              type="date"
              className="input"
              value={dobLocal}
              onChange={(e) => setDobLocal(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="place">
              Birth place
            </label>
            <input
              id="place"
              className="input"
              value={birthPlace}
              onChange={(e) => setBirthPlace(e.target.value)}
              placeholder="City, region"
            />
          </div>
          <div>
            <label className="label" htmlFor="gotra">
              Gotra
            </label>
            <input
              id="gotra"
              className="input"
              value={gotra}
              onChange={(e) => setGotra(e.target.value)}
            />
          </div>
          <p className="text-xs text-ved-green-800/50">
            Role: {data.role}
            {data.astrologerId ? ' · Astrologer console available' : ''}
          </p>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/wallet" className="card hover:border-ved-green-500/30">
          <p className="font-semibold text-ved-green-800">Wallet</p>
          <p className="mt-1 text-sm text-ved-green-800/60">Balance and top-ups</p>
        </Link>
        <Link href="/pujas" className="card hover:border-ved-green-500/30">
          <p className="font-semibold text-ved-green-800">E-Puja</p>
          <p className="mt-1 text-sm text-ved-green-800/60">Bookings and status</p>
        </Link>
        <Link href="/ayurveda" className="card hover:border-ved-green-500/30">
          <p className="font-semibold text-ved-green-800">Ayurveda shop</p>
          <p className="mt-1 text-sm text-ved-green-800/60">Orders and kits</p>
        </Link>
      </div>
    </div>
  );
}
