import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, AlliedHealthService, DoctorSlot } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { PaymentMethod, PaymentMethodPicker, isOnlinePayment } from '../../components/PaymentMethodPicker';
import { payWithRazorpay } from '../../payments/razorpayCheckout';

export function WellnessBookPage() {
  const { wingId = '', serviceCode = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
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
  const [gender, setGender] = useState('Male');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Online');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fee = service?.rate ?? 0;

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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!service) return;
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
      });
      const appointmentId = (res.data as { appointment_id?: string }).appointment_id;
      if (appointmentId && fee > 0 && isOnlinePayment(paymentMethod)) {
        await payWithRazorpay({
          referenceDoctype: 'Doctor Appointment',
          referenceName: appointmentId,
          amount: fee,
          customerName: patientName,
          email: user?.user,
          phone,
        });
      }
      navigate('/bookings', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking failed');
    } finally {
      setLoading(false);
    }
  }

  if (!user) {
    return (
      <section className="card card-wide">
        <h1>Sign in to book</h1>
        <p className="muted">Wellness appointments require an account for payment and My orders tracking.</p>
        <Link
          className="btn"
          to="/login"
          state={{ from: `/wellness/${wingId}/book/${encodeURIComponent(serviceCode)}` }}
        >
          Sign in
        </Link>
      </section>
    );
  }

  return (
    <>
      <Link to={`/wellness/${wingId}`} className="muted">
        ← Back to services
      </Link>
      <h1 style={{ marginTop: 12 }}>Book session</h1>
      {service && (
        <section className="card card-wide wellness-book-summary">
          <h2>{service.service_name}</h2>
          <p className="muted">
            {service.wing_title}
            {service.duration ? ` · ${service.duration}` : ''}
            {service.mode ? ` · ${service.mode}` : ''}
          </p>
          {fee > 0 && <p><strong>Session fee: ₹{fee.toFixed(0)}</strong></p>}
          {service.long_description && <p className="muted">{service.long_description}</p>}
        </section>
      )}

      <form className="form" onSubmit={onSubmit} style={{ marginTop: 20 }}>
        <label>
          Your name
          <input value={patientName} onChange={(e) => setPatientName(e.target.value)} required />
        </label>
        <label>
          Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" />
        </label>
        <label>
          Gender
          <select value={gender} onChange={(e) => setGender(e.target.value)}>
            <option>Male</option>
            <option>Female</option>
            <option>Other</option>
          </select>
        </label>
        {practitioners.length > 0 && (
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
        )}
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        {slots.length > 0 && (
          <label>
            Time slot
            <select value={slot} onChange={(e) => setSlot(e.target.value)} required>
              {slots.map((s) => (
                <option key={s.time} value={s.time}>
                  {s.time.slice(0, 5)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Notes (optional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>
        <PaymentMethodPicker value={paymentMethod} onChange={setPaymentMethod} variant="doctor" />
        {error && <div className="error">{error}</div>}
        <button className="btn" type="submit" disabled={loading || !service}>
          {loading
            ? 'Booking…'
            : fee > 0 && isOnlinePayment(paymentMethod)
              ? `Book & pay · ₹${fee.toFixed(0)}`
              : fee > 0
                ? `Book session · ₹${fee.toFixed(0)}`
                : 'Book session'}
        </button>
      </form>
    </>
  );
}
