import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

type Row = {
  name: string;
  patient_name?: string;
  appointment_date?: string;
  appointment_time?: string;
  status?: string;
  wellness_wing?: string;
  session_card?: string;
  session_punched?: number;
  consultation_mode?: string;
  meeting_link?: string;
};

export function SessionOpsPage() {
  const [wing, setWing] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.listSessionCardOps(wing || undefined, 80);
    setRows((res.data.appointments || []) as Row[]);
  }, [wing]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [load]);

  async function punch(row: Row) {
    if (!row.session_card) {
      setError('No session card linked. Patient must activate a pack first, then re-book or punch from their card.');
      return;
    }
    setBusy(row.name);
    setError('');
    setNotice('');
    try {
      await api.punchSessionCard(row.session_card, row.name);
      setNotice(`Punched session for ${row.patient_name || row.name}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Punch failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="session-ops-page">
      <header className="page-intro">
        <h1>Wellness session desk</h1>
        <p>Track physiotherapy & aesthetic punches; open online video rooms.</p>
      </header>

      <div className="session-ops-filters">
        <select value={wing} onChange={(e) => setWing(e.target.value)}>
          <option value="">All wings</option>
          <option value="physiotherapy">Physiotherapy</option>
          <option value="aesthetics">Aesthetic</option>
          <option value="yoga">Yoga</option>
        </select>
        <button type="button" className="btn secondary" onClick={() => void load()}>
          Refresh
        </button>
        <Link to="/dashboard/teleconsults">Teleconsult queue</Link>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}

      <table className="session-ops-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Patient</th>
            <th>Wing</th>
            <th>Mode</th>
            <th>Punched</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>
                {r.appointment_date}
                {r.appointment_time ? ` ${String(r.appointment_time).slice(0, 5)}` : ''}
              </td>
              <td>{r.patient_name}</td>
              <td>{r.wellness_wing || '—'}</td>
              <td>{r.consultation_mode || 'In-person'}</td>
              <td>{r.session_punched ? 'Yes' : 'No'}</td>
              <td className="session-ops-actions">
                {!r.session_punched && r.session_card ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy === r.name}
                    onClick={() => void punch(r)}
                  >
                    Punch
                  </button>
                ) : null}
                {r.consultation_mode === 'Online' || r.meeting_link ? (
                  <Link className="btn btn-sm secondary" to={`/teleconsult/join/${r.name}`}>
                    Join video
                  </Link>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
