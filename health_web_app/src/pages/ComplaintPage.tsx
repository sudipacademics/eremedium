import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export function ComplaintPage() {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ackId, setAckId] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setAckId(null);
    try {
      const res = await api.submitLabComplaint({
        subject,
        description,
        contact_name: contactName,
        contact_phone: contactPhone,
        contact_email: contactEmail,
        source: 'Customer',
      });
      setAckId(res.data.ack_id);
      setSubject('');
      setDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hero" style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1>Submit a complaint</h1>
      <p className="muted">
        We acknowledge every complaint with an ID (NABL 132-style redressal). Staff investigate and may open CAPA.
      </p>

      {ackId ? (
        <div className="notice">
          Complaint received. Your acknowledgement ID is <strong>{ackId}</strong>. Please keep this for follow-up.
        </div>
      ) : null}
      {error ? <div className="error">{error}</div> : null}

      <form className="form-stack" onSubmit={onSubmit}>
        <label>
          Your name
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </label>
        <label>
          Phone
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </label>
        <label>
          Email
          <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </label>
        <label>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} required />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} required rows={5} />
        </label>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit complaint'}
        </button>
      </form>

      <p className="muted" style={{ marginTop: 24 }}>
        <Link to="/">Back to home</Link>
      </p>
    </section>
  );
}
