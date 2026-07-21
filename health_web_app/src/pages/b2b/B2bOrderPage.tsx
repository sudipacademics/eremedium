import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, B2bCatalogItem } from '../../api';

export function B2bOrderPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<B2bCatalogItem[]>([]);
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [age, setAge] = useState('30');
  const [gender, setGender] = useState('Male');
  const [itemCode, setItemCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void api.getB2bCatalog().then((res) => {
      const list = res.data.items || [];
      setItems(list);
      if (list[0]) setItemCode(list[0].item_code);
    });
  }, []);

  const selected = items.find((i) => i.item_code === itemCode);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.createB2bWalkInOrder({
        patient_name: patientName,
        patient_phone: patientPhone,
        age,
        gender,
        item_code: itemCode,
        payment_method: 'Pay at Hub',
      });
      setSuccess(
        `Order ${res.data.trf_id} created — barcode ${res.data.barcode}. Margin ₹${res.data.margin.toFixed(0)}`,
      );
      setPatientName('');
      setPatientPhone('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Walk-in lab order</h1>
      <p className="muted">Register a patient at your hub. Payment collected at centre (no Razorpay).</p>

      <form className="card card-wide form-stack" onSubmit={onSubmit}>
        <label>
          Patient name
          <input value={patientName} onChange={(e) => setPatientName(e.target.value)} required />
        </label>
        <label>
          Mobile
          <input value={patientPhone} onChange={(e) => setPatientPhone(e.target.value)} required />
        </label>
        <div className="form-row">
          <label>
            Age
            <input type="number" min={1} max={120} value={age} onChange={(e) => setAge(e.target.value)} required />
          </label>
          <label>
            Gender
            <select value={gender} onChange={(e) => setGender(e.target.value)}>
              <option>Male</option>
              <option>Female</option>
              <option>Other</option>
            </select>
          </label>
        </div>
        <label>
          Lab test
          <select value={itemCode} onChange={(e) => setItemCode(e.target.value)} required>
            {items.map((item) => (
              <option key={item.item_code} value={item.item_code}>
                {item.item_name} — MRP ₹{item.retail_rate.toFixed(0)}
              </option>
            ))}
          </select>
        </label>

        {selected ? (
          <div className="price-breakdown">
            <div>
              <span>Bill patient (MRP)</span>
              <strong>₹{selected.retail_rate.toFixed(0)}</strong>
            </div>
            <div>
              <span>Platform charge (wholesale)</span>
              <strong>₹{selected.wholesale_rate.toFixed(0)}</strong>
            </div>
            <div>
              <span>Your margin</span>
              <strong>₹{selected.margin.toFixed(0)}</strong>
            </div>
          </div>
        ) : null}

        {error ? <div className="error">{error}</div> : null}
        {success ? <div className="success">{success}</div> : null}

        <div className="toolbar">
          <button className="btn" type="submit" disabled={busy || !itemCode}>
            {busy ? 'Creating…' : 'Create walk-in order'}
          </button>
          <button className="btn secondary" type="button" onClick={() => navigate('/b2b/statements')}>
            View statements
          </button>
        </div>
      </form>

      <p className="muted" style={{ marginTop: 16 }}>
        <Link to="/b2b/catalog">Full price list</Link>
      </p>
    </>
  );
}
