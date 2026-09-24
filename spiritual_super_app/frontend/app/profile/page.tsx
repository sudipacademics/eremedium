'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import {
  ApiError,
  api,
  session,
  type Invoice,
  type OtpRequestResult,
  type UserProfileDetails,
} from '@/lib/api';
import { resizeSquarePhoto } from '@/lib/photo';

const PHOTO_SIZE = 256;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ProfilePage() {
  const [data, setData] = useState<UserProfileDetails | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [address, setAddress] = useState('');
  const [gotra, setGotra] = useState('');
  const [dobLocal, setDobLocal] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api
      .get<UserProfileDetails>('auth/profile')
      .then((profile) => {
        setData(profile);
        setName(profile.name ?? '');
        setEmail(profile.email ?? '');
        setBirthPlace(profile.birthPlace ?? '');
        setAddress(profile.address ?? '');
        setGotra(profile.gotra ?? '');
        setDobLocal(profile.dob ? profile.dob.slice(0, 10) : '');
        setPhoto(profile.photoDataUrl);
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load profile'),
      );
  }, []);

  async function onPhotoPicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file');
      return;
    }
    try {
      setPhoto(await resizeSquarePhoto(file, PHOTO_SIZE));
      setSaved(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not use that image');
    }
  }

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
        email: email.trim() || null,
        birthPlace: birthPlace.trim() || null,
        address: address.trim() || null,
        gotra: gotra.trim() || null,
        dob,
        photoDataUrl: photo,
      });
      setData(updated);
      setPhoto(updated.photoDataUrl);
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

  const initials = (name.trim()[0] ?? data?.phone.slice(-2) ?? 'U').toUpperCase();
  const photoChanged = data !== null && photo !== data.photoDataUrl;

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
          <h2 className="font-display text-xl font-semibold text-ved-green-800">User details</h2>

          <div className="flex items-center gap-4">
            {photo ? (
              <img
                src={photo}
                alt="Profile photo"
                className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-ved-gold-400/40"
              />
            ) : (
              <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-ved-green-600 text-2xl font-semibold text-white ring-2 ring-ved-gold-400/40">
                {initials}
              </span>
            )}
            <div className="space-y-2">
              <p className="label mb-0">Profile photo</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-xs"
                  onClick={() => fileInput.current?.click()}
                >
                  {photo ? 'Change photo' : 'Upload photo'}
                </button>
                {photo && (
                  <button
                    type="button"
                    className="btn-ghost px-3 py-1.5 text-xs text-rose-600"
                    onClick={() => {
                      setPhoto(null);
                      setSaved(false);
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
              {photoChanged && (
                <p className="text-xs text-ved-gold-600">Save profile to keep this change.</p>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => void onPhotoPicked(e)}
              />
            </div>
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
            <label className="label" htmlFor="email">
              Email ID
            </label>
            <input
              id="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              maxLength={254}
            />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input bg-ved-cream-100" value={data.phone} readOnly />
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
            <label className="label" htmlFor="address">
              Address
            </label>
            <textarea
              id="address"
              className="input min-h-[5.5rem] resize-y"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="House / street, city, state, PIN code"
              autoComplete="street-address"
              minLength={5}
              maxLength={500}
              rows={3}
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

      {data && <InvoicesCard />}
      {data && <LoginSecurityCard phone={data.phone} />}
    </div>
  );
}

function InvoicesCard() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<{ invoices: Invoice[] }>('billing/invoices')
      .then((res) => setInvoices(res.invoices))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load invoices'),
      );
  }, []);

  async function onDownload(invoice: Invoice) {
    setDownloading(invoice.id);
    setError(null);
    try {
      const { blob, filename } = await api.download(
        `billing/invoices/${encodeURIComponent(invoice.id)}/pdf`,
        `${invoice.number}.pdf`,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold text-ved-green-800">Download invoices</h2>
        <p className="mt-1 text-sm text-ved-green-800/60">
          Wallet top-ups, E-Puja bookings, Ayurveda orders and consultations.
        </p>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {invoices === null && !error && (
        <p className="text-sm text-ved-green-800/60">Loading invoices…</p>
      )}

      {invoices !== null && invoices.length === 0 && (
        <p className="rounded-xl bg-ved-cream-100 px-4 py-3 text-sm text-ved-green-800/65">
          No invoices yet. They appear here after your first payment or booking.
        </p>
      )}

      {invoices !== null && invoices.length > 0 && (
        <ul className="divide-y divide-ved-green-900/10">
          {invoices.map((invoice) => (
            <li
              key={invoice.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-ved-green-800">{invoice.title}</p>
                <p className="text-xs text-ved-green-800/55">
                  {invoice.number} · {formatDate(invoice.issuedAt)} · {invoice.paymentMethod}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="tabular text-sm font-semibold text-ved-green-800">₹{invoice.amount}</span>
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-xs"
                  disabled={downloading !== null}
                  onClick={() => void onDownload(invoice)}
                >
                  {downloading === invoice.id ? 'Preparing…' : 'Download PDF'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type SecurityStep = 'idle' | 'code' | 'done';

function LoginSecurityCard({ phone }: { phone: string }) {
  const [step, setStep] = useState<SecurityStep>('idle');
  const [code, setCode] = useState('');
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const challenge = await api.post<OtpRequestResult>('auth/otp/request', { phone });
      setDebugCode(challenge.debugCode ?? null);
      setCode('');
      setStep('code');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send a code');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ accessToken: string }>('auth/sessions/revoke-others', {
        code: code.trim(),
      });
      const profile = session.profile;
      if (profile) session.save(result.accessToken, profile);
      setStep('done');
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 401
          ? 'That code is incorrect or has expired.'
          : caught instanceof Error
            ? caught.message
            : 'Could not sign out other devices',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold text-ved-green-800">Login &amp; security</h2>
        <p className="mt-1 text-sm text-ved-green-800/60">
          You sign in with your phone number and a one-time SMS code, so there is no password to
          reset. If you think someone else has access to your account, sign out every other device.
        </p>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {step === 'idle' && (
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void sendCode()}>
          {busy ? 'Sending code…' : 'Sign out of all other devices'}
        </button>
      )}

      {step === 'code' && (
        <form onSubmit={(e) => void confirm(e)} className="max-w-sm space-y-3">
          <div>
            <label className="label" htmlFor="security-code">
              Code sent to {phone}
            </label>
            <input
              id="security-code"
              className="input tracking-[0.3em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{4,8}"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
            />
            {debugCode && (
              <p className="mt-1 text-xs text-ved-green-800/50">Staging code: {debugCode}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary" disabled={busy || code.length < 4}>
              {busy ? 'Signing out…' : 'Confirm'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => {
                setStep('idle');
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {step === 'done' && (
        <p className="rounded-xl bg-ved-green-50 px-4 py-3 text-sm text-ved-green-700">
          All other devices have been signed out. You are still signed in here.
        </p>
      )}
    </section>
  );
}
