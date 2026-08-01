import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, SalesLead } from '../../api';
import { captureSalesGps } from '../../hooks/useSalesGps';
import { useWbGeoHierarchy } from '../../hooks/useWbGeoHierarchy';

const LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Negotiation', 'Won', 'Lost'];
const SOURCE_FILTERS = ['All', 'Manual', 'Meta Ads', 'Google Ads', 'WhatsApp Ads', 'Website', 'Reach'];

function statusClass(status?: string) {
  return `reach-status ${(status || 'new').toLowerCase().replace(/\s+/g, '')}`;
}

export function SalesLeadsPage() {
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('All');
  const { districts, subdivisionsFor, pincodesFor, error: geoError } = useWbGeoHierarchy();

  const [leadName, setLeadName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [subdivision, setSubdivision] = useState('');
  const [pincode, setPincode] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);

  const subdivisions = district ? subdivisionsFor(district) : [];
  const pincodes = district ? pincodesFor(district, subdivision || undefined) : [];

  const visibleLeads = useMemo(() => {
    if (sourceFilter === 'All') return leads;
    return leads.filter((lead) => (lead.lead_source || 'Manual') === sourceFilter);
  }, [leads, sourceFilter]);

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
        city: city || district,
        district,
        subdivision,
        pincode,
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
      setDistrict('');
      setSubdivision('');
      setPincode('');
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
    <div className="reach-leads-page">
      <div className="reach-page-head">
        <div>
          <h1>Franchise leads</h1>
          <p>Capture new prospects and track them through the field pipeline. Ads leads stay unassigned until a manager allocates them.</p>
        </div>
        <div className="reach-page-actions">
          <label className="reach-filter">
            Source
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              {SOURCE_FILTERS.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="reach-btn" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'Add new lead'}
          </button>
        </div>
      </div>

      {message ? <div className="reach-alert ok">{message}</div> : null}
      {error ? <div className="reach-alert err">{error}</div> : null}
      {geoError ? <div className="reach-alert err">{geoError}</div> : null}

      {showForm ? (
        <form className="reach-card" onSubmit={onSubmit}>
          <div className="reach-card-head">
            <div className="reach-card-icon" aria-hidden>
              +
            </div>
            <div>
              <h2>Add new lead</h2>
              <p>Enter contact details, territory and optional GPS so the team can follow up in the field.</p>
            </div>
          </div>

          <div className="reach-form-grid">
            <label className="reach-field">
              Lead / clinic name *
              <input required value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="Prospect or clinic name" />
            </label>
            <label className="reach-field">
              Company name
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Legal / trade name" />
            </label>
            <label className="reach-field">
              Contact person
              <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="Decision maker" />
            </label>
            <label className="reach-field">
              Phone *
              <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />
            </label>
            <label className="reach-field">
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
            </label>
            <label className="reach-field">
              District
              <select
                value={district}
                onChange={(e) => {
                  setDistrict(e.target.value);
                  setSubdivision('');
                  setPincode('');
                }}
              >
                <option value="">Select district</option>
                {districts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="reach-field">
              Subdivision
              <select
                value={subdivision}
                onChange={(e) => {
                  setSubdivision(e.target.value);
                  setPincode('');
                }}
                disabled={!district}
              >
                <option value="">{district ? 'Select subdivision' : 'Choose district first'}</option>
                {subdivisions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="reach-field">
              PIN code
              <select value={pincode} onChange={(e) => setPincode(e.target.value)} disabled={!district}>
                <option value="">{district ? 'Select PIN' : 'Choose district first'}</option>
                {pincodes.map((pin) => (
                  <option key={pin} value={pin}>
                    {pin}
                  </option>
                ))}
              </select>
            </label>
            <label className="reach-field">
              City / Corporation
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Optional free-text city" />
            </label>
            <label className="reach-field span-2">
              Address
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, landmark, locality" />
            </label>
            <label className="reach-field full">
              Notes
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Context for the next follow-up" />
            </label>
          </div>

          <div className="reach-form-footer">
            <div className="reach-gps">
              <button type="button" className="reach-btn secondary" onClick={() => void captureGps()}>
                Capture GPS
              </button>
              {latitude != null ? (
                <code>
                  {latitude.toFixed(5)}, {longitude?.toFixed(5)}
                </code>
              ) : (
                <span>Optional — attach current location</span>
              )}
            </div>
            <button type="submit" className="reach-btn" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save lead'}
            </button>
          </div>
        </form>
      ) : null}

      <section className="reach-panel" style={{ marginTop: showForm ? 16 : 0 }}>
        <div className="reach-panel-head">
          <h2>Lead pipeline</h2>
          <span>
            {visibleLeads.length} lead{visibleLeads.length === 1 ? '' : 's'}
            {sourceFilter !== 'All' ? ` · ${sourceFilter}` : ''}
          </span>
        </div>
        <div className="reach-table-wrap">
          <table className="reach-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Source / campaign</th>
                <th>Phone</th>
                <th>District / PIN</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleLeads.map((l) => (
                <tr key={l.name}>
                  <td>
                    <div className="lead-name">{l.lead_name}</div>
                    {l.company_name ? <div className="sub">{l.company_name}</div> : null}
                    {!l.assigned_rep ? <div className="sub">Unassigned</div> : null}
                  </td>
                  <td>
                    {l.lead_source || 'Manual'}
                    {l.campaign_name ? <div className="sub">{l.campaign_name}</div> : null}
                    {l.external_lead_id ? <div className="sub">{l.external_lead_id}</div> : null}
                  </td>
                  <td>{l.phone}</td>
                  <td>
                    {l.district || l.city || '—'}
                    {l.pincode ? <div className="sub">PIN {l.pincode}</div> : null}
                  </td>
                  <td>
                    <span className={statusClass(l.status)}>{l.status}</span>
                  </td>
                </tr>
              ))}
              {!visibleLeads.length ? (
                <tr>
                  <td colSpan={5} className="reach-empty">
                    No leads yet. Add a new lead or wait for ads imports.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      <p className="reach-pipeline-hint">Statuses: {LEAD_STATUSES.join(' → ')}</p>
    </div>
  );
}
