import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, LabReagentBatch, LabReagentDashboard } from '../../api';

export function ReagentDashboardPage() {
  const [data, setData] = useState<LabReagentDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reagentItem, setReagentItem] = useState('REAGENT-CBC');
  const [lotNumber, setLotNumber] = useState('');
  const [testsPerPack, setTestsPerPack] = useState('100');
  const [expiryDate, setExpiryDate] = useState('');
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  async function load() {
    const res = await api.getLabReagentDashboard();
    setData(res.data);
    if (res.data.reagent_items?.[0] && !reagentItem) {
      setReagentItem(res.data.reagent_items[0].item_code);
    }
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load reagents'));
  }, []);

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    setBusy('register');
    setFormSuccess(null);
    setError(null);
    try {
      const res = await api.registerLabReagentBatch({
        reagent_item: reagentItem,
        lot_number: lotNumber,
        tests_per_pack: testsPerPack,
        expiry_date: expiryDate || undefined,
      });
      setFormSuccess(`Batch ${res.data.batch_id} registered (sealed)`);
      setLotNumber('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(null);
    }
  }

  async function onOpen(batchId: string) {
    setBusy(batchId);
    setError(null);
    try {
      const res = await api.openLabReagentBatch(batchId);
      setFormSuccess(`Opened ${res.data.batch_id} — ${res.data.tests_remaining} tests available`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Open pack failed');
    } finally {
      setBusy(null);
    }
  }

  if (!data && !error) {
    return <p>Loading reagent dashboard…</p>;
  }

  if (data && !data.available) {
    return <div className="error">Lab operations access required.</div>;
  }

  const batches = data?.batches || [];
  const alerts = data?.low_stock_alerts || [];

  return (
    <>
      <section className="hero hero-compact">
        <h1>Reagent batches</h1>
        <p className="muted">
          Open packs to set test quotas. When a TRF completes, linked reagents auto-decrement.
          {data?.rules_count ? ` ${data.rules_count} test→reagent rules active.` : ''}
        </p>
      </section>

      {alerts.length ? (
        <div className="error" style={{ marginBottom: 16 }}>
          <strong>Low stock:</strong>{' '}
          {alerts.map((b) => `${b.reagent_name} (lot ${b.lot_number}, ${b.tests_remaining} left)`).join(' · ')}
        </div>
      ) : null}

      {error ? <div className="error">{error}</div> : null}
      {formSuccess ? <div className="success">{formSuccess}</div> : null}

      <form className="card card-wide form-stack" onSubmit={onRegister}>
        <h2>Register new pack</h2>
        <label>
          Reagent
          <select value={reagentItem} onChange={(e) => setReagentItem(e.target.value)} required>
            {(data?.reagent_items || []).map((item) => (
              <option key={item.item_code} value={item.item_code}>
                {item.item_name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            Lot number
            <input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} required />
          </label>
          <label>
            Tests per pack
            <input
              type="number"
              min={1}
              value={testsPerPack}
              onChange={(e) => setTestsPerPack(e.target.value)}
              required
            />
          </label>
        </div>
        <label>
          Expiry date (optional)
          <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        </label>
        <button className="btn" type="submit" disabled={busy === 'register'}>
          {busy === 'register' ? 'Saving…' : 'Register sealed pack'}
        </button>
      </form>

      <div className="table-wrap" style={{ marginTop: 24 }}>
        <h2>Inventory</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Reagent</th>
              <th>Lot</th>
              <th>Status</th>
              <th>Remaining</th>
              <th>Opened</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch: LabReagentBatch) => (
              <tr key={batch.batch_id} className={batch.low_stock ? 'row-warning' : undefined}>
                <td>{batch.reagent_name}</td>
                <td>{batch.lot_number}</td>
                <td>{batch.status}</td>
                <td>
                  {batch.tests_remaining} / {batch.tests_per_pack}
                  {batch.status === 'Open' ? ` (${batch.usage_percent}% used)` : ''}
                </td>
                <td>{batch.opened_on || '—'}</td>
                <td>
                  {batch.status === 'Sealed' ? (
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={busy === batch.batch_id}
                      onClick={() => void onOpen(batch.batch_id)}
                    >
                      {busy === batch.batch_id ? 'Opening…' : 'Open pack'}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!batches.length ? <p className="muted">No batches yet — register a pack above.</p> : null}
      </div>

      <p className="muted" style={{ marginTop: 16 }}>
        <Link to="/dashboard/staff">Back to operations</Link>
      </p>
    </>
  );
}
