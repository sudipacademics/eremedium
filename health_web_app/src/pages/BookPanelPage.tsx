import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, Franchisee, franchiseeLabel, LabPanel } from '../api';
import { useAuth } from '../auth/AuthContext';
import { LocationField } from '../components/LocationField';
import { PaymentMethod, PaymentMethodPicker, isOnlinePayment } from '../components/PaymentMethodPicker';
import { payWithRazorpay } from '../payments/razorpayCheckout';

function toLocalDatetime(slot: string) {
  const normalized = slot.includes('T') ? slot.replace('T', ' ') : slot;
  return normalized.length === 16 ? `${normalized}:00` : normalized;
}

export function BookPanelPage() {
  const { panelId = '' } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const [panel, setPanel] = useState<LabPanel | null>(null);
  const [centres, setCentres] = useState<Franchisee[]>([]);
  const [franchiseeId, setFranchiseeId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [age, setAge] = useState('30');
  const [gender, setGender] = useState('Male');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [slot, setSlot] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Online');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;

    async function load() {
      try {
        const [panelRes, centreRes] = await Promise.all([
          api.getLabPanels(),
          api.searchFranchisees(''),
        ]);
        const found = (panelRes.data.panels || []).find((p) => p.panel_id === panelId);
        if (!found) {
          setError('Health package not found');
          return;
        }
        setPanel(found);
        const list = centreRes.data.franchisees || [];
        setCentres(list);
        if (list[0]) setFranchiseeId(list[0].name);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load package');
      }
    }

    void load();
  }, [panelId, isAuthenticated]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!panel) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.bookLabPanel({
        panel_id: panelId,
        patient_name: patientName,
        age,
        gender,
        franchisee_id: franchiseeId,
        patient_phone: phone,
        collection_address: address,
        collection_slot: toLocalDatetime(slot),
        payment_method: paymentMethod,
      });
      const trfId = (res.data as { trf_id?: string }).trf_id;
      const rate = panel.rate;
      if (trfId && rate > 0 && isOnlinePayment(paymentMethod)) {
        await payWithRazorpay({
          referenceDoctype: 'Customer TRF',
          referenceName: trfId,
          amount: rate,
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

  const rate = panel?.rate ?? 0;

  return (
    <>
      <Link to="/" className="muted">
        ← Back to home
      </Link>
      <h1 style={{ marginTop: 12 }}>Book {panel?.panel_name || 'health package'}</h1>
      {panel && (
        <>
          <p className="muted">{panel.description}</p>
          <p>
            <strong>₹{rate.toFixed(0)}</strong>
            <span className="muted"> · {panel.tests.length} tests included</span>
          </p>
          <ul className="panel-test-list">
            {panel.tests.map((t) => (
              <li key={t.item_code}>{t.item_name}</li>
            ))}
          </ul>
        </>
      )}

      <form className="form" onSubmit={onSubmit} style={{ marginTop: 20 }}>
        <label>
          Patient name
          <input value={patientName} onChange={(e) => setPatientName(e.target.value)} required />
        </label>
        <label>
          Age
          <input value={age} onChange={(e) => setAge(e.target.value)} required />
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
          Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label>
          Collection centre
          <select value={franchiseeId} onChange={(e) => setFranchiseeId(e.target.value)} required>
            {centres.map((c) => (
              <option key={c.name} value={c.name}>
                {franchiseeLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <LocationField label="Collection address" value={address} onChange={setAddress} required />
        <label>
          Collection slot
          <input type="datetime-local" value={slot} onChange={(e) => setSlot(e.target.value)} required />
        </label>
        <PaymentMethodPicker value={paymentMethod} onChange={setPaymentMethod} />
        {error && <div className="error">{error}</div>}
        <button className="btn" type="submit" disabled={loading || !panel}>
          {loading
            ? 'Booking…'
            : isOnlinePayment(paymentMethod)
              ? `Book package & pay · ₹${rate.toFixed(0)}`
              : `Confirm package · ₹${rate.toFixed(0)}`}
        </button>
      </form>
    </>
  );
}
