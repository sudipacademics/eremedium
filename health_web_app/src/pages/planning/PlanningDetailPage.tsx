import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, StaffPlanDetail, StaffPlanResearch } from '../../api';
import './planning-portal.css';

function money(value?: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function PlanningDetailPage() {
  const { planId = '' } = useParams();
  const [plan, setPlan] = useState<StaffPlanDetail | null>(null);
  const [research, setResearch] = useState<StaffPlanResearch | null>(null);
  const [desired, setDesired] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const id = decodeURIComponent(planId);
    const res = await api.getStaffPlan(id);
    setPlan(res.data);
    setDesired(String(res.data.desired_ctc || res.data.market_median_ctc || ''));
    if (res.data.market_research) setResearch(res.data.market_research);
  }, [planId]);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Unable to load plan'));
  }, [load]);

  async function onResearch() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.researchMarketCtc(plan.name);
      setPlan(res.data.plan || plan);
      setResearch(res.data.research);
      setDesired(String(res.data.plan?.desired_ctc || res.data.research.market_median_ctc || ''));
      setMessage('Market CTC estimated from internal benchmarks + portal weightings.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Research failed');
    } finally {
      setBusy(false);
    }
  }

  async function onUseMedian() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.setDesiredCtc(plan.name, undefined, true);
      setPlan(res.data.plan);
      setDesired(String(res.data.plan.desired_ctc || ''));
      setMessage('Desired CTC set to market median.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set CTC');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveDesired(e: FormEvent) {
    e.preventDefault();
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.setDesiredCtc(plan.name, Number(desired));
      setPlan(res.data.plan);
      setMessage('Desired CTC saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save CTC');
    } finally {
      setBusy(false);
    }
  }

  async function onPublish() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.publishStaffPlanToCareers(plan.name);
      setPlan(res.data.plan);
      setMessage(res.message || 'Published to Careers.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setBusy(false);
    }
  }

  if (!plan && !error) return <p className="muted">Loading plan…</p>;
  if (error && !plan) return <div className="planning-alert err">{error}</div>;
  if (!plan) return null;

  return (
    <div>
      <Link to="/planning" className="muted">
        ← Plans
      </Link>
      <section className="planning-hero" style={{ marginTop: 12 }}>
        <h1>{plan.title}</h1>
        <p>
          {plan.designation} · {plan.department} · {plan.location} · {plan.status}
        </p>
      </section>

      {message ? <div className="planning-alert ok">{message}</div> : null}
      {error ? <div className="planning-alert err">{error}</div> : null}

      <div className="planning-grid">
        <section className="planning-card">
          <h2>Role brief</h2>
          <p className="muted">Headcount {plan.headcount}</p>
          <h3 style={{ marginTop: 12, font: '650 0.95rem Fraunces, Georgia, serif' }}>KPIs</h3>
          <ul>
            {(plan.kpis || []).map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
          <h3 style={{ marginTop: 12, font: '650 0.95rem Fraunces, Georgia, serif' }}>KRAs</h3>
          <div className="planning-chips">
            {(plan.kras || []).map((k) => (
              <span key={k}>{k}</span>
            ))}
          </div>
          <h3 style={{ marginTop: 12, font: '650 0.95rem Fraunces, Georgia, serif' }}>JD</h3>
          <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', margin: 0 }}>{plan.jd_text || '—'}</pre>
        </section>

        <section className="planning-card">
          <h2>Market CTC</h2>
          <div className="planning-alert info">
            Estimates use local benchmarks blended with AmbitionBox / Glassdoor / Naukri / Apna
            weightings — not live scrapes.
          </div>
          <div className="planning-actions">
            <button className="primary" type="button" disabled={busy} onClick={() => void onResearch()}>
              {busy ? 'Searching…' : 'AI search market median CTC'}
            </button>
          </div>

          {(research || plan.market_research) && (
            <>
              <p style={{ marginTop: 14 }}>
                <strong>Median</strong> {money((research || plan.market_research)?.market_median_ctc)}
              </p>
              <div className="planning-sources" style={{ marginTop: 10 }}>
                {((research || plan.market_research)?.sources || []).map((s) => (
                  <div key={s.portal} className="planning-source">
                    <span>{s.portal}</span>
                    <strong>{money(s.estimated_median_ctc)}</strong>
                  </div>
                ))}
              </div>
            </>
          )}

          <form className="planning-form" style={{ marginTop: 16 }} onSubmit={onSaveDesired}>
            <label>
              Desired monthly CTC
              <input type="number" min={1} value={desired} onChange={(e) => setDesired(e.target.value)} required />
            </label>
            <div className="planning-actions">
              <button type="button" disabled={busy} onClick={() => void onUseMedian()}>
                Use market median
              </button>
              <button className="primary" type="submit" disabled={busy}>
                Save desired CTC
              </button>
            </div>
          </form>

          <div className="planning-actions" style={{ marginTop: 18 }}>
            <button className="primary" type="button" disabled={busy || !plan.desired_ctc} onClick={() => void onPublish()}>
              Submit → create Careers job post
            </button>
          </div>
          {plan.job_opening ? (
            <p style={{ marginTop: 12 }}>
              Published as <strong>{plan.job_opening}</strong> ·{' '}
              <a href={plan.careers_url || `https://www.e-remedium.in/jobs/${plan.job_opening}/apply`} target="_blank" rel="noreferrer">
                Open apply page
              </a>
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
