'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { OtpInput } from '@/components/auth/OtpInput';
import { ApiError, api, safeNextPath, session, type OtpRequestResult, type VerifyResult } from '@/lib/api';
import { isProtectedPath } from '@/lib/auth-gate';

type Step = 'phone' | 'code' | 'name';

const INDIAN_MOBILE = /^[6-9]\d{9}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

const BENEFITS = [
  'Talk to verified astrologers by call or chat',
  'Free Kundali, horoscope and AI astrologers',
  'Book e-pujas and shop authentic Ayurveda',
];

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function maskPhone(phone: string): string {
  return phone.startsWith('+91') && phone.length === 13
    ? `+91 ${phone.slice(3, 5)}•••••${phone.slice(-3)}`
    : phone.replace(/\d(?=\d{3})/g, '•');
}

function waitMessage(seconds: number): string {
  return seconds >= 120 ? `about ${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`;
}

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [international, setInternational] = useState(false);
  const [mobile, setMobile] = useState('');
  const [intlPhone, setIntlPhone] = useState('+');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeLength, setCodeLength] = useState(6);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [expiresIn, setExpiresIn] = useState(0);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidCode, setInvalidCode] = useState(false);
  const [next, setNext] = useState('/');

  useEffect(() => {
    const target = safeNextPath(new URLSearchParams(window.location.search).get('next'));
    setNext(target);
    if (session.token && session.profile) router.replace(target);
  }, [router]);

  useEffect(() => {
    if (cooldown <= 0 && expiresIn <= 0) return;
    const timer = setTimeout(() => {
      setCooldown((value) => Math.max(0, value - 1));
      setExpiresIn((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [cooldown, expiresIn]);

  const candidate = international ? intlPhone.replace(/[\s-]/g, '') : `+91${mobile}`;
  const phoneValid = international ? E164.test(candidate) : INDIAN_MOBILE.test(mobile);

  function describe(caught: unknown, fallback: string): string {
    if (caught instanceof ApiError) {
      const retry = (caught.body as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (caught.status === 429 && typeof retry === 'number') {
        setCooldown(retry);
        return `${caught.message}. Please try again in ${waitMessage(retry)}.`;
      }
      if (caught.status === 400) return 'Please check the number and try again.';
      if ((caught.body as { error?: string } | undefined)?.error === 'GATEWAY_UNREACHABLE') {
        return `${fallback} — we could not reach the server. Please check your connection and try again.`;
      }
      return caught.message;
    }
    return `${fallback}. Please check your connection and try again.`;
  }

  async function requestCode(target: string) {
    setBusy(true);
    setError(null);
    setInvalidCode(false);
    try {
      const result = await api.post<OtpRequestResult>('auth/otp/request', { phone: target });
      setPhone(target);
      setCode('');
      setCodeLength(result.codeLength ?? 6);
      setDebugCode(result.debugCode ?? null);
      setCooldown(result.resendAfterSeconds);
      setExpiresIn(result.expiresInSeconds);
      setStep('code');
    } catch (caught) {
      setError(describe(caught, 'Could not send the code'));
    } finally {
      setBusy(false);
    }
  }

  async function verify(submitted: string) {
    if (busy || submitted.length !== codeLength) return;
    setBusy(true);
    setError(null);
    setInvalidCode(false);
    try {
      const result = await api.post<VerifyResult>('auth/otp/verify', { phone, code: submitted });
      session.save(result.accessToken, {
        userId: result.user.id,
        role: result.user.role,
        astrologerId: result.user.astrologerId,
        name: result.user.name,
        phone: result.user.phone,
      });
      if (result.isNewAccount || !result.user.name || result.user.name === 'Devotee') {
        setStep('name');
      } else {
        router.replace(next);
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setInvalidCode(true);
        setCode('');
        setError(
          /too many/i.test(caught.message)
            ? 'Too many incorrect attempts. Please request a new code.'
            : 'That code is incorrect or has expired. Please try again.',
        );
      } else {
        setError(describe(caught, 'Could not verify the code'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      router.replace(next);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch('auth/profile', { name: trimmed });
      session.updateProfile({ name: trimmed });
      router.replace(next);
    } catch (caught) {
      setError(describe(caught, 'Could not save your name'));
      setBusy(false);
    }
  }

  function onPhoneSubmit(event: FormEvent) {
    event.preventDefault();
    if (!phoneValid) {
      setError(international ? 'Enter the number with country code, e.g. +44 7700 900123.' : 'Enter a valid 10-digit mobile number.');
      return;
    }
    void requestCode(candidate);
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-ved-green-800 via-ved-green-700 to-ved-green-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Image
          src="/brand/vedsutra-hero-mandala.png"
          alt=""
          width={720}
          height={720}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-25"
          priority
        />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ved-green-950/90 via-ved-green-900/70 to-ved-green-900/40" />
        <Link href="/" aria-label="Vedsutra home" className="relative w-fit rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ved-gold-300">
          <Image src="/brand/vedsutra-logo.png" alt="Vedsutra" width={979} height={206} className="h-9 w-auto brightness-0 invert" />
        </Link>
        <div className="relative max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-ved-gold-300">Welcome to Vedsutra</p>
          <h2 className="mt-3 font-display text-4xl font-semibold leading-tight">Your life, guided by Vedic wisdom</h2>
          <ul className="mt-8 space-y-4">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-start gap-3 text-white/85">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ved-gold-400/20 text-sm text-ved-gold-300">
                  ✓
                </span>
                {benefit}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/55">Secure one-time-code login. No passwords to remember.</p>
      </aside>

      <main className="flex items-center justify-center bg-ved-cream-100 px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <Link
            href="/"
            aria-label="Vedsutra home"
            className="mx-auto mb-8 flex w-fit rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ved-gold-400 lg:hidden"
          >
            <Image src="/brand/vedsutra-logo.png" alt="Vedsutra" width={979} height={206} className="h-9 w-auto" priority />
          </Link>

          <div className="rounded-3xl border border-ved-green-900/10 bg-white p-6 shadow-sm sm:p-8">
            {step === 'phone' && (
              <form onSubmit={onPhoneSubmit} noValidate>
                <h1 className="font-display text-3xl font-semibold text-ved-green-900">
                  {next === '/' ? 'Login or sign up' : 'Sign in to continue'}
                </h1>
                <p className="mt-1 text-sm text-ved-green-800/65">
                  {next === '/'
                    ? 'We’ll text you a one-time code to verify your number.'
                    : 'We’ll text you a code and bring you right back to where you left off.'}
                </p>

                <label className="mt-6 block text-sm font-semibold text-ved-green-900" htmlFor="phone">
                  Mobile number
                </label>
                {international ? (
                  <input
                    id="phone"
                    className="input mt-1.5 h-12 text-base"
                    value={intlPhone}
                    onChange={(e) => setIntlPhone(e.target.value)}
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="+44 7700 900123"
                  />
                ) : (
                  <div className="mt-1.5 flex h-12 overflow-hidden rounded-xl border border-ved-green-900/15 bg-white shadow-sm focus-within:border-ved-gold-400 focus-within:ring-2 focus-within:ring-ved-gold-300/60">
                    <span className="flex items-center gap-1.5 border-r border-ved-green-900/10 bg-ved-cream-50 px-3 text-sm font-semibold text-ved-green-900">
                      <span aria-hidden>🇮🇳</span> +91
                    </span>
                    <input
                      id="phone"
                      className="min-w-0 flex-1 bg-transparent px-3 text-base tracking-wide text-ved-green-900 outline-none placeholder:text-ved-green-800/35"
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').replace(/^(?:91|0)(?=\d{10}$)/, '').slice(0, 10))}
                      autoComplete="tel-national"
                      inputMode="numeric"
                      placeholder="98765 43210"
                      aria-describedby="phone-help"
                    />
                  </div>
                )}
                <button
                  type="button"
                  id="phone-help"
                  className="mt-2 text-xs font-medium text-ved-green-700 underline-offset-2 hover:underline"
                  onClick={() => {
                    setInternational((value) => !value);
                    setError(null);
                  }}
                >
                  {international ? 'Use an Indian (+91) number' : 'Not in India? Use an international number'}
                </button>

                {error && (
                  <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </p>
                )}

                <button type="submit" className="btn-primary mt-6 h-12 w-full text-base" disabled={busy || cooldown > 0 || !phoneValid}>
                  {busy ? 'Sending code…' : cooldown > 0 ? `Try again in ${formatClock(cooldown)}` : 'Get OTP'}
                </button>
                <p className="mt-4 text-center text-xs leading-relaxed text-ved-green-800/55">
                  By continuing you agree to our{' '}
                  <Link href="/terms" className="underline underline-offset-2">
                    Terms
                  </Link>{' '}
                  and{' '}
                  <Link href="/privacy-policy" className="underline underline-offset-2">
                    Privacy Policy
                  </Link>
                  .
                </p>
              </form>
            )}

            {step === 'code' && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void verify(code);
                }}
              >
                <h1 className="font-display text-3xl font-semibold text-ved-green-900">Enter the code</h1>
                <p className="mt-1 text-sm text-ved-green-800/70">
                  Sent by SMS to <strong className="text-ved-green-900">{maskPhone(phone)}</strong>{' '}
                  <button
                    type="button"
                    className="font-semibold text-ved-green-700 underline-offset-2 hover:underline"
                    onClick={() => {
                      setStep('phone');
                      setError(null);
                      setInvalidCode(false);
                      setCooldown(0);
                    }}
                  >
                    Edit
                  </button>
                </p>
                {debugCode && <p className="mt-2 text-xs text-ved-gold-700">Staging code: {debugCode}</p>}

                <div className="mt-6">
                  <OtpInput
                    length={codeLength}
                    value={code}
                    onChange={(value) => {
                      setCode(value);
                      if (invalidCode) setInvalidCode(false);
                    }}
                    onComplete={(value) => void verify(value)}
                    disabled={busy}
                    invalid={invalidCode}
                  />
                </div>
                <p className="mt-2 text-xs text-ved-green-800/55" aria-live="polite">
                  {expiresIn > 0 ? `Code expires in ${formatClock(expiresIn)}` : 'This code has expired. Request a new one.'}
                </p>

                {error && (
                  <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </p>
                )}

                <button type="submit" className="btn-primary mt-6 h-12 w-full text-base" disabled={busy || code.length !== codeLength}>
                  {busy ? 'Verifying…' : 'Verify & continue'}
                </button>
                <p className="mt-4 text-center text-sm text-ved-green-800/70">
                  Didn&apos;t get it?{' '}
                  {cooldown > 0 ? (
                    <span className="text-ved-green-800/50">Resend in {formatClock(cooldown)}</span>
                  ) : (
                    <button
                      type="button"
                      className="font-semibold text-ved-green-700 underline-offset-2 hover:underline disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void requestCode(phone)}
                    >
                      Resend code
                    </button>
                  )}
                </p>
              </form>
            )}

            {step === 'name' && (
              <form onSubmit={saveName}>
                <h1 className="font-display text-3xl font-semibold text-ved-green-900">Welcome to Vedsutra 🙏</h1>
                <p className="mt-1 text-sm text-ved-green-800/65">What should our astrologers call you?</p>
                <label className="mt-6 block text-sm font-semibold text-ved-green-900" htmlFor="name">
                  Your name
                </label>
                <input
                  id="name"
                  className="input mt-1.5 h-12 text-base"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  maxLength={160}
                  placeholder="e.g. Priya Sharma"
                  autoFocus
                />
                {error && (
                  <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </p>
                )}
                <button type="submit" className="btn-primary mt-6 h-12 w-full text-base" disabled={busy}>
                  {busy ? 'Saving…' : 'Continue'}
                </button>
                <button
                  type="button"
                  className="mt-3 w-full text-sm text-ved-green-800/60 hover:text-ved-green-800"
                  onClick={() => router.replace(next)}
                >
                  Skip for now
                </button>
              </form>
            )}
          </div>

          {step !== 'name' && (
            <p className="mt-6 text-center text-sm">
              <Link
                href={isProtectedPath(next.split('?')[0]!) ? '/' : next}
                className="text-ved-green-700 underline-offset-2 hover:underline"
              >
                ← Continue browsing without signing in
              </Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
