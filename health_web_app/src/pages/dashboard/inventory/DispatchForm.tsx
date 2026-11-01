import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../../../api';
import type { InvAllocation, InvDispatch, InvDispatchPayload, InvFranchiseUnit, InvRequisition } from '../../../types/labInventory';
import { DispatchPill, ItemSelect, Modal, errMsg, fmtDate, fmtDateTime, fmtQty, todayIso, useInv } from './shared';

type DirectLine = { key: number; item: string; qty: string };
let seq = 0;

/** Franchise unit search for managers (Franchisee Profile). */
export function FranchisePicker({ value, onChange }: { value: string; onChange: (id: string, label: string) => void }) {
  const [q, setQ] = useState('');
  const [units, setUnits] = useState<InvFranchiseUnit[]>([]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      api
        .listInventoryFranchiseUnits(q)
        .then((res) => setUnits(res.data.units))
        .catch(() => setUnits([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);
  return (
    <span className="inv-picker">
      <input className="inv-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search franchise name / branch code" />
      <select
        className="inv-input"
        value={value}
        required
        onChange={(e) => onChange(e.target.value, units.find((u) => u.name === e.target.value)?.label || e.target.value)}
      >
        <option value="">Select franchise unit…</option>
        {units.map((u) => (
          <option key={u.name} value={u.name}>
            {u.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export function DispatchForm({ requisition, onDone, onCancel }: { requisition?: InvRequisition | null; onDone: (d: InvDispatch) => void; onCancel: () => void }) {
  const { meta, catalog, notify, refreshAll } = useInv();
  const pendingLines = useMemo(() => (requisition?.items || []).filter((l) => l.pending_qty > 0), [requisition]);
  const [reqQty, setReqQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(pendingLines.map((l) => [l.name, String(Math.min(l.pending_qty, l.available_qty ?? l.pending_qty))])),
  );
  const [destType, setDestType] = useState<'Company Unit' | 'Franchise'>('Company Unit');
  const [unit, setUnit] = useState('');
  const [franchisee, setFranchisee] = useState('');
  const [direct, setDirect] = useState<DirectLine[]>([{ key: ++seq, item: '', qty: '' }]);
  const [fromLocation, setFromLocation] = useState('');
  const [form, setForm] = useState({
    dispatch_date: todayIso(),
    logistics_mode: 'Courier',
    courier: '',
    tracking_no: '',
    logistics_details: '',
    remarks: '',
  });
  const [preview, setPreview] = useState<InvAllocation[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setPreview(null), [reqQty, direct, fromLocation, unit, franchisee]);

  function payload(): InvDispatchPayload {
    const base = { ...form, from_location: fromLocation || undefined };
    if (requisition) {
      return {
        ...base,
        requisition: requisition.name,
        lines: pendingLines.map((l) => ({ line: l.name, qty: Number(reqQty[l.name]) || 0 })).filter((l) => l.qty > 0),
      };
    }
    return {
      ...base,
      destination_type: destType,
      company_unit: destType === 'Company Unit' ? unit : undefined,
      franchisee: destType === 'Franchise' ? franchisee : undefined,
      lines: direct.filter((l) => l.item && Number(l.qty) > 0).map((l) => ({ item: l.item, qty: Number(l.qty) })),
    };
  }

  async function onPreview() {
    setBusy('preview');
    setError(null);
    try {
      const res = await api.previewMaterialDispatch(payload());
      setPreview(res.data.allocations);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setError(null);
    try {
      const res = await api.createMaterialDispatch(payload());
      notify(`Dispatch ${res.data.name} created for ${res.data.destination_name} (${fmtQty(res.data.total_qty)} units). Stock deducted.`);
      refreshAll();
      onDone(res.data);
    } catch (err) {
      setError(errMsg(err, 'Could not dispatch'));
    } finally {
      setBusy(null);
    }
  }

  const courierOptional = ['Hand delivery', 'Runner / field staff', 'Own vehicle'].includes(form.logistics_mode);

  return (
    <form className="inv-stack" onSubmit={(e) => void onSubmit(e)}>
      {error ? <div className="inv-alert is-error">{error}</div> : null}
      {requisition ? (
        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Approved</th>
                <th>Already sent</th>
                <th>Pending</th>
                <th>In stock</th>
                <th>Dispatch now</th>
              </tr>
            </thead>
            <tbody>
              {pendingLines.map((l) => (
                <tr key={l.name}>
                  <td>
                    {l.item_name}
                    <div className="inv-muted">{l.sku}</div>
                  </td>
                  <td>{fmtQty(l.approved_qty)}</td>
                  <td>{fmtQty(l.dispatched_qty)}</td>
                  <td>{fmtQty(l.pending_qty)}</td>
                  <td className={(l.available_qty ?? 0) < l.pending_qty ? 'inv-neg' : ''}>{fmtQty(l.available_qty)}</td>
                  <td>
                    <span className="inv-qty-input">
                      <input
                        className="inv-input"
                        type="number"
                        min="0"
                        max={l.pending_qty}
                        step="any"
                        value={reqQty[l.name] ?? ''}
                        onChange={(e) => setReqQty((cur) => ({ ...cur, [l.name]: e.target.value }))}
                      />
                      <small>{l.unit}</small>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="inv-form-grid">
            <label className="lt-field">
              Destination type
              <select className="inv-input" value={destType} onChange={(e) => setDestType(e.target.value as typeof destType)}>
                <option value="Company Unit">Company unit</option>
                <option value="Franchise">Franchise unit</option>
              </select>
            </label>
            <label className="lt-field inv-span-2">
              Destination unit <em>*</em>
              {destType === 'Company Unit' ? (
                <select className="inv-input" required value={unit} onChange={(e) => setUnit(e.target.value)}>
                  <option value="">Select company unit…</option>
                  {meta?.my_units.map((u) => (
                    <option key={u.name} value={u.name}>
                      {u.unit_name} ({u.unit_code})
                    </option>
                  ))}
                </select>
              ) : (
                <FranchisePicker value={franchisee} onChange={(id) => setFranchisee(id)} />
              )}
            </label>
          </div>
          <div className="lt-table-wrap">
            <table className="lt-table inv-lines">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {direct.map((l) => (
                  <tr key={l.key}>
                    <td className="inv-col-item">
                      <ItemSelect value={l.item} onChange={(item) => setDirect((cur) => cur.map((x) => (x.key === l.key ? { ...x, item } : x)))} />
                    </td>
                    <td>
                      <span className="inv-qty-input">
                        <input
                          className="inv-input"
                          type="number"
                          min="0"
                          step="any"
                          value={l.qty}
                          onChange={(e) => setDirect((cur) => cur.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))}
                        />
                        <small>{catalog.find((c) => c.name === l.item)?.unit}</small>
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="inv-icon-btn"
                        aria-label="Remove line"
                        disabled={direct.length === 1}
                        onClick={() => setDirect((cur) => cur.filter((x) => x.key !== l.key))}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <button type="button" className="lt-btn-clear" onClick={() => setDirect((cur) => [...cur, { key: ++seq, item: '', qty: '' }])}>
              + Add item
            </button>
          </div>
        </>
      )}

      <div className="inv-form-grid">
        <label className="lt-field">
          Pick from location
          <select className="inv-input" value={fromLocation} onChange={(e) => setFromLocation(e.target.value)}>
            <option value="">Any location (FEFO)</option>
            {meta?.locations.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="lt-field">
          Dispatch date <em>*</em>
          <input className="inv-input" type="date" required value={form.dispatch_date} onChange={(e) => setForm((f) => ({ ...f, dispatch_date: e.target.value }))} />
        </label>
        <label className="lt-field">
          Logistics mode
          <select className="inv-input" value={form.logistics_mode} onChange={(e) => setForm((f) => ({ ...f, logistics_mode: e.target.value }))}>
            {meta?.logistics_modes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="lt-field">
          Courier / logistics partner {courierOptional ? null : <em>*</em>}
          <input className="inv-input" required={!courierOptional} value={form.courier} onChange={(e) => setForm((f) => ({ ...f, courier: e.target.value }))} />
        </label>
        <label className="lt-field">
          Tracking / reference no.
          <input className="inv-input" value={form.tracking_no} onChange={(e) => setForm((f) => ({ ...f, tracking_no: e.target.value }))} placeholder="AWB / docket / LR no." />
        </label>
        <label className="lt-field inv-span-2">
          Vehicle / person / contact
          <input
            className="inv-input"
            value={form.logistics_details}
            onChange={(e) => setForm((f) => ({ ...f, logistics_details: e.target.value }))}
            placeholder="e.g. KA-01-AB-1234, Ravi 98xxxxxx"
          />
        </label>
        <label className="lt-field">
          Remarks
          <input className="inv-input" value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
        </label>
      </div>

      {preview ? (
        <div className="inv-inline-panel">
          <div className="inv-inline-head">
            <b>Batches that will be picked (earliest expiry first, expired stock excluded)</b>
          </div>
          <table className="lt-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Batch</th>
                <th>Expiry</th>
                <th>Location</th>
                <th>Qty</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((a, i) => (
                <tr key={`${a.batch}-${i}`}>
                  <td>{a.item_name}</td>
                  <td>{a.batch_no}</td>
                  <td>{fmtDate(a.expiry_date)}</td>
                  <td>{a.location}</td>
                  <td>
                    {fmtQty(a.qty)} {a.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="inv-form-actions">
        <button type="button" className="lt-btn-clear" onClick={onCancel}>
          Back
        </button>
        <button type="button" className="lt-btn-clear" onClick={() => void onPreview()} disabled={Boolean(busy)}>
          {busy === 'preview' ? 'Checking…' : 'Preview batches (FEFO)'}
        </button>
        <button type="submit" className="lt-btn-search" disabled={Boolean(busy)}>
          {busy === 'save' ? 'Dispatching…' : 'Dispatch & deduct stock'}
        </button>
      </div>
    </form>
  );
}

export function DispatchDetail({ dispatch, onChanged }: { dispatch: InvDispatch; onChanged: (d: InvDispatch) => void }) {
  const { canManage, meta, notify, refreshAll } = useInv();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [askCancel, setAskCancel] = useState(false);
  const canReceive =
    dispatch.status === 'Dispatched' &&
    (canManage || (dispatch.destination_type === 'Company Unit' && meta?.my_units.some((u) => u.name === dispatch.company_unit)));

  async function run(fn: () => Promise<{ data: InvDispatch }>, msg: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      notify(msg);
      refreshAll();
      onChanged(res.data);
      setAskCancel(false);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inv-dispatch">
      {error ? <div className="inv-alert is-error">{error}</div> : null}
      <div className="inv-dispatch-head">
        <div>
          <b>{dispatch.name}</b> <DispatchPill status={dispatch.status} />
          <div className="inv-muted">
            {fmtDate(dispatch.dispatch_date)} · to {dispatch.destination_name}
            {dispatch.requisition ? ` · ${dispatch.requisition}` : ''}
          </div>
        </div>
        <div className="inv-muted inv-right">
          {[dispatch.logistics_mode, dispatch.courier].filter(Boolean).join(' · ') || '—'}
          {dispatch.tracking_no ? (
            <div>
              Tracking: <b>{dispatch.tracking_no}</b>
            </div>
          ) : null}
          {dispatch.logistics_details ? <div>{dispatch.logistics_details}</div> : null}
        </div>
      </div>
      <table className="lt-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Batch</th>
            <th>Expiry</th>
            <th>From</th>
            <th>Qty</th>
          </tr>
        </thead>
        <tbody>
          {dispatch.items.map((r) => (
            <tr key={r.name}>
              <td>{r.item_name}</td>
              <td>{r.batch_no}</td>
              <td>{fmtDate(r.expiry_date)}</td>
              <td>{r.location}</td>
              <td>
                {fmtQty(r.qty)} {r.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="inv-muted">
        Dispatched by {dispatch.dispatched_by_name || dispatch.dispatched_by || '—'}
        {dispatch.received_on ? ` · received ${fmtDateTime(dispatch.received_on)} by ${dispatch.received_by_name || '—'}` : ''}
        {dispatch.receipt_remarks ? ` (${dispatch.receipt_remarks})` : ''}
        {dispatch.cancelled_on ? ` · cancelled ${fmtDateTime(dispatch.cancelled_on)}: ${dispatch.cancel_reason || ''}` : ''}
        {dispatch.remarks ? ` · ${dispatch.remarks}` : ''}
      </p>
      {dispatch.status === 'Dispatched' ? (
        <div className="inv-form-actions">
          {canManage ? (
            askCancel ? (
              <>
                <input className="inv-input" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason for cancelling (stock is restored)" />
                <button
                  type="button"
                  className="lt-btn-clear inv-danger"
                  disabled={busy || !cancelReason.trim()}
                  onClick={() => void run(() => api.cancelMaterialDispatch(dispatch.name, cancelReason), `Dispatch ${dispatch.name} cancelled; stock restored by reversal entries.`)}
                >
                  Confirm cancel
                </button>
              </>
            ) : (
              <button type="button" className="lt-btn-clear inv-danger" onClick={() => setAskCancel(true)}>
                Cancel dispatch
              </button>
            )
          ) : null}
          {canReceive ? (
            <button
              type="button"
              className="lt-btn-search"
              disabled={busy}
              onClick={() => void run(() => api.receiveMaterialDispatch(dispatch.name), `Dispatch ${dispatch.name} marked received.`)}
            >
              Mark received
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DispatchModal({ dispatch, onClose }: { dispatch: InvDispatch; onClose: () => void }) {
  const [current, setCurrent] = useState(dispatch);
  return (
    <Modal title={`Dispatch ${current.name}`} sub={current.destination_name} onClose={onClose} wide>
      <DispatchDetail dispatch={current} onChanged={setCurrent} />
    </Modal>
  );
}
