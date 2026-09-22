import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';

type Report = {
  name: string;
  report_month?: string;
  summary_html?: string;
  baseline_pain?: number;
  current_pain?: number;
  baseline_mobility?: number;
  current_mobility?: number;
  sessions_completed?: number;
  renewal_cta?: string;
  circle_referral_url?: string;
  ai_gait_note?: string;
};

export function CareProgressPage() {
  const { blueprintId = '' } = useParams();
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function reload() {
    const res = await api.getMyCareProgressReports(blueprintId || undefined);
    setReports((res.data.reports || []) as Report[]);
  }

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : 'Unable to load reports'));
  }, [blueprintId]);

  async function generate() {
    if (!blueprintId) {
      setError('Open a blueprint from My Care plan to generate a report.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.generateCareProgressReport(blueprintId);
      setNotice('Progress report generated.');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate report');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="care-progress-page">
      <p className="eyebrow">Remedium Care · Progress</p>
      <h1>Baseline vs current</h1>
      <p className="muted">Monthly progress after your treatment block — renew or join Remedium Circle.</p>

      <div className="care-plan-links">
        <Link className="btn secondary" to="/wellness/care/plan">
          My Care plan
        </Link>
        {blueprintId ? (
          <button className="btn" type="button" disabled={busy} onClick={generate}>
            {busy ? 'Generating…' : 'Generate this month’s report'}
          </button>
        ) : null}
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}

      {!reports.length ? <p className="muted">No reports yet.</p> : null}
      {reports.map((r) => (
        <article key={r.name} className="care-progress-card">
          <h2>{r.report_month || r.name}</h2>
          <p>
            Pain {r.baseline_pain ?? '—'} → {r.current_pain ?? '—'} · Mobility {r.baseline_mobility ?? '—'} →{' '}
            {r.current_mobility ?? '—'} · Sessions {r.sessions_completed ?? 0}
          </p>
          {r.ai_gait_note ? <p className="muted">{r.ai_gait_note}</p> : null}
          {r.summary_html ? (
            <div className="care-progress-html" dangerouslySetInnerHTML={{ __html: r.summary_html }} />
          ) : null}
          <div className="care-plan-links">
            <Link className="btn" to={r.renewal_cta || '/wellness/sessions?wing=physiotherapy'}>
              Renew / new pack
            </Link>
            <Link className="btn secondary" to={r.circle_referral_url || '/circle'}>
              Remedium Circle
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
