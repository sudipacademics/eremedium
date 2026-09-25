'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api, safeNextPath, session, type OtpRequestResult, type VerifyResult } from '@/lib/api';
import { isProtectedPath } from '@/lib/auth-gate';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('+91');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<OtpRequestResult | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState('/');

  useEffect(() => {
    const target = safeNextPath(new URLSearchParams(window.location.search).get('next'));
    setNext(target);
    if (session.token && session.profile) router.replace(target);
  }, [router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<OtpRequestResult>('auth/otp/request', { phone });
      setChallenge(result);
      setCooldown(result.resendAfterSeconds);
      setStep('code');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<VerifyResult>('auth/otp/verify', {
        phone,
        code,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      session.save(result.accessToken, {
        userId: result.user.id,
        role: result.user.role,
        astrologerId: result.user.astrologerId,
        name: result.user.name,
        phone: result.user.phone,
      });
      router.replace(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not verify the code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <Image
          src="/brand/vedsutra-logo.png"
          alt="Vedsutra"
          width={979}
          height={206}
          className="mx-auto h-9 w-auto"
          priority
        />
        <h1 className="mt-4 font-display text-3xl font-semibold text-ved-green-800">
          {next === '/' ? 'Welcome back' : 'Sign in to continue'}
        </h1>
        <p className="mt-1 text-sm text-ved-green-800/65">
          {next === '/'
            ? 'Sign in with your phone to consult, book pujas, and shop Ayurveda.'
            : 'Log in or sign up with your phone — we’ll take you right back to where you left off.'}
        </p>
      </div>

      <div className="card space-y-4">
        {step === 'phone' ? (
          <>
            <div>
              <label className="label" htmlFor="phone">
                Phone (E.164)
              </label>
              <input
                id="phone"
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </div>
            <div>
              <label className="label" htmlFor="name">
                Name (first login)
              </label>
              <input
                id="name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void requestCode()}>
              {busy ? 'Sending…' : 'Send OTP'}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-ved-green-800/70">
              Code sent to <strong>{phone}</strong>
              {challenge?.debugCode ? (
                <span className="mt-1 block text-xs text-ved-gold-700">Debug code: {challenge.debugCode}</span>
              ) : null}
            </p>
            <div>
              <label className="label" htmlFor="code">
                OTP
              </label>
              <input
                id="code"
                className="input tracking-[0.3em]"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
              />
            </div>
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void verify()}>
              {busy ? 'Verifying…' : 'Verify & continue'}
            </button>
            <button
              type="button"
              className="btn-ghost w-full"
              disabled={busy || cooldown > 0}
              onClick={() => void requestCode()}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
            <button type="button" className="text-xs text-ved-green-800/50" onClick={() => setStep('phone')}>
              Change phone
            </button>
          </>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
      <p className="text-center text-sm">
        <Link href={isProtectedPath(next.split('?')[0]!) ? '/' : next} className="text-ved-green-700 underline-offset-2 hover:underline">
          ← Continue browsing without signing in
        </Link>
      </p>
    </div>
  );
}
