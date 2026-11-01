import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api';
import type { InvPartnerPayload, InvRequisition } from '../../types/labInventory';
import './partner-earnings.css';

/** Old route; the page now lives under Consumables Inventory → Requisitions. */
export function B2bMaterialRequestsPage() {
  return <Navigate to="/b2b/consumables?tab=requisitions" replace />;
}

export type RequisitionPrefill = { lines: Record<string, string>; key: number };

function day(raw?: string | null) {
  if (!raw) return '—';
  const d = new Date(String(raw).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? String(raw) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function qty(n?: number | null) {
  return n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

const TONE: Record<string, string> = {
  Submitted: 'warn',
  Approved: 'ok',
  'Partially Approved': 'ok',
  Preparing: 'warn',
  'Partially Dispatched': 'warn',
  Dispatched: 'ok',
  Received: 'ok',
  Rejected: 'muted',
  Cancelled: 'muted',
};

function StatusPill({ status }: { status: string }) {
  const label = status === 'Submitted' ? 'Awaiting approval' : status;
  return <span className={`pe-pill pe-${TONE[status] || 'muted'}`}>{label}</span>;
}

type Draft = Record<string, string>;

export function PartnerRequisitionsPanel({ prefill, onChanged }: { prefill?: RequisitionPrefill | null; onChanged?: () => void }) {
  const [data, setData] = useState<InvPartnerPayload | null>(null);
  const [draft, setDraft] = useState<Draft>(() => ({ ...(prefill?.lines || {}) }));
  const formRef = useRef<HTMLFormElement>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [requiredBy, setRequiredBy] = useState('');
  const [priority, setPriority] = useState<'Normal' | 'Urgent'>('Normal');
  const [address, setAddress] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'open' | 'all'>('open');

  const load = useCallback(async () => {
    const res = await api.getPartnerMaterialRequests();
    setData(res.data);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load material requests'));
  }, [load]);

  useEffect(() => {
    if (!prefill) return;
    setDraft((cur) => ({ ...cur, ...prefill.lines }));
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [prefill]);

  const categories = useMemo(() => [...new Set((data?.catalogue || []).map((c) => c.category).filter(Boolean))].sort(), [data]);
  const visible = (data?.catalogue || []).filter(
    (c) =>
      (!category || c.category === category) &&
      (!search.trim() || `${c.item_name} ${c.sku} ${c.category}`.toLowerCase().includes(search.trim().toLowerCase())),
  );
  const picked = Object.entries(draft).filter(([, v]) => Number(v) > 0);
  const requests = (data?.requests || []).filter((r) => tab === 'all' || !['Received', 'Rejected', 'Cancelled'].includes(r.status));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!picked.length) {
      setError('Enter a quantity for at least one item.');
      return;
    }
    setBusy('create');
    setError(null);
    setNotice(null);
    try {
      const res = await api.createPartnerMaterialRequest({
        required_by: requiredBy || undefined,
        priority,
        delivery_address: address,
        remarks,
        lines: picked.map(([item, v]) => ({ item, qty: Number(v) })),
      });
      setNotice(`Request ${res.data.name} submitted. The lab will review it and dispatch the approved quantities.`);
      setDraft({});
      setRemarks('');
      setRequiredBy('');
      setPriority('Normal');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the request');
    } finally {
      setBusy(null);
    }
  }

  async function run(key: string, fn: () => Promise<unknown>, msg: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(msg);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error ? <div className="partners-alert error">{error}</div> : null}
      {notice ? <div className="partners-alert">{notice}</div> : null}

      <div className="partners-stats">
        <div className="partners-stat">
          <span>Awaiting approval</span>
          <strong>{data?.status_counts.Submitted || 0}</strong>
        </div>
        <div className="partners-stat">
          <span>Being prepared / part sent</span>
          <strong>
            {(data?.status_counts.Approved || 0) +
              (data?.status_counts['Partially Approved'] || 0) +
              (data?.status_counts.Preparing || 0) +
              (data?.status_counts['Partially Dispatched'] || 0)}
          </strong>
        </div>
        <div className="partners-stat">
          <span>Parcels in transit</span>
          <strong>{data?.in_transit || 0}</strong>
        </div>
        <div className="partners-stat">
          <span>Received</span>
          <strong>{data?.status_counts.Received || 0}</strong>
        </div>
      </div>

      <form ref={formRef} className="partners-table-card pe-circuit" onSubmit={(e) => void onSubmit(e)}>
        <h2 className="pe-section-title">New request</h2>
        <div className="pe-ship-form" style={{ marginTop: 0, marginBottom: 12 }}>
          <label className="partners-field">
            <span>Search catalogue</span>
            <span className="partners-input-wrap">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item name or code" />
            </span>
          </label>
          <label className="partners-field">
            <span>Category</span>
            <span className="partners-input-wrap">
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </span>
          </label>
        </div>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Code</th>
              <th>Category</th>
              <th>Availability</th>
              <th>Quantity</th>
            </tr>
          </thead>
          <tbody>
            {visible.length ? (
              visible.map((c) => (
                <tr key={c.name}>
                  <td>{c.item_name}</td>
                  <td>{c.sku}</td>
                  <td>{c.category || '—'}</td>
                  <td>
                    <span className={`pe-pill pe-${c.availability === 'Available' ? 'ok' : c.availability === 'Limited' ? 'warn' : 'muted'}`}>{c.availability}</span>
                  </td>
                  <td>
                    <span className="partners-input-wrap" style={{ maxWidth: 160 }}>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={draft[c.name] || ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [c.name]: e.target.value }))}
                        aria-label={`Quantity of ${c.item_name}`}
                      />
                    </span>{' '}
                    <span className="pe-muted">{c.unit}</span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>{data ? 'No catalogue items match.' : 'Loading catalogue…'}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="pe-ship-form">
          <label className="partners-field">
            <span>Required by</span>
            <span className="partners-input-wrap">
              <input type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} />
            </span>
          </label>
          <label className="partners-field">
            <span>Priority</span>
            <span className="partners-input-wrap">
              <select value={priority} onChange={(e) => setPriority(e.target.value as 'Normal' | 'Urgent')}>
                <option>Normal</option>
                <option>Urgent</option>
              </select>
            </span>
          </label>
          <label className="partners-field">
            <span>Delivery address</span>
            <span className="partners-input-wrap">
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={data?.franchisee.address || 'Hub address'} />
            </span>
          </label>
          <label className="partners-field">
            <span>Remarks</span>
            <span className="partners-input-wrap">
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </span>
          </label>
          <button type="submit" className="partners-btn partners-btn-primary" disabled={busy === 'create' || !picked.length}>
            {busy === 'create' ? 'Submitting…' : `Submit request (${picked.length})`}
          </button>
        </div>
      </form>

      <div className="pe-tabs">
        <button type="button" className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>
          Open requests
        </button>
        <button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
          All requests
        </button>
      </div>

      {requests.length ? (
        requests.map((r) => <RequestCard key={r.name} req={r} busy={busy} run={run} />)
      ) : (
        <div className="partners-table-card pe-circuit">
          <p className="pe-muted pe-circuit-note">{data ? 'No requests in this view yet.' : 'Loading…'}</p>
        </div>
      )}
    </>
  );
}

function RequestCard({
  req,
  busy,
  run,
}: {
  req: InvRequisition;
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>, msg: string) => Promise<void>;
}) {
  const decided = !['Submitted', 'Cancelled'].includes(req.status);
  return (
    <div className="partners-table-card pe-circuit">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h2 className="pe-section-title" style={{ margin: 0 }}>
          {req.name} <StatusPill status={req.status} />
          {req.priority === 'Urgent' ? <span className="pe-pill pe-warn">Urgent</span> : null}
        </h2>
        <span className="pe-muted">
          Requested {day(req.requested_on)}
          {req.required_by ? ` · needed by ${day(req.required_by)}` : ''}
        </span>
      </div>
      {req.review_remarks ? <p className="pe-muted">Lab note: {req.review_remarks}</p> : null}
      {req.closed_remarks ? <p className="pe-muted">Closure note: {req.closed_remarks}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Requested</th>
            <th>Approved</th>
            <th>Dispatched</th>
          </tr>
        </thead>
        <tbody>
          {req.items.map((l) => (
            <tr key={l.name}>
              <td>{l.item_name}</td>
              <td>
                {qty(l.requested_qty)} {l.unit}
              </td>
              <td>{decided ? qty(l.approved_qty) : '—'}</td>
              <td>{qty(l.dispatched_qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {req.dispatches
        .filter((d) => d.status !== 'Cancelled')
        .map((d) => (
          <div key={d.name} className="pe-node" style={{ marginTop: 10 }}>
            <small>
              Dispatch {d.name} · {day(d.dispatch_date)}
            </small>
            <span>
              {[d.logistics_mode, d.courier].filter(Boolean).join(' · ') || 'Dispatched'}
              {d.tracking_no ? ` · Tracking: ${d.tracking_no}` : ''}
            </span>
            <span className="pe-muted">
              {d.items.map((i) => `${i.item_name} ${qty(i.qty)} ${i.unit} (batch ${i.batch_no}${i.expiry_date ? `, exp ${day(i.expiry_date)}` : ''})`).join('; ')}
            </span>
            {d.logistics_details ? <span className="pe-muted">{d.logistics_details}</span> : null}
            {d.status === 'Received' ? (
              <span className="pe-muted">Received {day(d.received_on)}</span>
            ) : (
              <span>
                <button
                  type="button"
                  className="partners-btn partners-btn-primary"
                  disabled={busy === d.name}
                  onClick={() => void run(d.name, () => api.receivePartnerMaterialDispatch(d.name), `Receipt of ${d.name} confirmed; items added to your unit stock.`)}
                >
                  {busy === d.name ? 'Saving…' : 'Mark received'}
                </button>
              </span>
            )}
          </div>
        ))}

      {req.status === 'Submitted' ? (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="partners-btn"
            disabled={busy === req.name}
            onClick={() => {
              if (!window.confirm(`Cancel request ${req.name}?`)) return;
              void run(req.name, () => api.cancelPartnerMaterialRequest(req.name), `Request ${req.name} cancelled.`);
            }}
          >
            Cancel request
          </button>
        </div>
      ) : null}
    </div>
  );
}
