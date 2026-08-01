import { FormEvent, useEffect, useState } from 'react';
import { api, SalesLead, SalesVisit } from '../../api';
import { captureSalesGps } from '../../hooks/useSalesGps';

const PURPOSES = ['Meet Lead', 'Follow-up', 'Presentation', 'Negotiation', 'Onboarding support'];
const OUTCOMES = ['Positive', 'Neutral', 'Needs follow-up', 'Not interested', 'Closed'];

function statusClass(value?: string) {
  return `reach-status ${(value || '').toLowerCase().replace(/\s+/g, '')}`;
}

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
      setError('GPS location required — tap Refresh GPS');
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await api.logSalesVisit({
        ...(leadId ? { lead_id: leadId } : {}),
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
      setOutcome('');
      setLeadStatus('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Log failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="reach-visit-page">
      <div className="reach-page-head">
        <div>
          <h1>Log field visit</h1>
          <p>Record meetings with franchisee leads. GPS is captured automatically so managers can verify field activity.</p>
        </div>
      </div>

      {message ? <div className="reach-alert ok">{message}</div> : null}
      {error ? <div className="reach-alert err">{error}</div> : null}

      <form className="reach-card" onSubmit={onSubmit}>
        <div className="reach-card-head">
          <div className="reach-card-icon" aria-hidden>
            ⌖
          </div>
          <div>
            <h2>Visit details</h2>
            <p>Link a lead when relevant, note purpose and outcome, then save with your current location.</p>
          </div>
        </div>

        <div className="reach-form-grid">
          <label className="reach-field">
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
          <label className="reach-field">
            Purpose
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              {PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="reach-field">
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
            <label className="reach-field">
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
          <label className="reach-field">
            Duration (minutes)
            <input type="number" min={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </label>
          <label className="reach-field span-2">
            Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="What was discussed, next step, objections…" />
          </label>
        </div>

        <div className="reach-form-footer">
          <div className="reach-gps">
            <button
              type="button"
              className="reach-btn secondary"
              onClick={() =>
                void captureSalesGps().then((pos) => {
                  setLatitude(pos.latitude);
                  setLongitude(pos.longitude);
                  setMessage(pos.note ? `GPS updated (${pos.note})` : 'GPS updated');
                })
              }
            >
              Refresh GPS
            </button>
            {latitude != null ? (
              <code>
                {latitude.toFixed(5)}, {longitude?.toFixed(5)}
              </code>
            ) : (
              <span className="reach-alert err" style={{ margin: 0, padding: '6px 10px' }}>
                Waiting for GPS…
              </span>
            )}
          </div>
          <button type="submit" className="reach-btn" disabled={submitting}>
            {submitting ? 'Saving…' : 'Log visit'}
          </button>
        </div>
      </form>

      <section className="reach-panel" style={{ marginTop: 16 }}>
        <div className="reach-panel-head">
          <h2>Recent visits</h2>
          <span>
            {visits.length} recent entr{visits.length === 1 ? 'y' : 'ies'}
          </span>
        </div>
        <div className="reach-table-wrap">
          <table className="reach-table">
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
                  <td>{v.outcome ? <span className={statusClass(v.outcome)}>{v.outcome}</span> : '—'}</td>
                  <td>
                    {v.latitude && v.longitude
                      ? `${Number(v.latitude).toFixed(4)}, ${Number(v.longitude).toFixed(4)}`
                      : '—'}
                  </td>
                </tr>
              ))}
              {!visits.length ? (
                <tr>
                  <td colSpan={4} className="reach-empty">
                    No visits logged yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
