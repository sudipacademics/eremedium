import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../../api';
import { MetaLists } from './ItemFormModal';
import { ItemSelect, errMsg, fmtQty, todayIso, useInv } from './shared';

type Line = { key: number; item: string; batch_no: string; expiry_date: string; location: string; qty: string; unit_cost: string };

let seq = 0;
const blank = (item = '', location = ''): Line => ({ key: ++seq, item, batch_no: '', expiry_date: '', location, qty: '', unit_cost: '' });

export function StockInTab({ preset, onPresetUsed }: { preset: string[] | null; onPresetUsed: () => void }) {
  const { canManage, catalog, refreshAll, notify } = useInv();
  const defaultLocation = (item: string) => catalog.find((c) => c.name === item)?.default_location || '';
  const [lines, setLines] = useState<Line[]>(() => [blank()]);
  const [supplier, setSupplier] = useState('');
  const [reference, setReference] = useState('');
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!preset?.length) return;
    setLines(preset.map((item) => blank(item, defaultLocation(item))));
    onPresetUsed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  if (!canManage) {
    return <p className="lt-empty">Only the Lab Manager can receive stock. Ask your Lab Manager to record incoming material.</p>;
  }

  const patch = (key: number, p: Partial<Line>) => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ready = lines.filter((l) => l.item && Number(l.qty) > 0);
    if (!ready.length) {
      setError('Add at least one item with a quantity.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.inventoryStockIn({
        lines: ready.map((l) => ({
          item: l.item,
          batch_no: l.batch_no.trim(),
          expiry_date: l.expiry_date || undefined,
          location: l.location.trim() || undefined,
          qty: Number(l.qty),
          unit_cost: Number(l.unit_cost) || undefined,
        })),
        supplier,
        reference_no: reference,
        received_on: receivedOn,
        remarks,
      });
      notify(`Received ${res.data.count} line(s)${reference ? ` against ${reference}` : ''}. Stock and history updated.`);
      setLines([blank()]);
      setReference('');
      setRemarks('');
      refreshAll();
    } catch (err) {
      setError(errMsg(err, 'Could not receive stock'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="inv-stack">
      <div className="inv-section-head">
        <div>
          <h3>Stock In (goods receipt)</h3>
          <p className="inv-muted">Receive material into the central store. Each line adds to (or creates) a batch at its location and writes a Stock In entry to the history.</p>
        </div>
      </div>
      {error ? <div className="inv-alert is-error">{error}</div> : null}
      <div className="inv-form-grid">
        <label className="lt-field">
          Supplier
          <input className="inv-input" list="inv-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Defaults to item supplier" />
        </label>
        <label className="lt-field">
          GRN / invoice no.
          <input className="inv-input" value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        <label className="lt-field">
          Received on
          <input className="inv-input" type="date" max={todayIso()} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
        </label>
        <label className="lt-field">
          Remarks
          <input className="inv-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </label>
      </div>

      <div className="lt-table-card">
        <div className="lt-table-wrap">
          <table className="lt-table inv-lines">
            <thead>
              <tr>
                <th>Item</th>
                <th>Batch no.</th>
                <th>Expiry</th>
                <th>Location</th>
                <th>Qty</th>
                <th>Unit cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const meta = catalog.find((c) => c.name === l.item);
                return (
                  <tr key={l.key}>
                    <td className="inv-col-item">
                      <ItemSelect value={l.item} onChange={(item) => patch(l.key, { item, location: l.location || defaultLocation(item) })} />
                    </td>
                    <td>
                      <input className="inv-input" value={l.batch_no} onChange={(e) => patch(l.key, { batch_no: e.target.value })} placeholder="Auto if blank" />
                    </td>
                    <td>
                      <input className="inv-input" type="date" min={todayIso()} value={l.expiry_date} onChange={(e) => patch(l.key, { expiry_date: e.target.value })} />
                    </td>
                    <td>
                      <input className="inv-input" list="inv-locations" value={l.location} onChange={(e) => patch(l.key, { location: e.target.value })} placeholder="Main Store" />
                    </td>
                    <td>
                      <span className="inv-qty-input">
                        <input className="inv-input" type="number" min="0" step="any" value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} />
                        <small>{meta?.unit}</small>
                      </span>
                    </td>
                    <td>
                      <input className="inv-input" type="number" min="0" step="any" value={l.unit_cost} onChange={(e) => patch(l.key, { unit_cost: e.target.value })} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="inv-icon-btn"
                        aria-label="Remove line"
                        disabled={lines.length === 1}
                        onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="inv-form-actions">
        <button type="button" className="lt-btn-clear" onClick={() => setLines((cur) => [...cur, blank()])}>
          + Add line
        </button>
        <span className="inv-muted">Total quantity: {fmtQty(total)}</span>
        <button type="submit" className="lt-btn-search" disabled={busy}>
          {busy ? 'Saving…' : 'Receive stock'}
        </button>
      </div>
      <MetaLists />
    </form>
  );
}
