import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, SalesLead, SalesVisit } from '../../api';
import { captureSalesGps } from '../../hooks/useSalesGps';

const PURPOSES = ['Meet Lead', 'Follow-up', 'Onboarding', 'Franchise Support', 'HQ Check-in'];
const OUTCOMES = ['Positive', 'Neutral', 'Negative', 'Rescheduled'];

function statusClass(value?: string) {
  return `reach-status ${(value || '').toLowerCase().replace(/\s+/g, '')}`;
}

async function fileToBase64(file: File): Promise<{ base64: string; filename: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read photo'));
    reader.readAsDataURL(file);
  });
  return { base64: dataUrl, filename: file.name };
}

export function SalesVisitPage() {
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [visits, setVisits] = useState<SalesVisit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [visitId, setVisitId] = useState('');
  const [leadId, setLeadId] = useState('');
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [outcome, setOutcome] = useState('');
  const [duration, setDuration] = useState('30');
  const [notes, setNotes] = useState('');
  const [leadStatus, setLeadStatus] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [photoBase64, setPhotoBase64] = useState('');
  const [photoName, setPhotoName] = useState('');

  const assignedVisits = useMemo(
    () => visits.filter((v) => String(v.visit_status || '').toLowerCase() === 'assigned'),
    [visits],
  );

  async function load() {
    try {
      const [leadsRes, visitsRes] = await Promise.all([api.getSalesLeads(), api.getSalesVisits(50)]);
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

  function selectAssigned(visit: SalesVisit) {
    setVisitId(visit.name);
    setLeadId(visit.lead || '');
    setPurpose(visit.purpose || PURPOSES[0]);
    setNotes(visit.notes || '');
    setMessage(`Completing assigned visit ${visit.name}`);
  }

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
        ...(visitId ? { visit_id: visitId } : {}),
        ...(leadId ? { lead_id: leadId } : {}),
        latitude,
        longitude,
        purpose,
        outcome,
        duration_minutes: duration,
        notes,
        ...(leadStatus ? { lead_status: leadStatus } : {}),
        ...(photoBase64 ? { photo_base64: photoBase64, photo_filename: photoName || 'visit.jpg' } : {}),
      });
      setMessage(visitId ? 'Assigned Log Visit completed and synced to FFMS' : 'Visit logged with GPS — synced to FFMS');
      setNotes('');
      setOutcome('');
      setLeadStatus('');
      setVisitId('');
      setPhotoBase64('');
      setPhotoName('');
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
          <p>Assigned visits from FFMS appear here instantly. Complete them with GPS, remarks and an optional photo — they sync back to FFMS Log Visit.</p>
        </div>
      </div>

      {message ? <div className="reach-alert ok">{message}</div> : null}
      {error ? <div className="reach-alert err">{error}</div> : null}

      {assignedVisits.length ? (
        <section className="reach-panel" style={{ marginBottom: 16 }}>
          <div className="reach-panel-head">
            <h2>Assigned Log Visits</h2>
            <span>{assignedVisits.length} pending from FFMS</span>
          </div>
          <div className="reach-table-wrap">
            <table className="reach-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Purpose</th>
                  <th>From</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {assignedVisits.map((v) => (
                  <tr key={v.name}>
                    <td>
                      <b>{v.lead_name || v.lead || 'Lead'}</b>
                      <br />
                      <small>{v.name}</small>
                    </td>
                    <td>{v.purpose || 'Meet Lead'}</td>
                    <td>{v.assigned_from || 'FFMS'}</td>
                    <td>
                      <button type="button" className="reach-btn secondary" onClick={() => selectAssigned(v)}>
                        Complete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <form className="reach-card" onSubmit={onSubmit}>
        <div className="reach-card-head">
          <div className="reach-card-icon" aria-hidden>
            ⌖
          </div>
          <div>
            <h2>{visitId ? 'Complete assigned visit' : 'Visit details'}</h2>
            <p>{visitId ? `Updating ${visitId}` : 'Link a lead when relevant, note purpose and outcome, then save with your current location.'}</p>
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
          <label className="reach-field">
            Visit photo (optional)
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) {
                  setPhotoBase64('');
                  setPhotoName('');
                  return;
                }
                void fileToBase64(file)
                  .then(({ base64, filename }) => {
                    setPhotoBase64(base64);
                    setPhotoName(filename);
                  })
                  .catch(() => setError('Unable to read visit photo'));
              }}
            />
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
            {photoName ? <small>Photo ready: {photoName}</small> : null}
          </div>
          <button type="submit" className="reach-btn" disabled={submitting}>
            {submitting ? 'Saving…' : visitId ? 'Complete & sync' : 'Log visit'}
          </button>
        </div>
      </form>

      <section className="reach-panel" style={{ marginTop: 16 }}>
        <div className="reach-panel-head">
          <h2>Visit history</h2>
          <span>
            {visits.length} recent entr{visits.length === 1 ? 'y' : 'ies'}
          </span>
        </div>
        <div className="reach-table-wrap">
          <table className="reach-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Lead</th>
                <th>Status</th>
                <th>Outcome</th>
                <th>GPS</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((v) => (
                <tr key={v.name}>
                  <td>{v.visit_date || v.creation?.slice(0, 10)}</td>
                  <td>{v.lead_name || v.lead || '—'}</td>
                  <td>
                    <span className={statusClass(v.visit_status || 'Completed')}>{v.visit_status || 'Completed'}</span>
                  </td>
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
                  <td colSpan={5} className="reach-empty">
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
