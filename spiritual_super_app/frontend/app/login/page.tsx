'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api, session, type OtpRequestResult, type VerifyResult } from '@/lib/api';

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
      router.replace('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not verify the code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-saffron-500 text-2xl text-night-950">
          ॥
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Jyotish Consultations</h1>
        <p className="mt-1 text-sm text-slate-400">
          Talk to a Vedic astrologer, billed by the minute.
        </p>
      </div>

      <div className="card space-y-4">
        {step === 'phone' ? (
          <>
            <div>
              <label className="label" htmlFor="phone">
                Mobile number
              </label>
              <input
                id="phone"
                className="input"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+919876543210"
                value={phone}
                onChange={(event) => setPhone(event.target.value.replace(/[^\d+]/g, ''))}
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Include the country code. We send a one-time code by SMS.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="name">
                Your name <span className="normal-case text-slate-500">(optional)</span>
              </label>
              <input
                id="name"
                className="input"
                autoComplete="name"
                placeholder="Asha"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <button
              type="button"
              className="btn-primary w-full"
              disabled={busy || phone.replace(/\D/g, '').length < 10}
              onClick={() => void requestCode()}
            >
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </>
        ) : (
          <>
            <div>
              <label className="label" htmlFor="code">
                Enter the code sent to {phone}
              </label>
              <input
                id="code"
                className="input text-center text-2xl tracking-[0.5em] tabular"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="······"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
            </div>

            {challenge?.debugCode && (
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Staging: your code is <strong className="tabular">{challenge.debugCode}</strong>
              </p>
            )}

            <button
              type="button"
              className="btn-primary w-full"
              disabled={busy || code.length < 4}
              onClick={() => void verify()}
            >
              {busy ? 'Verifying…' : 'Verify and continue'}
            </button>

            <div className="flex items-center justify-between text-xs text-slate-400">
              <button type="button" className="hover:text-slate-100" onClick={() => setStep('phone')}>
                ← Change number
              </button>
              <button
                type="button"
                className="hover:text-slate-100 disabled:opacity-50"
                disabled={cooldown > 0 || busy}
                onClick={() => void requestCode()}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
          </>
        )}

        {error && (
          <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>
        )}
      </div>
    </div>
  );
}
