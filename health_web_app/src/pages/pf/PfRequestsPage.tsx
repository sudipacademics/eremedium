import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { PF_REQUEST_FLOW, type PfMyRequests, type PfRequestStatus } from '../../types/phlebofirst';
import { PfOpenAppLink } from '../phlebofirst/app/PfOpenAppLink';
import { usePfPaths } from '../phlebofirst/app/pfPaths';
import { PfStatusChip } from './PfStatusChip';
import './pf.css';

const PAGE_SIZE = 20;
const TERMINAL_EXTRA: PfRequestStatus[] = ['Rejected', 'Cancelled', 'Expired'];
const ALL_STATUSES: PfRequestStatus[] = [...PF_REQUEST_FLOW, ...TERMINAL_EXTRA];

function money(n?: number | null) {
  return `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function when(raw?: string | null, withTime = true) {
  if (!raw) return '—';
  const d = new Date(String(raw).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString(
    'en-IN',
    withTime
      ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }
      : { day: '2-digit', month: 'short', year: 'numeric' },
  );
}

function windowLabel(start?: string | null, end?: string | null) {
  if (!start && !end) return 'Any time';
  if (start && end && start.slice(0, 10) === end.slice(0, 10)) {
    const t = new Date(end.replace(' ', 'T'));
    const endTime = Number.isNaN(t.getTime())
      ? end
      : t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${when(start)} – ${endTime}`;
  }
  return [when(start), when(end)].filter((s) => s !== '—').join(' – ');
}

function patientLine(age?: number | null, gender?: string | null) {
  return [age != null ? `${age} y` : '', gender || ''].filter(Boolean).join(' / ');
}

export function PfRequestsPage({ basePath }: { basePath: string }) {
  const navigate = useNavigate();
  const { inApp } = usePfPaths();
  const [filter, setFilter] = useState<string>('active');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PfMyRequests | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.pfMyRequests(filter, page, PAGE_SIZE);
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load requests');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function pickFilter(next: string) {
    setFilter(next);
    setPage(1);
  }

  function open(name: string) {
    navigate(`${basePath}/${encodeURIComponent(name)}`);
  }

  function onRowKey(e: KeyboardEvent<HTMLTableRowElement>, name: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open(name);
    }
  }

  const rows = data?.rows || [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const account = data?.account;
  const isStatusFilter = filter !== '' && filter !== 'active';

  return (
    <div className="pf-page">
      <div className="pf-head">
        <div>
          <h1 className="partners-page-title">PhleboFirst requests</h1>
          <p className="partners-page-lead">
            {account ? (
              <>
                <b>{account.display_name}</b> · {account.account_type}
                {account.default_lab_name ? ` · Lab: ${account.default_lab_name}` : ''}
              </>
            ) : (
              'Upload a prescription or TRF and we send a phlebotomist to collect the sample.'
            )}
          </p>
        </div>
        <div className="pf-head-actions">
          {!inApp ? (
            <PfOpenAppLink className="partners-btn partners-btn-outline" path="/app/requests" />
          ) : null}
          <Link className="partners-btn partners-btn-primary" to={`${basePath}/new`}>
            + New request
          </Link>
        </div>
      </div>

      <div className="pf-toolbar">
        <div className="pf-filters" role="tablist" aria-label="Request filter">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'active'}
            className={`pf-filter${filter === 'active' ? ' is-on' : ''}`}
            onClick={() => pickFilter('active')}
          >
            Active
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === ''}
            className={`pf-filter${filter === '' ? ' is-on' : ''}`}
            onClick={() => pickFilter('')}
          >
            All
          </button>
        </div>
        <select
          className={`pf-select${isStatusFilter ? ' is-on' : ''}`}
          value={isStatusFilter ? filter : ''}
          onChange={(e) => pickFilter(e.target.value || 'active')}
          aria-label="Filter by status"
        >
          <option value="">Any status…</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="button" className="partners-btn partners-btn-outline pf-btn-sm" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>

      {error ? <div className="pf-alert is-err">{error}</div> : null}

      {loading && !data ? <p className="pf-empty">Loading requests…</p> : null}

      {!loading && !error && rows.length === 0 ? (
        <div className="pf-empty-card">
          <h2>{filter === 'active' ? 'No active requests' : 'No requests found'}</h2>
          <p>Photograph the prescription or TRF, add the patient and pickup address — the lab quotes and a rider is assigned.</p>
          <Link className="partners-btn partners-btn-primary" to={`${basePath}/new`}>
            Create a request
          </Link>
        </div>
      ) : null}

      {rows.length ? (
        <div className="pf-table-card">
          <table className="pf-table">
            <thead>
              <tr>
                <th>Request</th>
                <th>Patient</th>
                <th>Pickup area</th>
                <th>Lab</th>
                <th>Preferred window</th>
                <th>Total</th>
                <th>Status</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.name}
                  className="pf-row"
                  tabIndex={0}
                  onClick={() => open(row.name)}
                  onKeyDown={(e) => onRowKey(e, row.name)}
                >
                  <td data-label="Request">
                    <b>{row.name}</b>
                  </td>
                  <td data-label="Patient">
                    {row.patient_name}
                    {patientLine(row.patient_age, row.patient_gender) ? (
                      <small className="pf-sub">{patientLine(row.patient_age, row.patient_gender)}</small>
                    ) : null}
                  </td>
                  <td data-label="Pickup area">{row.pickup_area || '—'}</td>
                  <td data-label="Lab">{row.lab_name || row.assigned_lab || '—'}</td>
                  <td data-label="Window">{windowLabel(row.preferred_window_start, row.preferred_window_end)}</td>
                  <td data-label="Total">{row.grand_total != null && row.grand_total > 0 ? money(row.grand_total) : '—'}</td>
                  <td data-label="Status">
                    <PfStatusChip status={row.status} />
                  </td>
                  <td data-label="Submitted">{when(row.submitted_on, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 ? (
            <div className="pf-pager">
              <span>
                Page {page} of {pages} · {total} requests
              </span>
              <div>
                <button type="button" className="pf-link-btn" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                  ‹ Prev
                </button>
                <button type="button" className="pf-link-btn" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>
                  Next ›
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
