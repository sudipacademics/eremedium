'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { api, session, type NumerologyGender, type NumerologyReading } from '@/lib/api';

const GENDERS: readonly { value: NumerologyGender; label: string; icon: ReactNode }[] = [
  {
    value: 'MALE',
    label: 'Male',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
        <circle cx="12" cy="7" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0z" />
      </svg>
    ),
  },
  {
    value: 'FEMALE',
    label: 'Female',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
        <circle cx="12" cy="7" r="4" />
        <path d="M12 12c-3 0-5 2-6 9h12c-1-7-3-9-6-9z" />
      </svg>
    ),
  },
  {
    value: 'OTHER',
    label: 'Other',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4a8 8 0 0 1 0 16" fill="currentColor" />
      </svg>
    ),
  },
];

function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

const FIELD =
  'mt-1.5 w-full rounded-lg border border-ved-green-900/12 bg-[#FBF9F5] px-3.5 py-2.5 text-sm text-ved-green-900 outline-none transition placeholder:text-ved-green-900/35 focus:border-ved-green-500/50 focus:bg-white focus:ring-2 focus:ring-ved-green-500/15';

export function NumerologyCalculator({ onResult }: { onResult: (reading: NumerologyReading) => void }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<NumerologyGender>('MALE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const profile = session.profile;
    if (!profile) return;
    if (profile.name) setFullName((current) => current || profile.name || '');
    if (profile.phone) setPhone((current) => current || profile.phone || '');
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const reading = await api.post<NumerologyReading>('content/numerology/report', {
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        birthDate,
        gender,
      });
      onResult(reading);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not calculate your report');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      id="calculator"
      onSubmit={onSubmit}
      className="scroll-mt-24 rounded-2xl border border-ved-green-900/8 bg-white p-5 shadow-[0_12px_40px_rgba(11,79,69,0.08)] sm:p-7"
      aria-labelledby="calculator-title"
    >
      <h2 id="calculator-title" className="font-display text-2xl font-semibold text-ved-green-800">
        Free Numerology Calculator
      </h2>
      <p className="mt-1 text-sm text-ved-green-800/60">
        Enter your details to get your personalized numerology report
      </p>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="text-xs font-semibold text-ved-green-900">
            Full Name <span className="text-rose-500">*</span>
          </span>
          <input
            name="fullName"
            className={FIELD}
            placeholder="Enter your full name"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            minLength={2}
            maxLength={120}
            required
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ved-green-900">
            Email Address <span className="text-rose-500">*</span>
          </span>
          <input
            name="email"
            type="email"
            className={FIELD}
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            required
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ved-green-900">
            Phone Number <span className="text-rose-500">*</span>
          </span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            className={FIELD}
            placeholder="9876543210"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            pattern="\+?[0-9\s\-]{10,20}"
            title="At least 10 digits"
            required
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ved-green-900">
            Date of Birth <span className="text-rose-500">*</span>
          </span>
          <input
            name="birthDate"
            type="date"
            className={FIELD}
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            min="1900-01-01"
            max={todayIso()}
            required
          />
        </label>
        <fieldset>
          <legend className="text-xs font-semibold text-ved-green-900">Gender</legend>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {GENDERS.map((option) => {
              const selected = gender === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setGender(option.value)}
                  className={`inline-flex items-center justify-center gap-2 rounded-lg border px-2 py-2.5 text-sm font-medium transition ${
                    selected
                      ? 'border-ved-green-800 bg-ved-green-800 text-white'
                      : 'border-ved-green-900/12 bg-white text-ved-green-800/75 hover:border-ved-green-500/40'
                  }`}
                >
                  {option.icon}
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 w-full rounded-lg bg-ved-green-800 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-ved-green-700 disabled:opacity-60"
      >
        {busy ? 'Calculating…' : 'Calculate My Numerology Report'}
      </button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ved-green-800/55">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
          <path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z" />
        </svg>
        Your information is safe with us
      </p>
    </form>
  );
}
