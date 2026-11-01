import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type B2bFofoCommissionLine,
  type Booking,
  type ExpenseClaimRow,
  type FranchiseeProfile,
  type StaffPerformanceHub,
  type TrainingEventRow,
} from '../../api';
import { MarkOfflinePaymentButton, type OfflinePaymentResult } from '../../components/MarkOfflinePaymentButton';
import { isOnlinePayment, paymentMethodLabel } from '../../components/PaymentMethodPicker';
import type { FranchiseeKpiResponse } from '../../types/franchiseeKpi';
import bannerPhoto from '../../assets/partner-community.jpg';
import './partner-hub-v2.css';

const PAGE_SIZE = 5;
const PIPELINE_ORDER = ['Booked', 'Sample Collected', 'In Lab', 'Completed', 'Cancelled'] as const;

type PeriodKey = 'today' | '7d' | '30d' | '90d';
type TrfTab = 'all' | 'pending' | 'completed' | 'cancelled';
type ModalKind = 'tests' | 'staff' | 'training' | 'income' | null;

type StaffRow = {
  employee: string;
  employee_name?: string;
  designation?: string;
  today_status?: string;
};

function money(value?: number) {
  return `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
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

function prettyDay(raw?: string) {
  if (!raw) return '';
  const d = new Date(`${String(raw).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function dayKey(raw?: string) {
  return (raw || '').slice(0, 10);
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      {children}
    </svg>
  );
}

function staffBucket(designation?: string) {
  const d = (designation || '').toLowerCase();
  if (d.includes('phlebo')) return 'Phlebotomist';
  if (d.includes('reception') || d.includes('front office') || d.includes('front-office')) return 'Receptionist';
  if (d.includes('lab')) return 'Lab Technician';
  return 'Others';
}

function statusTone(status?: string) {
  const s = (status || '').toLowerCase();
  if (s.includes('complete') || s.includes('dispatched') || s === 'paid') return 'phb-pill';
  if (s.includes('cancel')) return 'phb-pill is-mute';
  if (s.includes('lab') || s.includes('collect')) return 'phb-pill is-info';
  return 'phb-pill is-warn';
}

function payLabel(row: Booking) {
  const method = paymentMethodLabel(row.payment_method) || '—';
  const paid = (row.razorpay_payment_status || '').toLowerCase() === 'paid';
  return `${method} · ${paid ? 'Paid' : row.razorpay_payment_status || 'Pending'}`;
}

function payTone(row: Booking) {
  return (row.razorpay_payment_status || '').toLowerCase() === 'paid' ? 'phb-pill' : 'phb-pill is-warn';
}

function testName(row: Booking) {
  return row.test_name || row.test_labels?.join(', ') || row.test_required || '—';
}

function pageNumbers(current: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, 2, total - 1, total, current - 1, current, current + 1]);
  return [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
}

function RevenueChart({
  paid,
  pending,
}: {
  paid: Array<{ date: string; revenue: number }>;
  pending: number;
}) {
  const w = 360;
  const h = 120;
  const pad = 10;
  const values = paid.map((p) => p.revenue);
  const max = Math.max(1, ...values, pending);
  function line(nums: number[], color: string) {
    if (!nums.length) return null;
    const pts = nums.map((v, i) => {
      const x = pad + (i * (w - pad * 2)) / Math.max(nums.length - 1, 1);
      const y = h - pad - (v / max) * (h - pad * 2);
      return `${x},${y}`;
    });
    return <polyline fill="none" stroke={color} strokeWidth="2" points={pts.join(' ')} />;
  }
  const pendingLine = values.map(() => pending);
  return (
    <svg className="phb-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Paid versus pending revenue">
      {line(pendingLine, '#fbbf24')}
      {line(values, '#0f766e')}
    </svg>
  );
}

export function B2bHubDashboardPage() {
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const [kpis, setKpis] = useState<FranchiseeKpiResponse | null>(null);
  const [hub, setHub] = useState<FranchiseeProfile | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [fofoLines, setFofoLines] = useState<B2bFofoCommissionLine[]>([]);
  const [fofoTotal, setFofoTotal] = useState(0);
  const [fofoPending, setFofoPending] = useState(0);
  const [training, setTraining] = useState<StaffPerformanceHub | null>(null);
  const [policies, setPolicies] = useState<Array<{ name: string; slug: string }>>([]);
  const [expenses, setExpenses] = useState<ExpenseClaimRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<TrfTab>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);

  const load = useCallback(async (p: PeriodKey) => {
    setLoading(true);
    setError(null);
    try {
      const [kpiRes, portalRes, bookRes, staffRes, fofoRes, trainRes, policyRes, hrRes] = await Promise.all([
        api.getFranchiseeKpis({ period: p }),
        api.getB2bPortal().catch(() => null),
        api.getMyBookings(80).catch(() => null),
        api.getFranchiseTeamAttendance().catch(() => null),
        api.getB2bFofoCommission().catch(() => null),
        api.getStaffPerformanceHub().catch(() => null),
        api.listHrPolicySnippets().catch(() => null),
        api.getHrSelfService().catch(() => null),
      ]);
      setKpis(kpiRes.data);
      setHub(portalRes?.data.franchisee || null);
      setBookings(bookRes?.data.bookings || []);
      setStaff(staffRes?.data.employees || []);
      setFofoLines(fofoRes?.data.lines || []);
      setFofoTotal(fofoRes?.data.summary?.profit_from_centre || 0);
      setFofoPending(fofoRes?.data.summary?.pending_fofo_earnings || 0);
      setTraining(trainRes?.data || null);
      setPolicies((policyRes?.data.policies || []).map((row) => ({ name: row.name, slug: row.slug })));
      setExpenses(hrRes?.data.expense_claims || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load hub dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  useEffect(() => {
    if (!selected && !modal) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSelected(null);
        setModal(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [selected, modal]);

  const periods = kpis?.periods?.length
    ? kpis.periods
    : [
        { key: 'today', label: 'Today' },
        { key: '7d', label: 'Last 7 days' },
        { key: '30d', label: 'Last 30 days' },
        { key: '90d', label: 'Last 90 days' },
      ];

  const startDay = kpis?.start_date || '';
  const rangeLabel = startDay ? `${prettyDay(startDay)} – ${prettyDay(new Date().toISOString())}` : 'All time';

  const scopedBookings = useMemo(() => {
    return bookings.filter((row) => {
      const day = dayKey(row.creation);
      if (startDay && day && day < startDay) return false;
      return true;
    });
  }, [bookings, startDay]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scopedBookings.filter((row) => {
      const status = (row.order_status || '').toLowerCase();
      const paid = (row.razorpay_payment_status || '').toLowerCase() === 'paid';
      if (tab === 'pending' && paid) return false;
      if (tab === 'completed' && !status.includes('complete')) return false;
      if (tab === 'cancelled' && !status.includes('cancel')) return false;
      if (!q) return true;
      return [row.trf_id, row.patient_name, testName(row)].join(' ').toLowerCase().includes(q);
    });
  }, [scopedBookings, query, tab]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [query, tab, period]);

  const pipeline = kpis?.pipeline ?? {};
  const pipelineMax = Math.max(1, ...Object.values(pipeline));
  const kpi = kpis?.kpis;
  const commissionRate = hub?.commission_percentage_rate ?? kpis?.franchisee.commission_rate;
  const operatingExpenses = expenses.reduce((sum, row) => sum + Number(row.total_claimed_amount || 0), 0);
  const netIncome = Math.max(0, Number(kpi?.revenue_paid || 0) - Number(kpi?.commission_earned || 0));
  const staffCounts = useMemo(() => {
    const counts = { Phlebotomist: 0, Receptionist: 0, 'Lab Technician': 0, Others: 0 };
    for (const row of staff) counts[staffBucket(row.designation)] += 1;
    return counts;
  }, [staff]);
  const events = (training?.training_events || []) as TrainingEventRow[];
  const programs = training?.training_programs || [];

  function onCollected(trfId: string, result: OfflinePaymentResult) {
    const billing = result?.hub_billing;
    if (billing?.status === 'pending') {
      setNotice(`${trfId}: payment recorded. Wallet will cover the platform fee after recharge.`);
    } else if (billing?.status === 'billed') {
      const fee = Number(billing.wholesale_amount || 0);
      setNotice(`${trfId}: payment recorded.${fee > 0 ? ` Platform fee ₹${fee.toFixed(0)} taken from wallet.` : ''}`);
    } else {
      setNotice(`${trfId}: payment recorded.`);
    }
    setSelected(null);
    void load(period);
  }

  function downloadReport() {
    const header = ['TRF', 'Patient', 'Test', 'Status', 'Amount', 'Payment', 'Date'];
    const body = filtered.map((row) =>
      [row.trf_id, row.patient_name || '', testName(row), row.order_status || '', row.amount || 0, payLabel(row), row.creation || '']
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hub-trfs.csv';
    a.click();
    URL.revokeObjectURL(url);
    setNotice(`Downloaded ${filtered.length} TRF${filtered.length === 1 ? '' : 's'}.`);
  }

  const hubName = hub?.franchise_name || kpis?.franchisee.franchise_name || 'Partner hub';
  const branchBits = [
    hub?.branch_code ? `Branch: ${hub.branch_code}` : '',
    hub?.territory_region || kpis?.franchisee.territory_region || '',
  ]
    .filter(Boolean)
    .join(' · ');
  const contactBits = [hub?.contact_phone, hub?.contact_email].filter(Boolean).join(' · ');

  return (
    <div className="phb">
      <section className="phb-hero">
        <div>
          <h1>
            <span className="phb-hero-ico" aria-hidden>
              <Icon>
                <path d="M3 21h18" />
                <path d="M5 21V8l7-4 7 4v13" />
                <path d="M9 21v-6h6v6" />
              </Icon>
            </span>
            {hubName}
          </h1>
          <p>{branchBits || 'Branch details pending from Franchise Directory'}</p>
          {contactBits ? <p>{contactBits}</p> : null}
        </div>
        <div className="phb-hero-visual" aria-hidden style={{ backgroundImage: `url(${bannerPhoto})` }}>
          <img src={bannerPhoto} alt="" />
          <div>
            <strong>Together for Healthier Communities</strong>
            <small>Fair Price · Accurate Reports · Trusted Network</small>
          </div>
        </div>
      </section>

      <div className="phb-period">
        <div className="phb-pills">
          <span>Period</span>
          {periods.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`phb-pill-btn${period === item.key ? ' is-on' : ''}`}
              onClick={() => setPeriod(item.key as PeriodKey)}
              disabled={loading && period === item.key}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="phb-range">{rangeLabel}</div>
      </div>

      {error ? <div className="phb-alert is-err">{error}</div> : null}
      {notice ? <div className="phb-alert is-ok">{notice}</div> : null}

      <div className="phb-stats">
        {[
          ['Revenue (Paid)', money(kpi?.revenue_paid)],
          ['Pending Revenue', money(kpi?.revenue_pending)],
          ['Commission Earned', money(kpi?.commission_earned)],
          ['Bookings', String(kpi?.total_bookings ?? 0)],
          ['Completed', String(kpi?.completed ?? 0)],
          ['Avg Order Value', money(kpi?.avg_order_value)],
          ['Paid Conversion', kpi?.conversion_rate != null ? `${kpi.conversion_rate}%` : '—'],
          ['Commission Rate', commissionRate != null ? `${commissionRate}%` : '—'],
        ].map(([label, value]) => (
          <article key={label} className="phb-stat">
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

      <div className="phb-quad">
        <section className="phb-card">
          <h2>Order Pipeline</h2>
          <p>Current status of orders at your hub.</p>
          {PIPELINE_ORDER.every((stage) => !pipeline[stage]) ? (
            <p className="phb-empty">No bookings in this period.</p>
          ) : (
            <div className="phb-pipe">
              {PIPELINE_ORDER.map((stage) => (
                <div key={stage}>
                  <div className="phb-pipe-row">
                    <span>{stage}</span>
                    <b>{pipeline[stage] || 0}</b>
                  </div>
                  <div className="phb-bar">
                    <i style={{ width: `${((pipeline[stage] || 0) / pipelineMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="phb-card">
          <div className="phb-card-head">
            <div>
              <h2>Top Tests</h2>
              <p>Most ordered tests in this period.</p>
            </div>
            <button type="button" className="phb-link" onClick={() => setModal('tests')} disabled={!kpis?.top_tests.length}>
              View All
            </button>
          </div>
          {kpis?.top_tests.length ? (
            <ol className="phb-tests">
              {kpis.top_tests.slice(0, 5).map((row) => (
                <li key={row.test}>
                  <span>{row.test}</span>
                  <div>
                    <i style={{ width: `${(row.count / Math.max(1, kpis.top_tests[0].count)) * 100}%` }} />
                  </div>
                  <b>{row.count}</b>
                </li>
              ))}
            </ol>
          ) : (
            <p className="phb-empty">No test data in this period.</p>
          )}
        </section>

        <section className="phb-card">
          <h2>Revenue Overview</h2>
          <p>Paid versus pending revenue for this period.</p>
          <RevenueChart paid={kpis?.revenue_trend || []} pending={kpi?.revenue_pending || 0} />
          <div className="phb-legend">
            <span>
              <i className="is-paid" /> Paid {money(kpi?.revenue_paid)}
            </span>
            <span>
              <i className="is-pend" /> Pending {money(kpi?.revenue_pending)}
            </span>
          </div>
        </section>

        <section className="phb-card">
          <div className="phb-card-head">
            <div>
              <h2>Staff Allotted to My Hub</h2>
              <p>Active employees attached to this franchisee.</p>
            </div>
            <button type="button" className="phb-link" onClick={() => setModal('staff')} disabled={!staff.length}>
              View All
            </button>
          </div>
          <ul className="phb-staff">
            {Object.entries(staffCounts).map(([role, count]) => (
              <li key={role}>
                <span>{role}</span>
                <b>{count}</b>
                <small>{count ? 'Active' : '—'}</small>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="phb-triple">
        <section className="phb-card">
          <div className="phb-card-head">
            <div>
              <h2>Training & Resource</h2>
              <p>Live training, policies and events for this login.</p>
            </div>
            <button type="button" className="phb-link" onClick={() => setModal('training')}>
              View All
            </button>
          </div>
          <div className="phb-train">
            <article>
              <strong>Training Videos</strong>
              <small>{events.length || programs.length} assigned</small>
              <button type="button" className="phb-link" onClick={() => setModal('training')}>
                Watch / View
              </button>
            </article>
            <article>
              <strong>SOP Documents</strong>
              <small>No SOP library API on this portal</small>
            </article>
            <article>
              <strong>Marketing Material</strong>
              <small>No marketing file API on this portal</small>
            </article>
            <article>
              <strong>Policy & Guidelines</strong>
              <small>{policies.length} published</small>
              <button type="button" className="phb-link" onClick={() => setModal('training')} disabled={!policies.length}>
                View
              </button>
            </article>
          </div>
        </section>

        <section className="phb-card">
          <div className="phb-card-head">
            <div>
              <h2>FOFO Commission</h2>
              <p>Upsell from mapped FOFO centres.</p>
            </div>
            <Link className="phb-link" to="/b2b/centres">
              View Centres
            </Link>
          </div>
          <div className="phb-pair">
            <div>
              <span>Total FOFO Commission</span>
              <strong>{money(fofoTotal)}</strong>
            </div>
            <div>
              <span>Pending Commission</span>
              <strong>{money(fofoPending)}</strong>
            </div>
          </div>
          <p className="phb-empty">{fofoLines.length} bill-wise commission line{fofoLines.length === 1 ? '' : 's'}.</p>
        </section>

        <section className="phb-card">
          <div className="phb-card-head">
            <div>
              <h2>Net Income</h2>
              <p>Paid revenue minus commission earned.</p>
            </div>
            <button type="button" className="phb-link" onClick={() => setModal('income')}>
              View Details
            </button>
          </div>
          <div className="phb-pair">
            <div>
              <span>Net income (after commission)</span>
              <strong>{money(netIncome)}</strong>
            </div>
            <div>
              <span>Operating Expenses</span>
              <strong>{money(operatingExpenses)}</strong>
            </div>
          </div>
        </section>
      </div>

      <section className="phb-card phb-table-card">
        <div className="phb-table-head">
          <div className="phb-tabs">
            {(
              [
                ['all', `TRFs at Your Hub`],
                ['pending', 'Pending Payments'],
                ['completed', 'Completed Orders'],
                ['cancelled', 'Cancelled Orders'],
              ] as Array<[TrfTab, string]>
            ).map(([key, label]) => (
              <button key={key} type="button" className={`phb-tab${tab === key ? ' is-on' : ''}`} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>
          <div className="phb-table-tools">
            <label className="phb-search">
              <Icon>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </Icon>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by patient, TRF or test name…"
                aria-label="Search TRFs"
              />
            </label>
            <button type="button" className="phb-btn" onClick={() => void load(period)}>
              Refresh
            </button>
            <button type="button" className="phb-btn is-primary" onClick={downloadReport} disabled={!filtered.length}>
              Download Report
            </button>
          </div>
        </div>

        <div className="phb-table-wrap">
          {loading && !pageRows.length ? (
            <p className="phb-empty">Loading hub TRFs…</p>
          ) : pageRows.length ? (
            <table className="phb-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>TRF No.</th>
                  <th>Patient Name</th>
                  <th>Test / Package</th>
                  <th>Status</th>
                  <th>Amount (₹)</th>
                  <th>Payment</th>
                  <th>Date & Time</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, i) => (
                  <tr key={row.trf_id}>
                    <td>{(safePage - 1) * PAGE_SIZE + i + 1}</td>
                    <td>{row.trf_id}</td>
                    <td>{row.patient_name || '—'}</td>
                    <td>{testName(row)}</td>
                    <td>
                      <span className={statusTone(row.order_status)}>{row.order_status || '—'}</span>
                    </td>
                    <td>{money(row.amount)}</td>
                    <td>
                      <span className={payTone(row)}>{payLabel(row)}</span>
                    </td>
                    <td>{formatWhen(row.creation)}</td>
                    <td>
                      <button type="button" className="phb-view" onClick={() => setSelected(row)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="phb-empty">No TRFs match these filters.</p>
          )}
        </div>

        {filtered.length ? (
          <div className="phb-pager">
            <span>
              Showing {(safePage - 1) * PAGE_SIZE + 1} to {Math.min(safePage * PAGE_SIZE, filtered.length)} of{' '}
              {filtered.length} TRFs
            </span>
            <div className="phb-pages">
              <button type="button" className="phb-page" disabled={safePage <= 1} onClick={() => setPage((n) => n - 1)}>
                ‹
              </button>
              {pageNumbers(safePage, pageCount).map((n, idx, arr) => (
                <span key={n}>
                  {idx > 0 && n - arr[idx - 1] > 1 ? <span className="phb-page">…</span> : null}
                  <button type="button" className={`phb-page${n === safePage ? ' is-on' : ''}`} onClick={() => setPage(n)}>
                    {n}
                  </button>
                </span>
              ))}
              <button type="button" className="phb-page" disabled={safePage >= pageCount} onClick={() => setPage((n) => n + 1)}>
                ›
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {selected ? (
        <div className="phb-backdrop" onClick={() => setSelected(null)}>
          <div className="phb-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>{selected.trf_id}</h2>
            <div className="phb-dl">
              <div>
                <span>Patient</span>
                <b>{selected.patient_name || '—'}</b>
              </div>
              <div>
                <span>Test</span>
                <b>{testName(selected)}</b>
              </div>
              <div>
                <span>Status</span>
                <b>{selected.order_status || '—'}</b>
              </div>
              <div>
                <span>Amount</span>
                <b>{money(selected.amount)}</b>
              </div>
              <div>
                <span>Payment</span>
                <b>{payLabel(selected)}</b>
              </div>
              <div>
                <span>Date & time</span>
                <b>{formatWhen(selected.creation)}</b>
              </div>
            </div>
            {!isOnlinePayment(selected.payment_method) &&
            selected.razorpay_payment_status !== 'Paid' &&
            selected.order_status !== 'Cancelled' &&
            Number(selected.amount || 0) > 0 ? (
              <MarkOfflinePaymentButton
                referenceDoctype="Customer TRF"
                referenceName={selected.trf_id}
                label="Payment received"
                className="phb-btn is-primary"
                onSuccess={(result) => onCollected(selected.trf_id, result)}
              />
            ) : null}
            <div className="phb-modal-actions">
              <Link className="phb-btn" to="/b2b/bill-status">
                Open in Bill Status
              </Link>
              <button type="button" className="phb-btn is-primary" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modal ? (
        <div className="phb-backdrop" onClick={() => setModal(null)}>
          <div className="phb-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            {modal === 'tests' ? (
              <>
                <h2>Top tests</h2>
                {kpis?.top_tests.length ? (
                  <ol className="phb-tests">
                    {kpis.top_tests.map((row) => (
                      <li key={row.test}>
                        <span>{row.test}</span>
                        <b>{row.count}</b>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="phb-empty">No tests in this period.</p>
                )}
              </>
            ) : null}
            {modal === 'staff' ? (
              <>
                <h2>Staff allotted</h2>
                {staff.length ? (
                  <ul className="phb-staff-list">
                    {staff.map((row) => (
                      <li key={row.employee}>
                        <b>{row.employee_name || row.employee}</b>
                        <span>
                          {row.designation || '—'} · {row.today_status || 'Active'}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="phb-empty">No employees are attached to this hub yet.</p>
                )}
              </>
            ) : null}
            {modal === 'training' ? (
              <>
                <h2>Training & resources</h2>
                <h3>Events</h3>
                {events.length ? (
                  <ul className="phb-staff-list">
                    {events.map((row) => (
                      <li key={row.name}>
                        <b>{row.event_name || row.name}</b>
                        <span>
                          {row.event_status || '—'} · {formatWhen(row.start_time)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="phb-empty">No training events assigned.</p>
                )}
                <h3>Programs</h3>
                {programs.length ? (
                  <ul className="phb-staff-list">
                    {programs.map((row) => (
                      <li key={row.name}>
                        <b>{row.training_program || row.name}</b>
                        <span>{row.description || '—'}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="phb-empty">No training programs assigned.</p>
                )}
                <h3>Policies</h3>
                {policies.length ? (
                  <ul className="phb-staff-list">
                    {policies.map((row) => (
                      <li key={row.slug || row.name}>
                        <b>{row.name}</b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="phb-empty">No policy snippets published.</p>
                )}
              </>
            ) : null}
            {modal === 'income' ? (
              <>
                <h2>Net income</h2>
                <div className="phb-dl">
                  <div>
                    <span>Paid revenue</span>
                    <b>{money(kpi?.revenue_paid)}</b>
                  </div>
                  <div>
                    <span>Commission earned</span>
                    <b>{money(kpi?.commission_earned)}</b>
                  </div>
                  <div>
                    <span>Net after commission</span>
                    <b>{money(netIncome)}</b>
                  </div>
                  <div>
                    <span>Operating expenses (HR claims)</span>
                    <b>{money(operatingExpenses)}</b>
                  </div>
                </div>
              </>
            ) : null}
            <div className="phb-modal-actions">
              <button type="button" className="phb-btn is-primary" onClick={() => setModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
