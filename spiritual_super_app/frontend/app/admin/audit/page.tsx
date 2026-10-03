'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { formatDateTime, saveBlob, toQuery, type AuditList } from '@/lib/admin-types';
import { api } from '@/lib/api';

interface Filters {
  q: string;
  entityType: string;
  actor: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { q: '', entityType: '', actor: '', from: '', to: '' };

function Audit() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<AuditList>(`admin/audit${toQuery({ ...filters, page, pageSize: 50 })}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the audit log');
    }
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function apply(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setFilters(draft);
  }

  async function exportCsv() {
    try {
      const { blob, filename } = await api.download(`admin/audit/export.csv${toQuery({ ...filters })}`, 'audit-log.csv');
      saveBlob(blob, filename);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Export failed');
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">Every staff change — content edits, status decisions, staff and role changes — with who did it and when.</p>
      <form onSubmit={apply} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <label className="label" htmlFor="audit-q">
            Search
          </label>
          <input id="audit-q" className="input" placeholder="Summary, action or record ID" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="audit-type">
            Area
          </label>
          <select id="audit-type" className="input" value={draft.entityType} onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}>
            <option value="">All areas</option>
            {data?.entityTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="audit-actor">
            Staff mobile
          </label>
          <input id="audit-actor" className="input" value={draft.actor} onChange={(e) => setDraft({ ...draft, actor: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="audit-from">
              From
            </label>
            <input id="audit-from" type="date" className="input px-2" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="audit-to">
              To
            </label>
            <input id="audit-to" type="date" className="input px-2" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-5">
          <button type="submit" className="btn-gold">
            Apply filters
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setDraft(EMPTY);
              setFilters(EMPTY);
              setPage(1);
            }}
          >
            Reset
          </button>
          <button type="button" className="btn-ghost ml-auto" onClick={() => void exportCsv()}>
            Export CSV
          </button>
        </div>
      </form>

      {error && <p className="text-sm text-rose-300">{error}</p>}

      <section className="card p-0">
        {data && data.items.length === 0 && <p className="p-5 text-sm text-slate-400">No activity matches these filters.</p>}
        <ul className="divide-y divide-white/10">
          {data?.items.map((row) => (
            <li key={row.id} className="px-5 py-3">
              <button
                type="button"
                className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 text-left"
                aria-expanded={open === row.id}
                onClick={() => setOpen(open === row.id ? null : row.id)}
              >
                <span className="text-sm font-medium text-white">{row.summary}</span>
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-400 ring-1 ring-white/10">{row.entityType}</span>
                <span className="ml-auto text-xs text-slate-500">{formatDateTime(row.createdAt)}</span>
                <span className="w-full text-xs text-slate-400">
                  {row.actorPhone ?? 'system'}
                  {row.actorRole ? ` · ${row.actorRole}` : ''}
                </span>
              </button>
              {open === row.id && (
                <pre className="mt-2 overflow-x-auto rounded-xl bg-black/30 p-3 text-xs text-slate-300">
                  {JSON.stringify({ action: row.action, entityId: row.entityId, ip: row.ip, metadata: row.metadata }, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </section>

      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>
            {data.total} entries · page {data.page} of {pages}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Newer
            </button>
            <button type="button" className="btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Older →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AuditPage() {
  return (
    <AdminGate>
      <Audit />
    </AdminGate>
  );
}
