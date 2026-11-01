import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../../api';
import type { InvBatch } from '../../../types/labInventory';
import { ItemSelect, errMsg, fmtDate, fmtQty, useInv } from './shared';

export type BatchMode = 'adjust' | 'transfer';

export function BatchActionForm({
  mode,
  item: initialItem = '',
  batch: initialBatch = '',
  onDone,
  compact,
}: {
  mode: BatchMode;
  item?: string;
  batch?: string;
  onDone?: (msg: string) => void;
  compact?: boolean;
}) {
  const { meta, catalog, version, refreshAll, notify } = useInv();
  const [item, setItem] = useState(initialItem);
  const [batches, setBatches] = useState<InvBatch[]>([]);
  const [batch, setBatch] = useState(initialBatch);
  const [adjMode, setAdjMode] = useState<'decrease' | 'increase' | 'count'>('decrease');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [toLocation, setToLocation] = useState('');
  const [remarks, setRemarks] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) {
      setBatches([]);
      return;
    }
    let cancelled = false;
    api
      .getInventoryItem(item)
      .then((res) => {
        if (cancelled) return;
        const rows = res.data.batches.filter((b) => b.qty > 0 || b.name === initialBatch);
        setBatches(rows);
        setBatch((cur) => (rows.some((b) => b.name === cur) ? cur : rows[0]?.name || ''));
      })
      .catch((e) => setError(errMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [item, initialBatch, version]);

  const current = batches.find((b) => b.name === batch);
  const unit = catalog.find((c) => c.name === item)?.unit || '';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!batch) {
      setError('Select a batch');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let msg: string;
      if (mode === 'adjust') {
        const res = await api.inventoryAdjustStock({
          batch,
          reason,
          remarks,
          reference_no: reference,
          ...(adjMode === 'count' ? { counted_qty: qty } : { direction: adjMode, qty: Number(qty) }),
        });
        msg = `Adjusted ${current?.batch_no}: ${res.data.delta > 0 ? '+' : ''}${fmtQty(res.data.delta)} ${unit}. New balance ${fmtQty(res.data.balance)}.`;
      } else {
        const res = await api.inventoryTransferStock({ batch, qty: Number(qty), to_location: toLocation, remarks });
        msg = `Transferred ${fmtQty(Number(qty))} ${unit} of ${current?.batch_no} to ${toLocation} (${res.data.reference_no}).`;
      }
      setQty('');
      setRemarks('');
      setReference('');
      notify(msg);
      refreshAll();
      onDone?.(msg);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`inv-form-grid${compact ? ' is-compact' : ''}`} onSubmit={(e) => void onSubmit(e)}>
      {error ? <div className="inv-alert is-error inv-span-all">{error}</div> : null}
      {!initialItem ? (
        <label className="lt-field inv-span-2">
          Item <em>*</em>
          <ItemSelect value={item} onChange={setItem} required />
        </label>
      ) : null}
      <label className={`lt-field${initialItem ? ' inv-span-2' : ''}`}>
        Batch <em>*</em>
        <select className="inv-input" value={batch} required onChange={(e) => setBatch(e.target.value)}>
          <option value="">{item ? (batches.length ? 'Select batch…' : 'No stock batches') : 'Select an item first'}</option>
          {batches.map((b) => (
            <option key={b.name} value={b.name}>
              {b.batch_no} · {b.location} · {fmtQty(b.qty)} on hand{b.expiry_date ? ` · exp ${fmtDate(b.expiry_date)}` : ''}
              {b.expired ? ' (expired)' : ''}
            </option>
          ))}
        </select>
      </label>
      {mode === 'adjust' ? (
        <>
          <label className="lt-field">
            Adjustment
            <select className="inv-input" value={adjMode} onChange={(e) => setAdjMode(e.target.value as typeof adjMode)}>
              <option value="decrease">Decrease (−)</option>
              <option value="increase">Increase (+)</option>
              <option value="count">Set to counted qty</option>
            </select>
          </label>
          <label className="lt-field">
            {adjMode === 'count' ? 'Counted quantity' : 'Quantity'} <em>*</em>
            <input className="inv-input" type="number" min="0" step="any" required value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          <label className="lt-field">
            Reason <em>*</em>
            <select className="inv-input" required value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Select reason…</option>
              {meta?.adjust_reasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="lt-field">
            Reference no.
            <input className="inv-input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Count sheet / memo" />
          </label>
        </>
      ) : (
        <>
          <label className="lt-field">
            Quantity <em>*</em>
            <input className="inv-input" type="number" min="0" max={current?.qty} step="any" required value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          <label className="lt-field">
            To location <em>*</em>
            <input className="inv-input" list="inv-transfer-locations" required value={toLocation} onChange={(e) => setToLocation(e.target.value)} placeholder="e.g. Reagent Store" />
            <datalist id="inv-transfer-locations">
              {meta?.locations.filter((l) => l !== current?.location).map((l) => <option key={l} value={l} />)}
            </datalist>
          </label>
        </>
      )}
      <label className="lt-field inv-span-2">
        Remarks{mode === 'adjust' && reason === 'Other' ? <em> *</em> : null}
        <input className="inv-input" value={remarks} required={mode === 'adjust' && reason === 'Other'} onChange={(e) => setRemarks(e.target.value)} />
      </label>
      <div className="inv-form-actions">
        {current ? (
          <span className="inv-muted">
            On hand: <b>{fmtQty(current.qty)}</b> {unit}
            {current.expired ? ' · expired batch' : ''}
          </span>
        ) : null}
        <button type="submit" className="lt-btn-search" disabled={busy}>
          {busy ? 'Saving…' : mode === 'adjust' ? 'Post adjustment' : 'Transfer stock'}
        </button>
      </div>
    </form>
  );
}
