import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

type Blueprint = {
  name: string;
  package?: string;
  status?: string;
  chief_complaint?: string;
  progress_percent?: number;
  planned_sessions?: number;
  completed_sessions?: number;
  timeline_weeks?: number;
  zone_plan_summary?: string;
  start_date?: string | null;
  end_date?: string | null;
  baseline_pain?: number | null;
  current_pain?: number | null;
  baseline_mobility?: number | null;
  current_mobility?: number | null;
  ai_gait_status?: string;
  red_zone_tags?: string;
  modalities?: Array<{
    zone: string;
    modality: string;
    planned_sessions: number;
    completed_sessions: number;
  }>;
};

export function CareMyPlanPage() {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api
      .getMyCareBlueprints()
      .then((res) => setBlueprints((res.data.blueprints || []) as Blueprint[]))
      .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load Care plan'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="care-plan-page">
      <p className="eyebrow">Remedium Care</p>
      <h1>My Care plan</h1>
      <p className="muted">Your Recovery Blueprint, zone plan, and session progress.</p>
      <div className="care-plan-links">
        <Link className="btn secondary" to="/wellness/care">
          Care home
        </Link>
        <Link className="btn secondary" to="/wellness/sessions?wing=physiotherapy">
          Session packs
        </Link>
      </div>

      {loading ? <p className="muted">Loading…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && !blueprints.length ? (
        <p className="muted">
          No Recovery Blueprint yet. Book an assessment — your clinician creates the blueprint after consult.
        </p>
      ) : null}

      <div className="care-plan-grid">
        {blueprints.map((bp) => (
          <article key={bp.name} className="care-plan-card">
            <p className="session-chip">
              {bp.package || 'Standard'} · {bp.status || 'Active'}
            </p>
            <h2>{bp.chief_complaint || bp.name}</h2>
            <p className="session-remaining">
              {bp.completed_sessions ?? 0} of {bp.planned_sessions ?? 0} sessions · {bp.progress_percent ?? 0}%
            </p>
            <div className="session-progress">
              <span style={{ width: `${Math.min(100, bp.progress_percent || 0)}%` }} />
            </div>
            {bp.zone_plan_summary ? <p className="muted">{bp.zone_plan_summary}</p> : null}
            {bp.modalities?.length ? (
              <ul className="care-modality-list">
                {bp.modalities.map((m) => (
                  <li key={`${m.zone}-${m.modality}`}>
                    Zone {m.zone} · {m.modality}: {m.completed_sessions}/{m.planned_sessions}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="muted">
              Pain {bp.baseline_pain ?? '—'} → {bp.current_pain ?? '—'} · Mobility {bp.baseline_mobility ?? '—'} →{' '}
              {bp.current_mobility ?? '—'}
            </p>
            {bp.ai_gait_status ? <p className="muted">AI gait: {bp.ai_gait_status}</p> : null}
            {bp.red_zone_tags ? <p className="error">Red zone: {bp.red_zone_tags}</p> : null}
            <Link className="btn" to={`/wellness/care/progress/${encodeURIComponent(bp.name)}`}>
              Progress report
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
