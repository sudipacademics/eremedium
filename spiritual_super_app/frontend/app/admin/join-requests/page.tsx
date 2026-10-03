'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import {
  JOIN_STATUSES,
  PROVIDER_CATEGORIES,
  STATUS_TONE,
  formatDateTime,
  saveBlob,
  toQuery,
  type JoinRequestList,
  type JoinRequestStatus,
  type ProviderCategory,
} from '@/lib/admin-types';
import { api } from '@/lib/api';

interface Filters {
  q: string;
  status: JoinRequestStatus | '';
  category: ProviderCategory | '';
  location: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { q: '', status: '', category: '', location: '', from: '', to: '' };

function JoinRequests() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<JoinRequestList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<JoinRequestList>(`admin/join-requests${toQuery({ ...filters, page, pageSize: 20 })}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load applications');
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

  function setStatus(status: JoinRequestStatus | '') {
    const next = { ...draft, status };
    setDraft(next);
    setFilters(next);
    setPage(1);
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const { blob, filename } = await api.download(`admin/join-requests/export.csv${toQuery({ ...filters })}`, 'join-requests.csv');
      saveBlob(blob, filename);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const totalAll = data ? Object.values(data.counts).reduce((sum, count) => sum + count, 0) : 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">
        Applications from the public <strong className="text-slate-200">Join as an Expert</strong> form. Open one to review details and
        documents, change its status, and create the provider account on approval.
      </p>

      <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-2">
        {[{ value: '' as const, label: 'All', count: totalAll }, ...JOIN_STATUSES.map((s) => ({ ...s, count: data?.counts[s.value] ?? 0 }))].map(
          (tab) => (
            <button
              key={tab.value || 'all'}
              type="button"
              role="tab"
              aria-selected={filters.status === tab.value}
              onClick={() => setStatus(tab.value)}
              className={`rounded-full px-3.5 py-1.5 text-sm transition ${
                filters.status === tab.value
                  ? 'bg-ved-gold-400 font-semibold text-ved-green-950'
                  : 'bg-white/5 text-slate-300 ring-1 ring-white/10 hover:bg-white/10'
              }`}
            >
              {tab.label} <span className="tabular opacity-70">{tab.count}</span>
            </button>
          ),
        )}
      </div>

      <form onSubmit={apply} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <label className="label" htmlFor="jr-q">
            Search
          </label>
          <input
            id="jr-q"
            className="input"
            placeholder="Name, mobile, email or application ID"
            value={draft.q}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="jr-category">
            Category
          </label>
          <select
            id="jr-category"
            className="input"
            value={draft.category}
            onChange={(event) => setDraft({ ...draft, category: event.target.value as ProviderCategory | '' })}
          >
            <option value="">All categories</option>
            {PROVIDER_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="jr-location">
            Location
          </label>
          <input
            id="jr-location"
            className="input"
            placeholder="City or state"
            value={draft.location}
            onChange={(event) => setDraft({ ...draft, location: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="jr-from">
            From
          </label>
          <input id="jr-from" type="date" className="input" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="jr-to">
            To
          </label>
          <input id="jr-to" type="date" className="input" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-6">
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
          <button type="button" className="btn-ghost ml-auto" onClick={() => void exportCsv()} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </form>

      {error && <p className="text-sm text-rose-300">{error}</p>}

      {data && data.items.length === 0 && <p className="card text-sm text-slate-400">No applications match these filters.</p>}

      {data && data.items.length > 0 && (
        <>
          <div className="card hidden overflow-x-auto p-0 md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Applicant</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Experience</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.items.map((row) => (
                  <tr key={row.id} className="hover:bg-white/5">
                    <td className="px-4 py-3">
                      <Link href={`/admin/join-requests/${row.id}`} className="font-medium text-white hover:text-ved-gold-200">
                        {row.name}
                      </Link>
                      <p className="text-xs text-slate-400">
                        {row.applicationNo} · {row.phone}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{row.categoryLabel}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {row.city}, {row.state}
                    </td>
                    <td className="px-4 py-3 text-slate-300 tabular">{row.experienceYears} yrs</td>
                    <td className="px-4 py-3 text-slate-400">{formatDateTime(row.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`pill ${STATUS_TONE[row.status]}`}>{row.statusLabel}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {data.items.map((row) => (
              <li key={row.id}>
                <Link href={`/admin/join-requests/${row.id}`} className="card block">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">{row.name}</p>
                      <p className="text-xs text-slate-400">{row.applicationNo}</p>
                    </div>
                    <span className={`pill ${STATUS_TONE[row.status]}`}>{row.statusLabel}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">
                    {row.categoryLabel} · {row.city}, {row.state} · {row.experienceYears} yrs
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{formatDateTime(row.createdAt)}</p>
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>
              {data.total} application{data.total === 1 ? '' : 's'} · page {data.page} of {pages}
            </span>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ← Previous
              </button>
              <button type="button" className="btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function JoinRequestsPage() {
  return (
    <AdminGate>
      <JoinRequests />
    </AdminGate>
  );
}
