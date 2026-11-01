import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type B2bStatementLine } from '../../api';
import './partner-statements-v2.css';

const PAGE_SIZE = 10;
const HIGH_MARGIN = 20;
const LOW_MARGIN = 20;

type Tab = 'all' | 'billed' | 'pending' | 'high' | 'low';
type SortKey = 'created' | 'retail' | 'wholesale' | 'margin' | 'marginPct';
type SortDir = 'asc' | 'desc';
type PriceSort = '' | 'retail-asc' | 'retail-desc';
type MarginSort = '' | 'margin-asc' | 'margin-desc' | 'pct-asc' | 'pct-desc';

function money(value: number) {
  return `₹${Math.round(value || 0).toLocaleString('en-IN')}`;
}

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

function monthKey(raw?: string) {
  return (raw || '').slice(0, 7);
}

function monthLabel(key: string) {
  if (!key) return '';
  const d = new Date(`${key}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function marginPct(line: B2bStatementLine) {
  if (!line.retail_amount) return 0;
  return (line.margin / line.retail_amount) * 100;
}

function billedLabel(line: B2bStatementLine) {
  if (line.platform_billed) return 'Yes';
  const status = (line.order_status || '').toLowerCase();
  if (status.includes('cancel')) return 'No';
  return 'Pending';
}

function billedTone(label: string) {
  if (label === 'Yes') return 'pst-pill';
  if (label === 'Pending') return 'pst-pill is-warn';
  return 'pst-pill is-mute';
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      {children}
    </svg>
  );
}

function Spark({ color }: { color: string }) {
  return (
    <svg className="pst-spark" viewBox="0 0 88 28" aria-hidden>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        points="1,20 12,16 22,18 34,10 46,13 58,7 70,11 87,4"
      />
    </svg>
  );
}

function pageNumbers(current: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, 2, total - 1, total, current - 1, current, current + 1]);
  return [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
}

function isoDay(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthBounds(offset = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: isoDay(start), to: isoDay(end) };
}

function prettyDay(raw: string) {
  const d = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function B2bStatementsPage() {
  const [lines, setLines] = useState<B2bStatementLine[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [testFilter, setTestFilter] = useState('');
  const [billingFilter, setBillingFilter] = useState('');
  const [billedFilter, setBilledFilter] = useState('');
  const [priceSort, setPriceSort] = useState<PriceSort>('');
  const [marginSort, setMarginSort] = useState<MarginSort>('');
  const [tab, setTab] = useState<Tab>('all');
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<B2bStatementLine | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await api.getB2bStatements(200);
      setLines(res.data.lines || []);
      setSummary(res.data.summary || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load statements');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tests = useMemo(
    () => Array.from(new Set(lines.map((l) => l.test).filter(Boolean))).sort(),
    [lines],
  );
  const months = useMemo(
    () => Array.from(new Set(lines.map((l) => monthKey(l.created)).filter(Boolean))).sort().reverse(),
    [lines],
  );
  const billingTypes = useMemo(
    () => Array.from(new Set(lines.map((l) => l.payment_method).filter(Boolean) as string[])).sort(),
    [lines],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = lines.filter((line) => {
      const day = dayKey(line.created);
      const month = monthKey(line.created);
      const billed = billedLabel(line);
      if (fromDate && day && day < fromDate) return false;
      if (toDate && day && day > toDate) return false;
      if ((fromDate || toDate) && !day) return false;
      if (monthFilter && month !== monthFilter) return false;
      if (testFilter && line.test !== testFilter) return false;
      if (billingFilter && (line.payment_method || '') !== billingFilter) return false;
      if (billedFilter && billed !== billedFilter) return false;
      if (tab === 'billed' && billed !== 'Yes') return false;
      if (tab === 'pending' && billed !== 'Pending') return false;
      if (tab === 'high' && marginPct(line) < HIGH_MARGIN) return false;
      if (tab === 'low' && marginPct(line) >= LOW_MARGIN) return false;
      if (!q) return true;
      return [line.patient_name, line.trf_id, line.test, line.payment_method].join(' ').toLowerCase().includes(q);
    });

    const key = priceSort === 'retail-asc' || priceSort === 'retail-desc'
      ? 'retail'
      : marginSort === 'pct-asc' || marginSort === 'pct-desc'
        ? 'marginPct'
        : marginSort
          ? 'margin'
          : sortKey;
    const dir: SortDir =
      priceSort === 'retail-asc' || marginSort === 'margin-asc' || marginSort === 'pct-asc'
        ? 'asc'
        : priceSort === 'retail-desc' || marginSort === 'margin-desc' || marginSort === 'pct-desc'
          ? 'desc'
          : sortDir;

    rows = [...rows].sort((a, b) => {
      const av =
        key === 'created'
          ? dayKey(a.created)
          : key === 'retail'
            ? a.retail_amount
            : key === 'wholesale'
              ? a.wholesale_amount
              : key === 'marginPct'
                ? marginPct(a)
                : a.margin;
      const bv =
        key === 'created'
          ? dayKey(b.created)
          : key === 'retail'
            ? b.retail_amount
            : key === 'wholesale'
              ? b.wholesale_amount
              : key === 'marginPct'
                ? marginPct(b)
                : b.margin;
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return rows;
  }, [
    lines,
    query,
    fromDate,
    toDate,
    monthFilter,
    testFilter,
    billingFilter,
    billedFilter,
    tab,
    priceSort,
    marginSort,
    sortKey,
    sortDir,
  ]);

  const counts = useMemo(() => {
    const scoped = lines.filter((line) => {
      const day = dayKey(line.created);
      const month = monthKey(line.created);
      if (fromDate && day && day < fromDate) return false;
      if (toDate && day && day > toDate) return false;
      if ((fromDate || toDate) && !day) return false;
      if (monthFilter && month !== monthFilter) return false;
      if (testFilter && line.test !== testFilter) return false;
      if (billingFilter && (line.payment_method || '') !== billingFilter) return false;
      if (billedFilter && billedLabel(line) !== billedFilter) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [line.patient_name, line.trf_id, line.test, line.payment_method].join(' ').toLowerCase().includes(q);
    });
    return {
      all: scoped.length,
      billed: scoped.filter((l) => billedLabel(l) === 'Yes').length,
      pending: scoped.filter((l) => billedLabel(l) === 'Pending').length,
      high: scoped.filter((l) => marginPct(l) >= HIGH_MARGIN).length,
      low: scoped.filter((l) => marginPct(l) < LOW_MARGIN).length,
    };
  }, [lines, fromDate, toDate, monthFilter, testFilter, billingFilter, billedFilter, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pageIds = pageRows.map((r) => r.trf_id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));

  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
  }, [query, fromDate, toDate, monthFilter, testFilter, billingFilter, billedFilter, tab, priceSort, marginSort]);

  useEffect(() => {
    if (!selected) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelected(null);
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [selected]);

  const thisMonth = useMemo(() => monthBounds(0), []);
  const lastMonth = useMemo(() => monthBounds(-1), []);
  const rangePreset =
    fromDate === thisMonth.from && toDate === thisMonth.to
      ? 'this-month'
      : fromDate === lastMonth.from && toDate === lastMonth.to
        ? 'last-month'
        : fromDate || toDate
          ? 'custom'
          : 'all';

  const rangeLabel = useMemo(() => {
    if (fromDate && toDate) return `${prettyDay(fromDate)} – ${prettyDay(toDate)}`;
    if (fromDate) return `From ${prettyDay(fromDate)}`;
    if (toDate) return `Until ${prettyDay(toDate)}`;
    if (monthFilter) return monthLabel(monthFilter);
    return 'All time';
  }, [fromDate, toDate, monthFilter]);

  function clearFilters() {
    setQuery('');
    setFromDate('');
    setToDate('');
    setMonthFilter('');
    setTestFilter('');
    setBillingFilter('');
    setBilledFilter('');
    setPriceSort('');
    setMarginSort('');
    setTab('all');
    setSortKey('created');
    setSortDir('desc');
  }

  function toggleSort(key: SortKey) {
    setPriceSort('');
    setMarginSort('');
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'created' ? 'desc' : 'desc');
    }
  }

  function toggleAllPage() {
    setSelectedIds((cur) => (allPageSelected ? cur.filter((id) => !pageIds.includes(id)) : [...new Set([...cur, ...pageIds])]));
  }

  function toggleOne(id: string) {
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function downloadReport(rows: B2bStatementLine[], name: string) {
    const header = [
      'Date',
      'TRF',
      'Patient',
      'Test',
      'Retail',
      'Wholesale',
      'Margin',
      'Margin %',
      'Platform billed',
      'Billing type',
      'Order status',
    ];
    const body = rows.map((row) =>
      [
        row.created || '',
        row.trf_id,
        row.patient_name,
        row.test,
        row.retail_amount,
        row.wholesale_amount,
        row.margin,
        `${Math.round(marginPct(row))}%`,
        billedLabel(row),
        row.payment_method || '',
        row.order_status || '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setMessage(`Downloaded ${rows.length} statement${rows.length === 1 ? '' : 's'}.`);
  }

  const totals = useMemo(() => {
    const scoped = lines.filter((line) => {
      const day = dayKey(line.created);
      const month = monthKey(line.created);
      if (fromDate && day && day < fromDate) return false;
      if (toDate && day && day > toDate) return false;
      if ((fromDate || toDate) && !day) return false;
      if (monthFilter && month !== monthFilter) return false;
      return true;
    });
    if (!fromDate && !toDate && !monthFilter && summary) {
      return {
        retail: summary.total_retail || 0,
        wholesale: summary.total_wholesale || 0,
        margin: summary.total_margin || 0,
        unbilled: summary.unbilled_wholesale || 0,
      };
    }
    return {
      retail: scoped.reduce((s, l) => s + (l.retail_amount || 0), 0),
      wholesale: scoped.reduce((s, l) => s + (l.wholesale_amount || 0), 0),
      margin: scoped.reduce((s, l) => s + (l.margin || 0), 0),
      unbilled: scoped.reduce(
        (s, l) => s + (!l.platform_billed && l.wholesale_amount ? l.wholesale_amount : 0),
        0,
      ),
    };
  }, [lines, fromDate, toDate, monthFilter, summary]);

  return (
    <div className="pst">
      <div className="pst-head">
        <div>
          <h1>
            <span className="pst-head-ico" aria-hidden>
              <Icon>
                <path d="M7 3h10v4H7z" />
                <path d="M6 7h12v14H6z" />
                <path d="M9 11h6" />
                <path d="M9 15h6" />
              </Icon>
            </span>
            B2B Statements
          </h1>
          <p>Retail collected from patients vs wholesale owed to platform.</p>
        </div>
        <select
          className="pst-range"
          aria-label="Date range"
          value={rangePreset}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'all') {
              setFromDate('');
              setToDate('');
              return;
            }
            if (v === 'this-month') {
              setFromDate(thisMonth.from);
              setToDate(thisMonth.to);
              return;
            }
            if (v === 'last-month') {
              setFromDate(lastMonth.from);
              setToDate(lastMonth.to);
            }
          }}
        >
          <option value="all">All time</option>
          <option value="this-month">
            {prettyDay(thisMonth.from)} – {prettyDay(thisMonth.to)}
          </option>
          <option value="last-month">
            {prettyDay(lastMonth.from)} – {prettyDay(lastMonth.to)}
          </option>
          {rangePreset === 'custom' ? <option value="custom">{rangeLabel}</option> : null}
        </select>
      </div>

      <div className="pst-stats">
        <article className="pst-stat">
          <div className="pst-stat-top">
            <span className="pst-stat-ico">
              <Icon>
                <circle cx="9" cy="20" r="1.6" />
                <circle cx="18" cy="20" r="1.6" />
                <path d="M3 4h3l2.2 11h10.3l2-7H8" />
              </Icon>
            </span>
            <Spark color="#86efac" />
          </div>
          <span>Total Retail</span>
          <strong>{money(totals.retail)}</strong>
        </article>
        <article className="pst-stat">
          <div className="pst-stat-top">
            <span className="pst-stat-ico is-blue">
              <Icon>
                <path d="M8 4h8v16H8z" />
                <path d="M10 8h4" />
                <path d="M10 12h4" />
              </Icon>
            </span>
            <Spark color="#93c5fd" />
          </div>
          <span>Total Wholesale</span>
          <strong>{money(totals.wholesale)}</strong>
        </article>
        <article className="pst-stat">
          <div className="pst-stat-top">
            <span className="pst-stat-ico is-amber">
              <Icon>
                <path d="M4 19V5" />
                <path d="M4 19h16" />
                <path d="M7 15l4-5 3 3 5-7" />
              </Icon>
            </span>
            <Spark color="#fcd34d" />
          </div>
          <span>Your Margin</span>
          <strong>{money(totals.margin)}</strong>
        </article>
        <article className="pst-stat">
          <div className="pst-stat-top">
            <span className="pst-stat-ico is-violet">
              <Icon>
                <path d="M7 3h10v18H7z" />
                <path d="M10 8h4" />
                <path d="M10 12h4" />
              </Icon>
            </span>
            <Spark color="#c4b5fd" />
          </div>
          <span>Unbilled Platform</span>
          <strong>{money(totals.unbilled)}</strong>
        </article>
      </div>

      <div className="pst-toolbar">
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="From date" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="To date" />
        <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} aria-label="Month">
          <option value="">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <select value={testFilter} onChange={(e) => setTestFilter(e.target.value)} aria-label="Test name">
          <option value="">All tests</option>
          {tests.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={priceSort} onChange={(e) => setPriceSort(e.target.value as PriceSort)} aria-label="Price filter">
          <option value="">All prices</option>
          <option value="retail-asc">Price: Low to High</option>
          <option value="retail-desc">Price: High to Low</option>
        </select>
      </div>

      <div className="pst-toolbar-2">
        <label className="pst-search">
          <Icon>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </Icon>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by patient name or TRF…"
            aria-label="Search statements"
          />
        </label>
        <select value={billingFilter} onChange={(e) => setBillingFilter(e.target.value)} aria-label="Billing type">
          <option value="">All billing types</option>
          {billingTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={billedFilter} onChange={(e) => setBilledFilter(e.target.value)} aria-label="Platform billed">
          <option value="">All billed states</option>
          <option value="Yes">Yes</option>
          <option value="Pending">Pending</option>
          <option value="No">No</option>
        </select>
        <select value={marginSort} onChange={(e) => setMarginSort(e.target.value as MarginSort)} aria-label="Margin filter">
          <option value="">All margins</option>
          <option value="margin-asc">Margin: Low to High</option>
          <option value="margin-desc">Margin: High to Low</option>
          <option value="pct-asc">Margin %: Low to High</option>
          <option value="pct-desc">Margin %: High to Low</option>
        </select>
        <button type="button" className="pst-btn is-clear" onClick={clearFilters}>
          Clear Filters
        </button>
      </div>

      {message ? <div className="pst-alert is-ok">{message}</div> : null}
      {error ? <div className="pst-alert is-err">{error}</div> : null}

      <div className="pst-tabs">
        <div className="pst-tab-list">
          {(
            [
              ['all', `All (${counts.all})`],
              ['billed', `Platform Billed (${counts.billed})`],
              ['pending', `Pending (${counts.pending})`],
              ['high', `High Margin (${counts.high})`],
              ['low', `Low Margin (${counts.low})`],
            ] as Array<[Tab, string]>
          ).map(([key, label]) => (
            <button key={key} type="button" className={`pst-tab${tab === key ? ' is-on' : ''}`} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="pst-btn"
            disabled={!selectedIds.length}
            onClick={() => downloadReport(filtered.filter((r) => selectedIds.includes(r.trf_id)), 'b2b-statements-selected.csv')}
          >
            Download selected
          </button>
          <button type="button" className="pst-btn" disabled={!filtered.length} onClick={() => downloadReport(filtered, 'b2b-statements.csv')}>
            <Icon>
              <path d="M12 4v11" />
              <path d="m8 11 4 4 4-4" />
              <path d="M5 19h14" />
            </Icon>
            Download Report
          </button>
        </div>
      </div>

      <section className="pst-card">
        <div className="pst-table-wrap">
          {loading ? (
            <p className="pst-empty">Loading statements…</p>
          ) : pageRows.length ? (
            <table className="pst-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" checked={allPageSelected} onChange={toggleAllPage} aria-label="Select page" />
                  </th>
                  <th>#</th>
                  <th>
                    <button type="button" onClick={() => toggleSort('created')}>
                      Date & Time
                    </button>
                  </th>
                  <th>TRF No.</th>
                  <th>Patient Name</th>
                  <th>Test / Package</th>
                  <th>
                    <button type="button" onClick={() => toggleSort('retail')}>
                      Retail (₹)
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('wholesale')}>
                      Wholesale (₹)
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('margin')}>
                      Margin (₹)
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('marginPct')}>
                      Margin %
                    </button>
                  </th>
                  <th>Platform Billed</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, i) => {
                  const billed = billedLabel(row);
                  return (
                    <tr key={row.trf_id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(row.trf_id)}
                          onChange={() => toggleOne(row.trf_id)}
                          aria-label={`Select ${row.trf_id}`}
                        />
                      </td>
                      <td>{(safePage - 1) * PAGE_SIZE + i + 1}</td>
                      <td>{formatWhen(row.created)}</td>
                      <td>{row.trf_id}</td>
                      <td>{row.patient_name || '—'}</td>
                      <td>{row.test || '—'}</td>
                      <td className="pst-num">{money(row.retail_amount)}</td>
                      <td className="pst-num">{money(row.wholesale_amount)}</td>
                      <td className="pst-num">{money(row.margin)}</td>
                      <td>{`${Math.round(marginPct(row))}%`}</td>
                      <td>
                        <span className={billedTone(billed)}>{billed}</span>
                      </td>
                      <td>
                        <button type="button" className="pst-view" onClick={() => setSelected(row)}>
                          <Icon>
                            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
                            <circle cx="12" cy="12" r="2.4" />
                          </Icon>
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="pst-empty">No statements match these filters.</p>
          )}
        </div>

        {filtered.length ? (
          <div className="pst-pager">
            <span>
              Showing {(safePage - 1) * PAGE_SIZE + 1} to {Math.min(safePage * PAGE_SIZE, filtered.length)} of{' '}
              {filtered.length} statements
            </span>
            <div className="pst-pages">
              <button type="button" className="pst-page" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>
                ‹
              </button>
              {pageNumbers(safePage, pageCount).map((n, idx, arr) => (
                <span key={n}>
                  {idx > 0 && n - arr[idx - 1] > 1 ? <span className="pst-page" aria-hidden>…</span> : null}
                  <button type="button" className={`pst-page${n === safePage ? ' is-on' : ''}`} onClick={() => setPage(n)}>
                    {n}
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="pst-page"
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                ›
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {selected ? (
        <div className="pst-backdrop" onClick={() => setSelected(null)}>
          <div className="pst-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>{selected.trf_id}</h2>
            <div className="pst-dl">
              <div>
                <span>Patient</span>
                <b>{selected.patient_name || '—'}</b>
              </div>
              <div>
                <span>Date & time</span>
                <b>{formatWhen(selected.created)}</b>
              </div>
              <div>
                <span>Test / package</span>
                <b>{selected.test || '—'}</b>
              </div>
              <div>
                <span>Billing type</span>
                <b>{selected.payment_method || '—'}</b>
              </div>
              <div>
                <span>Retail</span>
                <b>{money(selected.retail_amount)}</b>
              </div>
              <div>
                <span>Wholesale</span>
                <b>{money(selected.wholesale_amount)}</b>
              </div>
              <div>
                <span>Margin</span>
                <b>
                  {money(selected.margin)} ({Math.round(marginPct(selected))}%)
                </b>
              </div>
              <div>
                <span>Platform billed</span>
                <b>{billedLabel(selected)}</b>
              </div>
              <div>
                <span>Order status</span>
                <b>{selected.order_status || '—'}</b>
              </div>
            </div>
            <div className="pst-modal-actions">
              <button type="button" className="pst-btn is-primary" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
