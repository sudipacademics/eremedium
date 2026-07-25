import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { LocationField } from '../components/LocationField';

const DISCOUNT_SLABS = ['', '20-30%', '30-40%', '40-50%', '50-60%', '60-70%'] as const;
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

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

export function PharmacyPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [name, setName] = useState(user?.fullName || '');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [durationMonths, setDurationMonths] = useState(1);
  const [discountSlab, setDiscountSlab] = useState<(typeof DISCOUNT_SLABS)[number]>('');
  const [prescription, setPrescription] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user?.fullName && !name) setName(user.fullName);
  }, [user?.fullName, name]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isAuthenticated) return;
    if (!prescription) {
      setError('Please upload your prescription');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const fileData = await fileToBase64(prescription);
      const upload = await api.uploadPrescription(prescription.name, fileData);
      const res = await api.createPharmacyQuoteRequest({
        customer_name: name,
        customer_phone: phone,
        delivery_address: address,
        uploaded_prescription_url: upload.data.file_url,
        duration_months: durationMonths,
        ...(discountSlab ? { desired_discount_slab: discountSlab } : {}),
        ...(latitude != null && longitude != null
          ? { latitude, longitude }
          : {}),
      });
      setSuccess(res.message || 'Quote request submitted. Our pharmacist will confirm and send a quotation.');
      setTimeout(() => navigate('/bookings', { replace: true }), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit request');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="hero hero-compact">
        <h1>Chronic medicine subscription</h1>
        <p className="hero-lead">
          Heavy discounts on full monthly medicine packs at wholesale rates for chronic care.
        </p>
      </section>

      <section className="card card-wide pharmacy-info">
        <h2>How it works</h2>
        <ul className="steps-list">
          <li>
            <strong>Upload prescription</strong>
            <p className="muted">Our pharmacist reviews medicines and dosages.</p>
          </li>
          <li>
            <strong>Choose pack duration</strong>
            <p className="muted">Select how many months of medicines you need.</p>
          </li>
          <li>
            <strong>Receive quotation</strong>
            <p className="muted">
              You get a comprehensive quote after confirmation. Delivery in 3–4 days minimum;
              logistics charges apply case by case.
            </p>
          </li>
        </ul>
        <p className="muted">
          Retail medicine shopping is handled by our pharmacy team in ERPNext — this portal is for
          chronic monthly packs only.
        </p>
      </section>

      {!isAuthenticated ? (
        <section className="card card-wide">
          <h2>Sign in to request a quote</h2>
          <p className="muted">Prescription upload and order tracking require an account.</p>
          <Link className="btn" to="/login" state={{ from: '/pharmacy' }}>
            Sign in
          </Link>
        </section>
      ) : (
        <form className="form card card-wide" onSubmit={onSubmit}>
          <h2>Request a quotation</h2>

          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </label>

          <label>
            Mobile number
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              inputMode="tel"
              placeholder="10-digit mobile"
              autoComplete="tel"
            />
          </label>

          <LocationField
            label="Delivery address (GPS picker)"
            value={address}
            onChange={setAddress}
            onCoordsChange={(lat, lng) => {
              setLatitude(lat);
              setLongitude(lng);
            }}
            required
          />

          <label>
            Pack duration (months)
            <select
              value={durationMonths}
              onChange={(e) => setDurationMonths(Number(e.target.value))}
              required
            >
              {MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} month{m === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          </label>

          <label>
            Desired discount slab (optional)
            <select
              value={discountSlab}
              onChange={(e) => setDiscountSlab(e.target.value as (typeof DISCOUNT_SLABS)[number])}
            >
              {DISCOUNT_SLABS.map((slab) => (
                <option key={slab || 'none'} value={slab}>
                  {slab || 'No preference'}
                </option>
              ))}
            </select>
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
            {loading ? 'Submitting…' : 'Submit quote request'}
          </button>
        </form>
      )}
    </>
  );
}

