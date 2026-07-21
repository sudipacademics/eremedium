import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../../api';
import { deskAppUrl } from '../../config';
import { StaffGamificationResponse } from '../../types/gamification';

const PERIODS = [
  { key: 'daily', label: 'Today' },
  { key: 'weekly', label: 'This week' },
  { key: 'monthly', label: 'This month' },
  { key: 'annual', label: 'This year' },
];

function money(value?: number) {
  if (value == null) return '₹0';
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function medal(rank: number) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return String(rank);
}

export function GamificationDashboardPage() {
  const [period, setPeriod] = useState('daily');
  const [data, setData] = useState<StaffGamificationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getStaffGamificationDashboard();
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load gamification dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const board = data?.leaderboards?.[period];
  const myStats = data?.my_stats;
  const myPeriod = myStats?.period_points?.[period];

  return (
    <>
      <section className="hero hero-compact">
        <h1>Employee gamification</h1>
        <p>Track points for lab, pharmacy, appointments & revenue — daily through annual leaderboards.</p>
        <div className="hero-actions">
          <a className="btn secondary btn-sm" href={`${deskAppUrl()}/employee-gamification`} target="_blank" rel="noreferrer">
            Open ERPNext rules
          </a>
          <button type="button" className="btn secondary btn-sm" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </section>

      {loading && <p className="muted">Loading leaderboard…</p>}
      {error && <p className="error">{error}</p>}

      {data && (
        <>
          <div className="grid grid-stats">
            <div className="card">
              <p className="muted stat-label">All-time points</p>
              <p className="stat-value">{data.summary.all_time_points.toLocaleString('en-IN')}</p>
            </div>
            <div className="card">
              <p className="muted stat-label">Linked revenue</p>
              <p className="stat-value">{money(data.summary.all_time_revenue)}</p>
            </div>
            <div className="card">
              <p className="muted stat-label">My points ({board?.label ?? period})</p>
              <p className="stat-value">
                {myStats?.linked ? (myPeriod?.total_points ?? 0).toLocaleString('en-IN') : '—'}
              </p>
              {!myStats?.linked && (
                <p className="muted" style={{ fontSize: '0.85rem', marginTop: 8 }}>
                  Link your User to an Active Employee in ERPNext to earn points.
                </p>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="pill-row" style={{ marginBottom: 16 }}>
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`pill ${period === p.key ? 'pill-active' : ''}`}
                  onClick={() => setPeriod(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <h3>{board?.label ?? 'Leaderboard'}</h3>
            {!board?.leaders?.length ? (
              <p className="muted">No points recorded for this period yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Employee</th>
                      <th>Points</th>
                      <th>Revenue</th>
                      <th>Activities</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.leaders.map((row) => (
                      <tr key={row.employee}>
                        <td>{medal(row.rank)}</td>
                        <td>{row.employee_name || row.employee}</td>
                        <td>{row.total_points.toLocaleString('en-IN')}</td>
                        <td>{money(row.total_revenue)}</td>
                        <td>{row.activity_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <h3>Active rules</h3>
              {!data.active_rules.length ? (
                <p className="muted">No rules configured.</p>
              ) : (
                <ul className="plain-list">
                  {data.active_rules.map((rule) => (
                    <li key={rule.rule_code}>
                      <strong>{rule.title || rule.rule_code}</strong>
                      <br />
                      <span className="muted">
                        {rule.reference_doctype} · {rule.trigger_event} · base {rule.base_points}
                        {rule.points_per_1000_revenue
                          ? ` · +${rule.points_per_1000_revenue}/₹1000`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card">
              <h3>Recent activity</h3>
              {!data.recent_entries.length ? (
                <p className="muted">No entries yet.</p>
              ) : (
                <ul className="plain-list">
                  {data.recent_entries.slice(0, 8).map((entry) => (
                    <li key={entry.name}>
                      <strong>{entry.employee_name || entry.employee}</strong> +{entry.points} pts
                      <br />
                      <span className="muted">
                        {entry.rule_code} · {entry.reference_doctype} {entry.reference_name}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      <p style={{ marginTop: 24 }}>
        <Link to="/dashboard/staff">Back to operations</Link>
      </p>
    </>
  );
}
