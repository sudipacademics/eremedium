import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, B2bCollectionCentre, B2bSalesEntry } from '../../api';

function statusClass(status?: string) {
  const key = (status || 'submitted').toLowerCase().replace(/\s+/g, '');
  if (key === 'submitted' || key === 'synced') return 'reach-status new';
  if (key === 'closed' || key === 'approved') return 'reach-status positive';
  if (key === 'rejected' || key === 'failed') return 'reach-status lost';
  return `reach-status ${key}`;
}

function money(value?: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

export function SalesB2bSalesPage() {
  const [centres, setCentres] = useState<B2bCollectionCentre[]>([]);
  const [entries, setEntries] = useState<B2bSalesEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [centreFilter, setCentreFilter] = useState('All');

  const [centreId, setCentreId] = useState('');
  const [samples, setSamples] = useState('');
  const [businessValue, setBusinessValue] = useState('');
  const [logisticsPerson, setLogisticsPerson] = useState('');
  const [salesDate, setSalesDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState('');

  const selectedCentre = useMemo(
    () => centres.find((item) => item.name === centreId) || null,
    [centres, centreId],
  );
  const logisticsOptions = selectedCentre?.logistics_assignments || [];

  const visibleEntries = useMemo(() => {
    if (centreFilter === 'All') return entries;
    return entries.filter(
      (entry) =>
        entry.b2b_collection_centre === centreFilter || entry.centre_name === centreFilter,
    );
  }, [entries, centreFilter]);

  async function load() {
    setError(null);
    try {
      const [centresRes, salesRes] = await Promise.all([
        api.listB2bCollectionCentres(),
        api.listB2bSalesEntries(),
      ]);
      setCentres(centresRes.data.centres || []);
      setEntries(salesRes.data.entries || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load B2B sales');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function resetForm() {
    setSamples('');
    setBusinessValue('');
    setLogisticsPerson('');
    setRemarks('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await api.submitB2bSalesEntry({
        b2b_collection_centre: centreId,
        number_of_samples: Number(samples) || 0,
        business_value: Number(businessValue) || 0,
        assigned_logistics_person: logisticsPerson,
        sales_date: salesDate,
        remarks,
      });
      resetForm();
      setShowForm(false);
      setMessage('B2B sales submitted. Synced to FFMS and linked to today’s Closing draft for expense upload.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit B2B sales');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="reach-leads-page">
      <div className="reach-page-head">
        <div>
          <h1>B2B Sales</h1>
          <p>
            Submit daily B2B sales activity by centre. Successful entries sync to FFMS and Closing
            Submission.
          </p>
        </div>
        <div className="reach-page-actions">
          <label className="reach-filter">
            Centre
            <select value={centreFilter} onChange={(e) => setCentreFilter(e.target.value)}>
              <option value="All">All</option>
              {centres.map((centre) => (
                <option key={centre.name} value={centre.name}>
                  {centre.centre_name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="reach-btn"
            onClick={() => setShowForm((v) => !v)}
            disabled={!centres.length && !showForm}
          >
            {showForm ? 'Cancel' : '+ Add sales entry'}
          </button>
        </div>
      </div>

      {message ? <div className="reach-alert ok">{message}</div> : null}
      {error ? <div className="reach-alert err">{error}</div> : null}
      {!centres.length ? (
        <div className="reach-alert err">Register a B2B centre first before logging sales.</div>
      ) : null}

      {showForm ? (
        <form className="reach-card" onSubmit={onSubmit}>
          <div className="reach-card-head">
            <div className="reach-card-icon" aria-hidden>
              +
            </div>
            <div>
              <h2>New daily sales entry</h2>
              <p>Record samples and business value for one B2B collection centre.</p>
            </div>
          </div>

          <div className="reach-form-grid">
            <label className="reach-field span-2">
              B2B collection centre *
              <select
                required
                value={centreId}
                onChange={(e) => {
                  setCentreId(e.target.value);
                  setLogisticsPerson('');
                }}
              >
                <option value="">Select centre</option>
                {centres.map((centre) => (
                  <option key={centre.name} value={centre.name}>
                    {centre.centre_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="reach-field">
              Date *
              <input required type="date" value={salesDate} onChange={(e) => setSalesDate(e.target.value)} />
            </label>
            <label className="reach-field">
              Number of samples *
              <input
                required
                type="number"
                min={0}
                value={samples}
                onChange={(e) => setSamples(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="reach-field">
              Business value *
              <input
                required
                type="number"
                min={0}
                value={businessValue}
                onChange={(e) => setBusinessValue(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="reach-field">
              Assigned logistics person
              <select value={logisticsPerson} onChange={(e) => setLogisticsPerson(e.target.value)}>
                <option value="">Select logistics person</option>
                {logisticsOptions.map((row) => (
                  <option key={row.person_name} value={row.person_name}>
                    {row.person_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="reach-field full">
              Remarks
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={2}
                placeholder="Context for closing / Admin review"
              />
            </label>
          </div>

          <div className="reach-form-footer">
            <span className="muted" style={{ fontSize: 13 }}>
              Synced entries appear in Closing for expense upload.
            </span>
            <button type="submit" className="reach-btn" disabled={submitting || !centres.length}>
              {submitting ? 'Submitting…' : 'Submit sales'}
            </button>
          </div>
        </form>
      ) : null}

      <section className="reach-panel" style={{ marginTop: showForm ? 16 : 0 }}>
        <div className="reach-panel-head">
          <h2>Sales activity</h2>
          <span>
            {visibleEntries.length} entr{visibleEntries.length === 1 ? 'y' : 'ies'}
            {centreFilter !== 'All'
              ? ` · ${centres.find((c) => c.name === centreFilter)?.centre_name || centreFilter}`
              : ''}
          </span>
        </div>
        <div className="reach-table-wrap">
          <table className="reach-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Centre</th>
                <th>Samples</th>
                <th>Value</th>
                <th>Logistics</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => (
                <tr key={entry.name}>
                  <td>{entry.sales_date}</td>
                  <td>
                    <div className="lead-name">{entry.centre_name || entry.b2b_collection_centre}</div>
                    {entry.remarks ? <div className="sub">{entry.remarks}</div> : null}
                  </td>
                  <td>{entry.number_of_samples}</td>
                  <td>{money(entry.business_value)}</td>
                  <td>{entry.assigned_logistics_person || '—'}</td>
                  <td>
                    <span className={statusClass(entry.status)}>{entry.status || 'Submitted'}</span>
                  </td>
                </tr>
              ))}
              {!visibleEntries.length ? (
                <tr>
                  <td colSpan={6} className="reach-empty">
                    No B2B sales entries yet. Add a daily sales entry to start tracking.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      <p className="reach-pipeline-hint">Flow: Daily entry → FFMS sync → Closing draft → Expense upload</p>
    </div>
  );
}
