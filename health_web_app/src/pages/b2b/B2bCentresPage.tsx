import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type B2bFocoCentreRow, type B2bFofoCommissionLine } from '../../api';
import './partner-centres-v2.css';

const PAGE_SIZE = 8;

function money(value: number) {
  return `₹${Math.round(value || 0).toLocaleString('en-IN')}`;
}

function formatDay(raw?: string) {
  if (!raw) return '—';
  const d = new Date(String(raw).slice(0, 10));
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusTone(status?: string) {
  const s = (status || '').toLowerCase();
  if (s.includes('active') || s === 'onboarded' || s === 'credited') return 'pcn-pill';
  if (s.includes('pending') || s.includes('onboard')) return 'pcn-pill is-warn';
  return 'pcn-pill is-mute';
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
    <svg className="pcn-spark" viewBox="0 0 88 28" aria-hidden>
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

export function B2bCentresPage() {
  const [centres, setCentres] = useState<B2bFocoCentreRow[]>([]);
  const [lines, setLines] = useState<B2bFofoCommissionLine[]>([]);
  const [profit, setProfit] = useState(0);
  const [pending, setPending] = useState(0);
  const [pct, setPct] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [territoryFilter, setTerritoryFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<B2bFocoCentreRow | null>(null);
  const [showMapHelp, setShowMapHelp] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [centresRes, commRes] = await Promise.all([
        api.getB2bFocoCentres(),
        api.getB2bFofoCommission().catch(() => null),
      ]);
      setCentres(centresRes.data.centres || []);
      setProfit(centresRes.data.profit_from_centre || 0);
      setPending(centresRes.data.pending_fofo_earnings || 0);
      setPct(centresRes.data.override_upsell_commission || 20);
      setLines(commRes?.data.lines || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load centres');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const lastSettlement = useMemo(() => {
    const map: Record<string, string> = {};
    for (const line of lines) {
      const day = (line.settlement_date || '').slice(0, 10);
      if (!day || !line.fofo) continue;
      if (!map[line.fofo] || day > map[line.fofo]) map[line.fofo] = day;
    }
    return map;
  }, [lines]);

  const statuses = useMemo(
    () => Array.from(new Set(centres.map((c) => c.onboarding_status).filter(Boolean) as string[])).sort(),
    [centres],
  );
  const territories = useMemo(
    () => Array.from(new Set(centres.map((c) => c.territory || '').filter(Boolean))).sort(),
    [centres],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return centres.filter((row) => {
      if (statusFilter && row.onboarding_status !== statusFilter) return false;
      if (territoryFilter && (row.territory || '') !== territoryFilter) return false;
      const last = lastSettlement[row.fofo] || '';
      if (fromDate && last && last < fromDate) return false;
      if (toDate && last && last > toDate) return false;
      if ((fromDate || toDate) && !last) return false;
      if (!q) return true;
      return [row.fofo_name, row.franchise_code, row.fofo, row.address, row.territory]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [centres, query, statusFilter, territoryFilter, fromDate, toDate, lastSettlement]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, territoryFilter, fromDate, toDate]);

  const selectedLines = useMemo(
    () => (selected ? lines.filter((l) => l.fofo === selected.fofo) : []),
    [selected, lines],
  );
  const selectedTotals = useMemo(() => {
    const credited = selectedLines
      .filter((l) => (l.status || '').toLowerCase().includes('credit'))
      .reduce((s, l) => s + (l.foco_earning || 0), 0);
    const pendingEarn = selectedLines
      .filter((l) => (l.status || '').toLowerCase().includes('pend'))
      .reduce((s, l) => s + (l.foco_earning || 0), 0);
    return {
      earning: selectedLines.reduce((s, l) => s + (l.foco_earning || 0), 0),
      credited: selected?.credited_earning || credited,
      pending: selected?.pending_earning || pendingEarn,
    };
  }, [selected, selectedLines]);

  function downloadReport() {
    const header = [
      'FOFO Centre',
      'Franchise Code',
      'Address',
      'Territory',
      'Onboarding',
      'Total FOFO Sales',
      'Net Business',
      'FOCO Earning',
      'Pending Earning',
      'Last Settlement',
      'Settlement Status',
    ];
    const body = filtered.map((row) =>
      [
        row.fofo_name,
        row.franchise_code || row.fofo,
        row.address || '',
        row.territory || '',
        row.onboarding_status || '',
        row.total_fofo_sales,
        row.net_business,
        row.foco_earning,
        row.pending_earning,
        lastSettlement[row.fofo] || '',
        row.settlement_status,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fofo-centres.csv';
    a.click();
    URL.revokeObjectURL(url);
    setMessage('Downloaded the current centre list.');
  }

  function downloadCentreLines() {
    if (!selected) return;
    const header = [
      'FOFO Centre',
      'Bill / TRF ID',
      'Bill Date',
      'MRP',
      'FOFO Margin',
      'Net Amount',
      'FOCO %',
      'FOCO Earning',
      'Settlement Date',
      'Status',
    ];
    const body = selectedLines.map((line) =>
      [
        line.fofo_name || selected.fofo_name,
        line.trf_id,
        line.bill_date || '',
        line.mrp,
        line.fofo_margin,
        line.net_amount,
        line.commission_percent,
        line.foco_earning,
        line.settlement_date || '',
        line.status,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selected.franchise_code || selected.fofo}-commission.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage(`Downloaded commission lines for ${selected.fofo_name}.`);
  }

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

  return (
    <div className="pcn">
      <div className="pcn-head">
        <h1>
          <span className="pcn-head-ico" aria-hidden>
            <Icon>
              <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
              <circle cx="12" cy="10" r="2.2" />
            </Icon>
          </span>
          Centres
        </h1>
        <p>
          FOFO centres mapped under this FOCO. Upsell commission is {pct}% of net (MRP − FOFO margin), from
          Franchisee Profile → Override Upsell Commission.
        </p>
      </div>

      <div className="pcn-stats">
        <article className="pcn-stat">
          <div className="pcn-stat-top">
            <span className="pcn-stat-ico">
              <Icon>
                <path d="M3 10.5 12 4l9 6.5" />
                <path d="M5 10v9h14v-9" />
                <path d="M10 19v-6h4v6" />
              </Icon>
            </span>
            <Spark color="#86efac" />
          </div>
          <span>Mapped FOFOs</span>
          <strong>{centres.length}</strong>
        </article>
        <article className="pcn-stat">
          <div className="pcn-stat-top">
            <span className="pcn-stat-ico is-blue">
              <Icon>
                <path d="M6 20V10" />
                <path d="M12 20V4" />
                <path d="M18 20v-7" />
              </Icon>
            </span>
            <Spark color="#93c5fd" />
          </div>
          <span>Profit From Centre</span>
          <strong>{money(profit)}</strong>
        </article>
        <article className="pcn-stat">
          <div className="pcn-stat-top">
            <span className="pcn-stat-ico is-amber">
              <Icon>
                <ellipse cx="12" cy="7" rx="7" ry="3" />
                <path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7" />
                <path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
              </Icon>
            </span>
            <Spark color="#fcd34d" />
          </div>
          <span>Pending FOFO Earnings</span>
          <strong>{money(pending)}</strong>
        </article>
        <article className="pcn-stat">
          <div className="pcn-stat-top">
            <span className="pcn-stat-ico is-violet">
              <Icon>
                <circle cx="12" cy="12" r="8" />
                <path d="M12 8v8" />
                <path d="M9.5 10.5c.6-1 1.6-1.5 2.5-1.5s1.8.4 2.3 1.2c.4.7.3 1.7-.4 2.3L12 14" />
              </Icon>
            </span>
            <Spark color="#c4b5fd" />
          </div>
          <span>Override Upsell %</span>
          <strong>{pct}%</strong>
        </article>
      </div>

      <div className="pcn-toolbar">
        <label className="pcn-search">
          <Icon>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </Icon>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search centre name, franchise code, address…"
            aria-label="Search centres"
          />
        </label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Onboarding status">
          <option value="">Onboarding Status</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={territoryFilter} onChange={(e) => setTerritoryFilter(e.target.value)} aria-label="Territory">
          <option value="">Territory / Location</option>
          {territories.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="From date" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="To date" />
        <button type="button" className="pcn-icon-btn" onClick={() => void load()} aria-label="Refresh">
          <Icon>
            <path d="M20 12a8 8 0 1 1-2.2-5.5" />
            <path d="M20 4v5h-5" />
          </Icon>
        </button>
      </div>

      <div className="pcn-map-row">
        <button type="button" className="pcn-btn is-primary" onClick={() => setShowMapHelp((v) => !v)}>
          <Icon>
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </Icon>
          Map New FOFO Centre
        </button>
      </div>

      {showMapHelp ? (
        <div className="pcn-alert is-ok">
          New FOFO centres appear here after they are mapped under this FOCO in Franchise Directory. This portal does
          not create the mapping.
        </div>
      ) : null}
      {message ? <div className="pcn-alert is-ok">{message}</div> : null}
      {error ? <div className="pcn-alert is-err">{error}</div> : null}

      <section className="pcn-card">
        <div className="pcn-card-head">
          <div>
            <h2>
              <Icon>
                <path d="M3 10.5 12 4l9 6.5" />
                <path d="M5 10v9h14v-9" />
              </Icon>
              FOFO Centres
            </h2>
            <p>List of FOFO centres mapped to this FOCO with sales, earnings and settlement details.</p>
          </div>
          <button type="button" className="pcn-btn" onClick={downloadReport} disabled={!filtered.length}>
            <Icon>
              <path d="M12 4v11" />
              <path d="m8 11 4 4 4-4" />
              <path d="M5 19h14" />
            </Icon>
            Download Report
          </button>
        </div>

        <div className="pcn-table-wrap">
          {loading ? (
            <p className="pcn-empty">Loading mapped FOFO centres…</p>
          ) : pageRows.length ? (
            <table className="pcn-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>FOFO Centre</th>
                  <th>Franchise Code</th>
                  <th>Address / Territory</th>
                  <th>Onboarding Status</th>
                  <th>Total FOFO Sales</th>
                  <th>Net Business</th>
                  <th>FOCO Earning</th>
                  <th>Pending Earning</th>
                  <th>Last Settlement</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, i) => (
                  <tr key={row.fofo}>
                    <td>{(safePage - 1) * PAGE_SIZE + i + 1}</td>
                    <td>
                      <div className="pcn-name">{row.fofo_name}</div>
                      <small>{row.fofo}</small>
                    </td>
                    <td>{row.franchise_code || row.fofo}</td>
                    <td>
                      {row.address || row.territory || '—'}
                      {row.territory && row.address && row.address !== row.territory ? (
                        <>
                          <br />
                          <small>{row.territory}</small>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <span className={statusTone(row.onboarding_status)}>{row.onboarding_status || '—'}</span>
                    </td>
                    <td className="pcn-num">{money(row.total_fofo_sales)}</td>
                    <td className="pcn-num">{money(row.net_business)}</td>
                    <td className="pcn-num">{money(row.foco_earning)}</td>
                    <td className="pcn-num">{money(row.pending_earning)}</td>
                    <td>{formatDay(lastSettlement[row.fofo])}</td>
                    <td>
                      <button type="button" className="pcn-view" onClick={() => setSelected(row)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="pcn-empty">No FOFO centres match these filters.</p>
          )}
        </div>

        {filtered.length ? (
          <div className="pcn-pager">
            <span>
              Showing {(safePage - 1) * PAGE_SIZE + 1} to {Math.min(safePage * PAGE_SIZE, filtered.length)} of{' '}
              {filtered.length} centres
            </span>
            <div className="pcn-pages">
              <button type="button" className="pcn-page" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>
                ‹
              </button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`pcn-page${n === safePage ? ' is-on' : ''}`}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                className="pcn-page"
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
        <div className="pcn-backdrop" onClick={() => setSelected(null)}>
          <div className="pcn-modal is-wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="pcn-card-head">
              <div>
                <h2>{selected.fofo_name}</h2>
                <p>
                  Bill-wise FOFO → FOCO upsell. Net = MRP − FOFO margin. Earning = Override Upsell Commission ({pct}%)
                  of net. Pending items credit the FOCO wallet after 7 days.
                </p>
              </div>
              <button type="button" className="pcn-btn" onClick={downloadCentreLines} disabled={!selectedLines.length}>
                Download Report
              </button>
            </div>
            <div className="pcn-dl">
              <div>
                <span>Franchise code</span>
                <b>{selected.franchise_code || selected.fofo}</b>
              </div>
              <div>
                <span>Onboarding</span>
                <b>{selected.onboarding_status || '—'}</b>
              </div>
              <div>
                <span>Address</span>
                <b>{selected.address || '—'}</b>
              </div>
              <div>
                <span>Territory</span>
                <b>{selected.territory || '—'}</b>
              </div>
              <div>
                <span>Total FOFO sales</span>
                <b>{money(selected.total_fofo_sales)}</b>
              </div>
              <div>
                <span>Net business</span>
                <b>{money(selected.net_business)}</b>
              </div>
              <div>
                <span>FOCO earning</span>
                <b>{money(selected.foco_earning || selectedTotals.earning)}</b>
              </div>
              <div>
                <span>Pending earning</span>
                <b>{money(selectedTotals.pending)}</b>
              </div>
              <div>
                <span>Credited</span>
                <b>{money(selectedTotals.credited)}</b>
              </div>
              <div>
                <span>Override upsell %</span>
                <b>{pct}%</b>
              </div>
              <div>
                <span>Last settlement</span>
                <b>{formatDay(lastSettlement[selected.fofo])}</b>
              </div>
              <div>
                <span>Settlement status</span>
                <b>{selected.settlement_status || '—'}</b>
              </div>
            </div>
            <h3>FOFO commission lines</h3>
            {selectedLines.length ? (
              <div className="pcn-table-wrap">
                <table className="pcn-table" style={{ minWidth: 920 }}>
                  <thead>
                    <tr>
                      <th>FOFO Centre</th>
                      <th>Bill / TRF ID</th>
                      <th>Bill Date</th>
                      <th>MRP</th>
                      <th>FOFO Margin</th>
                      <th>Net Amount</th>
                      <th>FOCO %</th>
                      <th>FOCO Earning</th>
                      <th>Settlement Date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedLines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.fofo_name || selected.fofo_name}</td>
                        <td>{line.trf_id}</td>
                        <td>{formatDay(line.bill_date)}</td>
                        <td className="pcn-num">{money(line.mrp)}</td>
                        <td className="pcn-num">{money(line.fofo_margin)}</td>
                        <td className="pcn-num">{money(line.net_amount)}</td>
                        <td>{line.commission_percent}%</td>
                        <td className="pcn-num">{money(line.foco_earning)}</td>
                        <td>{formatDay(line.settlement_date)}</td>
                        <td>
                          <span className={statusTone(line.status)}>{line.status || '—'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="pcn-empty">No commission rows for this centre yet.</p>
            )}
            <div className="pcn-modal-actions">
              <button type="button" className="pcn-btn is-primary" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
