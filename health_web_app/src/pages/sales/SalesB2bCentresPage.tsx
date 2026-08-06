import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, B2bCollectionCentre, B2bLogisticsAssignment } from '../../api';

const STATUS_FILTERS = ['All', 'Active', 'Inactive', 'Deboarded'];

const emptyLogistics = (): B2bLogisticsAssignment => ({
  person_name: '',
  contact_number: '',
  pickup_point: '',
  logistics_cost: 0,
});

function statusClass(status?: string) {
  const key = (status || 'active').toLowerCase().replace(/\s+/g, '');
  if (key === 'active') return 'reach-status positive';
  if (key === 'inactive' || key === 'deboarded') return 'reach-status lost';
  return `reach-status ${key}`;
}

function money(value?: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

export function SalesB2bCentresPage() {
  const [centres, setCentres] = useState<B2bCollectionCentre[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');

  const [centreName, setCentreName] = useState('');
  const [walletAmount, setWalletAmount] = useState('');
  const [totalDeposit, setTotalDeposit] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [googleMapLocation, setGoogleMapLocation] = useState('');
  const [remarks, setRemarks] = useState('');
  const [logistics, setLogistics] = useState<B2bLogisticsAssignment[]>([emptyLogistics()]);

  const visibleCentres = useMemo(() => {
    if (statusFilter === 'All') return centres;
    return centres.filter((centre) => (centre.status || 'Active') === statusFilter);
  }, [centres, statusFilter]);

  async function load() {
    setError(null);
    try {
      const res = await api.listB2bCollectionCentres();
      setCentres(res.data.centres || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load B2B centres');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function resetForm() {
    setCentreName('');
    setWalletAmount('');
    setTotalDeposit('');
    setContactNumber('');
    setManualAddress('');
    setGoogleMapLocation('');
    setRemarks('');
    setLogistics([emptyLogistics()]);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await api.createB2bCollectionCentre({
        centre_name: centreName,
        wallet_amount: Number(walletAmount) || 0,
        total_deposit: Number(totalDeposit) || 0,
        contact_number: contactNumber,
        manual_address: manualAddress,
        google_map_location: googleMapLocation,
        remarks,
        logistics_assignments: logistics.filter((row) => row.person_name.trim()),
      });
      resetForm();
      setShowForm(false);
      setMessage('B2B collection centre registered and synced to FFMS.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to register centre');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="reach-leads-page">
      <div className="reach-page-head">
        <div>
          <h1>B2B Centres</h1>
          <p>
            Register collection centres with multi-person logistics details. Records sync to FFMS for
            Admin/Manager review.
          </p>
        </div>
        <div className="reach-page-actions">
          <label className="reach-filter">
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="reach-btn" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ Register centre'}
          </button>
        </div>
      </div>

      {message ? <div className="reach-alert ok">{message}</div> : null}
      {error ? <div className="reach-alert err">{error}</div> : null}

      {showForm ? (
        <form className="reach-card" onSubmit={onSubmit}>
          <div className="reach-card-head">
            <div className="reach-card-icon" aria-hidden>
              +
            </div>
            <div>
              <h2>Register centre</h2>
              <p>Capture wallet, deposit, address and logistics so FFMS can track the B2B partnership.</p>
            </div>
          </div>

          <div className="reach-form-grid">
            <label className="reach-field span-2">
              Collection centre name *
              <input
                required
                value={centreName}
                onChange={(e) => setCentreName(e.target.value)}
                placeholder="Partner collection centre"
              />
            </label>
            <label className="reach-field">
              Wallet amount
              <input
                type="number"
                min={0}
                value={walletAmount}
                onChange={(e) => setWalletAmount(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="reach-field">
              Total deposit
              <input
                type="number"
                min={0}
                value={totalDeposit}
                onChange={(e) => setTotalDeposit(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="reach-field">
              Contact number
              <input
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="10-digit mobile"
              />
            </label>
            <label className="reach-field">
              Google Map location
              <input
                value={googleMapLocation}
                onChange={(e) => setGoogleMapLocation(e.target.value)}
                placeholder="https://maps.google.com/..."
              />
            </label>
            <label className="reach-field full">
              Manual address
              <textarea
                value={manualAddress}
                onChange={(e) => setManualAddress(e.target.value)}
                rows={2}
                placeholder="Street, landmark, locality"
              />
            </label>
            <label className="reach-field full">
              Remarks
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={2}
                placeholder="Any follow-up notes for Admin"
              />
            </label>
          </div>

          <div className="reach-card-head" style={{ marginTop: 8 }}>
            <div>
              <h2>Logistics personnel</h2>
              <p>Add one or more pickup contacts linked to this centre.</p>
            </div>
          </div>

          {logistics.map((row, index) => (
            <div className="reach-form-grid" key={`logistics-${index}`}>
              <label className="reach-field">
                Person name {index === 0 ? '*' : ''}
                <input
                  required={index === 0}
                  value={row.person_name}
                  onChange={(e) =>
                    setLogistics((current) =>
                      current.map((item, i) => (i === index ? { ...item, person_name: e.target.value } : item)),
                    )
                  }
                  placeholder="Logistics contact"
                />
              </label>
              <label className="reach-field">
                Contact
                <input
                  value={row.contact_number || ''}
                  onChange={(e) =>
                    setLogistics((current) =>
                      current.map((item, i) => (i === index ? { ...item, contact_number: e.target.value } : item)),
                    )
                  }
                  placeholder="Phone"
                />
              </label>
              <label className="reach-field">
                Pickup point
                <input
                  value={row.pickup_point || ''}
                  onChange={(e) =>
                    setLogistics((current) =>
                      current.map((item, i) => (i === index ? { ...item, pickup_point: e.target.value } : item)),
                    )
                  }
                  placeholder="Pickup location"
                />
              </label>
              <label className="reach-field">
                Logistics cost
                <input
                  type="number"
                  min={0}
                  value={row.logistics_cost ?? 0}
                  onChange={(e) =>
                    setLogistics((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, logistics_cost: Number(e.target.value) || 0 } : item,
                      ),
                    )
                  }
                />
              </label>
            </div>
          ))}

          <div className="reach-form-footer">
            <button
              type="button"
              className="reach-btn secondary"
              onClick={() => setLogistics((current) => [...current, emptyLogistics()])}
            >
              + Add logistics person
            </button>
            <button type="submit" className="reach-btn" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save centre'}
            </button>
          </div>
        </form>
      ) : null}

      <section className="reach-panel" style={{ marginTop: showForm ? 16 : 0 }}>
        <div className="reach-panel-head">
          <h2>Centre directory</h2>
          <span>
            {visibleCentres.length} centre{visibleCentres.length === 1 ? '' : 's'}
            {statusFilter !== 'All' ? ` · ${statusFilter}` : ''}
          </span>
        </div>
        <div className="reach-table-wrap">
          <table className="reach-table">
            <thead>
              <tr>
                <th>Centre</th>
                <th>Contact</th>
                <th>Wallet / Deposit</th>
                <th>Logistics</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleCentres.map((centre) => (
                <tr key={centre.name}>
                  <td>
                    <div className="lead-name">{centre.centre_name}</div>
                    {centre.manual_address ? <div className="sub">{centre.manual_address}</div> : null}
                  </td>
                  <td>{centre.contact_number || '—'}</td>
                  <td>
                    {money(centre.wallet_amount)}
                    <div className="sub">Deposit {money(centre.total_deposit)}</div>
                  </td>
                  <td>
                    {(centre.logistics_assignments || []).map((row) => row.person_name).filter(Boolean).join(', ') ||
                      '—'}
                  </td>
                  <td>
                    <span className={statusClass(centre.status)}>{centre.status || 'Active'}</span>
                  </td>
                </tr>
              ))}
              {!visibleCentres.length ? (
                <tr>
                  <td colSpan={5} className="reach-empty">
                    No centres yet. Register a new B2B collection centre to start the pipeline.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      <p className="reach-pipeline-hint">Flow: Register on Reach → Sync to FFMS → Admin/Manager review</p>
    </div>
  );
}
