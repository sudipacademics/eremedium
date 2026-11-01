import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import './partner-download-v2.css';

type ReportRow = {
  journey_id: string;
  trf_id: string;
  patient_name?: string;
  barcode?: string;
  phone?: string;
  status: string;
  updated_at?: string;
  order_status?: string;
};

type ListRow = {
  key: string;
  journey_id?: string;
  trf_id: string;
  patient_name: string;
  phone: string;
  barcode: string;
  tests: string;
  reportStatus: 'Available' | 'Pending' | 'Not Available';
  dispatchStatus: string;
  paymentStatus: string;
  updated_at: string;
  canDownload: boolean;
};

type SortKey = 'patient' | 'phone' | 'trf' | 'tests' | 'report' | 'dispatch' | 'payment' | 'updated';
const PAGE_SIZE = 10;

function formatWhen(raw?: string) {
  if (!raw) return '—';
  const d = new Date(String(raw).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function dayKey(raw?: string) {
  return (raw || '').slice(0, 10);
}

function paymentOf(bill?: Record<string, unknown>) {
  if (!bill) return '—';
  const stored = String(bill.hec_patient_payment_status || '').trim();
  if (stored) return stored;
  const total = Number(bill.hec_net_amount || bill.amount || 0);
  const paid = Math.max(Number(bill.hec_amount_paid || 0), Number(bill.hec_received || 0));
  const due = Math.max(total - paid, 0);
  if (paid > 0 && due <= 0.009) return 'Paid';
  if (paid > 0) return 'Partially Paid';
  return 'Unpaid';
}

function reportTone(status: string) {
  if (status === 'Available') return 'pdr-pill';
  if (status === 'Pending') return 'pdr-pill is-warn';
  return 'pdr-pill is-mute';
}

function payTone(status: string) {
  const s = status.toLowerCase();
  if (s === 'paid') return 'pdr-pill';
  if (s.includes('partial')) return 'pdr-pill is-warn';
  if (s === 'unpaid') return 'pdr-pill is-bad';
  return 'pdr-pill is-mute';
}

function dispatchTone(status: string) {
  if (status === 'Dispatched') return 'pdr-pill';
  if (status === 'Authorized' || status === 'Pending') return 'pdr-pill is-warn';
  return 'pdr-pill is-mute';
}

export function B2bDownloadReportPage() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [bills, setBills] = useState<Array<Record<string, unknown>>>([]);
  const [testsByTrf, setTestsByTrf] = useState<Record<string, string>>({});
  const [txt, setTxt] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [reportFilter, setReportFilter] = useState('');
  const [testFilter, setTestFilter] = useState('');
  const [dispatchFilter, setDispatchFilter] = useState('');
  const [downloadFilter, setDownloadFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rep, bill, stmt] = await Promise.all([
        api.listHubDownloadReports(80, txt.trim()),
        api.listHubLabBills(80, txt.trim(), '').catch(() => null),
        api.getB2bStatements().catch(() => null),
      ]);
      setReports((rep.data.reports || []) as ReportRow[]);
      setBills((bill?.data.bills || []) as Array<Record<string, unknown>>);
      const tests: Record<string, string> = {};
      for (const line of stmt?.data.lines || []) {
        if (!line.trf_id) continue;
        const prev = tests[line.trf_id];
        tests[line.trf_id] = prev ? `${prev}, ${line.test}` : line.test || '';
      }
      setTestsByTrf(tests);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, [txt]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<ListRow[]>(() => {
    const byTrf = new Map<string, ListRow>();
    for (const bill of bills) {
      const trf = String(bill.name || '');
      if (!trf) continue;
      const order = String(bill.order_status || '');
      const cancelled = /cancel|reject/i.test(order);
      byTrf.set(trf, {
        key: trf,
        trf_id: trf,
        patient_name: String(bill.patient_name || '—'),
        phone: String(bill.patient_phone || '—'),
        barcode: String(bill.unique_barcode || '—'),
        tests: testsByTrf[trf] || '—',
        reportStatus: cancelled ? 'Not Available' : 'Pending',
        dispatchStatus: 'Pending',
        paymentStatus: paymentOf(bill),
        updated_at: String(bill.hec_bill_datetime || bill.creation || ''),
        canDownload: false,
      });
    }
    for (const report of reports) {
      const prev = byTrf.get(report.trf_id);
      const available = Boolean(report.journey_id);
      byTrf.set(report.trf_id, {
        key: report.journey_id || report.trf_id,
        journey_id: report.journey_id,
        trf_id: report.trf_id,
        patient_name: report.patient_name || prev?.patient_name || '—',
        phone: report.phone || prev?.phone || '—',
        barcode: report.barcode || prev?.barcode || '—',
        tests: testsByTrf[report.trf_id] || prev?.tests || '—',
        reportStatus: available ? 'Available' : 'Pending',
        dispatchStatus: report.status || prev?.dispatchStatus || '—',
        paymentStatus: prev?.paymentStatus || '—',
        updated_at: report.updated_at || prev?.updated_at || '',
        canDownload: available,
      });
    }
    return [...byTrf.values()];
  }, [bills, reports, testsByTrf]);

  const tests = useMemo(
    () => Array.from(new Set(rows.map((r) => r.tests).filter((t) => t && t !== '—'))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = txt.trim().toLowerCase();
    const list = rows.filter((row) => {
      const day = dayKey(row.updated_at);
      if (fromDate && day && day < fromDate) return false;
      if (toDate && day && day > toDate) return false;
      if (reportFilter && row.reportStatus !== reportFilter) return false;
      if (testFilter && row.tests !== testFilter) return false;
      if (dispatchFilter && row.dispatchStatus !== dispatchFilter) return false;
      if (downloadFilter === 'Ready' && !row.canDownload) return false;
      if (downloadFilter === 'Not Available' && row.canDownload) return false;
      if (paymentFilter && row.paymentStatus !== paymentFilter) return false;
      if (!q) return true;
      return [row.patient_name, row.phone, row.trf_id, row.barcode, row.tests].join(' ').toLowerCase().includes(q);
    });
    const dir = sortAsc ? 1 : -1;
    return list.sort((a, b) => {
      const av =
        sortKey === 'patient'
          ? a.patient_name
          : sortKey === 'phone'
            ? a.phone
            : sortKey === 'trf'
              ? a.trf_id
              : sortKey === 'tests'
                ? a.tests
                : sortKey === 'report'
                  ? a.reportStatus
                  : sortKey === 'dispatch'
                    ? a.dispatchStatus
                    : sortKey === 'payment'
                      ? a.paymentStatus
                      : a.updated_at;
      const bv =
        sortKey === 'patient'
          ? b.patient_name
          : sortKey === 'phone'
            ? b.phone
            : sortKey === 'trf'
              ? b.trf_id
              : sortKey === 'tests'
                ? b.tests
                : sortKey === 'report'
                  ? b.reportStatus
                  : sortKey === 'dispatch'
                    ? b.dispatchStatus
                    : sortKey === 'payment'
                      ? b.paymentStatus
                      : b.updated_at;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [
    rows,
    txt,
    fromDate,
    toDate,
    reportFilter,
    testFilter,
    dispatchFilter,
    downloadFilter,
    paymentFilter,
    sortKey,
    sortAsc,
  ]);

  const summary = useMemo(() => {
    const total = rows.length;
    const ready = rows.filter((r) => r.canDownload).length;
    const pending = rows.filter((r) => r.reportStatus === 'Pending').length;
    const missing = rows.filter((r) => r.reportStatus === 'Not Available').length;
    return { total, ready, pending, missing };
  }, [rows]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const selectedReady = pageRows.filter((r) => selected.includes(r.key) && r.canDownload && r.journey_id);

  useEffect(() => {
    setPage(1);
  }, [txt, fromDate, toDate, reportFilter, testFilter, dispatchFilter, downloadFilter, paymentFilter]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function clearFilters() {
    setTxt('');
    setFromDate('');
    setToDate('');
    setReportFilter('');
    setTestFilter('');
    setDispatchFilter('');
    setDownloadFilter('');
    setPaymentFilter('');
  }

  function toggleOne(key: string, on: boolean) {
    setSelected((cur) => (on ? Array.from(new Set([...cur, key])) : cur.filter((k) => k !== key)));
  }

  function togglePage(on: boolean) {
    const keys = pageRows.map((r) => r.key);
    setSelected((cur) => (on ? Array.from(new Set([...cur, ...keys])) : cur.filter((k) => !keys.includes(k))));
  }

  async function onDownload(row: ListRow) {
    if (!row.journey_id || !row.canDownload) return;
    setDownloading(row.journey_id);
    setError(null);
    setMessage(null);
    try {
      const safeName = (row.patient_name || row.trf_id || 'Report').replace(/[^\w.-]+/g, '_');
      await api.downloadHubReport(row.journey_id, `Lab_Report_${safeName}_${row.trf_id}.pdf`);
      setMessage(`Downloaded report for ${row.patient_name || row.trf_id}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  }

  async function onDownloadSelected() {
    const ready = selectedReady;
    if (!ready.length) return;
    for (const row of ready) {
      await onDownload(row);
    }
  }

  return (
    <div className="pdr">
      <div className="pdr-top">
        <div>
          <h1>Download Report</h1>
          <p>
            Authorized lab reports for patients billed at your hub. Collect any remaining dues on Bill Status before
            handover when needed.
          </p>
        </div>
        <aside className="pdr-help">
          <strong>Reports are ready to download</strong>
          <ul>
            <li>View and download authorized lab reports</li>
            <li>Search by patient, TRF, barcode or phone number</li>
            <li>Check status and dispatch details</li>
          </ul>
        </aside>
      </div>

      <div className="pdr-toolbar">
        <label className="pdr-search">
          <input
            value={txt}
            onChange={(e) => setTxt(e.target.value)}
            placeholder="Patient name, TRF, barcode, phone number..."
            aria-label="Search reports"
          />
        </label>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="From date" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="To date" />
        <select value={reportFilter} onChange={(e) => setReportFilter(e.target.value)} aria-label="Report status">
          <option value="">All Status</option>
          <option value="Available">Available</option>
          <option value="Pending">Pending</option>
          <option value="Not Available">Not Available</option>
        </select>
        <select value={testFilter} onChange={(e) => setTestFilter(e.target.value)} aria-label="Test name">
          <option value="">All Tests</option>
          {tests.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="button" className="pdr-btn is-primary" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div className="pdr-toolbar-2">
        <select value={dispatchFilter} onChange={(e) => setDispatchFilter(e.target.value)} aria-label="Dispatch status">
          <option value="">All Dispatch</option>
          <option value="Dispatched">Dispatched</option>
          <option value="Authorized">Authorized</option>
          <option value="Pending">Pending</option>
        </select>
        <select value={downloadFilter} onChange={(e) => setDownloadFilter(e.target.value)} aria-label="Download status">
          <option value="">All</option>
          <option value="Ready">Ready to download</option>
          <option value="Not Available">Not Available</option>
        </select>
        <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} aria-label="Payment status">
          <option value="">All Payment</option>
          <option value="Paid">Paid</option>
          <option value="Partially Paid">Partially Paid</option>
          <option value="Unpaid">Unpaid</option>
        </select>
        <button type="button" className="pdr-btn" onClick={clearFilters}>
          Clear Filters
        </button>
      </div>

      <div className="pdr-stats">
        <article className="pdr-stat">
          <span>Total reports</span>
          <strong>{summary.total}</strong>
        </article>
        <article className="pdr-stat">
          <span>Ready to download</span>
          <strong>{summary.ready}</strong>
        </article>
        <article className="pdr-stat">
          <span>Pending reports</span>
          <strong>{summary.pending}</strong>
        </article>
        <article className="pdr-stat">
          <span>Not available</span>
          <strong>{summary.missing}</strong>
        </article>
      </div>

      {message ? <div className="pdr-alert is-ok">{message}</div> : null}
      {error ? <div className="pdr-alert is-err">{error}</div> : null}

      <section className="pdr-card">
        <div className="pdr-card-head">
          <div>
            <h2>Reports list</h2>
            <p>Download authorized reports for your patients.</p>
          </div>
          <button type="button" className="pdr-btn" disabled={!selectedReady.length} onClick={() => void onDownloadSelected()}>
            Download selected ({selectedReady.length})
          </button>
        </div>

        <div className="pdr-table-wrap">
          {loading ? <p className="pdr-empty">Loading reports…</p> : null}
          {!loading && !filtered.length ? (
            <p className="pdr-empty">
              No reports match these filters. Authorized reports appear after lab authorization / dispatch.
            </p>
          ) : null}
          {!loading && filtered.length ? (
            <table className="pdr-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={pageRows.length > 0 && pageRows.every((r) => selected.includes(r.key))}
                      onChange={(e) => togglePage(e.target.checked)}
                      aria-label="Select page"
                    />
                  </th>
                  <th>#</th>
                  <th>
                    <button type="button" onClick={() => toggleSort('patient')}>
                      Patient Name
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('phone')}>
                      Phone
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('trf')}>
                      TRF / Barcode
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('tests')}>
                      Test Name / Package
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('report')}>
                      Report Status
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('dispatch')}>
                      Dispatch Status
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('payment')}>
                      Payment Status
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('updated')}>
                      Updated On
                    </button>
                  </th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, i) => (
                  <tr key={row.key}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(row.key)}
                        onChange={(e) => toggleOne(row.key, e.target.checked)}
                        aria-label={`Select ${row.trf_id}`}
                      />
                    </td>
                    <td>{(safePage - 1) * PAGE_SIZE + i + 1}</td>
                    <td>{row.patient_name}</td>
                    <td>{row.phone}</td>
                    <td>
                      {row.trf_id}
                      <br />
                      <small>{row.barcode}</small>
                    </td>
                    <td>{row.tests}</td>
                    <td>
                      <span className={reportTone(row.reportStatus)}>{row.reportStatus}</span>
                    </td>
                    <td>
                      <span className={dispatchTone(row.dispatchStatus)}>{row.dispatchStatus}</span>
                    </td>
                    <td>
                      <span className={payTone(row.paymentStatus)}>{row.paymentStatus}</span>
                    </td>
                    <td>{formatWhen(row.updated_at)}</td>
                    <td>
                      {row.canDownload ? (
                        <button
                          type="button"
                          className="pdr-btn is-primary"
                          disabled={downloading === row.journey_id}
                          onClick={() => void onDownload(row)}
                        >
                          {downloading === row.journey_id ? 'Downloading…' : 'Download PDF'}
                        </button>
                      ) : (
                        <span className="pdr-pill is-mute">Not Available</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>

        {filtered.length ? (
          <div className="pdr-pager">
            <span>
              Showing {(safePage - 1) * PAGE_SIZE + 1} to {Math.min(safePage * PAGE_SIZE, filtered.length)} of{' '}
              {filtered.length} reports
            </span>
            <span>
              <Link className="pdr-btn" to="/b2b/bill-status">
                Bill Status
              </Link>{' '}
              <button type="button" className="pdr-btn" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>
                Prev
              </button>{' '}
              {safePage} / {pageCount}{' '}
              <button
                type="button"
                className="pdr-btn"
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
