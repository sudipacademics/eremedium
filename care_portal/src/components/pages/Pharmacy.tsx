import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, savedSession } from '../../api';
import { Icon } from '../../icons';
import { useApi, useCare, withQuery } from '../../store';
import type { PharmBatchLine, PharmBoard, PharmDispatch, PharmExternal, PharmLedgerRow, PharmStock } from '../../types';
import { addDays, fmtDate, fmtStamp, inr, todayIst } from '../../format';
import { Empty, ErrorNote, Field, Loading, Modal, PageHeader, Pill, SearchBox, StatCard, Tabs, useDebounced } from '../ui';

type Tab = 'stock' | 'requisitions' | 'deliveries' | 'outside' | 'returns' | 'adjustments' | 'history';
type Dialog =
  | { kind: 'requisition' }
  | { kind: 'return' }
  | { kind: 'adjust' }
  | { kind: 'receive'; d: PharmDispatch }
  | { kind: 'external' }
  | { kind: 'extBill'; r: PharmExternal }
  | null;

const EXT_TONE: Record<string, string> = {
  Pending: 'orange',
  Approved: 'green',
  'Partially Approved': 'blue',
  'Partially Received': 'purple',
  Received: 'grey',
  Rejected: 'red',
  Cancelled: 'grey',
};
const extCanBuy = (r: PharmExternal) => ['Approved', 'Partially Approved', 'Partially Received'].includes(r.status) && !r.expired_approval;

const REQ_TONE: Record<string, string> = {
  Pending: 'orange',
  Approved: 'blue',
  'Partially Approved': 'blue',
  'Partially Dispatched': 'purple',
  Dispatched: 'purple',
  Completed: 'green',
  Rejected: 'red',
  Cancelled: 'grey',
};
const DSP_TONE: Record<string, string> = { Dispatched: 'indigo', 'In Transit': 'purple', 'Out for Delivery': 'orange', Delivered: 'green', Cancelled: 'red' };
const PRIORITY_TONE: Record<string, string> = { Normal: 'grey', Urgent: 'orange', Emergency: 'red' };

function expiryPill(s: Pick<PharmStock, 'expired' | 'days_left'>, near: number) {
  if (s.expired) return <Pill tone="red">Expired · blocked</Pill>;
  if (s.days_left !== null && s.days_left <= 30) return <Pill tone="red">{s.days_left} days left</Pill>;
  if (s.days_left !== null && s.days_left <= near) return <Pill tone="orange">{s.days_left} days left</Pill>;
  return <Pill tone="green">OK</Pill>;
}

async function openChallan(challan: string, branch: number, onError: (m: string) => void) {
  const win = window.open('', '_blank');
  try {
    const session = savedSession();
    const res = await fetch(`/care-api/pharmacy/challan?challan=${encodeURIComponent(challan)}&branch=${branch}`, { headers: session ? { 'X-Care-Sid': session.sid } : {} });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new ApiError(res.status, json.error || `Challan not available (${res.status})`);
    }
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url;
    else window.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (err) {
    win?.close();
    onError((err as Error).message);
  }
}

export function PharmacyPage() {
  const { can, branch, setBranch, meta, openModal, toast } = useCare();
  const [tab, setTab] = useState<Tab>('stock');
  const firstBranch = meta?.branches.find((b) => b.active)?.id;
  useEffect(() => {
    if (!branch && firstBranch) setBranch(firstBranch);
  }, [branch, firstBranch, setBranch]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const { data, error, loading } = useApi<PharmBoard>(branch ? withQuery('/pharmacy/board', { branch }) : null);
  const write = can('Pharmacy', 'create') && Boolean(data?.me.write);

  const stats = useMemo(() => {
    if (!data) return null;
    const live = data.stock.filter((s) => !s.expired && s.qty > 0);
    return {
      medicines: new Set(live.map((s) => s.item)).size,
      units: live.reduce((n, s) => n + s.qty, 0),
      value: live.reduce((n, s) => n + s.qty * (s.mrp || 0), 0),
      low: data.alerts.filter((a) => a.kind === 'low').length,
      near: data.alerts.filter((a) => a.kind === 'near').length,
      expired: data.alerts.filter((a) => a.kind === 'expired').length,
      open: data.requisitions.filter((r) => !['Completed', 'Rejected', 'Cancelled'].includes(r.status)).length,
      incoming: data.dispatches.filter((d) => !['Delivered', 'Cancelled'].includes(d.status)).length,
      outside: (data.external_requests || []).filter((r) => r.status === 'Pending' || extCanBuy(r)).length,
    };
  }, [data]);

  return (
    <div className="page">
      <PageHeader
        title={data ? `Pharmacy · ${data.location.location_name}` : 'Pharmacy'}
        subtitle="Branch medicine stock by batch, requisitions to the central store, deliveries and returns"
        icon="pill"
        actions={
          <>
            {can('Billing & Invoice') && (
              <Link className="btn btn-ghost" to="/billing?type=pharmacy">
                <Icon name="invoice" size={16} /> Pharmacy bills
              </Link>
            )}
            {(can('Pharmacy', 'create') || can('Billing & Invoice', 'create')) && (
              <button type="button" className="btn btn-soft" onClick={() => openModal({ kind: 'invoice', type: 'pharmacy' })}>
                <Icon name="cart" size={16} /> Pharmacy sale
              </button>
            )}
            {write && (
              <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'requisition' })}>
                <Icon name="plus" size={16} /> New requisition
              </button>
            )}
          </>
        }
      />
      {error && <ErrorNote text={error} />}
      {!data && !error && <Loading />}
      {data && stats && (
        <>
          <div className="stats">
            <StatCard label="Medicines in stock" value={stats.medicines} icon="pill" tone="blue" foot={`${stats.units} units · ${inr(stats.value)} at MRP`} />
            <StatCard label="Low stock" value={stats.low} icon="alert" tone="red" foot="at or below the branch reorder level" />
            <StatCard label="Expiring / expired" value={`${stats.near} / ${stats.expired}`} icon="calendar" tone="orange" foot={`within ${data.constants.near_days} days · expired is blocked`} />
            <StatCard label="Requisitions open" value={stats.open} icon="clipboard" tone="indigo" foot={`${stats.incoming} deliveries on the way`} />
          </div>

          {data.alerts.length > 0 && (
            <div className="card pharm-alerts">
              <strong className="small">Alerts</strong>
              <ul>
                {data.alerts.slice(0, 8).map((a, i) => (
                  <li key={i} className={`pa-${a.kind}`}>
                    <Icon name={a.kind === 'low' ? 'box' : 'calendar'} size={14} /> {a.text}
                  </li>
                ))}
              </ul>
              {data.alerts.length > 8 && <span className="muted small">and {data.alerts.length - 8} more</span>}
            </div>
          )}

          <div className="card">
            <div className="toolbar">
              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: 'stock', label: 'Branch stock' },
                  { value: 'requisitions', label: 'Requisitions', count: stats.open || undefined },
                  { value: 'deliveries', label: 'Deliveries', count: stats.incoming || undefined },
                  { value: 'outside', label: 'Outside purchases', count: stats.outside || undefined },
                  { value: 'returns', label: 'Returns' },
                  { value: 'adjustments', label: 'Dispensed & damaged' },
                  { value: 'history', label: 'Stock history' },
                ]}
              />
              <span className="spacer" />
              {write && tab === 'outside' && (
                <button type="button" className="btn btn-soft sm" onClick={() => setDialog({ kind: 'external' })}>
                  <Icon name="plus" size={15} /> Ask to buy outside
                </button>
              )}
              {write && tab === 'returns' && (
                <button type="button" className="btn btn-soft sm" onClick={() => setDialog({ kind: 'return' })}>
                  <Icon name="undo" size={15} /> Return stock
                </button>
              )}
              {write && tab === 'adjustments' && (
                <button type="button" className="btn btn-soft sm" onClick={() => setDialog({ kind: 'adjust' })}>
                  <Icon name="plus" size={15} /> Record dispensed / damaged
                </button>
              )}
            </div>
            {tab === 'stock' && <StockTab board={data} />}
            {tab === 'requisitions' && <RequisitionsTab board={data} write={write} />}
            {tab === 'deliveries' && <DeliveriesTab board={data} write={write} onReceive={(d) => setDialog({ kind: 'receive', d })} onChallan={(c) => openChallan(c, branch, (m) => toast(m, 'error'))} />}
            {tab === 'outside' && <OutsideTab board={data} write={write} onBill={(r) => setDialog({ kind: 'extBill', r })} />}
            {tab === 'returns' && <BatchDocs rows={data.returns.map((r) => ({ no: r.return_no, at: r.creation, status: r.status, lines: r.lines, by: r.actor, note: r.note, extra: r.received_on ? `Received ${fmtStamp(r.received_on)}${r.received_by ? ` by ${r.received_by}` : ''}` : '' }))} empty="No returns from this branch." />}
            {tab === 'adjustments' && <BatchDocs rows={data.adjustments.map((a) => ({ no: a.adj_no, at: a.creation, status: a.reason || '', lines: a.lines, by: a.actor, note: a.note, extra: '' }))} empty="Nothing recorded yet." />}
            {tab === 'history' && <HistoryTab names={Object.fromEntries(data.items.map((m) => [m.name, m.medicine_name]))} />}
          </div>
          {loading && <span className="muted small">Refreshing…</span>}
        </>
      )}
      {data && dialog?.kind === 'requisition' && <RequisitionDialog board={data} onClose={() => setDialog(null)} />}
      {data && dialog?.kind === 'return' && <BatchDialog board={data} mode="return" onClose={() => setDialog(null)} />}
      {data && dialog?.kind === 'adjust' && <BatchDialog board={data} mode="adjust" onClose={() => setDialog(null)} />}
      {data && dialog?.kind === 'receive' && <ReceiveDialog d={dialog.d} onClose={() => setDialog(null)} />}
      {data && dialog?.kind === 'external' && <ExternalDialog board={data} onClose={() => setDialog(null)} />}
      {data && dialog?.kind === 'extBill' && <ExternalBillDialog r={dialog.r} onClose={() => setDialog(null)} />}
    </div>
  );
}

function OutsideTab({ board, write, onBill }: { board: PharmBoard; write: boolean; onBill: (r: PharmExternal) => void }) {
  const { mutate, branch } = useCare();
  const rows = board.external_requests || [];
  const cancel = (no: string) =>
    window.confirm(`Cancel request ${no}?`) && mutate(() => api('/pharmacy/external/cancel', { method: 'POST', body: { ext_no: no, branch_id: branch } }), `${no} cancelled`);
  return (
    <>
      <p className="ext-rule small">
        <Icon name="alert" size={15} /> Buying medicine from an outside vendor needs the Operations Manager's approval first. Send the medicine, quantity, vendor, price and reason; once approved, enter the vendor's bill here within the approved quantity, price and date, and the batches join this branch's stock.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Request</th>
              <th>Medicine</th>
              <th>Vendor · price</th>
              <th>Approval</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>
                  <strong className="mono">{r.ext_no}</strong>
                  <small className="block muted">
                    {fmtStamp(r.creation)} · {r.requested_by_name}
                  </small>
                </td>
                <td className="wrap">
                  {r.medicine_name} × <b>{r.qty}</b> {r.urgency && r.urgency !== 'Normal' && <Pill tone={PRIORITY_TONE[r.urgency] || 'orange'}>{r.urgency}</Pill>}
                  <small className="block muted">{r.reason}</small>
                </td>
                <td>
                  {r.vendor_name}
                  <small className="block muted">
                    {inr(r.unit_price, true)} / unit · {inr(r.unit_price * r.qty, true)}
                  </small>
                </td>
                <td className="small wrap">
                  {r.approved_qty ? (
                    <>
                      {r.approved_qty} at most {inr(r.approved_price || 0, true)} each
                      <span className="block muted">
                        Bought {r.received_qty || 0} · valid till {fmtDate(r.valid_until)}
                      </span>
                    </>
                  ) : (
                    <span className="muted">{r.status === 'Pending' ? 'Waiting for the Operations Manager' : '—'}</span>
                  )}
                  {r.decision_note && <span className="block">{r.decided_by}: {r.decision_note}</span>}
                  {r.receipts.map((x) => (
                    <span key={x.purchase_no} className="block muted">
                      {x.purchase_no} · bill {x.invoice_no} · {x.qty} units
                    </span>
                  ))}
                </td>
                <td>
                  <Pill tone={EXT_TONE[r.status] || 'grey'}>{r.status}</Pill>
                  {r.expired_approval && <Pill tone="red">Approval expired</Pill>}
                </td>
                <td className="row-actions">
                  {write && extCanBuy(r) && (
                    <button type="button" className="btn btn-primary sm" onClick={() => onBill(r)}>
                      <Icon name="invoice" size={15} /> Enter bill
                    </button>
                  )}
                  {write && ['Pending', 'Approved', 'Partially Approved'].includes(r.status) && !r.received_qty && (
                    <button type="button" className="btn btn-ghost sm" onClick={() => cancel(r.ext_no)}>
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty text="No outside purchase requests from this branch." icon="cart" />}
      </div>
    </>
  );
}

function ExternalDialog({ board, onClose }: { board: PharmBoard; onClose: () => void }) {
  const { mutate, branch } = useCare();
  const [f, setF] = useState({ item: '', medicine_name: '', qty: '', unit_price: '', vendor_name: '', vendor_gstin: '', vendor_phone: '', reason: '', urgency: 'Normal' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));
  const ready = (f.item || f.medicine_name.trim()) && Number(f.qty) > 0 && Number(f.unit_price) > 0 && f.vendor_name.trim() && f.reason.trim().length >= 5;
  const central = f.item ? board.central_qty[f.item] ?? 0 : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await mutate(
      () => api<{ ext_no: string }>('/pharmacy/external', { method: 'POST', body: { ...f, qty: Number(f.qty), unit_price: Number(f.unit_price), branch_id: branch } }),
      (res) => `${res.ext_no} sent to the Operations Manager for approval`,
    );
    setBusy(false);
    if (r) onClose();
  };

  return (
    <Modal
      title="Ask to buy from an outside vendor"
      subtitle={`${board.location.location_name} · needs the Operations Manager's approval before buying`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="ext-form" className="btn btn-primary" disabled={busy || !ready}>
            {busy ? 'Sending…' : 'Send for approval'}
          </button>
        </>
      }
    >
      <form id="ext-form" className="stack" onSubmit={submit}>
        <div className="grid-2">
          <Field label="Medicine *">
            <select value={f.item} onChange={set('item')}>
              <option value="">Not in the list (type the name)</option>
              {board.items.map((x) => (
                <option key={x.name} value={x.name}>
                  {x.medicine_name}
                  {x.strength ? ` ${x.strength}` : ''}
                </option>
              ))}
            </select>
          </Field>
          {f.item ? (
            <Field label="Urgency">
              <select value={f.urgency} onChange={set('urgency')}>
                {board.constants.priorities.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Medicine name *">
              <input value={f.medicine_name} onChange={set('medicine_name')} maxLength={140} placeholder="Name, strength, pack" />
            </Field>
          )}
        </div>
        {central !== null && (
          <p className={`small ${central > 0 ? 'warn-text' : 'muted'}`}>
            The central store has {central} usable units of this medicine{central > 0 ? ' — a requisition may be quicker and is preferred.' : '.'}
          </p>
        )}
        <div className="grid-3">
          <Field label="Quantity *">
            <input type="number" min={1} step={1} value={f.qty} onChange={set('qty')} />
          </Field>
          <Field label="Vendor price per unit (₹) *">
            <input type="number" min={0.01} step="0.01" value={f.unit_price} onChange={set('unit_price')} />
          </Field>
          {!f.item ? (
            <Field label="Urgency">
              <select value={f.urgency} onChange={set('urgency')}>
                {board.constants.priorities.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Total">
              <input readOnly value={inr((Number(f.qty) || 0) * (Number(f.unit_price) || 0), true)} />
            </Field>
          )}
        </div>
        <div className="grid-3">
          <Field label="Vendor *">
            <input value={f.vendor_name} onChange={set('vendor_name')} maxLength={140} placeholder="Shop / distributor" />
          </Field>
          <Field label="Vendor GSTIN">
            <input value={f.vendor_gstin} onChange={set('vendor_gstin')} maxLength={20} />
          </Field>
          <Field label="Vendor phone">
            <input value={f.vendor_phone} onChange={set('vendor_phone')} maxLength={20} />
          </Field>
        </div>
        <Field label="Reason (why not from the central store?) *">
          <textarea rows={2} value={f.reason} onChange={set('reason')} maxLength={1000} />
        </Field>
      </form>
    </Modal>
  );
}

type BillLine = { batch_no: string; mfg_date: string; expiry_date: string; qty: string; free_qty: string; rate: string; mrp: string };

function ExternalBillDialog({ r, onClose }: { r: PharmExternal; onClose: () => void }) {
  const { mutate, branch } = useCare();
  const left = (r.approved_qty || 0) - (r.received_qty || 0);
  const max = r.approved_price || 0;
  const blank = (): BillLine => ({ batch_no: '', mfg_date: '', expiry_date: '', qty: '', free_qty: '', rate: String(max || ''), mrp: '' });
  const [invoice, setInvoice] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIst());
  const [lines, setLines] = useState<BillLine[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<BillLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const used = lines.filter((l) => l.batch_no && Number(l.qty) > 0);
  const units = used.reduce((n, l) => n + Number(l.qty) + (Number(l.free_qty) || 0), 0);
  const over = used.some((l) => Number(l.rate) > max + 0.005);
  const ready = invoice.trim() && used.length && used.every((l) => l.expiry_date && Number(l.rate) > 0) && units <= left && !over;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await mutate(
      () =>
        api<{ purchase_no: string }>('/pharmacy/external/receive', {
          method: 'POST',
          body: {
            ext_no: r.ext_no,
            invoice_no: invoice,
            invoice_date: invoiceDate,
            branch_id: branch,
            lines: used.map((l) => ({ ...l, qty: Number(l.qty), free_qty: Number(l.free_qty) || 0, rate: Number(l.rate), mrp: Number(l.mrp) || 0 })),
          },
        }),
      (x) => `${x.purchase_no}: ${units} units added to branch stock`,
    );
    setBusy(false);
    if (res) onClose();
  };

  return (
    <Modal
      title={`Enter outside bill · ${r.ext_no}`}
      subtitle={`${r.medicine_name} from ${r.vendor_name} · up to ${left} units at most ${inr(max, true)} each · valid till ${fmtDate(r.valid_until)}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="ext-bill" className="btn btn-primary" disabled={busy || !ready}>
            {busy ? 'Saving…' : `Add ${units || ''} units to stock`}
          </button>
        </>
      }
    >
      <form id="ext-bill" className="stack" onSubmit={submit}>
        <div className="grid-2">
          <Field label="Vendor bill no. *">
            <input value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={60} />
          </Field>
          <Field label="Bill date">
            <input type="date" value={invoiceDate} max={todayIst()} onChange={(e) => setInvoiceDate(e.target.value)} />
          </Field>
        </div>
        <table className="table req-lines">
          <thead>
            <tr>
              <th>Batch *</th>
              <th>Mfg</th>
              <th>Expiry *</th>
              <th className="num">Qty *</th>
              <th className="num">Free</th>
              <th className="num">Rate ₹ *</th>
              <th className="num">MRP ₹</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <input value={l.batch_no} onChange={(e) => set(i, { batch_no: e.target.value })} maxLength={60} aria-label="Batch" style={{ minWidth: 110 }} />
                </td>
                <td>
                  <input type="date" value={l.mfg_date} onChange={(e) => set(i, { mfg_date: e.target.value })} aria-label="Manufactured" />
                </td>
                <td>
                  <input type="date" value={l.expiry_date} min={todayIst()} onChange={(e) => set(i, { expiry_date: e.target.value })} aria-label="Expiry" />
                </td>
                <td className="num">
                  <input type="number" min={1} step={1} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} aria-label="Quantity" />
                </td>
                <td className="num">
                  <input type="number" min={0} step={1} value={l.free_qty} onChange={(e) => set(i, { free_qty: e.target.value })} aria-label="Free quantity" />
                </td>
                <td className="num">
                  <input type="number" min={0.01} max={max} step="0.01" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} aria-label="Rate" className={Number(l.rate) > max + 0.005 ? 'invalid' : ''} />
                </td>
                <td className="num">
                  <input type="number" min={0} step="0.01" value={l.mrp} onChange={(e) => set(i, { mrp: e.target.value })} aria-label="MRP" />
                </td>
                <td>
                  <button type="button" className="icon-btn sm" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blank()]))} aria-label="Remove line">
                    <Icon name="x" size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn btn-ghost sm" onClick={() => setLines((ls) => [...ls, blank()])}>
          <Icon name="plus" size={14} /> Another batch
        </button>
        {units > left && <p className="small neg">Only {left} more units are approved on this request.</p>}
        {over && <p className="small neg">The rate is above the approved {inr(max, true)} per unit. Ask for a new approval instead.</p>}
        <p className="muted small">Expired batches are refused. Free units count towards the approved quantity.</p>
      </form>
    </Modal>
  );
}

function StockTab({ board }: { board: PharmBoard }) {
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'all' | 'low' | 'expiry'>('all');
  const term = useDebounced(q.trim().toLowerCase());
  const lowItems = new Set(board.alerts.filter((a) => a.kind === 'low').map((a) => a.item));
  const rows = useMemo(() => {
    const byItem = new Map<string, PharmStock[]>();
    for (const s of board.stock) if (s.qty > 0) byItem.set(s.item, [...(byItem.get(s.item) || []), s]);
    for (const id of lowItems) if (!byItem.has(id)) byItem.set(id, []);
    return board.items
      .filter((m) => byItem.has(m.name))
      .map((m) => {
        const batches = byItem.get(m.name) || [];
        return { m, batches, available: batches.filter((b) => !b.expired).reduce((n, b) => n + b.qty, 0), expiring: batches.some((b) => b.expired || (b.days_left ?? 999) <= board.constants.near_days) };
      })
      .filter((r) => !term || [r.m.medicine_name, r.m.generic_name, r.m.item_code].some((v) => (v || '').toLowerCase().includes(term)))
      .filter((r) => show === 'all' || (show === 'low' ? lowItems.has(r.m.name) : r.expiring));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, term, show]);

  return (
    <>
      <div className="toolbar">
        <Tabs
          value={show}
          onChange={setShow}
          tabs={[
            { value: 'all', label: 'All medicines' },
            { value: 'low', label: 'Low stock' },
            { value: 'expiry', label: 'Expiring / expired' },
          ]}
        />
        <span className="spacer" />
        <SearchBox value={q} onChange={setQ} placeholder="Medicine, generic name or code" />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Medicine</th>
              <th className="num">Available</th>
              <th className="num">Reorder at</th>
              <th>Batches (batch · expiry · qty)</th>
              <th className="num">Central store</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, batches, available }) => (
              <tr key={m.name}>
                <td>
                  <strong>{m.medicine_name}</strong>
                  <small className="block muted">{[m.strength, m.pack_size, m.generic_name, m.schedule && `Sch ${m.schedule}`].filter(Boolean).join(' · ')}</small>
                </td>
                <td className="num">
                  <b className={lowItems.has(m.name) ? 'neg' : ''}>{available}</b> <span className="muted small">{m.uom}</span>
                </td>
                <td className="num">{m.reorder_branch || '—'}</td>
                <td className="wrap">
                  {batches.length === 0 && <span className="muted small">Out of stock</span>}
                  <ul className="batch-list">
                    {batches.map((b) => (
                      <li key={b.batch}>
                        <span className="mono">{b.batch_no}</span> · {fmtDate(b.expiry_date)} · <b>{b.qty}</b> {expiryPill(b, board.constants.near_days)}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="num muted">{board.central_qty[m.name] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty text={board.stock.length ? 'No medicines match.' : 'No medicine stock at this branch yet. Raise a requisition to the central store.'} icon="pill" />}
      </div>
    </>
  );
}

function RequisitionsTab({ board, write }: { board: PharmBoard; write: boolean }) {
  const { mutate, branch } = useCare();
  const cancel = (req: string) =>
    window.confirm(`Cancel requisition ${req}?`) &&
    mutate(() => api('/pharmacy/requisitions/cancel', { method: 'POST', body: { requisition: req, branch_id: branch } }), `${req} cancelled`);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Requisition</th>
            <th>Priority</th>
            <th>Medicines (requested · approved · sent · received)</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {board.requisitions.map((r) => (
            <tr key={r.name}>
              <td>
                <strong className="mono">{r.req_no}</strong>
                <small className="block muted">
                  {fmtStamp(r.creation)} · {r.requested_by_name}
                  {r.required_by ? ` · needed by ${fmtDate(r.required_by)}` : ''}
                </small>
              </td>
              <td>
                <Pill tone={PRIORITY_TONE[r.priority] || 'grey'}>{r.priority}</Pill>
              </td>
              <td className="wrap">
                <ul className="batch-list">
                  {r.lines.map((l) => (
                    <li key={l.item}>
                      {l.item_name}: {l.qty} · {r.status === 'Pending' ? '—' : l.approved} · {l.dispatched} · {l.delivered} <span className="muted small">{l.uom}</span>
                    </li>
                  ))}
                </ul>
                {r.note && <small className="block muted">Note: {r.note}</small>}
                {r.decision_note && (
                  <small className="block">
                    {r.decided_by}: {r.decision_note}
                  </small>
                )}
              </td>
              <td>
                <Pill tone={REQ_TONE[r.status] || 'grey'}>{r.status}</Pill>
              </td>
              <td className="row-actions">
                {write && ['Pending', 'Approved', 'Partially Approved'].includes(r.status) && r.lines.every((l) => !l.dispatched) && (
                  <button type="button" className="btn btn-ghost sm" onClick={() => cancel(r.req_no)}>
                    Cancel
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {board.requisitions.length === 0 && <Empty text="No requisitions yet." icon="clipboard" />}
    </div>
  );
}

function DeliveriesTab({ board, write, onReceive, onChallan }: { board: PharmBoard; write: boolean; onReceive: (d: PharmDispatch) => void; onChallan: (c: string) => void }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Challan</th>
            <th>Medicines</th>
            <th>Tracking</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {board.dispatches.map((d) => {
            const last = d.events[d.events.length - 1];
            return (
              <tr key={d.name}>
                <td>
                  <strong className="mono">{d.challan_no}</strong>
                  <small className="block muted">
                    {d.requisition || 'Direct transfer'} · {fmtStamp(d.dispatched_on)}
                  </small>
                </td>
                <td className="wrap">
                  <ul className="batch-list">
                    {d.lines.map((l, i) => (
                      <li key={i}>
                        {l.item_name} · <span className="mono">{l.batch_no}</span> · exp {fmtDate(l.expiry)} · <b>{l.qty}</b>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="small">
                  {[d.carrier, d.vehicle_no, d.driver_phone].filter(Boolean).join(' · ') || '—'}
                  {d.expected_on && <span className="block muted">Expected {fmtDate(d.expected_on)}</span>}
                  {last && <span className="block muted">{last.status} · {fmtStamp(last.at)}</span>}
                  {d.received_by && <span className="block">Received by {d.received_by}</span>}
                </td>
                <td>
                  <Pill tone={DSP_TONE[d.status] || 'grey'}>{d.status}</Pill>
                </td>
                <td className="row-actions">
                  <button type="button" className="btn btn-ghost sm" onClick={() => onChallan(d.challan_no)}>
                    <Icon name="download" size={15} /> Challan
                  </button>
                  {write && !['Delivered', 'Cancelled'].includes(d.status) && (
                    <button type="button" className="btn btn-primary sm" onClick={() => onReceive(d)}>
                      <Icon name="check" size={15} /> Confirm receipt
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {board.dispatches.length === 0 && <Empty text="No deliveries to this branch yet." icon="truck" />}
    </div>
  );
}

function BatchDocs({ rows, empty }: { rows: { no: string; at: string; status: string; lines: PharmBatchLine[]; by?: string; note?: string; extra: string }[]; empty: string }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Reference</th>
            <th>Batches</th>
            <th>Status / reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.no}>
              <td>
                <strong className="mono">{r.no}</strong>
                <small className="block muted">
                  {fmtStamp(r.at)}
                  {r.by ? ` · ${r.by}` : ''}
                </small>
              </td>
              <td className="wrap">
                <ul className="batch-list">
                  {r.lines.map((l, i) => (
                    <li key={i}>
                      {l.item_name} · <span className="mono">{l.batch_no}</span> · <b>{Math.abs(l.qty)}</b>
                      {l.reason ? <span className="muted"> · {l.reason}</span> : null}
                    </li>
                  ))}
                </ul>
                {r.note && <small className="block muted">Note: {r.note}</small>}
              </td>
              <td>
                <Pill tone={r.status === 'Received' ? 'green' : r.status === 'In Transit' ? 'purple' : 'grey'}>{r.status}</Pill>
                {r.extra && <small className="block muted">{r.extra}</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <Empty text={empty} icon="box" />}
    </div>
  );
}

function HistoryTab({ names }: { names: Record<string, string> }) {
  const { branch } = useCare();
  const [from, setFrom] = useState(addDays(todayIst(), -30));
  const [to, setTo] = useState(todayIst());
  const { data, error } = useApi<PharmLedgerRow[]>(branch ? withQuery('/pharmacy/ledger', { branch, from, to }) : null);
  return (
    <>
      <div className="toolbar">
        <label className="inline-field">
          From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="inline-field">
          To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {error && <ErrorNote text={error} />}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Medicine · batch</th>
              <th>Entry</th>
              <th className="num">In / out</th>
              <th className="num">Batch balance</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {(data || []).map((r, i) => (
              <tr key={i}>
                <td className="nowrap">{fmtStamp(r.posted_on)}</td>
                <td>
                  {names[r.item] || r.item}
                  <small className="block muted mono">
                    {r.batch_no}
                    {r.expiry_date ? ` · exp ${fmtDate(r.expiry_date)}` : ''}
                  </small>
                </td>
                <td>
                  {r.voucher_type} <span className="mono small">{r.voucher_no}</span>
                  {r.note && <small className="block muted">{r.note}</small>}
                </td>
                <td className={`num ${r.qty < 0 ? 'neg' : 'pos'}`}>
                  <b>{r.qty > 0 ? `+${r.qty}` : r.qty}</b>
                </td>
                <td className="num">{r.balance}</td>
                <td className="small">{r.actor}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.length === 0 && <Empty text="No stock movements in these dates." icon="box" />}
      </div>
    </>
  );
}

function RequisitionDialog({ board, onClose }: { board: PharmBoard; onClose: () => void }) {
  const { mutate, branch } = useCare();
  const [lines, setLines] = useState<{ item: string; qty: string }[]>([{ item: '', qty: '' }]);
  const [priority, setPriority] = useState('Normal');
  const [requiredBy, setRequiredBy] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const here = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of board.stock) if (!s.expired) m[s.item] = (m[s.item] || 0) + s.qty;
    return m;
  }, [board.stock]);
  const low = board.alerts.filter((a) => a.kind === 'low');
  const ready = lines.some((l) => l.item && Number(l.qty) > 0);
  const set = (i: number, patch: Partial<{ item: string; qty: string }>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const addLow = () =>
    setLines((ls) => {
      const have = new Set(ls.map((l) => l.item));
      const extra = low
        .filter((a) => !have.has(a.item))
        .map((a) => ({ item: a.item, qty: String(Math.max((a.reorder || 0) * 2 - (a.qty || 0), 1)) }));
      return [...ls.filter((l) => l.item), ...extra];
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await mutate(
      () =>
        api<{ req_no: string }>('/pharmacy/requisitions', {
          method: 'POST',
          body: {
            lines: lines.filter((l) => l.item && Number(l.qty) > 0).map((l) => ({ item: l.item, qty: Number(l.qty) })),
            priority,
            required_by: requiredBy || undefined,
            note,
            branch_id: branch,
          },
        }),
      (res) => `Requisition ${res.req_no} sent to the Operations Manager`,
    );
    setBusy(false);
    if (r) onClose();
  };

  return (
    <Modal
      title="New medicine requisition"
      subtitle={`${board.location.location_name} → Central Pharmacy Store`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="req-form" className="btn btn-primary" disabled={busy || !ready}>
            {busy ? 'Sending…' : 'Send requisition'}
          </button>
        </>
      }
    >
      <form id="req-form" className="stack" onSubmit={submit}>
        <div className="grid-3">
          <Field label="Urgency">
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {board.constants.priorities.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Needed by">
            <input type="date" value={requiredBy} min={todayIst()} onChange={(e) => setRequiredBy(e.target.value)} />
          </Field>
          {low.length > 0 && (
            <button type="button" className="btn btn-soft sm align-end" onClick={addLow}>
              <Icon name="alert" size={15} /> Add {low.length} low-stock medicine{low.length > 1 ? 's' : ''}
            </button>
          )}
        </div>
        <table className="table req-lines">
          <thead>
            <tr>
              <th>Medicine</th>
              <th className="num">At branch</th>
              <th className="num">Central</th>
              <th className="num">Requested qty</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const m = board.items.find((x) => x.name === l.item);
              return (
                <tr key={i}>
                  <td>
                    <select value={l.item} onChange={(e) => set(i, { item: e.target.value })} aria-label="Medicine">
                      <option value="">Choose medicine</option>
                      {board.items.map((x) => (
                        <option key={x.name} value={x.name} disabled={lines.some((o, j) => j !== i && o.item === x.name)}>
                          {x.medicine_name}
                          {x.strength ? ` ${x.strength}` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">{l.item ? here[l.item] || 0 : '—'}</td>
                  <td className="num muted">{l.item ? board.central_qty[l.item] ?? 0 : '—'}</td>
                  <td className="num">
                    <input type="number" min={1} step={1} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} aria-label="Quantity" />
                    {m?.uom && <span className="muted small"> {m.uom}</span>}
                  </td>
                  <td>
                    <button type="button" className="icon-btn sm" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [{ item: '', qty: '' }]))} aria-label="Remove line">
                      <Icon name="x" size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button type="button" className="btn btn-ghost sm" onClick={() => setLines((ls) => [...ls, { item: '', qty: '' }])}>
          <Icon name="plus" size={14} /> Add medicine
        </button>
        <Field label="Note for the Operations Manager">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Reason, patient demand, etc." />
        </Field>
      </form>
    </Modal>
  );
}

function BatchDialog({ board, mode, onClose }: { board: PharmBoard; mode: 'return' | 'adjust'; onClose: () => void }) {
  const { mutate, branch } = useCare();
  const reasons = mode === 'return' ? board.constants.return_reasons : board.constants.adj_reasons;
  const batches = board.stock.filter((s) => s.qty > 0);
  const names = Object.fromEntries(board.items.map((m) => [m.name, m.medicine_name]));
  const [lines, setLines] = useState<{ batch: string; qty: string; reason: string }[]>([{ batch: '', qty: '', reason: reasons[0] }]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<{ batch: string; qty: string; reason: string }>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const ready = lines.some((l) => l.batch && Number(l.qty) > 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body = { lines: lines.filter((l) => l.batch && Number(l.qty) > 0).map((l) => ({ batch: l.batch, qty: Number(l.qty), reason: l.reason })), note, branch_id: branch };
    const r = await mutate(
      () => api<{ return_no?: string; adj_no?: string }>(mode === 'return' ? '/pharmacy/returns' : '/pharmacy/adjustments', { method: 'POST', body }),
      (res) => (mode === 'return' ? `Return ${res.return_no} sent to the central store` : `Recorded as ${res.adj_no}`),
    );
    setBusy(false);
    if (r) onClose();
  };

  return (
    <Modal
      title={mode === 'return' ? 'Return stock to the central store' : 'Record dispensed / damaged stock'}
      subtitle={mode === 'return' ? 'Excess, damaged, near-expiry, expired, recalled or wrong medicines go back to the Central Pharmacy Store' : 'Stock that left the branch outside a pharmacy bill'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="batch-form" className="btn btn-primary" disabled={busy || !ready}>
            {busy ? 'Saving…' : mode === 'return' ? 'Send return' : 'Record'}
          </button>
        </>
      }
    >
      <form id="batch-form" className="stack" onSubmit={submit}>
        <table className="table req-lines">
          <thead>
            <tr>
              <th>Batch</th>
              <th className="num">Qty</th>
              <th>Reason</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const b = batches.find((x) => x.batch === l.batch);
              return (
                <tr key={i}>
                  <td>
                    <select value={l.batch} onChange={(e) => set(i, { batch: e.target.value })} aria-label="Batch">
                      <option value="">Choose batch</option>
                      {batches.map((x) => (
                        <option key={x.batch} value={x.batch} disabled={lines.some((o, j) => j !== i && o.batch === x.batch)}>
                          {names[x.item] || x.item} · {x.batch_no} · exp {fmtDate(x.expiry_date)} · {x.qty} in stock{x.expired ? ' · EXPIRED' : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    <input type="number" min={1} max={b?.qty} step={1} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} aria-label="Quantity" />
                  </td>
                  <td>
                    <select value={l.reason} onChange={(e) => set(i, { reason: e.target.value })} aria-label="Reason">
                      {reasons.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button type="button" className="icon-btn sm" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))} aria-label="Remove line">
                      <Icon name="x" size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button type="button" className="btn btn-ghost sm" onClick={() => setLines((ls) => [...ls, { batch: '', qty: '', reason: reasons[0] }])}>
          <Icon name="plus" size={14} /> Add batch
        </button>
        <Field label="Note">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        {batches.length === 0 && <p className="muted small">There is no stock at this branch.</p>}
      </form>
    </Modal>
  );
}

function ReceiveDialog({ d, onClose }: { d: PharmDispatch; onClose: () => void }) {
  const { mutate, me, branch } = useCare();
  const [receivedBy, setReceivedBy] = useState(me?.full_name || '');
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setReceivedBy((v) => v || me?.full_name || ''), [me]);
  const total = d.lines.reduce((n, l) => n + l.qty, 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await mutate(() => api('/pharmacy/receive', { method: 'POST', body: { challan: d.challan_no, received_by: receivedBy, note, branch_id: branch } }), `${d.challan_no} received; stock added to the branch`);
    setBusy(false);
    if (r) onClose();
  };

  return (
    <Modal
      title={`Confirm receipt · ${d.challan_no}`}
      subtitle={d.requisition ? `Against requisition ${d.requisition}` : 'Direct transfer from the central store'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="recv-form" className="btn btn-primary" disabled={busy || !checked || !receivedBy.trim()}>
            {busy ? 'Saving…' : `Receive ${total} units`}
          </button>
        </>
      }
    >
      <form id="recv-form" className="stack" onSubmit={submit}>
        <table className="table">
          <thead>
            <tr>
              <th>Medicine</th>
              <th>Batch</th>
              <th>Expiry</th>
              <th className="num">Qty</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.item_name}</td>
                <td className="mono">{l.batch_no}</td>
                <td>{fmtDate(l.expiry)}</td>
                <td className="num">
                  <b>{l.qty}</b> <span className="muted small">{l.uom}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid-2">
          <Field label="Received by *">
            <input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} required maxLength={140} />
          </Field>
          <Field label="Note">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Packaging, seal, temperature…" />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I have counted the medicines and batches against this challan
        </label>
        <p className="muted small">
          If anything is missing or damaged, do not confirm: tell the Operations Manager first. After receipt, damaged items can be recorded under “Dispensed &amp; damaged” or returned.
        </p>
      </form>
    </Modal>
  );
}
