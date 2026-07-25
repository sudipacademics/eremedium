import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, Franchisee, franchiseeLabel, itemRate } from '../api';
import { useAuth } from '../auth/AuthContext';
import { LocationField } from '../components/LocationField';
import { PriceTag } from '../components/PriceTag';

function toLocalDatetime(slot: string) {
  const normalized = slot.includes('T') ? slot.replace('T', ' ') : slot;
  return normalized.length === 16 ? `${normalized}:00` : normalized;
}

export function BookLabPage() {
  const { itemCode = '' } = useParams();
  const [searchParams] = useSearchParams();
  const hubFromQuery = (searchParams.get('hub') || '').trim();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [itemName, setItemName] = useState(itemCode);
  const [item, setItem] = useState<Awaited<ReturnType<typeof api.getItemDetail>>['data']['item'] | null>(null);
  const [rate, setRate] = useState(0);
  const [centres, setCentres] = useState<Franchisee[]>([]);
  const [franchiseeId, setFranchiseeId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [age, setAge] = useState('30');
  const [gender, setGender] = useState('Male');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [slot, setSlot] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;

    async function load() {
      try {
        const [itemRes, centreRes] = await Promise.all([
          api.getItemDetail(itemCode),
          api.searchFranchisees(''),
        ]);
        const detail = itemRes.data.item;
        setItem(detail);
        setItemName(detail.item_name || itemCode);
        setRate(itemRate(detail));
        const list = centreRes.data.franchisees || [];
        setCentres(list);
        const preferred = hubFromQuery && list.find((c) => c.name === hubFromQuery);
        if (preferred) setFranchiseeId(preferred.name);
        else if (list[0]) setFranchiseeId(list[0].name);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load booking details');
      }
    }

    void load();
  }, [itemCode, isAuthenticated, hubFromQuery]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.bookLabTest({
        patient_name: patientName,
        age,
        gender,
        test_required: itemCode,
        franchisee_id: franchiseeId,
        patient_phone: phone,
        collection_address: address,
        collection_slot: toLocalDatetime(slot),
        amount: rate,
      });
      navigate('/bookings', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Link to="/diagnostics" className="muted">
        ← Back to diagnostics
      </Link>
      <h1 style={{ marginTop: 12 }}>Book {itemName}</h1>
      {item && <PriceTag item={item} />}

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
        <LocationField
          label="Collection address"
          value={address}
          onChange={setAddress}
          required
        />
        <label>
          Collection slot
          <input type="datetime-local" value={slot} onChange={(e) => setSlot(e.target.value)} required />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Booking…' : `Confirm booking · ₹${rate.toFixed(0)}`}
        </button>
      </form>
    </>
  );
}
