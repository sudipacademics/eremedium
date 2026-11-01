import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminIcon, type AdminIconName } from './AestheticAdminIcons';
import {
  BOOKING_STATUS,
  DASHBOARD_KPIS,
  QUICK_ACTIONS,
  RECENT_ACTIVITY,
  RECENT_BOOKINGS,
  REVENUE_SERIES,
  paymentTone,
  statusTone,
} from './aestheticAdminData';
import './aesthetic-admin.css';

function RevenueChart() {
  const w = 520;
  const h = 220;
  const pad = { t: 18, r: 16, b: 32, l: 40 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(...REVENUE_SERIES.service, ...REVENUE_SERIES.product) * 1.15;
  const n = REVENUE_SERIES.labels.length;

  function xAt(i: number) {
    return pad.l + (innerW * i) / Math.max(1, n - 1);
  }
  function yAt(v: number) {
    return pad.t + innerH - (v / max) * innerH;
  }
  function path(values: number[]) {
    return values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(' ');
  }

  return (
    <svg className="aea-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Revenue overview chart">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line
            x1={pad.l}
            x2={w - pad.r}
            y1={pad.t + innerH * (1 - t)}
            y2={pad.t + innerH * (1 - t)}
            stroke="#e8eef0"
          />
          <text x={pad.l - 8} y={pad.t + innerH * (1 - t) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">
            {Math.round((max * t) / 1000)}k
          </text>
        </g>
      ))}
      <path d={path(REVENUE_SERIES.service)} fill="none" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round" />
      <path d={path(REVENUE_SERIES.product)} fill="none" stroke="#a78bfa" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="5 4" />
      {REVENUE_SERIES.service.map((v, i) => (
        <circle key={`s-${i}`} cx={xAt(i)} cy={yAt(v)} r="3.5" fill="#0f766e" />
      ))}
      {REVENUE_SERIES.product.map((v, i) => (
        <circle key={`p-${i}`} cx={xAt(i)} cy={yAt(v)} r="3.5" fill="#a78bfa" />
      ))}
      {REVENUE_SERIES.labels.map((label, i) => (
        <text key={label} x={xAt(i)} y={h - 10} textAnchor="middle" fontSize="11" fill="#64748b">
          {label}
        </text>
      ))}
    </svg>
  );
}

function DonutChart() {
  const total = BOOKING_STATUS.reduce((s, r) => s + r.value, 0);
  const r = 54;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = BOOKING_STATUS.map((row) => {
    const len = (row.value / total) * c;
    const dash = `${len} ${c - len}`;
    const item = { ...row, dash, offset };
    offset += len;
    return item;
  });

  return (
    <div className="aea-donut-wrap">
      <svg className="aea-donut" viewBox="0 0 140 140" role="img" aria-label="Booking status">
        <g transform="rotate(-90 70 70)">
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth="16"
              strokeDasharray={a.dash}
              strokeDashoffset={-a.offset}
              strokeLinecap="butt"
            />
          ))}
        </g>
        <text x="70" y="66" textAnchor="middle" fontSize="22" fontWeight="700" fill="#0b2f2f">
          {total}
        </text>
        <text x="70" y="84" textAnchor="middle" fontSize="11" fill="#64748b">
          Bookings
        </text>
      </svg>
      <ul className="aea-donut-legend">
        {BOOKING_STATUS.map((row) => (
          <li key={row.key}>
            <i style={{ background: row.color }} />
            <span>{row.key}</span>
            <b>
              {row.value} ({row.pct}%)
            </b>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ACTIVITY_ICON: Record<(typeof RECENT_ACTIVITY)[number]['kind'], AdminIconName> = {
  booking: 'calendar',
  payment: 'rupee',
  product: 'box',
  employee: 'users',
  machine: 'machine',
};

export function AestheticAdminDashboard() {
  const [period, setPeriod] = useState('This Month');
  const rangeLabel = useMemo(() => '01 Oct 2026 – 31 Oct 2026', []);

  return (
    <div className="aea-dash">
      <div className="aea-page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Welcome back! Here&apos;s an overview of your Remedium Aesthetic business.</p>
        </div>
        <div className="aea-range" aria-label="Date range">
          <AdminIcon name="calendar" size={15} />
          <span>{rangeLabel}</span>
        </div>
      </div>

      <section className="aea-kpis" aria-label="Key metrics">
        {DASHBOARD_KPIS.map((kpi) => (
          <article key={kpi.id} className={`aea-kpi tone-${kpi.tone}`}>
            <span className="aea-kpi-icon">
              <AdminIcon name={kpi.icon} size={20} />
            </span>
            <div>
              <span className="aea-kpi-label">{kpi.label}</span>
              <strong>{kpi.value}</strong>
              <small className="up">
                <AdminIcon name="trendUp" size={12} /> {kpi.delta}% vs last month
              </small>
            </div>
          </article>
        ))}
      </section>

      <section className="aea-mid">
        <article className="aea-card aea-revenue">
          <header>
            <div>
              <h2>Revenue Overview</h2>
              <div className="aea-chart-legend">
                <span>
                  <i className="svc" /> Service Revenue
                </span>
                <span>
                  <i className="prd" /> Product Revenue
                </span>
              </div>
            </div>
            <label className="aea-select">
              <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Revenue period">
                <option>This Month</option>
                <option>Last Month</option>
                <option>This Quarter</option>
              </select>
              <AdminIcon name="chevron" size={14} />
            </label>
          </header>
          <RevenueChart />
        </article>

        <article className="aea-card aea-status">
          <header>
            <h2>Booking Status</h2>
          </header>
          <DonutChart />
        </article>

        <article className="aea-card aea-quick">
          <header>
            <h2>Quick Actions</h2>
          </header>
          <div className="aea-quick-grid">
            {QUICK_ACTIONS.map((a) => (
              <Link key={a.to} to={a.to} className={`aea-quick-btn tone-${a.tone}`}>
                <AdminIcon name={a.icon as AdminIconName} size={18} />
                <span>{a.label}</span>
              </Link>
            ))}
          </div>
        </article>
      </section>

      <section className="aea-bottom">
        <article className="aea-card aea-bookings">
          <header>
            <h2>Recent Bookings</h2>
            <Link to="/aesthetic-admin/bookings" className="aea-text-link">
              View all
            </Link>
          </header>
          <div className="aea-table-wrap">
            <table className="aea-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Date &amp; Time</th>
                  <th>Customer</th>
                  <th>Service</th>
                  <th>Branch</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {RECENT_BOOKINGS.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <code>{row.id}</code>
                    </td>
                    <td>{row.datetime}</td>
                    <td>
                      <div className="aea-person">
                        <b>{row.customer}</b>
                        <small>{row.phone}</small>
                      </div>
                    </td>
                    <td>{row.service}</td>
                    <td>{row.branch}</td>
                    <td>
                      <span className={`aea-pill ${statusTone(row.status)}`}>{row.status}</span>
                    </td>
                    <td>
                      <span className={`aea-pill ${paymentTone(row.payment)}`}>{row.payment}</span>
                    </td>
                    <td>
                      <div className="aea-row-actions">
                        <Link to={`/aesthetic-admin/bookings/${encodeURIComponent(row.id)}`} className="aea-mini-btn">
                          <AdminIcon name="eye" size={14} /> View
                        </Link>
                        <button type="button" className="aea-icon-btn" aria-label="More actions">
                          <AdminIcon name="more" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="aea-card aea-activity">
          <header>
            <h2>Recent Activities</h2>
          </header>
          <ul className="aea-timeline">
            {RECENT_ACTIVITY.map((a) => (
              <li key={a.id}>
                <span className={`aea-timeline-icon kind-${a.kind}`}>
                  <AdminIcon name={ACTIVITY_ICON[a.kind]} size={15} />
                </span>
                <div>
                  <b>{a.title}</b>
                  <p>{a.detail}</p>
                  <small>{a.when}</small>
                </div>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </div>
  );
}
