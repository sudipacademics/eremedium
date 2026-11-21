import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../icons';
import { useApi, useCare, withQuery } from '../store';
import type { Appointment, Item, StockAlert } from '../types';
import { apptLabel, fmtTime, inr, num, TYPE_LABEL } from '../format';
import { Empty, ErrorNote, Pill, Tabs, TypePill } from './ui';
import { RevenueChart, SERIES, type RevenueDay } from './RevenueChart';

type Kpi = { value: number; delta: number; new?: number; amount?: number; count?: number };

type DashboardData = {
  range: number;
  today: string;
  kpis: Record<'patients' | 'consultations' | 'physiotherapy' | 'lab' | 'invoices' | 'pharmacy', Kpi>;
  todayAppointments: (Appointment & { total_sessions: number | null })[];
  revenue: { total: number; delta: number; totals: Record<string, number>; days: RevenueDay[] };
  queue: { type: string; total: number; active: number }[];
  recentInvoices: { id: number; number: string; service_type: string; total: number; status: string; patient: string }[];
  alerts: StockAlert[];
};

function Delta({ value, label }: { value: number; label?: string }) {
  const up = value >= 0;
  return (
    <small className={`delta ${up ? 'up' : 'down'}`}>
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={13} strokeWidth={2.4} />
      {up ? '+' : ''}
      {value}%{label && <span className="muted"> {label}</span>}
    </small>
  );
}

const KPI_CARDS: { key: keyof DashboardData['kpis']; label: string; icon: IconName; tone: string; money?: boolean }[] = [
  { key: 'patients', label: 'Total Patients', icon: 'users', tone: 'green' },
  { key: 'consultations', label: 'Consultations', icon: 'calendar', tone: 'blue' },
  { key: 'physiotherapy', label: 'Physiotherapy Sessions', icon: 'bed', tone: 'purple' },
  { key: 'lab', label: 'Lab Test Bookings', icon: 'flask', tone: 'pink' },
  { key: 'invoices', label: 'Invoices Generated', icon: 'invoice', tone: 'orange' },
  { key: 'pharmacy', label: 'Pharmacy Sales', icon: 'pill', tone: 'teal', money: true },
];

const QUEUE_META: Record<string, { icon: IconName; tone: string; active: string; to: string }> = {
  consultation: { icon: 'users', tone: 'green', active: 'In Progress', to: '/appointments/consultation' },
  physiotherapy: { icon: 'physio', tone: 'purple', active: 'In Progress', to: '/appointments/physiotherapy' },
  lab: { icon: 'flask', tone: 'blue', active: 'Sample Pending', to: '/lab' },
  diagnostic: { icon: 'scan', tone: 'teal', active: 'Report Pending', to: '/diagnostics' },
  pharmacy: { icon: 'cart', tone: 'orange', active: 'In Billing', to: '/billing?type=pharmacy' },
};

function alertLabel(a: StockAlert) {
  if (a.level === 'out') return 'Out of Stock';
  if (a.level === 'low') return `Low Stock (${a.stock} left)`;
  if (a.level === 'expired') return 'Expired';
  if (a.level === 'expiry') return 'Expiring Soon';
  return 'Reorder Now';
}

export function Dashboard() {
  const { branch, can, openModal, meta } = useCare();
  const navigate = useNavigate();
  const [range, setRange] = useState(30);
  const [tab, setTab] = useState<'all' | 'consultation' | 'physiotherapy' | 'lab' | 'diagnostic'>('all');
  const { data, error } = useApi<DashboardData>(withQuery('/dashboard', { range, branch }));

  const clinic = meta?.settings.clinic_name || 'Remedium Care';
  const appts = data?.todayAppointments || [];
  const visible = appts.filter((a) => tab === 'all' || a.type === tab);
  const count = (t: string) => appts.filter((a) => a.type === t).length;
  const k = data?.kpis;
  const todayLabel = data ? new Date(`${data.today}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';

  const actions: { label: string; icon: IconName; tone: string; show: boolean; run: () => void }[] = [
    { label: 'New Patient', icon: 'userPlus', tone: 'green', show: can('Patients', 'create'), run: () => openModal({ kind: 'patient' }) },
    { label: 'Book Consultation', icon: 'calendar', tone: 'blue', show: can('Appointments', 'create'), run: () => openModal({ kind: 'appointment', type: 'consultation' }) },
    { label: 'Book Physiotherapy', icon: 'bed', tone: 'purple', show: can('Appointments', 'create'), run: () => openModal({ kind: 'plan' }) },
    { label: 'Book Lab Test', icon: 'flask', tone: 'pink', show: can('Test & Lab', 'create'), run: () => openModal({ kind: 'appointment', type: 'lab' }) },
    { label: 'Book Diagnostic', icon: 'scan', tone: 'teal', show: can('Diagnostics', 'create'), run: () => openModal({ kind: 'appointment', type: 'diagnostic' }) },
    { label: 'Generate Invoice', icon: 'invoice', tone: 'orange', show: can('Billing & Invoice', 'create'), run: () => openModal({ kind: 'invoice' }) },
    { label: 'Pharmacy Sale', icon: 'pill', tone: 'green', show: can('Pharmacy', 'create'), run: () => openModal({ kind: 'invoice', type: 'pharmacy' }) },
    { label: 'Add Inventory', icon: 'box', tone: 'teal', show: can('Inventory Management', 'create'), run: () => openModal({ kind: 'item' }) },
  ];

  return (
    <div className="dashboard">
      <section className="welcome card">
        <span className="welcome-mark">
          <Icon name="cross" size={30} strokeWidth={0} fill="currentColor" />
        </span>
        <div>
          <h1>
            Welcome to <span>{clinic}</span>
          </h1>
          <p>Clinic Operations, Physiotherapy, Diagnostics &amp; Pharmacy – All in One Place</p>
        </div>
      </section>

      {error && <ErrorNote text={error} />}

      <section className="kpis">
        {KPI_CARDS.map((card) => {
          const kpi = k?.[card.key];
          return (
            <div key={card.key} className={`kpi kpi-${card.tone}`}>
              <span className="kpi-icon">
                <Icon name={card.icon} size={24} />
              </span>
              <div>
                <p>{card.label}</p>
                <strong>{kpi ? (card.money ? inr(kpi.value) : num(kpi.value)) : '—'}</strong>
                {kpi && card.key === 'invoices' && <small className="kpi-sub">{inr(kpi.amount)}</small>}
                {kpi && <Delta value={kpi.delta} label={card.key === 'patients' ? `vs last ${data?.range} days` : undefined} />}
              </div>
            </div>
          );
        })}
      </section>

      <section className="quick card">
        <h2>Quick Actions</h2>
        <div className="quick-list">
          {actions
            .filter((a) => a.show)
            .map((a) => (
              <button key={a.label} type="button" className={`quick-btn tone-${a.tone}`} onClick={a.run}>
                <Icon name={a.icon} size={18} /> {a.label}
              </button>
            ))}
        </div>
      </section>

      <section className="dash-row">
        <div className="card appts-card">
          <div className="card-head">
            <h2>
              Today&apos;s Appointments <span className="muted">({todayLabel})</span>
            </h2>
            <Link to="/appointments" className="link">
              View All <Icon name="arrowRight" size={15} />
            </Link>
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'all', label: 'All', count: appts.length },
              { value: 'consultation', label: 'Consultation', count: count('consultation') },
              { value: 'physiotherapy', label: 'Physiotherapy', count: count('physiotherapy') },
              { value: 'lab', label: 'Lab Test', count: count('lab') },
              ...(count('diagnostic') ? [{ value: 'diagnostic' as const, label: 'Diagnostics', count: count('diagnostic') }] : []),
            ]}
          />
          <div className="appt-list">
            {visible.length === 0 && <Empty text="No appointments for today yet." icon="calendar" />}
            {visible.map((a) => (
              <button key={a.id} type="button" className={`appt-row type-${a.type}`} onClick={() => openModal({ kind: 'appointmentEdit', appointment: a })}>
                <span className="appt-time">{fmtTime(a.time)}</span>
                <span className="appt-name">{a.patient}</span>
                <span className="appt-service">{apptLabel(a)}</span>
                <Pill status={a.status} />
              </button>
            ))}
          </div>
        </div>

        <div className="card revenue-card">
          <div className="card-head">
            <h2>Revenue Overview</h2>
            <select className="select-sm" value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="Range">
              <option value={7}>Last 7 Days</option>
              <option value={30}>Last 30 Days</option>
              <option value={90}>Last 90 Days</option>
            </select>
          </div>
          <div className="revenue-total">
            <strong>{data ? inr(data.revenue.total) : '—'}</strong>
            {data && <Delta value={data.revenue.delta} label={`vs previous ${data.range} days`} />}
          </div>
          <div className="revenue-body">
            {data && <RevenueChart days={data.revenue.days} />}
            <ul className="legend">
              {SERIES.map((s) => (
                <li key={s.key}>
                  <i style={{ background: s.color }} /> {s.label}
                  <b>{inr(data?.revenue.totals[s.key] ?? 0)}</b>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="dash-row three">
        <div className="card">
          <div className="card-head">
            <h2>Today&apos;s Queue</h2>
          </div>
          <div className="queue">
            {(data?.queue || []).map((q) => {
              const m = QUEUE_META[q.type];
              return (
                <button key={q.type} type="button" className="queue-row" onClick={() => navigate(m.to)}>
                  <span className={`queue-icon tone-${m.tone}`}>
                    <Icon name={m.icon} size={18} />
                  </span>
                  <span className="queue-label">{TYPE_LABEL[q.type]}</span>
                  <strong>{q.total}</strong>
                  <small>
                    ({q.active} {m.active})
                  </small>
                  <Icon name="chevronRight" size={16} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Recent Invoices</h2>
            <Link to="/billing" className="link">
              View All <Icon name="arrowRight" size={15} />
            </Link>
          </div>
          <table className="table compact">
            <thead>
              <tr>
                <th>Invoice No.</th>
                <th>Patient</th>
                <th>Service Type</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recentInvoices || []).map((inv) => (
                <tr key={inv.id} className="clickable" onClick={() => openModal({ kind: 'viewInvoice', id: inv.id })}>
                  <td className="mono">{inv.number}</td>
                  <td>{inv.patient}</td>
                  <td>
                    <TypePill type={inv.service_type} />
                  </td>
                  <td className="num">{inr(inv.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.recentInvoices.length === 0 && <Empty text="No invoices yet." icon="invoice" />}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Inventory Alerts</h2>
            <Link to="/inventory?filter=low" className="link">
              View All <Icon name="arrowRight" size={15} />
            </Link>
          </div>
          <div className="stock-alerts">
            {data && data.alerts.length === 0 && <Empty text="Stock levels look healthy." icon="box" />}
            {(data?.alerts || []).map((a) => {
              const severe = a.level === 'out' || a.level === 'low' || a.level === 'expired';
              return (
                <div key={a.id} className="stock-alert">
                  <span className={`alert-icon ${severe ? 'warn' : 'info'}`}>
                    <Icon name={severe ? 'alert' : 'info'} size={18} />
                  </span>
                  <span className="stock-name">{a.name}</span>
                  {can('Inventory Management', 'edit') ? (
                    <button
                      type="button"
                      className={`pill pill-btn pill-${severe ? 'red' : a.level === 'expiry' ? 'orange' : 'blue'}`}
                      title="Record stock received"
                      onClick={() => openModal({ kind: 'stock', item: a as Item, direction: 'in' })}
                    >
                      {alertLabel(a)}
                    </button>
                  ) : (
                    <Pill tone={severe ? 'red' : a.level === 'expiry' ? 'orange' : 'blue'}>{alertLabel(a)}</Pill>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
