import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, DoctorSlot, TeleconsultSession } from '../../api';

type Tab = 'upcoming' | 'followup';

export function TeleconsultQueuePage() {
  const [tab, setTab] = useState<Tab>('upcoming');
  const [upcoming, setUpcoming] = useState<TeleconsultSession[]>([]);
  const [followups, setFollowups] = useState<TeleconsultSession[]>([]);
  const [active, setActive] = useState<TeleconsultSession | null>(null);
  const [followDate, setFollowDate] = useState('');
  const [followNotes, setFollowNotes] = useState('');
  const [bookSlot, setBookSlot] = useState(true);
  const [followTime, setFollowTime] = useState('');
  const [slots, setSlots] = useState<DoctorSlot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [upRes, fuRes] = await Promise.all([
      api.listTeleconsultQueue(14, 80),
      api.listConsultFollowupQueue(80),
    ]);
    setUpcoming(upRes.data.sessions || []);
    setFollowups(fuRes.data.sessions || []);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load teleconsults'));
  }, [load]);

  useEffect(() => {
    if (!active || !bookSlot || !followDate) {
      setSlots([]);
      return;
    }
    const doctorId = active.doctor_name;
    void api
      .getDoctorSlots(doctorId || '', followDate)
      .then((res) => setSlots(res.data.slots || []))
      .catch(() => setSlots([]));
  }, [active, bookSlot, followDate]);

  function openFollowup(row: TeleconsultSession) {
    setActive(row);
    setFollowDate('');
    setFollowNotes(row.follow_up_notes || '');
    setFollowTime('');
    setBookSlot(true);
    setError(null);
  }

  async function submitFollowup() {
    if (!active) return;
    setBusy(active.appointment_id);
    setError(null);
    try {
      const res = await api.scheduleConsultFollowup({
        appointment_id: active.appointment_id,
        follow_up_date: followDate,
        follow_up_notes: followNotes.trim(),
        book_slot: bookSlot,
        ...(followTime ? { appointment_time: followTime } : {}),
      });
      setNotice(
        res.data.follow_up_appointment
          ? `Follow-up booked — ${res.data.follow_up_appointment}`
          : 'Follow-up date saved on consultation record.',
      );
      setActive(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Follow-up failed');
    } finally {
      setBusy(null);
    }
  }

  async function completeConsult(row: TeleconsultSession) {
    setBusy(row.appointment_id);
    setError(null);
    try {
      const res = await api.completeConsultationBilling(row.appointment_id);
      setNotice(
        res.data.sales_invoice
          ? `Completed — Sales Invoice ${res.data.sales_invoice}`
          : 'Consultation marked complete.',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete consultation');
    } finally {
      setBusy(null);
    }
  }

  const rows = tab === 'upcoming' ? upcoming : followups.filter((r) => r.needs_followup !== false);

  return (
    <>
      <section className="hero hero-compact">
        <h1>Teleconsult sessions</h1>
        <p className="muted">Coordinate online visits, schedule follow-ups, and mark consultations complete for billing.</p>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      <div className="toolbar" style={{ marginBottom: 16 }}>
        <button type="button" className={`btn ${tab === 'upcoming' ? '' : 'secondary'}`} onClick={() => setTab('upcoming')}>
          Upcoming ({upcoming.length})
        </button>
        <button type="button" className={`btn ${tab === 'followup' ? '' : 'secondary'}`} onClick={() => setTab('followup')}>
          Needs follow-up ({followups.filter((r) => r.needs_followup).length})
        </button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>Patient</th>
              <th>Doctor</th>
              <th>Status</th>
              <th>Follow-up</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.appointment_id}>
                <td>{row.appointment_date || '—'}</td>
                <td>{row.appointment_time || '—'}</td>
                <td>{row.patient_name || '—'}</td>
                <td>{row.doctor_name || '—'}</td>
                <td>
                  <span className="badge">{row.status || '—'}</span>
                </td>
                <td>{row.follow_up_date || (row.needs_followup ? 'Pending' : '—')}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Link
                    to={`/teleconsult/join/${row.appointment_id}`}
                    className="btn btn-sm secondary"
                  >
                    Join video
                  </Link>{' '}
                  {row.meeting_link ? (
                    <a href={row.meeting_link} target="_blank" rel="noreferrer" className="btn btn-sm secondary">
                      Open room
                    </a>
                  ) : null}{' '}
                  <button type="button" className="btn btn-sm" onClick={() => openFollowup(row)}>
                    Follow-up
                  </button>{' '}
                  {row.status !== 'Completed' ? (
                    <button
                      type="button"
                      className="btn btn-sm secondary"
                      disabled={busy === row.appointment_id}
                      onClick={() => void completeConsult(row)}
                    >
                      Complete
                    </button>
                  ) : (
                    <span className="muted">{row.sales_invoice || 'Billed'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <p className="muted">No sessions in this view.</p> : null}
      </div>

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.5)',
            zIndex: 1000,
            overflowY: 'auto',
          }}
        >
          <div className="card" style={{ maxWidth: 560, width: '94%', margin: '6vh auto' }}>
            <h2>Schedule follow-up</h2>
            <p className="muted">
              {active.patient_name} · {active.appointment_id}
            </p>
            <label style={{ display: 'block', marginTop: 12 }}>
              Follow-up date
              <input type="date" value={followDate} onChange={(e) => setFollowDate(e.target.value)} required />
            </label>
            <label style={{ display: 'block', marginTop: 12 }}>
              Notes for patient / doctor
              <textarea rows={3} value={followNotes} onChange={(e) => setFollowNotes(e.target.value)} />
            </label>
            <label style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
              <input type="checkbox" checked={bookSlot} onChange={(e) => setBookSlot(e.target.checked)} />
              Book follow-up appointment slot
            </label>
            {bookSlot && followDate ? (
              <label style={{ display: 'block', marginTop: 12 }}>
                Time slot
                <select value={followTime} onChange={(e) => setFollowTime(e.target.value)}>
                  <option value="">Select slot</option>
                  {slots.map((s) => (
                    <option key={s.time} value={s.time}>
                      {s.time.slice(0, 5)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                className="btn"
                disabled={!followDate || busy === active.appointment_id}
                onClick={() => void submitFollowup()}
              >
                {busy === active.appointment_id ? 'Saving…' : 'Save follow-up'}
              </button>
              <button type="button" className="btn secondary" onClick={() => setActive(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p className="muted" style={{ marginTop: 16 }}>
        <Link to="/dashboard/session-ops">Wellness session desk</Link>
        {' · '}
        <Link to="/dashboard/staff">Back to operations</Link>
      </p>
    </>
  );
}
