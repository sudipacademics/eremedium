import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, HiringMarketingDashboard } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { isHiringMarketer } from '../../auth/roles';

function formatInr(n?: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function LineChart({ points }: { points: Array<{ date: string; leads: number }> }) {
  const w = 640;
  const h = 200;
  const pad = 24;
  const max = Math.max(1, ...points.map((p) => p.leads));
  const coords = points.map((p, i) => {
    const x = pad + (i / Math.max(points.length - 1, 1)) * (w - pad * 2);
    const y = h - pad - (p.leads / max) * (h - pad * 2);
    return `${x},${y}`;
  });
  const poly = coords.join(' ');
  const area = `${pad},${h - pad} ${poly} ${w - pad},${h - pad}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mkt-chart-svg" role="img" aria-label="Leads over time">
      <polyline fill="none" stroke="#0d9488" strokeWidth="2.5" points={poly} />
      <polygon fill="rgba(13,148,136,0.12)" points={area} />
    </svg>
  );
}

function Donut({
  slices,
  centerLabel,
}: {
  slices: Array<{ label: string; pct: number; color: string }>;
  centerLabel: string;
}) {
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="mkt-donut-wrap">
      <svg viewBox="0 0 120 120" className="mkt-donut" aria-hidden>
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="14" />
        {slices.map((s) => {
          const len = (s.pct / 100) * c;
          const el = (
            <circle
              key={s.label}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="14"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            />
          );
          offset += len;
          return el;
        })}
        <text x="60" y="58" textAnchor="middle" fontSize="11" fontWeight="700" fill="#0f172a">
          {centerLabel}
        </text>
        <text x="60" y="72" textAnchor="middle" fontSize="9" fill="#64748b">
          leads
        </text>
      </svg>
      <ul className="mkt-legend">
        {slices.map((s) => (
          <li key={s.label}>
            <span style={{ background: s.color }} />
            {s.label} ({s.pct}%)
          </li>
        ))}
      </ul>
    </div>
  );
}

const SOURCE_COLORS = ['#0d9488', '#8b5cf6', '#f59e0b', '#3b82f6', '#94a3b8'];
const ROLE_COLORS = ['#0d9488', '#06b6d4', '#f97316', '#6366f1'];

export function HiringMarketingDashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<HiringMarketingDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getHiringMarketingDashboard();
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sourceSlices = useMemo(
    () =>
      (data?.leads_by_source || []).map((s, i) => ({
        label: s.source,
        pct: s.pct,
        color: SOURCE_COLORS[i % SOURCE_COLORS.length]!,
      })),
    [data],
  );
  const roleSlices = useMemo(
    () =>
      (data?.leads_by_role || []).map((s, i) => ({
        label: s.role,
        pct: s.pct,
        color: ROLE_COLORS[i % ROLE_COLORS.length]!,
      })),
    [data],
  );

  if (!user || !isHiringMarketer(user.roles)) {
    return (
      <div className="card card-wide">
        <h1>Digital Marketing</h1>
        <p>HR or sales leadership login required.</p>
        <Link className="btn" to="/login">
          Login
        </Link>
      </div>
    );
  }

  if (loading) return <p className="muted">Loading marketing dashboard…</p>;
  if (error) return <div className="error">{error}</div>;
  if (!data) return null;

  const leadTotal = data.leads_by_source.reduce((a, b) => a + b.count, 0) || data.kpis[0]?.value || 0;

  return (
    <div className="mkt-dash">
      <header className="mkt-dash-head">
        <div>
          <h1>Digital Marketing Dashboard</h1>
          <p className="muted">
            {data.from_date} → {data.to_date}
          </p>
        </div>
        <div className="mkt-dash-actions">
          <Link className="btn secondary btn-sm" to="/hr/applications">
            Applicants
          </Link>
          <Link className="btn secondary btn-sm" to="/jobs">
            Job Openings
          </Link>
        </div>
      </header>

      <section className="mkt-kpi-grid">
        {data.kpis.map((k) => (
          <article key={k.key} className="mkt-kpi-card">
            <p className="muted">{k.label}</p>
            <strong>
              {k.value.toLocaleString('en-IN')}
              {k.suffix || ''}
            </strong>
            <span className={(k.delta_pct || 0) >= 0 ? 'mkt-up' : 'mkt-down'}>
              {(k.delta_pct || 0) >= 0 ? '↑' : '↓'} {Math.abs(k.delta_pct || 0)}%
            </span>
          </article>
        ))}
      </section>

      <section className="mkt-charts-row">
        <article className="card mkt-span-2">
          <h2>Leads Over Time</h2>
          <LineChart points={data.leads_over_time} />
        </article>
        <article className="card">
          <h2>Leads by Source</h2>
          <Donut slices={sourceSlices} centerLabel={String(leadTotal)} />
        </article>
        <article className="card">
          <h2>Leads by Job Role</h2>
          <Donut
            slices={roleSlices}
            centerLabel={String(data.leads_by_role.reduce((a, b) => a + b.count, 0) || leadTotal)}
          />
        </article>
      </section>

      <section className="mkt-mid-row">
        <article className="card">
          <div className="careers-section-head">
            <h2>Campaign Performance</h2>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Platform</th>
                  <th>Impr.</th>
                  <th>Clicks</th>
                  <th>Leads</th>
                  <th>CPL</th>
                  <th>Apps</th>
                  <th>Hired</th>
                  <th>ROI</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((c) => (
                  <tr key={c.name}>
                    <td>{c.campaign_name}</td>
                    <td>{c.platform}</td>
                    <td>{Number(c.impressions || 0).toLocaleString('en-IN')}</td>
                    <td>{Number(c.clicks || 0).toLocaleString('en-IN')}</td>
                    <td>{c.leads}</td>
                    <td>{formatInr(c.cpl)}</td>
                    <td>{c.applications}</td>
                    <td>{c.hired}</td>
                    <td className="mkt-up">{Number(c.roi || 0).toFixed(2)}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
        <article className="card">
          <h2>Hiring Funnel</h2>
          <ol className="mkt-funnel">
            {data.funnel.map((f) => (
              <li key={f.stage}>
                <div className="mkt-funnel-bar" style={{ width: `${Math.max(12, f.conversion_from_prev || 10)}%` }} />
                <div className="mkt-funnel-meta">
                  <strong>{f.stage}</strong>
                  <span>{f.count.toLocaleString('en-IN')}</span>
                  {f.stage !== 'Leads' ? (
                    <span className="muted">{f.conversion_from_prev}% from prev</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <p className="mkt-funnel-foot">
            Overall hire rate: <strong>{data.overall_hire_rate}%</strong>
          </p>
        </article>
      </section>

      <section className="mkt-bottom-row">
        <article className="card">
          <h2>Recent Leads</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Source</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_leads.map((l) => (
                  <tr key={l.name}>
                    <td>{l.lead_name}</td>
                    <td>{l.job_role}</td>
                    <td>{l.source}</td>
                    <td>{l.lead_date}</td>
                    <td>
                      <span className={`mkt-badge mkt-badge-${(l.status || 'New').toLowerCase().replace(/\s+/g, '-')}`}>
                        {l.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.recent_leads.length ? <p className="muted">No leads yet.</p> : null}
        </article>
        <article className="card">
          <h2>Recent Hires</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Stage</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_hires.map((h) => (
                  <tr key={h.name}>
                    <td>{h.applicant_name}</td>
                    <td>{h.job_role}</td>
                    <td>{h.stage}</td>
                    <td>{h.hired_on}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.recent_hires.length ? <p className="muted">No hires in pipeline yet.</p> : null}
        </article>
      </section>
    </div>
  );
}
