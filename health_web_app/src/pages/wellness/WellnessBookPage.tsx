import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, AlliedHealthService, DoctorSlot } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { PaymentMethod, PaymentMethodPicker, isOnlinePayment } from '../../components/PaymentMethodPicker';
import { payWithRazorpay } from '../../payments/razorpayCheckout';
import { getWellnessClinicConfig } from './wellnessClinicConfig';

const STEPS = [
  { id: 'session', label: 'Session' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'details', label: 'Details' },
  { id: 'confirm', label: 'Confirm' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

function money(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function WellnessBookPage() {
  const { wingId = '', serviceCode = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const clinic = getWellnessClinicConfig(wingId);
  const [step, setStep] = useState<StepId>('session');
  const [service, setService] = useState<AlliedHealthService | null>(null);
  const [practitioners, setPractitioners] = useState<
    Array<{ name: string; practitioner_name?: string }>
  >([]);
  const [slots, setSlots] = useState<DoctorSlot[]>([]);
  const [practitioner, setPractitioner] = useState('');
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState('');
  const [patientName, setPatientName] = useState(user?.fullName || '');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState('Female');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Online');
  const [consultationMode, setConsultationMode] = useState<'In-person' | 'Online'>('In-person');
  const [useSessionCard, setUseSessionCard] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fee = service?.rate ?? 0;
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const minDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    void api
      .getAlliedHealthService(decodeURIComponent(serviceCode))
      .then((res) => setService(res.data.service))
      .catch((e) => setError(e instanceof Error ? e.message : 'Service not found'));
  }, [serviceCode]);

  useEffect(() => {
    if (!service?.department_name) return;
    void api
      .getPractitioners(service.department_name)
      .then((res) => {
        const list = res.data.practitioners || [];
        setPractitioners(list);
        setPractitioner(list[0]?.name || '');
      })
      .catch(() => setPractitioners([]));
  }, [service?.department_name]);

  useEffect(() => {
    if (!practitioner || !date || !service?.department_name) {
      setSlots([]);
      setSlot('');
      return;
    }
    void api
      .getDoctorSlots(practitioner, date, service.department_name)
      .then((res) => {
        const list = res.data.slots || [];
        setSlots(list);
        setSlot(list[0]?.time || '');
      })
      .catch(() => setSlots([]));
  }, [practitioner, date, service?.department_name]);

  function goNext() {
    setError(null);
    if (step === 'session') {
      if (!service) {
        setError('Session details are still loading.');
        return;
      }
      setStep('schedule');
      return;
    }
    if (step === 'schedule') {
      if (!date) {
        setError('Choose a date for your session.');
        return;
      }
      if (slots.length > 0 && !slot) {
        setError('Pick an available time slot.');
        return;
      }
      setStep('details');
      return;
    }
    if (step === 'details') {
      if (!patientName.trim() || !phone.trim()) {
        setError('Name and phone are required.');
        return;
      }
      setStep('confirm');
    }
  }

  function goBack() {
    setError(null);
    if (step === 'schedule') setStep('session');
    else if (step === 'details') setStep('schedule');
    else if (step === 'confirm') setStep('details');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!service) return;
    if (step !== 'confirm') {
      goNext();
      return;
    }
    if (!date) {
      setError('Please choose a date');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.bookAlliedHealthAppointment({
        service_code: service.service_code,
        patient_name: patientName,
        patient_phone: phone,
        gender,
        practitioner,
        appointment_date: date,
        appointment_time: slot,
        notes,
        payment_method: paymentMethod,
        consultation_mode: consultationMode,
        use_session_card: useSessionCard ? '1' : '0',
      });
      const data = res.data as {
        appointment_id?: string;
        amount?: number;
        meeting_link?: string;
        portal_join_url?: string;
        session_card?: string;
      };
      const appointmentId = data.appointment_id;
      const charge = Number(data.amount ?? fee);
      if (appointmentId && charge > 0 && isOnlinePayment(paymentMethod)) {
        await payWithRazorpay({
          referenceDoctype: 'Doctor Appointment',
          referenceName: appointmentId,
          amount: charge,
          customerName: patientName,
          email: user?.user,
          phone,
        });
      }
      if (consultationMode === 'Online' && appointmentId) {
        navigate(`/teleconsult/join/${appointmentId}`, { replace: true });
      } else {
        navigate('/bookings', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking failed');
    } finally {
      setLoading(false);
    }
  }

  if (!user) {
    return (
      <section className="wellness-journey wellness-journey-gate">
        <p className="brand-kicker">{clinic?.kicker || 'Remedium Wellness'}</p>
        <h1>Sign in to book</h1>
        <p className="muted">
          Wellness appointments need an account for payments and tracking under My orders.
        </p>
        <Link
          className="btn"
          to="/login"
          state={{ from: `/wellness/${wingId}/book/${encodeURIComponent(serviceCode)}` }}
        >
          Sign in to continue
        </Link>
      </section>
    );
  }

  const pracLabel =
    practitioners.find((p) => p.name === practitioner)?.practitioner_name ||
    practitioner ||
    'Assigned clinician';

  return (
    <div className={`wellness-journey${clinic?.theme === 'indic' ? ' is-indic' : ''}`}>
      <header className="wellness-journey-top">
        <Link to={`/wellness/${wingId}`} className="wellness-journey-back">
          ← {clinic?.headline || 'Back to clinic'}
        </Link>
        <p className="brand-kicker">{clinic?.kicker || service?.wing_title || 'Wellness'}</p>
        <h1>Book your session</h1>
        <p className="wellness-journey-lead">
          A short, clear path from treatment choice to confirmed appointment.
        </p>
      </header>

      <ol className="wellness-journey-steps" aria-label="Booking steps">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            className={
              i < stepIndex ? 'is-done' : i === stepIndex ? 'is-active' : undefined
            }
          >
            <span className="wellness-journey-step-num">{i + 1}</span>
            <span>{s.label}</span>
          </li>
        ))}
      </ol>

      <div className="wellness-journey-grid">
        <aside className="wellness-journey-summary" aria-live="polite">
          {service ? (
            <>
              <p className="wellness-journey-summary-label">Selected session</p>
              <h2>{service.service_name}</h2>
              <ul className="wellness-journey-summary-meta">
                <li>{service.wing_title}</li>
                {service.duration ? <li>{service.duration}</li> : null}
                {service.mode ? <li>{service.mode}</li> : null}
              </ul>
              {fee > 0 ? (
                <p className="wellness-journey-price">
                  <span>Session rate</span>
                  <strong>{money(fee)}</strong>
                </p>
              ) : null}
              {date ? (
                <p className="wellness-journey-chip">
                  {date}
                  {slot ? ` · ${slot.slice(0, 5)}` : ''}
                </p>
              ) : null}
              {stepIndex >= 2 && patientName ? (
                <p className="wellness-journey-chip muted-chip">{patientName}</p>
              ) : null}
              {service.includes ? (
                <p className="muted wellness-journey-includes">Includes: {service.includes}</p>
              ) : null}
            </>
          ) : (
            <p className="muted">Loading session…</p>
          )}
        </aside>

        <form className="wellness-journey-panel" onSubmit={onSubmit}>
          {step === 'session' && service ? (
            <section>
              <h3>Confirm this treatment</h3>
              <p className="muted">
                {service.short_description ||
                  service.long_description ||
                  'Transparent session pricing from the Remedium wellness rate chart.'}
              </p>
              {service.long_description && service.short_description ? (
                <details className="wellness-journey-details">
                  <summary>Full description</summary>
                  <p>{service.long_description}</p>
                </details>
              ) : null}
            </section>
          ) : null}

          {step === 'schedule' ? (
            <section className="wellness-journey-fields">
              <h3>Choose date &amp; clinician</h3>
              {practitioners.length > 0 ? (
                <label>
                  Practitioner
                  <select value={practitioner} onChange={(e) => setPractitioner(e.target.value)} required>
                    {practitioners.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.practitioner_name || p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="muted">A clinician will be assigned from {service?.wing_title}.</p>
              )}
              <label>
                Preferred date
                <input
                  type="date"
                  min={minDate}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </label>
              {slots.length > 0 ? (
                <fieldset className="wellness-slot-grid">
                  <legend>Available slots</legend>
                  {slots.map((s) => (
                    <button
                      key={s.time}
                      type="button"
                      className={`wellness-slot${slot === s.time ? ' is-selected' : ''}`}
                      onClick={() => setSlot(s.time)}
                    >
                      {s.time.slice(0, 5)}
                    </button>
                  ))}
                </fieldset>
              ) : date ? (
                <p className="muted">No open slots for this date — try another day.</p>
              ) : null}
            </section>
          ) : null}

          {step === 'details' ? (
            <section className="wellness-journey-fields">
              <h3>Your details</h3>
              <label>
                Full name
                <input value={patientName} onChange={(e) => setPatientName(e.target.value)} required />
              </label>
              <label>
                Mobile
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  inputMode="tel"
                  placeholder="10-digit mobile"
                />
              </label>
              <label>
                Gender
                <select value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option>Female</option>
                  <option>Male</option>
                  <option>Other</option>
                </select>
              </label>
              <label>
                Notes for clinician (optional)
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              </label>
            </section>
          ) : null}

          {step === 'confirm' ? (
            <section className="wellness-journey-confirm">
              <h3>Review &amp; pay</h3>
              <dl className="wellness-journey-review">
                <div>
                  <dt>Session</dt>
                  <dd>{service?.service_name}</dd>
                </div>
                <div>
                  <dt>When</dt>
                  <dd>
                    {date}
                    {slot ? ` · ${slot.slice(0, 5)}` : ''}
                  </dd>
                </div>
                <div>
                  <dt>With</dt>
                  <dd>{pracLabel}</dd>
                </div>
                <div>
                  <dt>For</dt>
                  <dd>
                    {patientName} · {phone}
                  </dd>
                </div>
                <div>
                  <dt>Amount</dt>
                  <dd className="is-price">{money(fee)}</dd>
                </div>
              </dl>
              <div className="wellness-session-opts">
                <p className="wellness-session-opts-label">Session mode</p>
                <div className="wellness-session-mode-row">
                  <button
                    type="button"
                    className={consultationMode === 'In-person' ? 'is-active' : ''}
                    onClick={() => setConsultationMode('In-person')}
                  >
                    In clinic
                  </button>
                  <button
                    type="button"
                    className={consultationMode === 'Online' ? 'is-active' : ''}
                    onClick={() => setConsultationMode('Online')}
                  >
                    Video call
                  </button>
                </div>
                <label className="wellness-session-card-toggle">
                  <input
                    type="checkbox"
                    checked={useSessionCard}
                    onChange={(e) => setUseSessionCard(e.target.checked)}
                  />
                  Use my session card (if available)
                </label>
              </div>
              {!useSessionCard ? (
                <PaymentMethodPicker value={paymentMethod} onChange={setPaymentMethod} variant="doctor" />
              ) : (
                <p className="wellness-session-card-note">One session will be deducted from your active card. No payment needed.</p>
              )}
            </section>
          ) : null}

          {error ? <div className="error">{error}</div> : null}

          <div className="wellness-journey-actions">
            {stepIndex > 0 ? (
              <button type="button" className="btn secondary" onClick={goBack} disabled={loading}>
                Back
              </button>
            ) : (
              <Link className="btn secondary" to={`/wellness/${wingId}`}>
                Cancel
              </Link>
            )}
            {step !== 'confirm' ? (
              <button type="button" className="btn" onClick={goNext} disabled={!service}>
                Continue
              </button>
            ) : (
              <button className="btn" type="submit" disabled={loading || !service}>
                {loading
                  ? 'Booking…'
                  : fee > 0 && isOnlinePayment(paymentMethod)
                    ? `Confirm & pay · ${money(fee)}`
                    : fee > 0
                      ? `Confirm booking · ${money(fee)}`
                      : 'Confirm booking'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
