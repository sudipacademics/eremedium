import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ProviderPortalPayload, ProviderScheduleSlot } from '../../api';
import { useAuth } from '../../auth/AuthContext';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function emptySlot(): Omit<ProviderScheduleSlot, 'name'> {
  return {
    day_of_week: 'Monday',
    from_time: '09:00:00',
    to_time: '13:00:00',
    slot_duration: 15,
    is_active: true,
  };
}

export function ProviderPortalPage() {
  const { user } = useAuth();
  const [data, setData] = useState<ProviderPortalPayload | null>(null);
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [bio, setBio] = useState('');
  const [draft, setDraft] = useState<Omit<ProviderScheduleSlot, 'name'>>(emptySlot());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.getMyProviderPortal();
    setData(res.data);
    setMobile(res.data.profile?.mobile || '');
    setEmail(res.data.profile?.email || '');
    setBio(res.data.profile?.bio || '');
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load portal'));
  }, [load]);

  async function saveProfile() {
    setBusy('profile');
    setError(null);
    try {
      await api.updateMyProviderProfile({ mobile, email, bio });
      setNotice('Profile saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setBusy(null);
    }
  }

  async function addSlot() {
    setBusy('slot');
    setError(null);
    try {
      await api.saveMyScheduleSlot(draft);
      setDraft(emptySlot());
      setNotice('Schedule slot added.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save slot');
    } finally {
      setBusy(null);
    }
  }

  async function toggleSlot(slot: ProviderScheduleSlot) {
    setBusy(slot.name);
    setError(null);
    try {
      await api.setMyScheduleSlotActive(slot.name, !slot.is_active);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update slot');
    } finally {
      setBusy(null);
    }
  }

  const profile = data?.profile || user?.provider;
  const slots = data?.schedule_slots || [];
  const appointments = data?.upcoming_appointments || [];

  return (
    <>
      <section className="hero hero-compact">
        <h1>{profile?.doctor_name || 'My practice'}</h1>
        <p className="muted">
          {profile?.department_name || profile?.primary_department || 'Provider portal'}
          {profile?.status ? ` · ${profile.status}` : ''}
        </p>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Profile</h2>
        <div style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
          <label>
            Mobile
            <input value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </label>
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Bio (shown to patients)
            <textarea rows={4} value={bio} onChange={(e) => setBio(e.target.value)} />
          </label>
          <button type="button" className="btn" disabled={busy === 'profile'} onClick={() => void saveProfile()}>
            {busy === 'profile' ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Weekly schedule</h2>
        <p className="muted">Patients book against these active slots on the public booking pages.</p>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>From</th>
                <th>To</th>
                <th>Duration</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot.name}>
                  <td>{slot.day_of_week}</td>
                  <td>{slot.from_time}</td>
                  <td>{slot.to_time}</td>
                  <td>{slot.slot_duration} min</td>
                  <td>
                    <span className="badge">{slot.is_active ? 'Active' : 'Paused'}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn btn-sm secondary"
                      disabled={busy === slot.name}
                      onClick={() => void toggleSlot(slot)}
                    >
                      {slot.is_active ? 'Pause' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!slots.length ? <p className="muted">No schedule slots yet — add your first block below.</p> : null}
        </div>

        <h3 style={{ marginTop: 20 }}>Add slot</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <label>
            Day
            <select
              value={draft.day_of_week}
              onChange={(e) => setDraft((prev) => ({ ...prev, day_of_week: e.target.value }))}
            >
              {DAYS.map((day) => (
                <option key={day}>{day}</option>
              ))}
            </select>
          </label>
          <label>
            From
            <input
              type="time"
              value={draft.from_time.slice(0, 5)}
              onChange={(e) => setDraft((prev) => ({ ...prev, from_time: `${e.target.value}:00` }))}
            />
          </label>
          <label>
            To
            <input
              type="time"
              value={draft.to_time.slice(0, 5)}
              onChange={(e) => setDraft((prev) => ({ ...prev, to_time: `${e.target.value}:00` }))}
            />
          </label>
          <label>
            Minutes
            <input
              type="number"
              min={5}
              step={5}
              value={draft.slot_duration}
              onChange={(e) => setDraft((prev) => ({ ...prev, slot_duration: Number(e.target.value) || 15 }))}
            />
          </label>
        </div>
        <button
          type="button"
          className="btn"
          style={{ marginTop: 12 }}
          disabled={busy === 'slot'}
          onClick={() => void addSlot()}
        >
          {busy === 'slot' ? 'Adding…' : 'Add schedule block'}
        </button>
      </div>

      <div className="card">
        <h2>Upcoming appointments</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Patient</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Join</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((apt) => (
                <tr key={apt.appointment_id}>
                  <td>{apt.appointment_date}</td>
                  <td>{apt.appointment_time || '—'}</td>
                  <td>{apt.patient_name || '—'}</td>
                  <td>{apt.consultation_mode || 'In-person'}</td>
                  <td>
                    <span className="badge">{apt.status || '—'}</span>
                  </td>
                  <td>
                    {apt.meeting_link ? (
                      <a href={apt.meeting_link} target="_blank" rel="noreferrer" className="btn btn-sm">
                        Open
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!appointments.length ? <p className="muted">No upcoming appointments in the next 14 days.</p> : null}
        </div>
      </div>

      <p className="muted" style={{ marginTop: 16 }}>
        <Link to="/services">Public services</Link>
        {' · '}
        <Link to="/account">Account</Link>
      </p>
    </>
  );
}
