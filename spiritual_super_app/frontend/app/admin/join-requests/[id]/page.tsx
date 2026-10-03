'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import {
  JOIN_STATUSES,
  STATUS_TONE,
  formatBytes,
  formatDateTime,
  saveBlob,
  type JoinRequestDetail,
  type JoinRequestEvent,
  type JoinRequestFile,
  type JoinRequestStatus,
} from '@/lib/admin-types';
import { api } from '@/lib/api';

const STATUS_LABEL = Object.fromEntries(JOIN_STATUSES.map((s) => [s.value, s.label])) as Record<JoinRequestStatus, string>;

const EVENT_LABELS: Record<string, string> = {
  SUBMITTED: 'Application submitted',
  STATUS_CHANGED: 'Status changed',
  APPLICANT_RESPONDED: 'Applicant replied',
  NOTE_ADDED: 'Internal note',
  PROVIDER_CREATED: 'Provider account created',
  PROVIDER_LINKED: 'Linked to existing provider',
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-100">{children}</dd>
    </div>
  );
}

function Chips({ values }: { values: string[] }) {
  if (values.length === 0) return <span className="text-slate-500">—</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span key={value} className="rounded-full bg-white/5 px-2.5 py-0.5 text-xs ring-1 ring-white/10">
          {value}
        </span>
      ))}
    </span>
  );
}

function eventTitle(event: JoinRequestEvent): string {
  if (event.action === 'STATUS_CHANGED' && event.fromStatus && event.toStatus) {
    return `${STATUS_LABEL[event.fromStatus]} → ${STATUS_LABEL[event.toStatus]}`;
  }
  return EVENT_LABELS[event.action] ?? event.action;
}

function Detail({ id }: { id: string }) {
  const [detail, setDetail] = useState<JoinRequestDetail | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nextStatus, setNextStatus] = useState<JoinRequestStatus | ''>('');
  const [note, setNote] = useState('');
  const [createAccount, setCreateAccount] = useState(true);
  const [internalNote, setInternalNote] = useState('');

  const load = useCallback(async () => {
    try {
      setDetail(await api.get<JoinRequestDetail>(`admin/join-requests/${id}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the application');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const photoId = detail?.files.find((file) => file.kind === 'PHOTO')?.id;
  useEffect(() => {
    if (!photoId) return;
    let url: string | null = null;
    api
      .download(`admin/join-requests/${id}/files/${photoId}`, 'photo')
      .then(({ blob }) => {
        url = URL.createObjectURL(blob);
        setPhotoUrl(url);
      })
      .catch(() => setPhotoUrl(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, photoId]);

  async function openFile(file: JoinRequestFile, download: boolean) {
    const target = download ? null : window.open('', '_blank');
    try {
      const { blob, filename } = await api.download(`admin/join-requests/${id}/files/${file.id}`, file.originalName);
      if (download || !target) {
        saveBlob(blob, filename);
      } else {
        target.location.href = URL.createObjectURL(blob);
      }
    } catch (caught) {
      target?.close();
      setError(caught instanceof Error ? caught.message : 'Could not open the file');
    }
  }

  async function changeStatus(event: FormEvent) {
    event.preventDefault();
    if (!nextStatus) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await api.patch<JoinRequestDetail>(`admin/join-requests/${id}/status`, {
        status: nextStatus,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(nextStatus === 'APPROVED' ? { createAccount } : {}),
      });
      setDetail(updated);
      setNextStatus('');
      setNote('');
      setMessage(
        nextStatus === 'APPROVED' && updated.providerAstrologerId
          ? 'Approved. The provider account was created and the applicant has been notified.'
          : `Status changed to ${updated.statusLabel}. The applicant has been notified.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change the status');
    } finally {
      setBusy(false);
    }
  }

  async function provision() {
    if (!window.confirm('Create the provider account for this applicant now?')) return;
    setBusy(true);
    setError(null);
    try {
      setDetail(await api.post<JoinRequestDetail>(`admin/join-requests/${id}/provision`));
      setMessage('Provider account created and the applicant notified.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the provider account');
    } finally {
      setBusy(false);
    }
  }

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (internalNote.trim().length < 2) return;
    setBusy(true);
    try {
      setDetail(await api.post<JoinRequestDetail>(`admin/join-requests/${id}/notes`, { note: internalNote.trim() }));
      setInternalNote('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the note');
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return error ? <p className="text-sm text-rose-300">{error}</p> : <p className="text-sm text-slate-400">Loading application…</p>;
  }

  const documents = detail.files.filter((file) => file.kind === 'DOCUMENT');

  return (
    <div className="space-y-5">
      <Link href="/admin/join-requests" className="text-sm text-ved-gold-300 hover:text-ved-gold-200">
        ← All join requests
      </Link>

      <section className="card flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white/5 ring-1 ring-ved-gold-400/30">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a private blob URL, not an optimisable asset
            <img src={photoUrl} alt={`${detail.name}'s profile photo`} className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full place-items-center font-display text-3xl text-ved-gold-300">{detail.name.charAt(0)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-2xl font-semibold text-white">{detail.name}</h2>
            <span className={`pill ${STATUS_TONE[detail.status]}`}>{detail.statusLabel}</span>
          </div>
          <p className="text-sm text-slate-300">
            {detail.categoryLabel}
            {detail.categoryOther ? ` (${detail.categoryOther})` : ''} · {detail.experienceYears} years experience
          </p>
          <p className="text-xs text-slate-500">
            {detail.applicationNo} · submitted {formatDateTime(detail.createdAt)}
            {detail.reviewedBy ? ` · last reviewed by ${detail.reviewedBy}` : ''}
          </p>
        </div>
      </section>

      {message && <p className="rounded-xl bg-emerald-400/10 px-4 py-2.5 text-sm text-emerald-200 ring-1 ring-emerald-300/20">{message}</p>}
      {error && <p className="rounded-xl bg-rose-400/10 px-4 py-2.5 text-sm text-rose-200 ring-1 ring-rose-300/20">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="card">
            <h3 className="font-semibold text-white">Applicant details</h3>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Mobile">
                <a href={`tel:${detail.phone}`} className="hover:text-ved-gold-200">
                  {detail.phone}
                </a>
              </Field>
              <Field label="Email">
                <a href={`mailto:${detail.email}`} className="break-all hover:text-ved-gold-200">
                  {detail.email}
                </a>
              </Field>
              <Field label="Date of birth">{detail.dateOfBirth}</Field>
              <Field label="Location">
                {detail.city}, {detail.state}
              </Field>
              <div className="sm:col-span-2">
                <Field label="Address">{detail.address}</Field>
              </div>
              <Field label="Languages">
                <Chips values={detail.languages} />
              </Field>
              <Field label="Expertise">
                <Chips values={detail.expertise} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Services offered">
                  <Chips values={detail.services} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Qualification / certification">{detail.qualification}</Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="About">
                  <span className="whitespace-pre-line">{detail.about}</span>
                </Field>
              </div>
            </dl>
          </section>

          <section className="card">
            <h3 className="font-semibold text-white">Documents</h3>
            {documents.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">No documents attached.</p>
            ) : (
              <ul className="mt-3 divide-y divide-white/10">
                {documents.map((file) => (
                  <li key={file.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span aria-hidden className="grid h-9 w-9 place-items-center rounded-lg bg-white/5 text-xs font-semibold text-ved-gold-300">
                      {file.mimeType === 'application/pdf' ? 'PDF' : 'IMG'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-white">{file.label || file.originalName}</p>
                      <p className="text-xs text-slate-500">
                        {file.originalName} · {formatBytes(file.sizeBytes)} · {formatDateTime(file.createdAt)}
                      </p>
                    </div>
                    <button type="button" className="btn-ghost px-3 py-1.5" onClick={() => void openFile(file, false)}>
                      View
                    </button>
                    <button type="button" className="btn-ghost px-3 py-1.5" onClick={() => void openFile(file, true)}>
                      Download
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <section className="card space-y-3">
            <h3 className="font-semibold text-white">Decision</h3>
            {detail.allowedStatuses.length === 0 ? (
              <p className="text-sm text-slate-400">This application is approved; that decision is final.</p>
            ) : (
              <form onSubmit={changeStatus} className="space-y-3">
                <div>
                  <label className="label" htmlFor="jr-status">
                    Move to
                  </label>
                  <select
                    id="jr-status"
                    className="input"
                    value={nextStatus}
                    onChange={(event) => setNextStatus(event.target.value as JoinRequestStatus | '')}
                  >
                    <option value="">Choose a status…</option>
                    {detail.allowedStatuses.map((status) => (
                      <option key={status} value={status}>
                        {status === 'MORE_INFO_REQUESTED' ? 'Request More Information' : STATUS_LABEL[status]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="jr-note">
                    {nextStatus === 'MORE_INFO_REQUESTED' ? 'What do you need? (sent to the applicant)' : 'Admin note (optional)'}
                  </label>
                  <textarea
                    id="jr-note"
                    className="input min-h-[90px]"
                    value={note}
                    maxLength={2000}
                    required={nextStatus === 'MORE_INFO_REQUESTED'}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  {(nextStatus === 'REJECTED' || nextStatus === 'MORE_INFO_REQUESTED') && (
                    <p className="mt-1 text-xs text-slate-500">The applicant sees this note on their status page and in the email.</p>
                  )}
                </div>
                {nextStatus === 'APPROVED' && (
                  <label className="flex items-start gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-ved-gold-400"
                      checked={createAccount}
                      onChange={(event) => setCreateAccount(event.target.checked)}
                    />
                    Create and activate the provider account now (starts offline at the default rate)
                  </label>
                )}
                <button type="submit" className="btn-gold w-full" disabled={!nextStatus || busy}>
                  {busy ? 'Saving…' : 'Update status & notify applicant'}
                </button>
              </form>
            )}
            {detail.status === 'APPROVED' && !detail.providerAstrologerId && (
              <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void provision()}>
                Create provider account
              </button>
            )}
            {detail.providerAstrologerId && (
              <p className="rounded-xl bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">
                Provider account active.{' '}
                <Link href="/admin/astrologers" className="underline">
                  Set rate &amp; profile in the roster
                </Link>
              </p>
            )}
            {detail.adminNote && (
              <p className="text-xs text-slate-400">
                Latest note to applicant: <span className="text-slate-200">{detail.adminNote}</span>
              </p>
            )}
          </section>

          <section className="card">
            <h3 className="font-semibold text-white">History</h3>
            <ol className="mt-3 space-y-3 border-l border-ved-gold-400/30 pl-4">
              {[...detail.events].reverse().map((event) => (
                <li key={event.id} className="relative">
                  <span aria-hidden className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-ved-gold-400" />
                  <p className="text-sm font-medium text-white">{eventTitle(event)}</p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(event.createdAt)} ·{' '}
                    {event.actorKind === 'APPLICANT' ? 'Applicant' : event.actorName ?? (event.actorKind === 'STAFF' ? 'Staff' : 'System')}
                  </p>
                  {event.note && <p className="mt-1 whitespace-pre-line text-sm text-slate-300">{event.note}</p>}
                </li>
              ))}
            </ol>
            <form onSubmit={addNote} className="mt-4 space-y-2">
              <label className="label" htmlFor="jr-internal">
                Add internal note
              </label>
              <textarea
                id="jr-internal"
                className="input min-h-[70px]"
                value={internalNote}
                maxLength={2000}
                onChange={(event) => setInternalNote(event.target.value)}
                placeholder="Visible to staff only"
              />
              <button type="submit" className="btn-ghost w-full" disabled={busy || internalNote.trim().length < 2}>
                Save note
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

function DetailRoute() {
  const params = useParams<{ id: string }>();
  return params?.id ? <Detail id={params.id} /> : null;
}

export default function JoinRequestDetailPage() {
  return (
    <AdminGate>
      <DetailRoute />
    </AdminGate>
  );
}
