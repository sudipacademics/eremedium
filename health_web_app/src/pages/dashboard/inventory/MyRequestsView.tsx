import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../api';
import type { InvMyRequestsPayload, InvRequisition } from '../../../types/labInventory';
import { DispatchPill, INV_ICONS, ReqPill, Svg, errMsg, fmtDate, fmtDateTime, fmtQty, todayIso } from './shared';
import '../lab-tech-v2.css';
import './inventory.css';

const CLOSED = ['Received', 'Rejected', 'Cancelled'];

/** Company-unit staff (Material Requester role): request from the catalogue and track their units' requests. */
export function MyRequestsView() {
  const [data, setData] = useState<InvMyRequestsPayload | null>(null);
  const [unit, setUnit] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [requiredBy, setRequiredBy] = useState('');
  const [priority, setPriority] = useState<'Normal' | 'Urgent'>('Normal');
  const [address, setAddress] = useState('');
  const [remarks, setRemarks] = useState('');
  const [view, setView] = useState<'open' | 'all'>('open');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getMyMaterialRequests();
      setData(res.data);
      setUnit((cur) => cur || res.data.units[0]?.name || '');
    } catch (e) {
      setError(errMsg(e, 'Could not load your material requests'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => [...new Set((data?.catalogue || []).map((c) => c.category).filter(Boolean))].sort(), [data]);
  const needle = search.trim().toLowerCase();
  const visible = (data?.catalogue || []).filter(
    (c) => (!category || c.category === category) && (!needle || `${c.item_name} ${c.sku} ${c.category}`.toLowerCase().includes(needle)),
  );
  const picked = Object.entries(draft).filter(([, v]) => Number(v) > 0);
  const requests = (data?.requests || []).filter((r) => view === 'all' || !CLOSED.includes(r.status));
  const counts = data?.status_counts || {};
  const inProgress = ['Approved', 'Partially Approved', 'Preparing', 'Partially Dispatched'].reduce((s, k) => s + (counts[k] || 0), 0);
  const unitAddress = data?.units.find((u) => u.name === unit)?.address || '';

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
      const res = await api.createMaterialRequisition({
        requester_type: 'Company Unit',
        company_unit: unit,
        required_by: requiredBy || undefined,
        priority,
        delivery_address: address,
        remarks,
        lines: picked.map(([item, v]) => ({ item, qty: Number(v) })),
      });
      setNotice(`Request ${res.data.name} submitted. The Lab Manager will review it.`);
      setDraft({});
      setRemarks('');
      setRequiredBy('');
      setPriority('Normal');
      await load();
    } catch (err) {
      setError(errMsg(err, 'Could not submit the request'));
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
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="lt-page inv-page">
      <section className="lt-hero inv-hero">
        <div className="lt-hero-icon">
          <Svg size={30}>{INV_ICONS.box}</Svg>
        </div>
        <div className="inv-hero-copy">
          <h2>Material Requests</h2>
          <p>Request lab consumables and supplies for your unit and track approval, dispatch and delivery.</p>
        </div>
        <div className="inv-hero-tools">
          <button type="button" className="inv-hero-btn" onClick={() => void load()}>
            <Svg size={16}>{INV_ICONS.refresh}</Svg>
            Refresh
          </button>
        </div>
      </section>

      <section className="inv-kpis inv-kpis-4" aria-label="My requests summary">
        <div className="inv-kpi tone-purple">
          <span className="inv-kpi-copy">
            <strong>{counts.Submitted || 0}</strong>
            <b>Awaiting approval</b>
            <small>Submitted requests</small>
          </span>
        </div>
        <div className="inv-kpi tone-amber">
          <span className="inv-kpi-copy">
            <strong>{inProgress}</strong>
            <b>In progress</b>
            <small>Approved, preparing or part sent</small>
          </span>
        </div>
        <div className="inv-kpi tone-cyan">
          <span className="inv-kpi-copy">
            <strong>{data?.in_transit || 0}</strong>
            <b>In transit</b>
            <small>Parcels to confirm</small>
          </span>
        </div>
        <div className="inv-kpi tone-teal">
          <span className="inv-kpi-copy">
            <strong>{counts.Received || 0}</strong>
            <b>Received</b>
            <small>Completed requests</small>
          </span>
        </div>
      </section>

      {error ? (
        <div className="inv-alert is-error" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}
      {notice ? <div className="inv-alert" role="status">{notice}</div> : null}

      {data && !data.units.length ? (
        <div className="inv-card inv-tab-body">
          <p className="lt-empty">
            You are not listed on any company unit yet. Ask the Lab Manager to add you to your unit under Inventory Management → Material Requisition → Company
            units.
          </p>
        </div>
      ) : null}

      {data?.units.length ? (
        <form className="inv-card inv-tab-body" onSubmit={(e) => void onSubmit(e)}>
          <div className="inv-section-head">
            <div>
              <h3>New request</h3>
              <p className="inv-muted">Enter quantities for the items you need. Availability is indicative; the lab confirms the approved quantity.</p>
            </div>
          </div>
          <div className="inv-form-grid">
            <label className="lt-field">
              Unit <em>*</em>
              <select className="inv-input" required value={unit} onChange={(e) => setUnit(e.target.value)}>
                {data.units.map((u) => (
                  <option key={u.name} value={u.name}>
                    {u.unit_name} ({u.unit_code})
                  </option>
                ))}
              </select>
            </label>
            <label className="lt-field">
              Search catalogue
              <input className="inv-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item name or code" />
            </label>
            <label className="lt-field">
              Category
              <select className="inv-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="lt-table-card">
            <div className="lt-table-wrap">
              <table className="lt-table">
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
                        <td className="inv-nowrap">{c.sku}</td>
                        <td>{c.category || '—'}</td>
                        <td>
                          <span className={`inv-pill tone-${c.availability === 'Available' ? 'green' : c.availability === 'Limited' ? 'amber' : 'muted'}`}>{c.availability}</span>
                        </td>
                        <td>
                          <span className="inv-qty-input">
                            <input
                              className="inv-input inv-input-sm"
                              type="number"
                              min="0"
                              step="any"
                              value={draft[c.name] || ''}
                              onChange={(e) => setDraft((d) => ({ ...d, [c.name]: e.target.value }))}
                              aria-label={`Quantity of ${c.item_name}`}
                            />
                            <small>{c.unit}</small>
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="lt-empty">
                        No catalogue items match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="inv-form-grid">
            <label className="lt-field">
              Required by
              <input className="inv-input" type="date" min={todayIso()} value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} />
            </label>
            <label className="lt-field">
              Priority
              <select className="inv-input" value={priority} onChange={(e) => setPriority(e.target.value as 'Normal' | 'Urgent')}>
                <option>Normal</option>
                <option>Urgent</option>
              </select>
            </label>
            <label className="lt-field inv-span-2">
              Delivery address
              <input className="inv-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={unitAddress || "Defaults to the unit's address"} />
            </label>
            <label className="lt-field inv-span-3">
              Remarks
              <input className="inv-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </label>
            <div className="inv-form-actions">
              <button type="submit" className="lt-btn-search" disabled={busy === 'create' || !picked.length || !unit}>
                {busy === 'create' ? 'Submitting…' : `Submit request (${picked.length})`}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      <section className="inv-card inv-tab-body">
        <div className="inv-section-head">
          <div>
            <h3>My requests</h3>
            <p className="inv-muted">Requests raised for your units, with dispatch and courier tracking.</p>
          </div>
          <div className="lt-chips">
            <button type="button" className={`lt-chip${view === 'open' ? ' is-active' : ''}`} onClick={() => setView('open')}>
              Open
            </button>
            <button type="button" className={`lt-chip${view === 'all' ? ' is-active' : ''}`} onClick={() => setView('all')}>
              All
            </button>
          </div>
        </div>
        {requests.length ? (
          requests.map((r) => <RequestCard key={r.name} req={r} busy={busy} run={run} />)
        ) : (
          <p className="lt-empty">{data ? 'No requests in this view.' : 'Loading…'}</p>
        )}
      </section>
    </div>
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
  const decided = req.status !== 'Submitted' && req.status !== 'Cancelled';
  const dispatches = req.dispatches.filter((d) => d.status !== 'Cancelled');
  return (
    <div className="inv-dispatch">
      <div className="inv-dispatch-head">
        <div>
          <b>{req.name}</b> <ReqPill status={req.status} />
          {req.priority === 'Urgent' ? <span className="inv-pill tone-red">Urgent</span> : null}
          <div className="inv-muted">
            {req.unit_name} · requested {fmtDateTime(req.requested_on)} by {req.requested_by_name}
            {req.required_by ? ` · needed by ${fmtDate(req.required_by)}` : ''}
          </div>
        </div>
        {req.status === 'Submitted' ? (
          <button
            type="button"
            className="lt-btn-clear inv-danger"
            disabled={busy === req.name}
            onClick={() => {
              if (!window.confirm(`Cancel request ${req.name}?`)) return;
              void run(req.name, () => api.cancelMaterialRequisition(req.name, 'Cancelled by requester'), `Request ${req.name} cancelled.`);
            }}
          >
            Cancel request
          </button>
        ) : null}
      </div>
      {req.review_remarks ? <p className="inv-muted">Lab note: {req.review_remarks}</p> : null}
      {req.closed_remarks ? <p className="inv-muted">Closure note: {req.closed_remarks}</p> : null}
      <table className="lt-table">
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
                {fmtQty(l.requested_qty)} {l.unit}
              </td>
              <td>{decided ? fmtQty(l.approved_qty) : '—'}</td>
              <td>{fmtQty(l.dispatched_qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {dispatches.map((d) => (
        <div key={d.name} className="inv-inline-panel">
          <div className="inv-inline-head">
            <span>
              <b>{d.name}</b> <DispatchPill status={d.status} /> <span className="inv-muted">{fmtDate(d.dispatch_date)}</span>
            </span>
            {d.status === 'Dispatched' ? (
              <button
                type="button"
                className="lt-btn-search"
                disabled={busy === d.name}
                onClick={() => void run(d.name, () => api.receiveMaterialDispatch(d.name), `Receipt of ${d.name} confirmed.`)}
              >
                {busy === d.name ? 'Saving…' : 'Mark received'}
              </button>
            ) : (
              <span className="inv-muted">Received {fmtDateTime(d.received_on)}</span>
            )}
          </div>
          <span className="inv-muted">
            {[d.logistics_mode, d.courier].filter(Boolean).join(' · ') || 'Dispatched'}
            {d.tracking_no ? ` · Tracking: ${d.tracking_no}` : ''}
            {d.logistics_details ? ` · ${d.logistics_details}` : ''}
          </span>
          <span className="inv-muted">{d.items.map((i) => `${i.item_name} ${fmtQty(i.qty)} ${i.unit}`).join('; ')}</span>
        </div>
      ))}
    </div>
  );
}
