import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../../api';
import { CriticalAlertRow } from '../../types/executiveAnalytics';

export function CriticalAlertsQueuePage() {
  const [status, setStatus] = useState('Open');
  const [rows, setRows] = useState<CriticalAlertRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (s: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCriticalAlertsQueue({ status: s });
      setRows(res.data.alerts || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [load, status]);

  async function acknowledge(name: string) {
    try {
      await api.acknowledgeCriticalAlert(name);
      void load(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Acknowledge failed');
    }
  }

  return (
    <>
      <section className="hero hero-compact">
        <h1>Critical & abnormal lab alerts</h1>
        <p>H/L/Critical flags trigger SMS, WhatsApp & email when reports are authorized.</p>
      </section>

      <div className="pill-row" style={{ marginBottom: 16 }}>
        {['Open', 'Acknowledged', 'All'].map((s) => (
          <button
            key={s}
            type="button"
            className={`pill ${status === s ? 'pill-active' : ''}`}
            onClick={() => setStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {loading && <p className="muted">Loading alerts…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !rows.length && <p className="muted">No alerts in this queue.</p>}

      {!!rows.length && (
        <div className="table-wrap card">
          <table className="table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Parameter</th>
                <th>Result</th>
                <th>Flag</th>
                <th>TRF</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <td>{row.patient_name || '—'}</td>
                  <td>{row.parameter}</td>
                  <td>
                    {row.result_value} {row.unit || ''}
                    <br />
                    <span className="muted">{row.reference_range}</span>
                  </td>
                  <td>
                    <strong>{row.abnormal_flag}</strong>
                  </td>
                  <td>{row.customer_trf || row.lab_report}</td>
                  <td>{row.alert_status}</td>
                  <td>
                    {row.alert_status === 'Open' && (
                      <button type="button" className="btn btn-sm secondary" onClick={() => void acknowledge(row.name)}>
                        Acknowledge
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 24 }}>
        <Link to="/dashboard/staff">Back to operations</Link>
        {' · '}
        <Link to="/dashboard/executive">Executive analytics</Link>
      </p>
    </>
  );
}
