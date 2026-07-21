import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, DoctorSlot } from '../api';
import { useAuth } from '../auth/AuthContext';
import { PaymentMethod, PaymentMethodPicker, isOnlinePayment } from '../components/PaymentMethodPicker';
import { payWithRazorpay } from '../payments/razorpayCheckout';

type ConsultationType = {
  name: string;
  consultation_type?: string;
  consultation_fee?: number;
};

export function AppointmentBookPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [types, setTypes] = useState<ConsultationType[]>([]);
  const [departments, setDepartments] = useState<Array<{ name: string; department_name?: string }>>([]);
  const [practitioners, setPractitioners] = useState<
    Array<{ name: string; practitioner_name?: string; department?: string }>
  >([]);
  const [slots, setSlots] = useState<DoctorSlot[]>([]);
  const [appointmentType, setAppointmentType] = useState('');
  const [department, setDepartment] = useState('');
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

  const consultationFee = useMemo(() => {
    const selected = types.find((t) => t.name === appointmentType);
    return Number(selected?.consultation_fee || 0);
  }, [types, appointmentType]);

  useEffect(() => {
    async function loadMeta() {
      try {
        const [typesRes, deptRes] = await Promise.all([
          api.getAppointmentTypes(),
          api.getDepartments(),
        ]);
        const typeList = typesRes.data.types || [];
        const deptList = deptRes.data.departments || [];
        setTypes(typeList);
        setDepartments(deptList);
        if (typeList[0]) setAppointmentType(typeList[0].name);
        if (deptList[0]) setDepartment(deptList[0].name);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load appointment options');
      }
    }
    void loadMeta();
  }, []);

  useEffect(() => {
    if (!department) return;
    async function loadDoctors() {
      try {
        const res = await api.getPractitioners(department);
        const list = res.data.practitioners || [];
        setPractitioners(list);
        setPractitioner(list[0]?.name || '');
        setSlot('');
        setSlots([]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load doctors');
      }
    }
    void loadDoctors();
  }, [department]);

  useEffect(() => {
    if (!practitioner || !date) {
      setSlots([]);
      setSlot('');
      return;
    }
    async function loadSlots() {
      try {
        const res = await api.getDoctorSlots(practitioner, date, department);
        const list = res.data.slots || [];
        setSlots(list);
        setSlot(list[0]?.time || '');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load schedule slots');
        setSlots([]);
      }
    }
    void loadSlots();
  }, [practitioner, date, department]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!appointmentType || !date) {
      setError('Consultation type and date are required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.bookAppointment({
        patient_name: patientName,
        patient_phone: phone,
        gender,
        practitioner,
        appointment_type: appointmentType,
        appointment_date: date,
        appointment_time: slot,
        department,
        notes,
        payment_method: paymentMethod,
        amount: consultationFee > 0 ? String(consultationFee) : '',
      });
      const appointmentId = (res.data as { appointment_id?: string }).appointment_id;
      if (appointmentId && consultationFee > 0 && isOnlinePayment(paymentMethod)) {
        await payWithRazorpay({
          referenceDoctype: 'Doctor Appointment',
          referenceName: appointmentId,
          amount: consultationFee,
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

  return (
    <>
      <Link to="/services" className="muted">
        ← Back to services
      </Link>
      <h1 style={{ marginTop: 12 }}>Book doctor appointment</h1>
      <p className="muted">Slots are loaded from each practitioner&apos;s schedule in ERPNext.</p>

      <form className="form" onSubmit={onSubmit} style={{ marginTop: 20 }}>
        <label>
          Patient name
          <input value={patientName} onChange={(e) => setPatientName(e.target.value)} required />
        </label>
        <label>
          Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label>
          Gender
          <select value={gender} onChange={(e) => setGender(e.target.value)}>
            <option>Male</option>
            <option>Female</option>
            <option>Other</option>
          </select>
        </label>
        <label>
          Department
          <select value={department} onChange={(e) => setDepartment(e.target.value)}>
            {departments.map((d) => (
              <option key={d.name} value={d.name}>
                {d.department_name || d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Doctor
          <select value={practitioner} onChange={(e) => setPractitioner(e.target.value)} required>
            {practitioners.map((p) => (
              <option key={p.name} value={p.name}>
                {p.practitioner_name || p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Consultation type
          <select value={appointmentType} onChange={(e) => setAppointmentType(e.target.value)} required>
            {types.map((t) => (
              <option key={t.name} value={t.name}>
                {t.consultation_type || t.name}
                {t.consultation_fee ? ` · ₹${Number(t.consultation_fee).toFixed(0)}` : ''}
              </option>
            ))}
          </select>
        </label>
        {consultationFee > 0 && (
          <p className="muted">Consultation fee: ₹{consultationFee.toFixed(0)}</p>
        )}
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          Time slot
          <select value={slot} onChange={(e) => setSlot(e.target.value)} required disabled={!slots.length}>
            {!slots.length && <option value="">No slots — pick doctor & date</option>}
            {slots.map((s) => (
              <option key={s.time} value={s.time}>
                {s.time.slice(0, 5)}
                {s.consultation_type ? ` · ${s.consultation_type}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
        <PaymentMethodPicker value={paymentMethod} onChange={setPaymentMethod} variant="doctor" />
        {error && <div className="error">{error}</div>}
        <button className="btn" type="submit" disabled={loading || !slot}>
          {loading
            ? 'Booking…'
            : isOnlinePayment(paymentMethod) && consultationFee > 0
              ? `Confirm & pay · ₹${consultationFee.toFixed(0)}`
              : consultationFee > 0
                ? `Confirm appointment · ₹${consultationFee.toFixed(0)}`
                : 'Confirm appointment'}
        </button>
      </form>
    </>
  );
}
