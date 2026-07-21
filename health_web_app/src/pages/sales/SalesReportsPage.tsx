import { FormEvent, useEffect, useState } from 'react';
import { api, SalesClosingReport } from '../../api';

export function SalesReportsPage() {
  const [reports, setReports] = useState<SalesClosingReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [reportType, setReportType] = useState<'Daily' | 'Monthly'>('Daily');
  const [periodDate, setPeriodDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [draft, setDraft] = useState<Record<string, string | number> | null>(null);
  const [kmTraveled, setKmTraveled] = useState('');
  const [notes, setNotes] = useState('');

  async function loadReports() {
    try {
      const res = await api.getSalesClosingReports();
      setReports(res.data.reports || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports');
    }
  }

  useEffect(() => {
    void loadReports();
  }, []);

  async function loadDraft() {
    setError(null);
    try {
      const res = await api.draftSalesClosingReport(reportType, periodDate);
      setDraft(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Draft failed');
    }
  }

  useEffect(() => {
    void loadDraft();
  }, [reportType, periodDate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await api.submitSalesClosingReport({
        report_type: reportType,
        period_date: periodDate,
        visits_count: draft.visits_count,
        new_leads: draft.new_leads,
        qualified_leads: draft.qualified_leads,
        onboardings: draft.onboardings,
        franchise_revenue: draft.franchise_revenue,
        km_traveled: kmTraveled || 0,
        notes,
      });
      setMessage('Closing report submitted');
      setKmTraveled('');
      setNotes('');
      await loadReports();
      await loadDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1>Daily & monthly closing</h1>
      <p className="muted">End-of-day or end-of-month field activity summary for your manager.</p>

      {message ? <div className="success">{message}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <form className="card form-stack" onSubmit={onSubmit}>
        <div className="toolbar">
          <label>
            Type
            <select value={reportType} onChange={(e) => setReportType(e.target.value as 'Daily' | 'Monthly')}>
              <option value="Daily">Daily</option>
              <option value="Monthly">Monthly</option>
            </select>
          </label>
          <label>
            Period date
            <input type="date" value={periodDate} onChange={(e) => setPeriodDate(e.target.value)} />
          </label>
        </div>

        {draft ? (
          <div className="grid grid-stats">
            <article className="card stat-card">
              <span className="stat-label">Visits</span>
              <strong>{draft.visits_count}</strong>
            </article>
            <article className="card stat-card">
              <span className="stat-label">New leads</span>
              <strong>{draft.new_leads}</strong>
            </article>
            <article className="card stat-card">
              <span className="stat-label">Qualified</span>
              <strong>{draft.qualified_leads}</strong>
            </article>
            <article className="card stat-card">
              <span className="stat-label">Onboardings</span>
              <strong>{draft.onboardings}</strong>
            </article>
            <article className="card stat-card">
              <span className="stat-label">Franchise revenue</span>
              <strong>₹{Number(draft.franchise_revenue || 0).toFixed(0)}</strong>
            </article>
          </div>
        ) : (
          <p>Loading draft…</p>
        )}

        <label>
          KM traveled (optional)
          <input type="number" step="0.1" value={kmTraveled} onChange={(e) => setKmTraveled(e.target.value)} />
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>
        <button type="submit" className="btn" disabled={submitting || !draft}>
          {submitting ? 'Submitting…' : 'Submit closing report'}
        </button>
      </form>

      <h2 style={{ marginTop: 32 }}>Submitted reports</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Period</th>
            <th>Visits</th>
            <th>Leads</th>
            <th>Onboardings</th>
            <th>Revenue</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.name}>
              <td>{r.report_type}</td>
              <td>{r.period_date}</td>
              <td>{r.visits_count}</td>
              <td>{r.new_leads}</td>
              <td>{r.onboardings}</td>
              <td>₹{Number(r.franchise_revenue || 0).toFixed(0)}</td>
            </tr>
          ))}
          {!reports.length ? (
            <tr>
              <td colSpan={6} className="muted">
                No reports yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}
