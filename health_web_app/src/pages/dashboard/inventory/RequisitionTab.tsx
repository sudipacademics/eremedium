import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../../../api';
import type { InvCompanyUnit, InvRequisition, InvRequisitionFilters, InvRequisitionList } from '../../../types/labInventory';
import { DispatchDetail, DispatchForm, FranchisePicker } from './DispatchForm';
import { INV_ICONS, ItemSelect, Modal, Pager, ReqPill, Svg, downloadExport, errMsg, fmtDate, fmtDateTime, fmtQty, todayIso, useInv } from './shared';

const EMPTY: InvRequisitionFilters = { q: '', status: 'open', requester_type: '', date_from: '', date_to: '' };
const REVIEWABLE = ['Submitted', 'Approved', 'Partially Approved', 'Preparing'];
const DISPATCHABLE = ['Approved', 'Partially Approved', 'Preparing', 'Partially Dispatched'];

export function RequisitionTab() {
  const { meta, canManage, version, fail } = useInv();
  const [draft, setDraft] = useState<InvRequisitionFilters>(EMPTY);
  const [filters, setFilters] = useState<InvRequisitionFilters>(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState<InvRequisitionList | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [unitsOpen, setUnitsOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.listMaterialRequisitions(filters, page, pageSize);
      setData(res.data);
    } catch (e) {
      fail(e);
    }
  }, [filters, page, pageSize, fail]);

  useEffect(() => {
    void load();
  }, [load, version]);

  function apply(next: InvRequisitionFilters) {
    setDraft(next);
    setFilters(next);
    setPage(1);
  }

  async function exportList(fmt: 'xlsx' | 'csv') {
    try {
      downloadExport((await api.exportLabInventory('requisitions', fmt, { ...filters })).data);
    } catch (e) {
      fail(e);
    }
  }

  const counts = data?.status_counts || {};
  const openCount = ['Submitted', 'Approved', 'Partially Approved', 'Preparing', 'Partially Dispatched'].reduce((s, k) => s + (counts[k] || 0), 0);
  const canRequest = canManage || Boolean(meta?.my_units.length);

  return (
    <div className="inv-stack">
      <div className="inv-section-head">
        <div>
          <h3>Material Requisition</h3>
          <p className="inv-muted">
            Franchise partners raise requests from the partner portal; company units raise them here. Review each line (full, partial or reject), prepare and dispatch.
          </p>
        </div>
        <div className="inv-tools-right">
          {canManage ? (
            <button type="button" className="lt-action is-ghost" onClick={() => setUnitsOpen(true)}>
              Company units
            </button>
          ) : null}
          {canRequest ? (
            <button type="button" className="lt-action" onClick={() => setCreating(true)}>
              + New request
            </button>
          ) : null}
        </div>
      </div>

      <div className="lt-chips">
        <button type="button" className={`lt-chip${filters.status === 'open' ? ' is-active' : ''}`} onClick={() => apply({ ...filters, status: 'open' })}>
          Open ({openCount})
        </button>
        {(meta?.requisition_statuses || []).map((s) => (
          <button key={s} type="button" className={`lt-chip${filters.status === s ? ' is-active' : ''}`} onClick={() => apply({ ...filters, status: s })}>
            {s} ({counts[s] || 0})
          </button>
        ))}
        <button type="button" className={`lt-chip${!filters.status ? ' is-active' : ''}`} onClick={() => apply({ ...filters, status: '' })}>
          All
        </button>
      </div>

      <form
        className="inv-filters is-compact"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ ...draft, status: filters.status });
        }}
      >
        <label className="lt-field inv-filter-search">
          <span className="sr-only">Search</span>
          <span className="lt-search">
            <Svg size={16}>{INV_ICONS.search}</Svg>
            <input value={draft.q} onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))} placeholder="Search requisition no., unit or branch code..." />
          </span>
        </label>
        <label className="lt-field">
          Requesting unit
          <select value={draft.requester_type} onChange={(e) => setDraft((d) => ({ ...d, requester_type: e.target.value }))}>
            <option value="">All units</option>
            <option value="Franchise">Franchise units</option>
            <option value="Company Unit">Company units</option>
          </select>
        </label>
        <label className="lt-field inv-filter-dates">
          Requested between
          <span className="lt-dates">
            <input type="date" value={draft.date_from} onChange={(e) => setDraft((d) => ({ ...d, date_from: e.target.value }))} aria-label="From" />
            <span>-</span>
            <input type="date" value={draft.date_to} onChange={(e) => setDraft((d) => ({ ...d, date_to: e.target.value }))} aria-label="To" />
          </span>
        </label>
        <div className="inv-filter-actions">
          <button type="button" className="lt-btn-clear" onClick={() => apply(EMPTY)}>
            Clear
          </button>
          <button type="submit" className="lt-btn-search">
            Search
          </button>
          <button type="button" className="lt-action is-ghost" onClick={() => void exportList('xlsx')}>
            Excel
          </button>
        </div>
      </form>

      <div className="lt-table-card">
        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead>
              <tr>
                <th>Requisition</th>
                <th>Requesting unit</th>
                <th>Requested</th>
                <th>Required by</th>
                <th>Lines</th>
                <th>Requested</th>
                <th>Approved</th>
                <th>Dispatched</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.rows.length ? (
                data.rows.map((r) => (
                  <tr key={r.name}>
                    <td className="inv-nowrap">
                      <b>{r.name}</b>
                      {r.priority === 'Urgent' ? <span className="inv-pill tone-red">Urgent</span> : null}
                    </td>
                    <td>
                      {r.unit_name}
                      <div className="inv-muted">{r.requester_type === 'Franchise' ? `Franchise · ${r.franchisee}` : 'Company unit'}</div>
                    </td>
                    <td className="inv-nowrap">
                      {fmtDateTime(r.requested_on)}
                      <div className="inv-muted">{r.requested_by_name}</div>
                    </td>
                    <td>{fmtDate(r.required_by)}</td>
                    <td>{r.lines}</td>
                    <td>{fmtQty(r.requested_qty)}</td>
                    <td>{r.status === 'Submitted' ? '—' : fmtQty(r.approved_qty)}</td>
                    <td>{fmtQty(r.dispatched_qty)}</td>
                    <td>
                      <ReqPill status={r.status} />
                    </td>
                    <td>
                      <button type="button" className="inv-view-btn" onClick={() => setOpen(r.name)}>
                        {canManage && (r.status === 'Submitted' || DISPATCHABLE.includes(r.status)) ? 'Process' : 'View'}
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="lt-empty">
                    No requisitions in this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager
          page={page}
          pageSize={pageSize}
          total={data?.total || 0}
          noun="requisitions"
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </div>

      {open ? <RequisitionModal name={open} onClose={() => setOpen(null)} /> : null}
      {creating ? (
        <NewRequestModal
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false);
            setOpen(name);
          }}
        />
      ) : null}
      {unitsOpen ? <CompanyUnitsModal onClose={() => setUnitsOpen(false)} /> : null}
    </div>
  );
}

function RequisitionModal({ name, onClose }: { name: string; onClose: () => void }) {
  const { canManage, notify, refreshAll } = useInv();
  const [req, setReq] = useState<InvRequisition | null>(null);
  const [approved, setApproved] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState('');
  const [mode, setMode] = useState<'view' | 'dispatch'>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getMaterialRequisition(name);
      setReq(res.data);
      setApproved(Object.fromEntries(res.data.items.map((l) => [l.name, String(res.data.status === 'Submitted' ? l.requested_qty : l.approved_qty)])));
    } catch (e) {
      setError(errMsg(e));
    }
  }, [name]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<{ data: InvRequisition }>, msg: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      setReq(res.data);
      setRemarks('');
      notify(msg);
      refreshAll();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const reviewable = Boolean(req && canManage && REVIEWABLE.includes(req.status) && req.totals.dispatched === 0);
  const dispatchable = Boolean(req && canManage && DISPATCHABLE.includes(req.status) && req.totals.pending > 0);

  return (
    <Modal
      title={req ? `${req.name} · ${req.unit_name}` : name}
      sub={req ? `${req.requester_type === 'Franchise' ? `Franchise unit ${req.franchisee}` : 'Company unit'} · requested ${fmtDateTime(req.requested_on)} by ${req.requested_by_name}` : null}
      onClose={onClose}
      wide
    >
      {error ? <div className="inv-alert is-error">{error}</div> : null}
      {!req ? <p className="lt-empty">Loading…</p> : null}
      {req && mode === 'dispatch' ? (
        <DispatchForm
          requisition={req}
          onCancel={() => setMode('view')}
          onDone={() => {
            setMode('view');
            void load();
          }}
        />
      ) : null}
      {req && mode === 'view' ? (
        <div className="inv-stack">
          <div className="inv-detail-stats">
            <div>
              <small>Status</small>
              <ReqPill status={req.status} />
            </div>
            <div>
              <small>Priority</small>
              <strong>{req.priority}</strong>
            </div>
            <div>
              <small>Required by</small>
              <strong>{fmtDate(req.required_by)}</strong>
            </div>
            <div>
              <small>Requested / approved</small>
              <strong>
                {fmtQty(req.totals.requested)} / {req.status === 'Submitted' ? '—' : fmtQty(req.totals.approved)}
              </strong>
            </div>
            <div>
              <small>Dispatched / pending</small>
              <strong>
                {fmtQty(req.totals.dispatched)} / {fmtQty(req.totals.pending)}
              </strong>
            </div>
          </div>
          {req.delivery_address ? <p className="inv-muted">Deliver to: {req.delivery_address}</p> : null}
          {req.remarks ? <p className="inv-muted">Requester note: {req.remarks}</p> : null}
          {req.review_remarks ? (
            <p className="inv-muted">
              Review ({req.reviewed_by_name}, {fmtDateTime(req.reviewed_on)}): {req.review_remarks}
            </p>
          ) : null}
          {req.closed_remarks ? <p className="inv-muted">Closure note: {req.closed_remarks}</p> : null}

          <div className="lt-table-wrap">
            <table className="lt-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Requested</th>
                  <th>{reviewable ? 'Approve qty' : 'Approved'}</th>
                  <th>Dispatched</th>
                  <th>Pending</th>
                  {canManage ? <th>In stock</th> : null}
                </tr>
              </thead>
              <tbody>
                {req.items.map((l) => (
                  <tr key={l.name}>
                    <td>
                      {l.item_name}
                      <div className="inv-muted">
                        {l.sku}
                        {l.remarks ? ` · ${l.remarks}` : ''}
                      </div>
                    </td>
                    <td>
                      {fmtQty(l.requested_qty)} {l.unit}
                    </td>
                    <td>
                      {reviewable ? (
                        <input
                          className="inv-input inv-input-sm"
                          type="number"
                          min="0"
                          max={l.requested_qty}
                          step="any"
                          value={approved[l.name] ?? ''}
                          onChange={(e) => setApproved((cur) => ({ ...cur, [l.name]: e.target.value }))}
                        />
                      ) : req.status === 'Submitted' ? (
                        '—'
                      ) : (
                        fmtQty(l.approved_qty)
                      )}
                    </td>
                    <td>{fmtQty(l.dispatched_qty)}</td>
                    <td>{fmtQty(l.pending_qty)}</td>
                    {canManage ? <td className={(l.available_qty ?? 0) < Number(approved[l.name] || l.pending_qty) ? 'inv-neg' : ''}>{fmtQty(l.available_qty)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canManage && req.status !== 'Cancelled' && req.status !== 'Rejected' && req.status !== 'Received' ? (
            <label className="lt-field">
              Remarks {reviewable ? '(required to reject)' : req.status === 'Partially Dispatched' ? '(required to close short)' : ''}
              <input className="inv-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </label>
          ) : null}

          <div className="inv-form-actions">
            {reviewable ? (
              <>
                <button
                  type="button"
                  className="lt-btn-clear inv-danger"
                  disabled={busy || !remarks.trim()}
                  onClick={() => void act(() => api.reviewMaterialRequisition({ name: req.name, decision: 'reject', remarks }), `${req.name} rejected`)}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="lt-btn-search"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        api.reviewMaterialRequisition({
                          name: req.name,
                          decision: 'approve',
                          remarks,
                          lines: req.items.map((l) => ({ line: l.name, approved_qty: Number(approved[l.name] || 0) })),
                        }),
                      `${req.name} reviewed`,
                    )
                  }
                >
                  {req.status === 'Submitted' ? 'Approve' : 'Update approval'}
                </button>
              </>
            ) : null}
            {canManage && (req.status === 'Approved' || req.status === 'Partially Approved') ? (
              <button type="button" className="lt-btn-clear" disabled={busy} onClick={() => void act(() => api.prepareMaterialRequisition(req.name), `${req.name} marked as preparing`)}>
                Mark preparing
              </button>
            ) : null}
            {dispatchable ? (
              <button type="button" className="lt-btn-search" onClick={() => setMode('dispatch')}>
                Dispatch…
              </button>
            ) : null}
            {canManage && req.status === 'Partially Dispatched' ? (
              <button
                type="button"
                className="lt-btn-clear"
                disabled={busy || !remarks.trim()}
                onClick={() => void act(() => api.closeMaterialRequisition(req.name, remarks), `${req.name} closed; remaining quantity dropped`)}
              >
                Close remaining
              </button>
            ) : null}
            {['Submitted', 'Approved', 'Partially Approved', 'Preparing'].includes(req.status) && !req.dispatches.some((d) => d.status !== 'Cancelled') && (canManage || req.status === 'Submitted') ? (
              <button
                type="button"
                className="lt-btn-clear inv-danger"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt('Reason for cancelling this requisition?');
                  if (reason === null) return;
                  void act(() => api.cancelMaterialRequisition(req.name, reason), `${req.name} cancelled`);
                }}
              >
                Cancel request
              </button>
            ) : null}
          </div>

          {req.dispatches.length ? (
            <>
              <h4 className="inv-section-title">Dispatches</h4>
              {req.dispatches.map((d) => (
                <DispatchDetail key={d.name} dispatch={d} onChanged={() => void load()} />
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

type NewLine = { key: number; item: string; qty: string; remarks: string };
let lineSeq = 0;

function NewRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const { meta, canManage, catalog, notify, refreshAll } = useInv();
  const [type, setType] = useState<'Company Unit' | 'Franchise'>(meta?.my_units.length || !canManage ? 'Company Unit' : 'Franchise');
  const [unit, setUnit] = useState(meta?.my_units[0]?.name || '');
  const [franchisee, setFranchisee] = useState('');
  const [requiredBy, setRequiredBy] = useState('');
  const [priority, setPriority] = useState<'Normal' | 'Urgent'>('Normal');
  const [address, setAddress] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<NewLine[]>([{ key: ++lineSeq, item: '', qty: '', remarks: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.createMaterialRequisition({
        requester_type: type,
        company_unit: type === 'Company Unit' ? unit : undefined,
        franchisee: type === 'Franchise' ? franchisee : undefined,
        required_by: requiredBy || undefined,
        priority,
        delivery_address: address,
        remarks,
        lines: lines.filter((l) => l.item && Number(l.qty) > 0).map((l) => ({ item: l.item, qty: Number(l.qty), remarks: l.remarks })),
      });
      notify(`Requisition ${res.data.name} submitted for ${res.data.unit_name}`);
      refreshAll();
      onCreated(res.data.name);
    } catch (err) {
      setError(errMsg(err, 'Could not submit the request'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New material request"
      sub="Raise a requisition to the central lab store."
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="lt-btn-clear" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="inv-new-req" className="lt-btn-search" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit request'}
          </button>
        </>
      }
    >
      <form id="inv-new-req" className="inv-stack" onSubmit={(e) => void onSubmit(e)}>
        {error ? <div className="inv-alert is-error">{error}</div> : null}
        <div className="inv-form-grid">
          {canManage ? (
            <label className="lt-field">
              Requesting unit type
              <select className="inv-input" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                <option value="Company Unit">Company unit</option>
                <option value="Franchise">Franchise unit (on behalf)</option>
              </select>
            </label>
          ) : null}
          <label className="lt-field inv-span-2">
            Unit <em>*</em>
            {type === 'Company Unit' ? (
              <select className="inv-input" required value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="">Select unit…</option>
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
          <label className="lt-field">
            Required by
            <input className="inv-input" type="date" min={todayIso()} value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} />
          </label>
          <label className="lt-field">
            Priority
            <select className="inv-input" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              <option>Normal</option>
              <option>Urgent</option>
            </select>
          </label>
          <label className="lt-field inv-span-2">
            Delivery address
            <input className="inv-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Defaults to the unit's address" />
          </label>
          <label className="lt-field inv-span-2">
            Remarks
            <input className="inv-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </label>
        </div>
        <table className="lt-table inv-lines">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td className="inv-col-item">
                  <ItemSelect value={l.item} onChange={(item) => setLines((cur) => cur.map((x) => (x.key === l.key ? { ...x, item } : x)))} />
                </td>
                <td>
                  <span className="inv-qty-input">
                    <input
                      className="inv-input"
                      type="number"
                      min="0"
                      step="any"
                      value={l.qty}
                      onChange={(e) => setLines((cur) => cur.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))}
                    />
                    <small>{catalog.find((c) => c.name === l.item)?.unit}</small>
                  </span>
                </td>
                <td>
                  <input className="inv-input" value={l.remarks} onChange={(e) => setLines((cur) => cur.map((x) => (x.key === l.key ? { ...x, remarks: e.target.value } : x)))} />
                </td>
                <td>
                  <button type="button" className="inv-icon-btn" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>
          <button type="button" className="lt-btn-clear" onClick={() => setLines((cur) => [...cur, { key: ++lineSeq, item: '', qty: '', remarks: '' }])}>
            + Add item
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CompanyUnitsModal({ onClose }: { onClose: () => void }) {
  const { meta, notify, refreshAll } = useInv();
  const [units, setUnits] = useState<InvCompanyUnit[]>([]);
  const [edit, setEdit] = useState<(Partial<InvCompanyUnit> & { usersText?: string; grant?: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listInventoryCompanyUnits(true)
      .then((res) => setUnits(res.data.units))
      .catch((e) => setError(errMsg(e)));
  }, []);
  useEffect(load, [load]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveInventoryCompanyUnit({
        name: edit.name,
        unit_name: edit.unit_name,
        unit_code: edit.unit_code,
        unit_type: edit.unit_type,
        active: edit.active,
        contact_person: edit.contact_person,
        contact_phone: edit.contact_phone,
        address: edit.address,
        users: (edit.usersText || '')
          .split(/[\s,;]+/)
          .map((u) => u.trim())
          .filter(Boolean),
        grant_requester_role: edit.grant ? 1 : 0,
      });
      const missing = (res.data.user_access || []).filter((u) => !u.access).map((u) => u.user);
      notify(
        `Unit ${res.data.unit_name} saved.` +
          (res.data.granted?.length ? ` Material Requester role granted to ${res.data.granted.join(', ')}.` : '') +
          (missing.length ? ` Still without request access: ${missing.join(', ')}.` : ''),
      );
      setEdit(null);
      load();
      refreshAll();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Company units" sub="Internal units (collection centres, labs, clinics, offices) that can request material. Users listed on a unit can raise its requests." onClose={onClose} wide>
      {error ? <div className="inv-alert is-error">{error}</div> : null}
      {edit ? (
        <form className="inv-form-grid" onSubmit={(e) => void onSave(e)}>
          <label className="lt-field inv-span-2">
            Unit name <em>*</em>
            <input className="inv-input" required value={edit.unit_name || ''} onChange={(e) => setEdit({ ...edit, unit_name: e.target.value })} />
          </label>
          <label className="lt-field">
            Unit code <em>*</em>
            <input className="inv-input" required value={edit.unit_code || ''} onChange={(e) => setEdit({ ...edit, unit_code: e.target.value.toUpperCase() })} />
          </label>
          <label className="lt-field">
            Type
            <select className="inv-input" value={edit.unit_type || ''} onChange={(e) => setEdit({ ...edit, unit_type: e.target.value })}>
              {meta?.unit_types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="lt-field">
            Contact person
            <input className="inv-input" value={edit.contact_person || ''} onChange={(e) => setEdit({ ...edit, contact_person: e.target.value })} />
          </label>
          <label className="lt-field">
            Contact phone
            <input className="inv-input" value={edit.contact_phone || ''} onChange={(e) => setEdit({ ...edit, contact_phone: e.target.value })} />
          </label>
          <label className="lt-field inv-span-2">
            Delivery address
            <input className="inv-input" value={edit.address || ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
          </label>
          <label className="lt-field inv-span-all">
            Users who can request for this unit (login emails, comma separated)
            <input className="inv-input" value={edit.usersText || ''} onChange={(e) => setEdit({ ...edit, usersText: e.target.value })} />
            <span className="inv-muted">
              Listed users also need the <b>Material Requester</b> role (company-unit staff) or a lab staff role to sign in to Material Requests.
            </span>
          </label>
          {edit.user_access?.length ? (
            <div className="inv-user-list inv-span-all">
              {edit.user_access.map((u) => (
                <span key={u.user} className="inv-user-chip" title={u.user}>
                  {u.full_name}
                  <span className={`inv-pill tone-${u.access ? 'green' : 'amber'}`}>{u.enabled ? u.access || 'No request role' : 'Disabled user'}</span>
                </span>
              ))}
            </div>
          ) : null}
          <label className="inv-check inv-span-all">
            <input type="checkbox" checked={Boolean(edit.grant)} onChange={(e) => setEdit({ ...edit, grant: e.target.checked })} /> Grant the Material Requester
            role to listed users who don't have a request role yet (adds only that role)
          </label>
          <label className="inv-check">
            <input type="checkbox" checked={edit.active !== 0} onChange={(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} /> Active
          </label>
          <div className="inv-form-actions inv-span-all">
            <button type="button" className="lt-btn-clear" onClick={() => setEdit(null)}>
              Back
            </button>
            <button type="submit" className="lt-btn-search" disabled={busy}>
              {busy ? 'Saving…' : 'Save unit'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="inv-form-actions">
            <button type="button" className="lt-action" onClick={() => setEdit({ unit_type: meta?.unit_types[0], active: 1, usersText: '' })}>
              + Add unit
            </button>
          </div>
          <table className="lt-table">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Type</th>
                <th>Contact</th>
                <th>Users</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {units.length ? (
                units.map((u) => (
                  <tr key={u.name} className={u.active ? '' : 'inv-row-muted'}>
                    <td>
                      {u.unit_name}
                      <div className="inv-muted">{u.unit_code}</div>
                    </td>
                    <td>{u.unit_type}</td>
                    <td>
                      {u.contact_person || '—'}
                      <div className="inv-muted">{u.contact_phone}</div>
                    </td>
                    <td>
                      {u.user_access?.length ? (
                        <span className="inv-user-list">
                          {u.user_access.map((a) => (
                            <span key={a.user} className="inv-user-chip" title={a.user}>
                              {a.full_name}
                              <span className={`inv-pill tone-${a.access ? 'green' : 'amber'}`}>{a.enabled ? a.access || 'No request role' : 'Disabled'}</span>
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="inv-muted">Lab Manager only</span>
                      )}
                    </td>
                    <td>{u.active ? 'Active' : 'Inactive'}</td>
                    <td>
                      <button type="button" className="inv-link" onClick={() => setEdit({ ...u, usersText: u.users.join(', ') })}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="lt-empty">
                    No company units yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}
