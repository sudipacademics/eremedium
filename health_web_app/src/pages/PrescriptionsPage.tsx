import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ClinicalPrescription, Franchisee, franchiseeLabel } from '../api';
import { useAuth } from '../auth/AuthContext';

function toLocalDatetime(slot: string) {
  const normalized = slot.includes('T') ? slot.replace('T', ' ') : slot;
  return normalized.length === 16 ? `${normalized}:00` : normalized;
}

export function PrescriptionsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [prescriptions, setPrescriptions] = useState<ClinicalPrescription[]>([]);
  const [active, setActive] = useState<ClinicalPrescription | null>(null);
  const [centres, setCentres] = useState<Franchisee[]>([]);
  const [franchiseeId, setFranchiseeId] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [slot, setSlot] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.getMyPrescriptions(50);
    setPrescriptions(res.data.prescriptions || []);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load prescriptions'));
  }, [load]);

  useEffect(() => {
    if (!user) return;
    void api
      .searchFranchisees('')
      .then((res) => {
        const list = res.data.franchisees || [];
        setCentres(list);
        if (list[0]) setFranchiseeId(list[0].name);
      })
      .catch(() => setCentres([]));
  }, [user]);

  async function openPrescription(name: string) {
    setError(null);
    try {
      const res = await api.getClinicalPrescription(name);
      setActive(res.data.prescription);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load prescription');
    }
  }

  async function orderMedicines() {
    if (!active) return;
    setBusy(`rx-${active.name}`);
    setError(null);
    try {
      const res = await api.orderPharmacyFromPrescription({
        prescription_id: active.name,
        ...(address.trim() ? { delivery_address: address.trim() } : {}),
        ...(phone.trim() ? { customer_phone: phone.trim() } : {}),
      });
      setActive(null);
      setNotice(`Pharmacy order ${res.data.order_id} created — track it in My orders.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create pharmacy order');
    } finally {
      setBusy(null);
    }
  }

  async function bookLabTests() {
    if (!active || !franchiseeId) return;
    setBusy(`lab-${active.name}`);
    setError(null);
    try {
      const res = await api.orderDiagnosticsFromPrescription({
        prescription_id: active.name,
        franchisee_id: franchiseeId,
        ...(address.trim() ? { collection_address: address.trim() } : {}),
        ...(slot.trim() ? { collection_slot: toLocalDatetime(slot) } : {}),
      });
      const trfId = res.data.trfs?.[0]?.trf_id;
      setActive(null);
      setNotice(
        trfId
          ? `Lab booking ${trfId} created — track sample collection in My orders.`
          : 'Lab tests booked from your prescription.',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not book lab tests');
    } finally {
      setBusy(null);
    }
  }

  if (!user) {
    return (
      <div className="card">
        <h1>Prescriptions</h1>
        <p className="muted">Sign in to view your e-prescriptions.</p>
        <button className="btn" type="button" onClick={() => navigate('/login')}>
          Sign in
        </button>
      </div>
    );
  }

  return (
    <>
      <section className="hero hero-compact">
        <h1>My prescriptions</h1>
        <p className="muted">
          Digital prescriptions from your doctor. Order medicines and book prescribed lab tests in one place.
        </p>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Rx</th>
              <th>Date</th>
              <th>Diagnosis</th>
              <th>Meds</th>
              <th>Tests</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {prescriptions.map((rx) => (
              <tr key={rx.name}>
                <td>{rx.name}</td>
                <td>{rx.encounter_date || '—'}</td>
                <td>{rx.diagnosis || '—'}</td>
                <td>{rx.medicine_count ?? 0}</td>
                <td>{rx.diagnostic_count ?? 0}</td>
                <td>
                  <span className="badge">{rx.status || '—'}</span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button type="button" className="btn btn-sm" onClick={() => void openPrescription(rx.name)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!prescriptions.length ? (
          <p className="muted">
            No prescriptions yet. Book a <Link to="/telemedicine">doctor consultation</Link> to get started.
          </p>
        ) : null}
      </div>

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.5)',
            zIndex: 1000,
            overflowY: 'auto',
          }}
        >
          <div className="card" style={{ maxWidth: 680, width: '94%', margin: '6vh auto' }}>
            <h2>{active.name}</h2>
            <p className="muted">
              {active.encounter_date}
              {active.department ? ` · ${active.department}` : ''} · {active.status}
            </p>
            {active.diagnosis ? (
              <p>
                <strong>Diagnosis:</strong> {active.diagnosis}
              </p>
            ) : null}
            {active.clinical_notes ? <p className="muted">{active.clinical_notes}</p> : null}

            {(active.medicines || []).length ? (
              <>
                <h3>Medicines</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Medicine</th>
                        <th>Dosage</th>
                        <th>Frequency</th>
                        <th>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(active.medicines || []).map((m, i) => (
                        <tr key={i}>
                          <td>{m.item_name || m.medicine_item}</td>
                          <td>{m.dosage || '—'}</td>
                          <td>{m.frequency || '—'}</td>
                          <td>{m.duration || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}

            {(active.diagnostics || []).length ? (
              <>
                <h3 style={{ marginTop: 16 }}>Lab tests prescribed</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Test</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(active.diagnostics || []).map((d, i) => (
                        <tr key={i}>
                          <td>{d.test_name || d.diagnostic_test || d.item_name || d.item}</td>
                          <td>{d.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}

            {(active.medicines || []).length ? (
              <>
                <h3 style={{ marginTop: 16 }}>Order medicines</h3>
                <div style={{ display: 'grid', gap: 10 }}>
                  <label>
                    Delivery address
                    <input
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Home address / OPD counter"
                    />
                  </label>
                  <label>
                    Contact phone
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </label>
                </div>
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy === `rx-${active.name}`}
                    onClick={() => void orderMedicines()}
                  >
                    {busy === `rx-${active.name}` ? 'Ordering…' : 'Order these medicines'}
                  </button>
                </div>
              </>
            ) : null}

            {(active.diagnostics || []).length ? (
              <>
                <h3 style={{ marginTop: 16 }}>Book lab tests</h3>
                <div style={{ display: 'grid', gap: 10 }}>
                  <label>
                    Collection centre
                    <select value={franchiseeId} onChange={(e) => setFranchiseeId(e.target.value)} required>
                      {centres.map((c) => (
                        <option key={c.name} value={c.name}>
                          {franchiseeLabel(c)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Home collection address
                    <input
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Full address for phlebotomist visit"
                    />
                  </label>
                  <label>
                    Preferred slot
                    <input type="datetime-local" value={slot} onChange={(e) => setSlot(e.target.value)} />
                  </label>
                </div>
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy === `lab-${active.name}` || !franchiseeId}
                    onClick={() => void bookLabTests()}
                  >
                    {busy === `lab-${active.name}` ? 'Booking…' : 'Book prescribed tests'}
                  </button>
                </div>
              </>
            ) : null}

            <div style={{ marginTop: 16 }}>
              <button type="button" className="btn secondary" onClick={() => setActive(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p className="muted" style={{ marginTop: 16 }}>
        <Link to="/bookings">My orders</Link> · <Link to="/pharmacy">Pharmacy</Link> ·{' '}
        <Link to="/diagnostics">Diagnostics</Link>
      </p>
    </>
  );
}
