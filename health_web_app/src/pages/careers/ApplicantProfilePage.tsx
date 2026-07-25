import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../api';

export function ApplicantProfilePage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getMyCareerHub();
        if (cancelled) return;
        const p = res.data.profile || {};
        setFullName(String(p.full_name || ''));
        setEmail(String(p.contact_email || p.email || ''));
        setMobile(String(p.mobile || ''));
        setCity(String(p.city || ''));
        setAddress(String(p.address || ''));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load profile');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setOk(null);
    try {
      await api.updateMyCareerProfile({
        full_name: fullName,
        email,
        mobile,
        city,
        address,
      });
      setOk('Profile saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="careers-hr-page">
      <h1>Profile</h1>
      <p className="muted">Used to prefill job applications.</p>
      <form className="form card card-wide" onSubmit={onSave}>
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Mobile
          <input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" />
        </label>
        <label>
          City
          <input value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        <label>
          Address
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
        </label>
        {error ? <div className="error">{error}</div> : null}
        {ok ? <p className="muted">{ok}</p> : null}
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Saving…' : 'Save profile'}
        </button>
      </form>
    </div>
  );
}
