import { FormEvent, useEffect, useState } from 'react';
import { api, SalesLead, SalesVisit } from '../../api';
import { captureSalesGps } from '../../hooks/useSalesGps';

const PURPOSES = ['Meet Lead', 'Follow-up', 'Presentation', 'Negotiation', 'Onboarding support'];
const OUTCOMES = ['Positive', 'Neutral', 'Needs follow-up', 'Not interested', 'Closed'];

export function SalesVisitPage() {
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [visits, setVisits] = useState<SalesVisit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [leadId, setLeadId] = useState('');
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [outcome, setOutcome] = useState('');
  const [duration, setDuration] = useState('30');
  const [notes, setNotes] = useState('');
  const [leadStatus, setLeadStatus] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);

  async function load() {
    try {
      const [leadsRes, visitsRes] = await Promise.all([api.getSalesLeads(), api.getSalesVisits(20)]);
      setLeads(leadsRes.data.leads || []);
      setVisits(visitsRes.data.visits || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }

  useEffect(() => {
    void load();
    void captureSalesGps()
      .then((pos) => {
        setLatitude(pos.latitude);
        setLongitude(pos.longitude);
      })
      .catch(() => undefined);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (latitude == null || longitude == null) {
      setError('GPS location required — tap capture GPS');
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await api.logSalesVisit({
        lead_id: leadId || undefined,
        latitude,
        longitude,
        purpose,
        outcome,
        duration_minutes: duration,
        notes,
        ...(leadStatus ? { lead_status: leadStatus } : {}),
      });
      setMessage('Visit logged with GPS');
      setNotes('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Log failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1>Log field visit</h1>
      <p className="muted">Record meetings with franchisee leads — GPS is captured automatically.</p>

      {message ? <div className="success">{message}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <form className="card form-stack" onSubmit={onSubmit}>
        <label>
          Lead (optional)
          <select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">— General visit —</option>
            {leads
              .filter((l) => !['Won', 'Lost'].includes(l.status))
              .map((l) => (
                <option key={l.name} value={l.name}>
                  {l.lead_name} ({l.status})
                </option>
              ))}
          </select>
        </label>
        <label>
          Purpose
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {PURPOSES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Outcome
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">—</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        {leadId ? (
          <label>
            Update lead status
            <select value={leadStatus} onChange={(e) => setLeadStatus(e.target.value)}>
              <option value="">No change</option>
              {['Contacted', 'Qualified', 'Negotiation', 'Won', 'Lost'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Duration (minutes)
          <input type="number" min={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>
        <div className="toolbar">
          <button
            type="button"
            className="btn secondary"
            onClick={() =>
              void captureSalesGps().then((pos) => {
                setLatitude(pos.latitude);
                setLongitude(pos.longitude);
                setMessage(pos.note ? `GPS (${pos.note})` : 'GPS updated');
              })
            }
          >
            Refresh GPS
          </button>
          {latitude != null ? (
            <span className="muted">
              {latitude.toFixed(5)}, {longitude?.toFixed(5)}
            </span>
          ) : (
            <span className="error">Waiting for GPS…</span>
          )}
        </div>
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? 'Saving…' : 'Log visit'}
        </button>
      </form>

      <h2 style={{ marginTop: 32 }}>Recent visits</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Purpose</th>
            <th>Outcome</th>
            <th>GPS</th>
          </tr>
        </thead>
        <tbody>
          {visits.map((v) => (
            <tr key={v.name}>
              <td>{v.visit_date || v.creation?.slice(0, 10)}</td>
              <td>{v.purpose}</td>
              <td>{v.outcome || '—'}</td>
              <td>
                {v.latitude && v.longitude
                  ? `${Number(v.latitude).toFixed(4)}, ${Number(v.longitude).toFixed(4)}`
                  : '—'}
              </td>
            </tr>
          ))}
          {!visits.length ? (
            <tr>
              <td colSpan={4} className="muted">
                No visits logged yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}
