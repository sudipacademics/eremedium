import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useCart } from '../cart/CartContext';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function PharmacyCheckoutPage() {
  const navigate = useNavigate();
  const { lines, total, count, clear } = useCart();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [prescription, setPrescription] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (count === 0) {
    return (
      <section className="card card-wide">
        <h1>Checkout</h1>
        <p className="muted">Your cart is empty.</p>
        <Link className="btn" to="/pharmacy">
          Browse pharmacy
        </Link>
      </section>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!prescription) {
      setError('Please upload a prescription image');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const fileData = await fileToBase64(prescription);
      const upload = await api.uploadPrescription(prescription.name, fileData);
      const items = lines.map((l) => ({
        item_code: l.itemCode,
        item_name: l.itemName,
        qty: l.qty,
        rate: l.rate,
      }));
      const res = await api.createPharmacyOrder({
        customer_name: name,
        customer_phone: phone,
        delivery_address: address,
        uploaded_prescription_url: upload.data.file_url,
        order_total: total,
        items_json: JSON.stringify(items),
      });
      clear();
      setSuccess(`Order placed: ${String(res.data.order_id || res.data.name || 'confirmed')}`);
      setTimeout(() => navigate('/bookings'), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Link to="/pharmacy/cart" className="muted">
        ← Back to cart
      </Link>
      <h1 style={{ marginTop: 12 }}>Pharmacy checkout</h1>
      <p className="muted">Order total: ₹{total.toFixed(0)} · {count} items</p>

      <form className="form" onSubmit={onSubmit} style={{ marginTop: 20 }}>
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label>
          Delivery address
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} required rows={3} />
        </label>
        <label>
          Prescription (required)
          <input
            type="file"
            accept="image/*,.pdf"
            onChange={(e) => setPrescription(e.target.files?.[0] || null)}
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        {success && <div className="success">{success}</div>}
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Placing order…' : `Place order · ₹${total.toFixed(0)}`}
        </button>
      </form>
    </>
  );
}
