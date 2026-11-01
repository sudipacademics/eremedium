import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BRANCHES,
  DASHBOARD_BRANCH_IDS,
  DELTAS,
  NETWORK,
  formatINR,
  formatNumber,
  unitById,
  type UnitId,
} from '../data';
import { Icon, type IconName } from '../icons';
import { useOps } from '../store';
import { AlertBubble, Sla, UnitPill } from './ui';

const SHAPE: Record<UnitId, number[]> = {
  lab: [640, 780, 730, 860, 980, 1060, 1180],
  care: [280, 340, 400, 460, 560, 660, 760],
  aesthetic: [170, 200, 230, 250, 290, 330, 370],
  pharmacy: [430, 490, 540, 600, 690, 780, 860],
};

const SERIES_META: { id: UnitId; color: string }[] = [
  { id: 'lab', color: '#14a37a' },
  { id: 'care', color: '#f0a12a' },
  { id: 'aesthetic', color: '#8b5cf6' },
  { id: 'pharmacy', color: '#3b82f6' },
];

function sample(shape: number[], count: number) {
  if (count === shape.length) return shape;
  return Array.from({ length: count }, (_, index) => {
    const t = (index / (count - 1)) * (shape.length - 1);
    const left = Math.floor(t);
    const right = Math.min(shape.length - 1, left + 1);
    const mix = t - left;
    return Math.round(shape[left] * (1 - mix) + shape[right] * mix);
  });
}

function lastDays(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (count - 1 - index));
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  });
}

function linePath(points: [number, number][]) {
  if (points.length === 0) return '';
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    path += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return path;
}

function TrendChart({ count }: { count: number }) {
  const labels = lastDays(count);
  const series = SERIES_META.map((meta) => ({ ...meta, values: sample(SHAPE[meta.id], count) }));
  const width = 720;
  const height = 248;
  const pad = { l: 46, r: 10, t: 14, b: 28 };
  const max = 1200;
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const xAt = (index: number) => pad.l + (labels.length === 1 ? innerW / 2 : (index / (labels.length - 1)) * innerW);
  const yAt = (value: number) => pad.t + innerH - (value / max) * innerH;
  const ticks = [0, 200, 400, 600, 800, 1000, 1200];
  const drawOrder = ['aesthetic', 'care', 'pharmacy', 'lab'] as UnitId[];

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Bookings trend across Lab, Care, Aesthetic and Pharmacy">
      {ticks.map((tick) => {
        const y = yAt(tick);
        return (
          <g key={tick}>
            <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} className="grid-line" />
            <text x={pad.l - 8} y={y + 4} className="axis" textAnchor="end">
              {tick === 0 ? '0' : tick.toLocaleString('en-IN')}
            </text>
          </g>
        );
      })}
      {labels.map((label, index) =>
        count <= 7 || index === 0 || index === labels.length - 1 || index % (count > 20 ? 5 : 2) === 0 ? (
          <text key={label + index} x={xAt(index)} y={height - 6} className="axis" textAnchor="middle">
            {label}
          </text>
        ) : null,
      )}
      {drawOrder.map((id) => {
        const entry = series.find((item) => item.id === id)!;
        const points = entry.values.map((value, index) => [xAt(index), yAt(value)] as [number, number]);
        const d = linePath(points);
        const last = points[points.length - 1];
        const first = points[0];
        const base = pad.t + innerH;
        return (
          <g key={id}>
            <path d={`${d} L ${last[0]} ${base} L ${first[0]} ${base} Z`} fill={entry.color} opacity="0.1" />
            <path d={d} fill="none" stroke={entry.color} strokeWidth="2.6" />
            <circle cx={last[0]} cy={last[1]} r="3.4" fill={entry.color} />
          </g>
        );
      })}
    </svg>
  );
}

const KPI: { key: string; label: string; icon: IconName; tile: string }[] = [
  { key: 'bookings', label: 'Total Bookings', icon: 'calendar', tile: 'tile-green' },
  { key: 'revenue', label: 'Total Revenue', icon: 'coins', tile: 'tile-blue' },
  { key: 'units', label: 'Active Units', icon: 'building', tile: 'tile-indigo' },
  { key: 'collections', label: 'Sample Collections', icon: 'vial', tile: 'tile-purple' },
  { key: 'deliveries', label: 'Service Deliveries', icon: 'truck', tile: 'tile-mint' },
  { key: 'sla', label: 'SLA Compliance', icon: 'shield', tile: 'tile-teal' },
];

export function Dashboard() {
  const { totals, tasks, approvalCounts, alerts, toggleTask, openModal } = useOps();
  const [range, setRange] = useState(7);
  const featured = DASHBOARD_BRANCH_IDS.map((id) => BRANCHES.find((branch) => branch.id === id)!);
  const openTasks = useMemo(() => tasks.filter((task) => !task.done).length, [tasks]);

  const kpiValue = (key: string) => {
    if (key === 'bookings') return formatNumber(totals.bookings);
    if (key === 'revenue') return formatINR(totals.revenue);
    if (key === 'units') return formatNumber(NETWORK.activeUnits);
    if (key === 'collections') return formatNumber(totals.collections);
    if (key === 'deliveries') return formatNumber(totals.deliveries);
    return `${totals.sla.toFixed(1)}%`;
  };

  return (
    <div className="dash">
      <div className="dash-intro">
        <h1>
          <span className="pulse" aria-hidden="true" />
          Operations Dashboard
        </h1>
        <p>Manage and monitor operations across Lab, Care, Aesthetic and Pharmacy.</p>
      </div>

      <section className="unit-row" aria-label="Business units">
        {(['lab', 'care', 'aesthetic', 'pharmacy'] as UnitId[]).map((id) => {
          const unit = unitById(id);
          return (
            <Link key={id} to={`/units/${id}`} className={`unit-card ${id}`}>
              <span className="ic">
                <Icon name={id} size={22} />
              </span>
              <span>
                <h2>{unit.name}</h2>
                <p>{unit.full}</p>
              </span>
            </Link>
          );
        })}
      </section>

      <section className="kpi-row" aria-label="Network totals">
        {KPI.map((item) => (
          <article key={item.key} className="kpi">
            <span className={`ic ${item.tile}`}>
              <Icon name={item.icon} size={18} />
            </span>
            <div className="label">{item.label}</div>
            <div className="value">{kpiValue(item.key)}</div>
            {item.key === 'units' ? (
              <div className="sub">
                Lab {NETWORK.labUnits} | Care {NETWORK.careUnits} | Aesthetic {NETWORK.aestheticUnits} | Pharmacy {NETWORK.pharmacyUnits}
              </div>
            ) : item.key === 'sla' ? (
              <div className="sub">Target ≥ {NETWORK.slaTarget}%</div>
            ) : (
              <div className="delta">{item.key === 'bookings' ? DELTAS.bookings : item.key === 'revenue' ? DELTAS.revenue : item.key === 'collections' ? DELTAS.collections : DELTAS.deliveries}</div>
            )}
          </article>
        ))}
      </section>

      <section className="mid">
        <article className="card trend-card">
          <div className="card-head">
            <h3>
              <Icon name="chart" size={16} /> Bookings Trend (All Units)
            </h3>
            <label>
              <span className="sr-only">Trend range</span>
              <select className="quiet" value={range} onChange={(event) => setRange(Number(event.target.value))}>
                <option value={7}>Last 7 Days</option>
                <option value={14}>Last 14 Days</option>
                <option value={30}>Last 30 Days</option>
              </select>
            </label>
          </div>
          <div className="trend-body">
            <TrendChart count={range} />
            <ul className="legend">
              {SERIES_META.map((meta) => (
                <li key={meta.id}>
                  <i style={{ background: meta.color }} />
                  <span>{unitById(meta.id).name}</span>
                  <b>{formatNumber(totals.week[meta.id])}</b>
                </li>
              ))}
            </ul>
          </div>
        </article>

        <article className="card">
          <div className="card-head">
            <h3>Today's Operations</h3>
          </div>
          <div className="today-grid">
            {(['lab', 'care', 'aesthetic', 'pharmacy'] as UnitId[]).map((id) => (
              <Link key={id} to={`/units/${id}`} className={`today-tile ${id}`}>
                <span className="ic">
                  <Icon name={id} size={16} />
                </span>
                <span className="k">{unitById(id).name}</span>
                <span className="n">{formatNumber(totals.today[id])}</span>
                <span className="s">{id === 'pharmacy' ? 'Orders' : 'Bookings'}</span>
              </Link>
            ))}
          </div>
        </article>

        <article className="card">
          <div className="card-head">
            <h3>Quick Actions</h3>
          </div>
          <div className="quick-grid">
            <button type="button" className="quick-btn" onClick={() => openModal('booking')}>
              <Icon name="plus" size={18} />
              Create Booking
            </button>
            <button type="button" className="quick-btn" onClick={() => openModal('requisition')}>
              <Icon name="clipboard" size={18} />
              Raise Requisition
            </button>
            <button type="button" className="quick-btn" onClick={() => openModal('task')}>
              <Icon name="task" size={18} />
              Assign Task
            </button>
            <button type="button" className="quick-btn" onClick={() => openModal('issue')}>
              <Icon name="flag" size={18} />
              Log Issue
            </button>
          </div>
        </article>
      </section>

      <section className="split">
        <article className="card">
          <div className="card-head">
            <h3>
              <Icon name="clipboard" size={16} /> Approvals (Pending Actions)
            </h3>
            <Link to="/approvals" className="linkish">
              View All →
            </Link>
          </div>
          <div className="appr">
            <Link to="/approvals?tab=Pending" className="appr-card hot">
              <b>{approvalCounts.pending}</b>
              <span>Pending</span>
            </Link>
            <Link to="/approvals?tab=In%20Review" className="appr-card warn">
              <b>{approvalCounts.review}</b>
              <span>In Review</span>
            </Link>
            <Link to="/approvals?tab=Approved" className="appr-card ok">
              <b>{approvalCounts.approved}</b>
              <span>Approved</span>
            </Link>
            <Link to="/approvals?tab=Rejected" className="appr-card mute">
              <b>{approvalCounts.rejected}</b>
              <span>Rejected</span>
            </Link>
          </div>
        </article>
        <article className="card">
          <div className="card-head">
            <h3>
              <Icon name="box" size={16} /> Assets Overview
            </h3>
            <Link to="/assets" className="linkish">
              View All →
            </Link>
          </div>
          <div className="assets">
            <Link to="/assets" className="asset">
              <span className="ic tile-teal">
                <Icon name="box" size={16} />
              </span>
              <span>
                <b>{formatNumber(NETWORK.assets)}</b>
                <span>Total Assets</span>
              </span>
            </Link>
            <Link to="/assets?status=In%20Service" className="asset">
              <span className="ic tile-green">
                <Icon name="check" size={16} />
              </span>
              <span>
                <b>{formatNumber(NETWORK.inService)}</b>
                <span>In Service</span>
              </span>
            </Link>
            <Link to="/assets?status=Under%20Service" className="asset">
              <span className="ic tile-amber">
                <Icon name="wrench" size={16} />
              </span>
              <span>
                <b>{NETWORK.underService}</b>
                <span>Under Service</span>
              </span>
            </Link>
            <Link to="/assets?status=Inactive" className="asset">
              <span className="ic tile-red">
                <Icon name="ban" size={16} />
              </span>
              <span>
                <b>{NETWORK.inactive}</b>
                <span>Inactive</span>
              </span>
            </Link>
          </div>
        </article>
      </section>

      <section className="bottom">
        <article className="card">
          <div className="card-head">
            <h3>Branch / Unit Performance</h3>
            <Link to="/reports" className="linkish">
              View All →
            </Link>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Unit / Branch</th>
                  <th>Business Unit</th>
                  <th>Bookings</th>
                  <th>Revenue</th>
                  <th>SLA</th>
                </tr>
              </thead>
              <tbody>
                {featured.map((branch) => (
                  <tr key={branch.id}>
                    <td>
                      <strong>{branch.name}</strong>
                      <span className="muted">{branch.area}</span>
                    </td>
                    <td>
                      <UnitPill id={branch.unit} />
                    </td>
                    <td className="num">{formatNumber(branch.bookings)}</td>
                    <td className="num">{formatINR(branch.revenue)}</td>
                    <td>
                      <Sla value={branch.sla} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="card" id="tasks">
          <div className="card-head">
            <h3>
              <Icon name="list" size={16} /> Operations Tasks
            </h3>
            <Link to="/services" className="linkish">
              View All →
            </Link>
          </div>
          <p className="fine">{openTasks} open</p>
          <div>
            {tasks.map((task) => (
              <div key={task.id} className={`task${task.done ? ' done' : ''}`}>
                <button
                  type="button"
                  className="check"
                  aria-pressed={task.done}
                  aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`}
                  onClick={() => toggleTask(task.id)}
                >
                  {task.done ? <Icon name="check" size={12} /> : null}
                </button>
                <div>
                  <div className="title">{task.title}</div>
                  <div className="muted">{task.detail}</div>
                </div>
                <span className={`pri ${task.done ? 'done' : task.priority.toLowerCase()}`}>{task.done ? 'Done' : task.priority}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <div className="card-head">
            <h3>
              <Icon name="alert" size={16} /> Alerts & Exceptions
            </h3>
            <Link to="/quality" className="linkish">
              View All →
            </Link>
          </div>
          <div>
            {alerts.map((alert) => (
              <Link key={alert.id} to={alert.href} className="alert">
                <AlertBubble tone={alert.tone} />
                <span>{alert.text}</span>
              </Link>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
