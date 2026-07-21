import { FormEvent, useEffect, useState } from 'react';
import { api, SalesLead } from '../../api';
import { captureSalesGps } from '../../hooks/useSalesGps';

const LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Negotiation', 'Won', 'Lost'];

export function SalesLeadsPage() {
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [leadName, setLeadName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await api.getSalesLeads();
      setLeads(res.data.leads || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leads');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function captureGps() {
    try {
      const pos = await captureSalesGps();
      setLatitude(pos.latitude);
      setLongitude(pos.longitude);
      setMessage(pos.note ? `GPS captured (${pos.note})` : 'GPS captured');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'GPS failed');
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await api.createSalesLead({
        lead_name: leadName,
        company_name: companyName,
        contact_person: contactPerson,
        phone,
        email,
        city,
        address,
        notes,
        status: 'New',
        ...(latitude != null ? { latitude, longitude: longitude ?? 0 } : {}),
      });
      setMessage('Lead created');
      setShowForm(false);
      setLeadName('');
      setCompanyName('');
      setContactPerson('');
      setPhone('');
      setEmail('');
      setCity('');
      setAddress('');
      setNotes('');
      setLatitude(null);
      setLongitude(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1>Franchise leads</h1>
      <p className="muted">Track potential franchisee prospects through the pipeline.</p>

      <div className="toolbar">
        <button type="button" className="btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : 'Add lead'}
        </button>
      </div>

      {message ? <div className="success">{message}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      {showForm ? (
        <form className="card form-stack" onSubmit={onSubmit} style={{ marginTop: 16 }}>
          <label>
            Lead / clinic name *
            <input value={leadName} onChange={(e) => setLeadName(e.target.value)} required />
          </label>
          <label>
            Company name
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </label>
          <label>
            Contact person
            <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
          </label>
          <label>
            Phone *
            <input value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            City
            <input value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
          <label>
            Address
            <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
          </label>
          <label>
            Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
          <div className="toolbar">
            <button type="button" className="btn secondary" onClick={() => void captureGps()}>
              Capture GPS
            </button>
            {latitude != null ? (
              <span className="muted">
                {latitude.toFixed(5)}, {longitude?.toFixed(5)}
              </span>
            ) : null}
          </div>
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save lead'}
          </button>
        </form>
      ) : null}

      <table className="data-table" style={{ marginTop: 24 }}>
        <thead>
          <tr>
            <th>Lead</th>
            <th>Phone</th>
            <th>City</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.name}>
              <td>
                <strong>{l.lead_name}</strong>
                {l.company_name ? <div className="muted">{l.company_name}</div> : null}
              </td>
              <td>{l.phone}</td>
              <td>{l.city || '—'}</td>
              <td>
                <span className={`badge badge-${l.status?.toLowerCase() || 'new'}`}>{l.status}</span>
              </td>
            </tr>
          ))}
          {!leads.length ? (
            <tr>
              <td colSpan={4} className="muted">
                No leads yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
        Statuses: {LEAD_STATUSES.join(' → ')}
      </p>
    </>
  );
}
