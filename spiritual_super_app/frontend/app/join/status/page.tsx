'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';

import type { JoinRequestStatus } from '@/lib/admin-types';
import { ApiError, api, session } from '@/lib/api';
import { DOCUMENT_LABELS, MAX_DOCUMENTS, prepareDocument, type PreparedDocument } from '@/lib/join';

interface PublicStatus {
  applicationNo: string;
  firstName: string;
  categoryLabel: string;
  status: JoinRequestStatus;
  statusLabel: string;
  note: string | null;
  canRespond: boolean;
  submittedAt: string;
  updatedAt: string;
}

const STEPS: { status: JoinRequestStatus; label: string }[] = [
  { status: 'PENDING', label: 'Submitted' },
  { status: 'UNDER_REVIEW', label: 'Under review' },
  { status: 'APPROVED', label: 'Decision' },
];

const TONE: Record<JoinRequestStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-800 ring-amber-200',
  UNDER_REVIEW: 'bg-sky-50 text-sky-800 ring-sky-200',
  MORE_INFO_REQUESTED: 'bg-violet-50 text-violet-800 ring-violet-200',
  APPROVED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-800 ring-rose-200',
};

function stepIndex(status: JoinRequestStatus): number {
  if (status === 'PENDING') return 0;
  if (status === 'UNDER_REVIEW' || status === 'MORE_INFO_REQUESTED') return 1;
  return 2;
}

function message(caught: unknown): string {
  if (caught instanceof ApiError) {
    const body = caught.body as { issues?: { message: string }[] } | undefined;
    return body?.issues?.map((issue) => issue.message).join(' · ') || caught.message;
  }
  return caught instanceof Error ? caught.message : 'Something went wrong';
}

function StatusLookup() {
  const params = useSearchParams();
  const [applicationNo, setApplicationNo] = useState(params?.get('application') ?? '');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [documents, setDocuments] = useState<PreparedDocument[]>([]);
  const [docLabel, setDocLabel] = useState<string>(DOCUMENT_LABELS[0]);
  const [sent, setSent] = useState(false);

  const lookup = useCallback(async (id: string, mobile: string) => {
    setLoading(true);
    setError(null);
    try {
      setStatus(
        await api.get<PublicStatus>(
          `join-requests/status?applicationNo=${encodeURIComponent(id.trim())}&phone=${encodeURIComponent(mobile.trim())}`,
        ),
      );
    } catch (caught) {
      setStatus(null);
      setError(message(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const profilePhone = session.profile?.phone;
    if (profilePhone) setPhone(profilePhone);
    const initial = params?.get('application');
    if (initial && profilePhone) void lookup(initial, profilePhone);
  }, [lookup, params]);

  function onLookup(event: FormEvent) {
    event.preventDefault();
    setSent(false);
    void lookup(applicationNo, phone);
  }

  async function onDocuments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, MAX_DOCUMENTS - documents.length);
    event.target.value = '';
    try {
      const prepared = await Promise.all(files.map((file) => prepareDocument(file, docLabel)));
      setDocuments((current) => [...current, ...prepared]);
    } catch (caught) {
      setError(message(caught));
    }
  }

  async function onReply(event: FormEvent) {
    event.preventDefault();
    if (!status) return;
    setLoading(true);
    setError(null);
    try {
      await api.post('join-requests/respond', {
        applicationNo: status.applicationNo,
        phone,
        message: reply,
        documents: documents.map(({ name, label, dataUrl }) => ({ name, label, dataUrl })),
      });
      setReply('');
      setDocuments([]);
      setSent(true);
      await lookup(status.applicationNo, phone);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-ved-gold-600">Join as an Expert</p>
        <h1 className="mt-1 font-display text-4xl font-semibold text-ved-green-900">Application status</h1>
        <p className="mt-2 text-sm text-ved-green-800/70">Enter your application ID and the mobile number you applied with.</p>
      </div>

      <form onSubmit={onLookup} className="card grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="status-id">
            Application ID
          </label>
          <input
            id="status-id"
            className="input font-mono uppercase"
            required
            placeholder="VSJ-261003-7KQ2M"
            value={applicationNo}
            onChange={(e) => setApplicationNo(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="status-phone">
            Mobile number
          </label>
          <input id="status-phone" className="input" required inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary py-3" disabled={loading}>
          {loading ? 'Checking…' : 'Check status'}
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">
          {error}
        </p>
      )}

      {status && (
        <section className="card space-y-5 sm:p-7" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-sm text-ved-green-800/70">{status.applicationNo}</p>
              <h2 className="font-display text-2xl font-semibold text-ved-green-900">
                Namaste {status.firstName} · {status.categoryLabel}
              </h2>
            </div>
            <span className={`pill ring-1 ${TONE[status.status]}`}>{status.statusLabel}</span>
          </div>

          <ol className="grid grid-cols-3 gap-2">
            {STEPS.map((step, index) => {
              const reached = index <= stepIndex(status.status);
              const label = index === 2 && (status.status === 'APPROVED' || status.status === 'REJECTED') ? status.statusLabel : step.label;
              return (
                <li key={step.status} className="text-center">
                  <span
                    className={`mx-auto block h-1.5 rounded-full ${
                      reached ? (status.status === 'REJECTED' && index === 2 ? 'bg-rose-400' : 'bg-ved-green-600') : 'bg-ved-green-900/10'
                    }`}
                  />
                  <span className={`mt-2 block text-xs ${reached ? 'font-semibold text-ved-green-900' : 'text-ved-green-800/50'}`}>{label}</span>
                </li>
              );
            })}
          </ol>

          <p className="text-sm text-ved-green-800/70">
            Submitted {new Date(status.submittedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })} · last updated{' '}
            {new Date(status.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>

          {status.note && (
            <div className="rounded-xl bg-ved-cream-100 px-4 py-3 ring-1 ring-ved-gold-400/40">
              <p className="text-xs font-semibold uppercase tracking-wider text-ved-gold-700">Note from our team</p>
              <p className="mt-1 whitespace-pre-line text-sm text-ved-green-900">{status.note}</p>
            </div>
          )}

          {status.status === 'APPROVED' && (
            <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
              Welcome aboard! Sign in with your registered mobile number to open your{' '}
              <Link href="/astrologer" className="font-semibold underline">
                provider console
              </Link>
              .
            </div>
          )}

          {sent && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Thank you — your reply was sent to our team.</p>}

          {status.canRespond && (
            <form onSubmit={onReply} className="space-y-3 border-t border-ved-green-900/10 pt-5">
              <h3 className="font-semibold text-ved-green-900">Reply to our team</h3>
              <textarea
                className="input min-h-[110px]"
                required
                minLength={2}
                maxLength={1500}
                aria-label="Your reply"
                placeholder="Answer the team's questions here"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
              <div className="flex flex-wrap items-end gap-3">
                <select aria-label="Document type" className="input w-auto" value={docLabel} onChange={(e) => setDocLabel(e.target.value)}>
                  {DOCUMENT_LABELS.map((label) => (
                    <option key={label}>{label}</option>
                  ))}
                </select>
                <label className="btn-ghost cursor-pointer">
                  + Attach documents
                  <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void onDocuments(e)} />
                </label>
              </div>
              {documents.length > 0 && (
                <ul className="space-y-1 text-sm text-ved-green-800">
                  {documents.map((document, index) => (
                    <li key={`${document.name}-${index}`} className="flex justify-between gap-3">
                      <span className="truncate">
                        {document.label}: {document.name}
                      </span>
                      <button type="button" className="text-rose-600" onClick={() => setDocuments((c) => c.filter((_, i) => i !== index))}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="submit" className="btn-primary" disabled={loading}>
                Send reply
              </button>
            </form>
          )}
        </section>
      )}

      <p className="text-center text-sm text-ved-green-800/70">
        Haven&apos;t applied yet?{' '}
        <Link href="/join" className="font-semibold text-ved-green-700 underline">
          Join as an Expert
        </Link>
      </p>
    </div>
  );
}

export default function JoinStatusPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-ved-green-800/60">Loading…</p>}>
      <StatusLookup />
    </Suspense>
  );
}
