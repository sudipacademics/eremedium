import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { JourneyOpsBoard, JourneyOpsRow } from '../../types/journey';

export function JourneysBoardPage() {
  const [board, setBoard] = useState<JourneyOpsBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [phlebos, setPhlebos] = useState<Array<{ user: string; full_name: string }>>([]);
  const [assigning, setAssigning] = useState<JourneyOpsRow | null>(null);
  const [chosenPhlebo, setChosenPhlebo] = useState('');

  const load = useCallback(async () => {
    const res = await api.getJourneyOpsBoard(200);
    setBoard(res.data);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load journeys'));
    void api
      .listActivePhlebotomists()
      .then((r) => setPhlebos(r.data.phlebotomists || []))
      .catch(() => setPhlebos([]));
  }, [load]);

  async function advance(row: JourneyOpsRow) {
    if (!row.next_status) return;
    if (row.next_status === 'Phlebotomist Assigned') {
      setAssigning(row);
      setChosenPhlebo(row.phlebotomist || (phlebos[0]?.user ?? ''));
      return;
    }
    setBusy(row.name);
    setError(null);
    try {
      await api.journeyTransition({ journey_id: row.name, to_status: row.next_status });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transition failed');
    } finally {
      setBusy(null);
    }
  }

  async function confirmAssign() {
    if (!assigning || !chosenPhlebo) return;
    setBusy(assigning.name);
    setError(null);
    try {
      await api.journeyTransition({
        journey_id: assigning.name,
        to_status: 'Phlebotomist Assigned',
        phlebotomist: chosenPhlebo,
      });
      setAssigning(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assignment failed');
    } finally {
      setBusy(null);
    }
  }

  if (!board && !error) {
    return <p>Loading care journeys…</p>;
  }

  const journeys = board?.journeys || [];
  const counts = board?.stage_counts || {};
  const stages = board?.stages || [];

  return (
    <>
      <section className="hero hero-compact">
        <h1>Care journey queue</h1>
        <p className="muted">
          Live pipeline of active patients. Advance each journey one step at a time — every move is
          logged.
        </p>
      </section>

      {error ? <div className="error">{error}</div> : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        {stages.map((stage) => (
          <span
            key={stage}
            className="badge"
            style={{ opacity: counts[stage] ? 1 : 0.45 }}
            title={stage}
          >
            {stage}: <strong>{counts[stage] || 0}</strong>
          </span>
        ))}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Journey</th>
              <th>Patient</th>
              <th>Stage</th>
              <th>Phlebotomist</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {journeys.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.patient_name || '—'}</td>
                <td>
                  <span className="badge">{row.status}</span>
                </td>
                <td>{row.phlebotomist || '—'}</td>
                <td className="muted">{row.ago || '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {row.next_status ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy === row.name}
                      onClick={() => void advance(row)}
                    >
                      {busy === row.name ? 'Working…' : `→ ${row.next_status}`}
                    </button>
                  ) : (
                    <span className="muted">Done</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!journeys.length ? <p className="muted">No active journeys right now.</p> : null}
      </div>

      {assigning ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="card" style={{ maxWidth: 420, margin: '10vh auto' }}>
            <h2>Assign phlebotomist</h2>
            <p className="muted">
              {assigning.patient_name || assigning.name} → Phlebotomist Assigned
            </p>
            <label>
              Phlebotomist
              {phlebos.length ? (
                <select value={chosenPhlebo} onChange={(e) => setChosenPhlebo(e.target.value)}>
                  <option value="">Select…</option>
                  {phlebos.map((p) => (
                    <option key={p.user} value={p.user}>
                      {p.full_name} ({p.user})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={chosenPhlebo}
                  onChange={(e) => setChosenPhlebo(e.target.value)}
                  placeholder="user@example.com"
                />
              )}
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                className="btn"
                disabled={!chosenPhlebo || busy === assigning.name}
                onClick={() => void confirmAssign()}
              >
                {busy === assigning.name ? 'Assigning…' : 'Assign & advance'}
              </button>
              <button type="button" className="btn secondary" onClick={() => setAssigning(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p className="muted" style={{ marginTop: 16 }}>
        <Link to="/dashboard/staff">Back to operations</Link>
      </p>
    </>
  );
}
