'use client';

import Image from 'next/image';
import { useEffect, useState, type FormEvent } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { api, youtubeThumbnailUrl, type NumerologyLead, type NumerologySettings } from '@/lib/api';

/** Best-effort id for the live preview; the server does the authoritative parsing. */
function previewId(url: string): string | null {
  const match = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/.exec(url) ?? /^([A-Za-z0-9_-]{11})$/.exec(url.trim());
  return match?.[1] ?? null;
}

function csvCell(value: string | number): string {
  const text = String(value);
  // A leading = + - @ would be run as a formula when the file is opened in a spreadsheet.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function downloadCsv(leads: readonly NumerologyLead[]) {
  const header = ['Created', 'Name', 'Email', 'Phone', 'Date of birth', 'Gender', 'Life path', 'Destiny', 'Soul urge', 'Personality', 'Birthday'];
  const rows = leads.map((l) => [l.createdAt, l.fullName, l.email, l.phone, l.birthDate, l.gender, l.lifePath, l.destiny, l.soulUrge, l.personality, l.birthday]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `numerology-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function AdminNumerologyPage() {
  const [videoUrl, setVideoUrl] = useState('');
  const [leads, setLeads] = useState<NumerologyLead[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadLeads() {
    const res = await api.get<{ leads: NumerologyLead[]; total: number }>('content/admin/numerology/leads?limit=500');
    setLeads(res.leads);
    setTotal(res.total);
  }

  useEffect(() => {
    void api
      .get<NumerologySettings>('content/admin/numerology/settings')
      .then((s) => setVideoUrl(s.videoUrl ?? ''))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load settings'));
    void loadLeads().catch((caught: unknown) =>
      setError(caught instanceof Error ? caught.message : 'Could not load leads'),
    );
  }, []);

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await action();
      setMessage(done);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  function saveVideo(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const saved = await api.put<NumerologySettings>('content/admin/numerology/settings', {
        videoUrl: videoUrl.trim() || null,
      });
      setVideoUrl(saved.videoUrl ?? '');
    }, videoUrl.trim() ? 'Video saved — it appears on /numerology within a minute.' : 'Video removed.');
  }

  function removeLead(lead: NumerologyLead) {
    if (!window.confirm(`Delete the lead for ${lead.fullName}? This cannot be undone.`)) return;
    void run(async () => {
      await api.del(`content/admin/numerology/leads/${lead.id}`);
      await loadLeads();
    }, 'Lead deleted.');
  }

  const preview = previewId(videoUrl);

  return (
    <AdminGate>
      <form onSubmit={saveVideo} className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Explainer video</h2>
          <p className="text-sm text-slate-400">
            Plays beside the calculator on /numerology. Paste any YouTube link; leave it empty to show the artwork only.
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="block flex-1">
            <span className="label">YouTube URL</span>
            <input
              className="input"
              placeholder="https://www.youtube.com/watch?v=…"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
            />
          </label>
          {preview && (
            <Image
              src={youtubeThumbnailUrl(preview)}
              alt="Video preview"
              width={160}
              height={90}
              unoptimized
              className="rounded-lg object-cover"
            />
          )}
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save video'}
        </button>
      </form>

      {error && <p className="text-sm text-rose-300">{error}</p>}
      {message && <p className="text-sm text-emerald-300">{message}</p>}

      <section className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Calculator leads</h2>
            <p className="text-sm text-slate-400">
              {leads === null ? 'Loading…' : `${total} total${total > leads.length ? ` · showing the latest ${leads.length}` : ''}`}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15 disabled:opacity-40"
            onClick={() => leads && downloadCsv(leads)}
            disabled={!leads || leads.length === 0}
          >
            Download CSV
          </button>
        </div>
        {leads && leads.length === 0 && <p className="text-sm text-slate-400">No one has used the calculator yet.</p>}
        {leads && leads.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Contact</th>
                  <th className="py-2 pr-3 font-medium">Born</th>
                  <th className="py-2 pr-3 font-medium" title="Life path · Destiny · Soul urge · Personality · Birthday">
                    Numbers
                  </th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td className="py-2 pr-3 text-slate-400">{new Date(lead.createdAt).toLocaleString('en-IN')}</td>
                    <td className="py-2 pr-3">
                      {lead.fullName}
                      <span className="block text-xs text-slate-400">{lead.gender.toLowerCase()}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <a href={`mailto:${lead.email}`} className="hover:underline">
                        {lead.email}
                      </a>
                      <a href={`tel:${lead.phone}`} className="block text-xs text-slate-400 hover:underline">
                        {lead.phone}
                      </a>
                    </td>
                    <td className="py-2 pr-3">{lead.birthDate}</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      LP {lead.lifePath} · D {lead.destiny} · SU {lead.soulUrge} · P {lead.personality} · B {lead.birthday}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        className="rounded-lg px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10"
                        onClick={() => removeLead(lead)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminGate>
  );
}
