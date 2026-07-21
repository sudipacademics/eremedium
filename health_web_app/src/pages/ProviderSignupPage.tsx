import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ProviderScheduleInput } from '../api';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WINGS = ['psychology', 'aesthetics', 'physiotherapy', 'chiropractic', 'ayurvedic', 'yoga'];

function defaultSchedule(): ProviderScheduleInput {
  return {
    day_of_week: 'Monday',
    from_time: '10:00',
    to_time: '14:00',
    slot_duration: 20,
    consultation_mode: 'Both',
  };
}

export function ProviderSignupPage() {
  const [providerType, setProviderType] = useState<'Doctor' | 'Wellness'>('Doctor');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [qualification, setQualification] = useState('');
  const [registration, setRegistration] = useState('');
  const [speciality, setSpeciality] = useState('');
  const [department, setDepartment] = useState('');
  const [wellnessWing, setWellnessWing] = useState('psychology');
  const [fee, setFee] = useState('500');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [bio, setBio] = useState('');
  const [supportsOnline, setSupportsOnline] = useState(true);
  const [supportsInPerson, setSupportsInPerson] = useState(true);
  const [schedule, setSchedule] = useState<ProviderScheduleInput[]>([defaultSchedule()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function updateSchedule(index: number, patch: Partial<ProviderScheduleInput>) {
    setSchedule((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!registration.trim()) {
      setError('Medical council / license registration number is required.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.submitServiceProviderApplication({
        provider_type: providerType,
        full_name: fullName,
        email,
        phone,
        qualification,
        registration_number: registration.trim(),
        speciality,
        department,
        wellness_wing: providerType === 'Wellness' ? wellnessWing : undefined,
        consultation_fee: Number(fee || 0),
        supports_online: supportsOnline,
        supports_in_person: supportsInPerson,
        clinic_address: address,
        city,
        bio,
        schedule_proposal: schedule,
      });
      setMessage(`${res.message || 'Application submitted'} (${res.data.application.name})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit application');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="hero hero-compact">
        <h1>Healthcare provider registration</h1>
        <p>
          Doctors and licensed wellness practitioners — submit your credentials, license number, and
          weekly schedule for review. After approval you can sign in with email and password.
        </p>
        <p className="muted">
          <Link to="/login">← Back to sign in</Link>
        </p>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      <form className="card card-wide form-grid" onSubmit={(e) => void onSubmit(e)}>
        <label>
          Provider type
          <select value={providerType} onChange={(e) => setProviderType(e.target.value as 'Doctor' | 'Wellness')}>
            <option>Doctor</option>
            <option>Wellness</option>
          </select>
        </label>
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Mobile
          <input value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </label>
        <label>
          Qualification
          <input value={qualification} onChange={(e) => setQualification(e.target.value)} />
        </label>
        <label className="full-row">
          Medical council / license registration no.
          <input
            value={registration}
            onChange={(e) => setRegistration(e.target.value)}
            placeholder="e.g. MCI / State council registration number"
            required
          />
        </label>
        <label>
          Speciality / service
          <input value={speciality} onChange={(e) => setSpeciality(e.target.value)} />
        </label>
        {providerType === 'Doctor' ? (
          <label>
            Department ID
            <input
              placeholder="Clinical Department ID"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            />
          </label>
        ) : (
          <label>
            Wellness wing
            <select value={wellnessWing} onChange={(e) => setWellnessWing(e.target.value)}>
              {WINGS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Consultation fee
          <input type="number" value={fee} onChange={(e) => setFee(e.target.value)} min="0" />
        </label>
        <label>
          City
          <input value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        <label className="full-row">
          Clinic / practice address
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
        </label>
        <label className="full-row">
          Short profile
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} />
        </label>

        <div className="full-row toolbar">
          <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={supportsOnline} onChange={(e) => setSupportsOnline(e.target.checked)} />
            Online / telemedicine
          </label>
          <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={supportsInPerson} onChange={(e) => setSupportsInPerson(e.target.checked)} />
            In-person
          </label>
        </div>

        <div className="full-row">
          <h3>Weekly schedule</h3>
          {schedule.map((row, index) => (
            <div
              key={`${row.day_of_week}-${index}`}
              className="grid"
              style={{ gridTemplateColumns: '1.1fr 1fr 1fr 0.8fr 1fr auto', gap: 8, alignItems: 'end' }}
            >
              <label>
                Day
                <select value={row.day_of_week} onChange={(e) => updateSchedule(index, { day_of_week: e.target.value })}>
                  {DAYS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label>
                From
                <input value={row.from_time} onChange={(e) => updateSchedule(index, { from_time: e.target.value })} />
              </label>
              <label>
                To
                <input value={row.to_time} onChange={(e) => updateSchedule(index, { to_time: e.target.value })} />
              </label>
              <label>
                Slot
                <input
                  type="number"
                  value={row.slot_duration}
                  onChange={(e) => updateSchedule(index, { slot_duration: Number(e.target.value || 15) })}
                />
              </label>
              <label>
                Mode
                <select
                  value={row.consultation_mode}
                  onChange={(e) =>
                    updateSchedule(index, { consultation_mode: e.target.value as ProviderScheduleInput['consultation_mode'] })
                  }
                >
                  <option>Both</option>
                  <option>Online</option>
                  <option>In-person</option>
                </select>
              </label>
              <button
                className="btn secondary"
                type="button"
                onClick={() => setSchedule((rows) => rows.filter((_, i) => i !== index))}
                disabled={schedule.length === 1}
              >
                Remove
              </button>
            </div>
          ))}
          <button className="btn secondary" type="button" onClick={() => setSchedule((rows) => [...rows, defaultSchedule()])}>
            Add schedule row
          </button>
        </div>

        <button className="btn full-row" disabled={busy} type="submit">
          {busy ? 'Submitting…' : 'Submit for review'}
        </button>
      </form>
    </>
  );
}
