import { useEffect, useState } from 'react';
import { api, TelephonyDashboard } from '../../api';

export function TelephonyDashboardPage() {
  const [data, setData] = useState<TelephonyDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await api.getTelephonyDashboard();
    setData(res.data);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load telephony'));
  }, []);

  if (!data && !error) return <p>Loading telephony…</p>;

  return (
    <>
      <section className="hero hero-compact">
        <h1>Cloud telephony</h1>
        <p className="muted">
          Exotel ↔ ERP booking — known callers use AI voice; unknown callers use IVR. Complex / no-slot → human agent.
        </p>
      </section>

      {error ? <div className="error">{error}</div> : null}

      <div className="stat-row">
        <div className="card">
          <p className="muted">Calls</p>
          <h3>{data?.counts?.total ?? 0}</h3>
        </div>
        <div className="card">
          <p className="muted">Booked</p>
          <h3>{data?.counts?.booked ?? 0}</h3>
        </div>
        <div className="card">
          <p className="muted">Escalated</p>
          <h3>{data?.counts?.escalated ?? 0}</h3>
        </div>
        <div className="card">
          <p className="muted">AI / IVR</p>
          <h3>
            {data?.counts?.ai ?? 0} / {data?.counts?.ivr ?? 0}
          </h3>
        </div>
      </div>

      <section className="card card-wide">
        <h2>Integration status</h2>
        <ul>
          <li>Telephony enabled: {data?.telephony_enabled ? 'Yes' : 'No (set in Health Ecosystem Settings)'}</li>
          <li>Agent connect number: {data?.agent_configured ? 'Configured' : 'Missing'}</li>
          <li>
            OpenAI voice:{' '}
            {data?.openai_status?.ready
              ? `Ready (${data.openai_status.model || 'gpt-4o-mini'})`
              : data?.openai_configured
                ? `Key set — falling back to rules${
                    data.openai_status?.last_error_code
                      ? ` (${data.openai_status.last_error_code})`
                      : ''
                  }`
                : 'Rule-based fallback (no key)'}
          </li>
          {data?.openai_status?.last_error_message ? (
            <li className="muted">OpenAI detail: {data.openai_status.last_error_message}</li>
          ) : null}
        </ul>
        <p className="muted">
          Exotel Incoming Passthru →{' '}
          <code>/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony.telephony_incoming</code>
        </p>
      </section>

      <section className="card card-wide">
        <h2>Recent calls</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>From</th>
              <th>Path</th>
              <th>Status</th>
              <th>Patient</th>
              <th>Service</th>
              <th>Booking</th>
              <th>Escalate</th>
            </tr>
          </thead>
          <tbody>
            {(data?.calls || []).map((c) => (
              <tr key={c.name}>
                <td>{c.creation}</td>
                <td>{c.from_number}</td>
                <td>{c.path}</td>
                <td>{c.status}</td>
                <td>
                  {c.patient_name || '—'}
                  {c.caller_known ? ' ✓' : ''}
                </td>
                <td>{c.service_intent || '—'}</td>
                <td>{c.booking_ref ? `${c.booking_doctype || ''} ${c.booking_ref}` : '—'}</td>
                <td>{c.escalate_reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.calls?.length ? <p className="muted">No calls logged yet.</p> : null}
      </section>
    </>
  );
}
