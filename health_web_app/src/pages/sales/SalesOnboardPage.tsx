import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, SalesLead } from '../../api';

export function SalesOnboardPage() {
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [franchiseeId, setFranchiseeId] = useState<string | null>(null);

  const [leadId, setLeadId] = useState('');
  const [franchiseName, setFranchiseName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [territory, setTerritory] = useState('East India');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [commission, setCommission] = useState('12.5');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    void api
      .getSalesLeads()
      .then((res) => setLeads(res.data.leads || []))
      .catch(() => undefined);
  }, []);

  function pickLead(id: string) {
    setLeadId(id);
    const lead = leads.find((l) => l.name === id);
    if (!lead) return;
    setFranchiseName(lead.lead_name);
    setPhone(lead.phone);
    setTerritory(lead.city || territory);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.submitSalesOnboarding({
        ...(leadId ? { lead_id: leadId } : {}),
        franchise_name: franchiseName,
        owner_name: ownerName,
        proposed_branch_code: branchCode.toUpperCase(),
        territory_region: territory,
        address,
        phone,
        email,
        commission_percentage_rate: commission,
        notes,
      });
      setFranchiseeId(res.data.franchisee_id);
      setMessage(`Franchisee ${res.data.franchisee_id} created and linked to your portfolio.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onboarding failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1>Onboard franchisee</h1>
      <p className="muted">Complete franchise registration — creates Franchisee Profile and B2B wallet.</p>

      {message ? (
        <div className="success">
          {message}
          {franchiseeId ? (
            <div style={{ marginTop: 8 }}>
              <Link to="/sales/franchisees">View franchisee stats →</Link>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <div className="error">{error}</div> : null}

      <form className="card form-stack" onSubmit={onSubmit}>
        <label>
          From lead (optional)
          <select value={leadId} onChange={(e) => pickLead(e.target.value)}>
            <option value="">— New —</option>
            {leads
              .filter((l) => l.status !== 'Won')
              .map((l) => (
                <option key={l.name} value={l.name}>
                  {l.lead_name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Franchise / lab name *
          <input value={franchiseName} onChange={(e) => setFranchiseName(e.target.value)} required />
        </label>
        <label>
          Owner name *
          <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required />
        </label>
        <label>
          Branch code * (unique, e.g. KOL-01)
          <input
            value={branchCode}
            onChange={(e) => setBranchCode(e.target.value.toUpperCase())}
            required
            pattern="[A-Z0-9-]+"
          />
        </label>
        <label>
          Territory / region *
          <input value={territory} onChange={(e) => setTerritory(e.target.value)} required />
        </label>
        <label>
          Address
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
        </label>
        <label>
          Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Commission % (default 12.5)
          <input type="number" step="0.1" value={commission} onChange={(e) => setCommission(e.target.value)} />
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit onboarding'}
        </button>
      </form>
    </>
  );
}
