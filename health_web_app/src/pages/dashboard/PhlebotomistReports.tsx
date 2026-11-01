import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { api, PhlebotomistReport, PhlebotomistReportUiStatus } from '../../api';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { formatPatientAge } from '../../utils/patientAge';
import './collector-v2.css';

const PAGE_SIZE = 10;

type Chip = 'all' | PhlebotomistReportUiStatus;

function Ico({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function uiStatus(report: PhlebotomistReport): PhlebotomistReportUiStatus {
  if (report.report_ui_status) return report.report_ui_status;
  if (report.report_delivered_on) return 'delivered';
  if (report.report_pdf && (report.status === 'Authorized' || report.status === 'Dispatched')) return 'ready';
  if ((report.status || '').toLowerCase().includes('cancel') || (report.status || '').toLowerCase().includes('fail')) {
    return 'failed';
  }
  return 'processing';
}

function statusLabel(status: PhlebotomistReportUiStatus) {
  if (status === 'ready') return 'Ready to Download';
  if (status === 'delivered') return 'Delivered';
  if (status === 'failed') return 'Failed';
  return 'In Processing';
}

function testLabel(report: PhlebotomistReport) {
  return report.test_name || report.test_labels?.filter(Boolean).join(', ') || 'Diagnostics';
}

function testCount(report: PhlebotomistReport) {
  return report.test_labels?.filter(Boolean).length || 1;
}

function patientMeta(report: PhlebotomistReport) {
  const gender = (report.gender || '').trim();
  const age = report.age_label || formatPatientAge(report);
  if (gender && age) return `${gender} · ${age}`;
  return gender || age;
}

function ymd(value?: Date | string | null) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function formatDay(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function inRange(value: string | null | undefined, from: string, to: string) {
  const day = ymd(value);
  if (!day) return !from && !to;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function canDownload(report: PhlebotomistReport) {
  return Boolean(report.journey_id && report.report_pdf && (uiStatus(report) === 'ready' || uiStatus(report) === 'delivered'));
}

export function PhlebotomistReports() {
  const [reports, setReports] = useState<PhlebotomistReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [testFilter, setTestFilter] = useState('');
  const [chip, setChip] = useState<Chip>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPhlebotomistReports(200);
      setReports(res.data.reports || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh(load, 30000);

  const tests = useMemo(() => {
    const names = new Set<string>();
    for (const row of reports) {
      const label = testLabel(row);
      if (label) names.add(label);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [reports]);

  const counts = useMemo(() => {
    const next = { all: reports.length, ready: 0, processing: 0, delivered: 0, failed: 0 };
    for (const row of reports) next[uiStatus(row)] += 1;
    return next;
  }, [reports]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((row) => {
      const status = uiStatus(row);
      if (chip !== 'all' && status !== chip) return false;
      if (testFilter && testLabel(row) !== testFilter) return false;
      if (!inRange(row.collection_slot || row.creation, from, to)) return false;
      if (!q) return true;
      return [
        row.patient_name,
        row.patient_phone,
        row.barcode,
        row.trf_id,
        row.report_no,
        testLabel(row),
        row.collection_slot,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [reports, chip, testFilter, from, to, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const showingFrom = filtered.length ? (safePage - 1) * PAGE_SIZE + 1 : 0;
  const showingTo = Math.min(safePage * PAGE_SIZE, filtered.length);
  const selectedReady = reports.filter((row) => selected.includes(row.trf_id) && canDownload(row));

  useEffect(() => {
    setPage(1);
  }, [query, from, to, testFilter, chip]);

  function toggleOne(trfId: string, on: boolean) {
    setSelected((prev) => (on ? Array.from(new Set([...prev, trfId])) : prev.filter((id) => id !== trfId)));
  }

  function togglePage(on: boolean) {
    const ids = paged.filter(canDownload).map((row) => row.trf_id);
    setSelected((prev) => (on ? Array.from(new Set([...prev, ...ids])) : prev.filter((id) => !ids.includes(id))));
  }

  function resetFilters() {
    setQuery('');
    setFrom('');
    setTo('');
    setTestFilter('');
    setChip('all');
    setPage(1);
  }

  async function downloadOne(report: PhlebotomistReport) {
    if (!canDownload(report) || !report.journey_id) return;
    setActing(report.trf_id);
    setError(null);
    setMessage(null);
    try {
      await api.downloadJourneyReport(report.journey_id, `NABL_Report_${report.trf_id}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setActing(null);
      setMenuFor(null);
    }
  }

  async function downloadSelected() {
    if (!selectedReady.length) return;
    setActing('bulk');
    setError(null);
    setMessage(null);
    try {
      for (const row of selectedReady) {
        if (row.journey_id) {
          await api.downloadJourneyReport(row.journey_id, `NABL_Report_${row.trf_id}.pdf`);
        }
      }
      setMessage(`Downloaded ${selectedReady.length} report${selectedReady.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not download selected reports');
    } finally {
      setActing(null);
    }
  }

  async function deliver(report: PhlebotomistReport) {
    if (!canDownload(report) || !report.journey_id) return;
    setActing(report.trf_id);
    setError(null);
    setMenuFor(null);
    try {
      await api.downloadJourneyReport(report.journey_id, `NABL_Report_${report.trf_id}.pdf`).catch(() => undefined);
      await api.deliverPhlebotomistReport(report.trf_id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mark report delivered');
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="cp-page crd-page">
      <section className="crd-hero">
        <div className="crd-hero-copy">
          <h1>Reports Download</h1>
          <p>Download authorized lab reports for your collected samples.</p>
          <ul className="crd-pills">
            <li>NABL formatted PDF reports</li>
            <li>Authorized & Secure</li>
            <li>Complete reports in single PDF</li>
            <li>Fast & easy download</li>
          </ul>
        </div>
        <ul className="crd-benefits">
          <li>Accurate Reports</li>
          <li>NABL Compliant</li>
          <li>Secure & Confidential</li>
          <li>Ready for Patient Delivery</li>
        </ul>
        <div className="crd-hero-art" aria-hidden>
          <span className="crd-sheet">LAB REPORT</span>
        </div>
      </section>

      <section className="crd-stats">
        <article>
          <span className="crd-stat-ico docs"><Ico><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4" /></Ico></span>
          <strong>{counts.ready}</strong>
          <b>Ready to Download</b>
          <small>Authorized reports</small>
        </article>
        <article>
          <span className="crd-stat-ico wait"><Ico><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></Ico></span>
          <strong>{counts.processing}</strong>
          <b>In Processing</b>
          <small>Under verification</small>
        </article>
        <article>
          <span className="crd-stat-ico ok"><Ico><path d="M20 6L9 17l-5-5" /></Ico></span>
          <strong>{counts.delivered}</strong>
          <b>Delivered</b>
          <small>Reports downloaded</small>
        </article>
        <article>
          <span className="crd-stat-ico bad"><Ico><circle cx="12" cy="12" r="8" /><path d="M15 9l-6 6M9 9l6 6" /></Ico></span>
          <strong>{counts.failed}</strong>
          <b>Failed</b>
          <small>Processing failed</small>
        </article>
      </section>

      {error ? <p className="cp-error">{error}</p> : null}
      {message ? <p className="crd-ok">{message}</p> : null}

      <section className="crd-panel">
        <div className="crd-tools">
          <label className="crd-search">
            <Ico><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></Ico>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by patient name, mobile, test, barcode or collection date..."
            />
          </label>
          <label className="crd-dates">
            <Ico><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M8 3v4M16 3v4" /></Ico>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <span>–</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </label>
          <select value={testFilter} onChange={(e) => setTestFilter(e.target.value)} aria-label="Filter by test">
            <option value="">All Tests</option>
            {tests.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <button type="button" className="crd-reset" onClick={resetFilters}>
            Reset
          </button>
        </div>

        <div className="crd-tabs">
          {(
            [
              ['all', `All (${counts.all})`],
              ['ready', `Ready to Download (${counts.ready})`],
              ['processing', `In Processing (${counts.processing})`],
              ['delivered', `Delivered (${counts.delivered})`],
              ['failed', `Failed (${counts.failed})`],
            ] as Array<[Chip, string]>
          ).map(([key, label]) => (
            <button key={key} type="button" className={`crd-tab${chip === key ? ' is-on' : ''}`} onClick={() => setChip(key)}>
              {label}
            </button>
          ))}
          <button
            type="button"
            className="crd-bulk"
            disabled={!selectedReady.length || acting === 'bulk'}
            onClick={() => void downloadSelected()}
          >
            Download Selected ({selectedReady.length})
          </button>
        </div>

        {loading ? <p className="cp-empty">Loading reports…</p> : null}
        {!loading && !filtered.length ? (
          <p className="cp-empty">No reports match this filter. Authorized PDFs appear after lab sign-off.</p>
        ) : null}

        {!loading && filtered.length ? (
          <>
            <div className="crd-table-wrap">
              <table className="crd-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={paged.filter(canDownload).length > 0 && paged.filter(canDownload).every((row) => selected.includes(row.trf_id))}
                        onChange={(e) => togglePage(e.target.checked)}
                        aria-label="Select downloadable reports on this page"
                      />
                    </th>
                    <th>#</th>
                    <th>Patient Details</th>
                    <th>Test / Package</th>
                    <th>Collection Date</th>
                    <th>Report Date</th>
                    <th>Status</th>
                    <th>Report No.</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((row, index) => {
                    const status = uiStatus(row);
                    const ready = canDownload(row);
                    return (
                      <tr key={row.trf_id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.includes(row.trf_id)}
                            disabled={!ready}
                            onChange={(e) => toggleOne(row.trf_id, e.target.checked)}
                            aria-label={`Select ${row.patient_name || row.trf_id}`}
                          />
                        </td>
                        <td>{(safePage - 1) * PAGE_SIZE + index + 1}</td>
                        <td>
                          <strong>{row.patient_name || '—'}</strong>
                          <small>
                            {row.patient_phone ? <span>☎ {row.patient_phone}</span> : null}
                            {patientMeta(row) ? <span>{patientMeta(row)}</span> : null}
                            <span># {row.barcode || row.trf_id}</span>
                          </small>
                        </td>
                        <td>
                          <strong>{testLabel(row)}</strong>
                          <small>{testCount(row)} Test{testCount(row) === 1 ? '' : 's'}</small>
                        </td>
                        <td>
                          <b>{formatDay(row.collection_slot || row.creation)}</b>
                          <small>{formatTime(row.collection_slot || row.creation)}</small>
                        </td>
                        <td>
                          <b>{formatDay(row.authorized_on || row.report_delivered_on)}</b>
                          <small>{formatTime(row.authorized_on || row.report_delivered_on)}</small>
                        </td>
                        <td>
                          <span className={`crd-status ${status}`}>{statusLabel(status)}</span>
                        </td>
                        <td>{row.report_no || row.trf_id}</td>
                        <td>
                          <div className="crd-actions">
                            <button
                              type="button"
                              className="crd-dl"
                              disabled={!ready || acting === row.trf_id}
                              onClick={() => void downloadOne(row)}
                            >
                              {acting === row.trf_id ? '…' : 'Download PDF'}
                            </button>
                            <div className="crd-more">
                              <button type="button" className="crd-more-btn" onClick={() => setMenuFor(menuFor === row.trf_id ? null : row.trf_id)} aria-label="More actions">
                                ⋯
                              </button>
                              {menuFor === row.trf_id ? (
                                <div className="crd-menu">
                                  {ready ? (
                                    <button type="button" onClick={() => void deliver(row)}>Mark delivered</button>
                                  ) : null}
                                  <button type="button" onClick={() => { setMenuFor(null); void load(); }}>Refresh</button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="crd-cards">
              {paged.map((row) => {
                const status = uiStatus(row);
                const ready = canDownload(row);
                return (
                  <article key={row.trf_id} className="crd-card">
                    <div className="crd-card-head">
                      <strong>{row.patient_name || '—'}</strong>
                      <span className={`crd-status ${status}`}>{statusLabel(status)}</span>
                    </div>
                    <p>{testLabel(row)}</p>
                    <small>
                      {row.patient_phone || 'No mobile'} · {patientMeta(row) || 'Age not recorded'} · {row.report_no || row.trf_id}
                    </small>
                    <small>
                      Collected {formatDay(row.collection_slot || row.creation)}
                      {row.authorized_on ? ` · Report ${formatDay(row.authorized_on)}` : ''}
                    </small>
                    <button type="button" className="crd-dl" disabled={!ready || acting === row.trf_id} onClick={() => void downloadOne(row)}>
                      {ready ? 'Download PDF' : 'PDF not ready'}
                    </button>
                  </article>
                );
              })}
            </div>

            <div className="crd-foot">
              <span>Showing {showingFrom} to {showingTo} of {filtered.length} reports</span>
              <div className="crd-pager">
                <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹</button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).slice(0, 5).map((n) => (
                  <button key={n} type="button" className={n === safePage ? 'is-on' : ''} onClick={() => setPage(n)}>
                    {n}
                  </button>
                ))}
                <button type="button" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>›</button>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
