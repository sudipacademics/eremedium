import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useApi, useCare } from '../../store';
import type { Appointment, Branch, Invoice, InvoiceLine, InvoiceType, Item, LabTest, PackageUsage, Payment, Sellable, Service, Settings } from '../../types';
import { LOGO_URL, printInvoice, rupeesInWords } from '../../invoicePrint';
import { useServiceSearch } from './ServiceSearch';
import { fmtDate, fmtStamp, inr, TYPE_LABEL } from '../../format';
import { DiscountInput, discountAmount, ErrorNote, Field, Loading, Modal, Pill, TypePill, type DiscountType } from '../ui';
import { Icon } from '../../icons';
import { loadPatientChoice, PatientPicker, resolvePatient, type PatientChoice, type PatientDraft } from './PatientForm';

type Line = { key: number; item_id?: number; med?: string; item?: string; batches?: string; name: string; qty: string; rate: string; stock?: number; auto?: boolean };

let lineSeq = 0;
const line = (l: Omit<Line, 'key'>): Line => ({ ...l, key: (lineSeq += 1) });

function linesFromAppointment(a: Appointment): Line[] {
  if ((a.type === 'lab' || a.type === 'diagnostic') && a.tests) {
    try {
      return (JSON.parse(a.tests) as LabTest[]).map((t) => line({ name: t.name, qty: '1', rate: String(t.price) }));
    } catch {
      /* fall through to a single line */
    }
  }
  const name = a.type === 'physiotherapy' && a.session_no ? `${a.service} (Session ${a.session_no}/${a.total_sessions ?? '?'})` : a.service;
  return [line({ name, qty: '1', rate: String(a.fee) })];
}

export function InvoiceForm({ type, patientId, appointment, onClose }: { type?: InvoiceType; patientId?: number; appointment?: Appointment; onClose: () => void }) {
  const { meta, branch, mutate, openModal, can } = useCare();
  const [kind, setKind] = useState<InvoiceType>(type || appointment?.type || 'consultation');
  const [patient, setPatient] = useState<PatientChoice>(null);
  const [draft, setDraft] = useState<PatientDraft | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const [customer, setCustomer] = useState('');
  const [lines, setLines] = useState<Line[]>(() => (appointment ? linesFromAppointment(appointment) : []));
  const [discount, setDiscount] = useState('0');
  const [discountType, setDiscountType] = useState<DiscountType>('flat');
  const [paid, setPaid] = useState('');
  const [paidTouched, setPaidTouched] = useState(false);
  const [mode, setMode] = useState('UPI');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [stock, setStock] = useState<Item[]>([]);
  const [doctorId, setDoctorId] = useState(appointment?.type === 'consultation' && appointment.practitioner_id ? String(appointment.practitioner_id) : '');
  const pharmacy = kind === 'pharmacy';
  const consultation = kind === 'consultation';
  const doctors = (meta?.practitioners || []).filter((p) => p.role === 'Doctor' && (p.active || String(p.id) === doctorId));

  const pickDoctor = (id: string) => {
    setDoctorId(id);
    const doc = doctors.find((d) => String(d.id) === id);
    if (appointment) return;
    setLines((current) => {
      const manual = current.filter((l) => !l.auto);
      if (!doc) return manual;
      return [line({ name: `Consultation — ${doc.name}${doc.specialty ? ` (${doc.specialty})` : ''}`, qty: '1', rate: String(doc.fee || 0), auto: true }), ...manual];
    });
  };
  const allowedKinds: InvoiceType[] = can('Billing & Invoice', 'create') ? ['consultation', 'physiotherapy', 'diagnostic', 'pharmacy', 'other'] : ['pharmacy'];

  useEffect(() => {
    const id = patientId || appointment?.patient_id;
    if (id) loadPatientChoice(id).then(setPatient).catch(() => undefined);
  }, [patientId, appointment]);

  useEffect(() => {
    if (!pharmacy) return;
    const q = branch ? `?branch=${branch}` : '';
    Promise.all([
      api<{ items: Sellable[] }>(`/pharmacy/sellable${q}`).catch(() => ({ items: [] as Sellable[] })),
      api<{ items: Item[] }>(`/items${q}`).catch(() => ({ items: [] as Item[] })),
    ]).then(([meds, local]) =>
      setStock([
        ...meds.items.map(
          (m, i): Item => ({
            id: -(i + 1), med: m.item, name: [m.name, m.strength].filter(Boolean).join(' '), sku: m.item, category: m.schedule ? `Schedule ${m.schedule}` : 'Medicine',
            unit: m.uom, stock: m.qty, reorder_level: 0, cost: 0, price: m.mrp, expiry: m.next_expiry || null, vendor: null, branch_id: branch || null,
          }),
        ),
        ...local.items.filter((i) => i.price > 0 && i.category !== 'Medicine'),
      ]),
    );
  }, [pharmacy, branch]);

  const services = (meta?.services || []).filter((s) => s.active && s.category === kind);
  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const discountRs = discountAmount(subtotal, discount, discountType);
  const total = Math.max(Math.round((subtotal - discountRs) * 100) / 100, 0);
  useEffect(() => {
    if (!paidTouched) setPaid(String(total));
  }, [total, paidTouched]);

  const addService = (id: string) => {
    const s = services.find((x) => String(x.id) === id);
    if (s) setLines((l) => [...l, line({ name: s.name, qty: '1', rate: String(s.price) })]);
  };
  const addItem = (id: string) => {
    const it = stock.find((x) => String(x.id) === id);
    if (!it) return;
    setLines((l) =>
      l.some((x) => x.item_id === it.id)
        ? l.map((x) => (x.item_id === it.id ? { ...x, qty: String((Number(x.qty) || 0) + 1) } : x))
        : [...l, line({ item_id: it.id, med: it.med, name: it.name, qty: '1', rate: String(it.price), stock: it.stock })],
    );
  };
  const setLine = (key: number, patch: Partial<Line>) => setLines((l) => l.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = await mutate(
      async () => {
        const pid = pharmacy && walkIn ? null : await resolvePatient(patient, draft);
        return api<{ invoice: Invoice }>('/invoices', {
          method: 'POST',
          body: {
            service_type: kind,
            patient_id: pid,
            customer: pharmacy && walkIn ? customer : undefined,
            appointment_id: appointment?.id,
            items: lines.map((l) => ({ item_id: l.med ? undefined : l.item_id, med: l.med, name: l.name, qty: Number(l.qty), rate: Number(l.rate) })),
            discount: Number(discount) || 0,
            discount_type: discountType,
            practitioner_id: consultation ? Number(doctorId) || null : null,
            paid: Number(paid) || 0,
            mode,
            reference,
            notes,
            branch_id: branch || undefined,
          },
        });
      },
      (r) => `Invoice ${r.invoice.number} created`,
    );
    setBusy(false);
    if (result) openModal({ kind: 'viewInvoice', id: result.invoice.id });
  };

  return (
    <Modal
      title={pharmacy ? 'Pharmacy Sale' : 'Generate Invoice'}
      subtitle={appointment ? `For ${appointment.code} · ${appointment.patient}` : undefined}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="foot-total">
            Total <strong>{inr(total, true)}</strong>
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="invoice-form" className="btn btn-primary" disabled={busy || !lines.length || (consultation && !doctorId)}>
            {busy ? 'Saving…' : 'Create invoice'}
          </button>
        </>
      }
    >
      <form id="invoice-form" onSubmit={submit} className="stack">
        <div className="grid-2">
          {!appointment && !type && (
            <Field label="Service type">
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as InvoiceType);
                  setLines([]);
                  setDoctorId('');
                }}
              >
                {allowedKinds.map((k) => (
                  <option key={k} value={k}>
                    {TYPE_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {consultation && (
            <Field label="Doctor *" hint={doctors.length ? undefined : 'Add doctors in the Doctors module first'}>
              <select value={doctorId} onChange={(e) => pickDoctor(e.target.value)} required disabled={Boolean(appointment?.practitioner_id)}>
                <option value="">Choose consulting doctor</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.specialty ? ` — ${d.specialty}` : ''}
                    {d.fee ? ` — ${inr(d.fee)}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {pharmacy && (
            <Field label="Customer" group>
              <div className="seg">
                <button type="button" className={!walkIn ? 'on' : ''} onClick={() => setWalkIn(false)}>
                  Registered patient
                </button>
                <button type="button" className={walkIn ? 'on' : ''} onClick={() => setWalkIn(true)}>
                  Walk-in
                </button>
              </div>
            </Field>
          )}
        </div>
        {pharmacy && walkIn ? (
          <Field label="Customer name *">
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} required />
          </Field>
        ) : (
          <Field label="Patient *" group>
            <PatientPicker value={patient} onChange={setPatient} newDraft={draft} onNewDraft={setDraft} />
          </Field>
        )}

        <div className="lines">
          <div className="lines-head">
            <strong>Items</strong>
            {pharmacy ? (
              <MedicinePicker stock={stock} onPick={(it) => addItem(String(it.id))} />
            ) : kind === 'lab' || kind === 'diagnostic' ? (
              <TestLinePicker category={kind} onPick={(s) => setLines((l) => [...l, line({ name: s.name, qty: '1', rate: String(s.price) })])} />
            ) : (
              services.length > 0 && (
                <select value="" onChange={(e) => addService(e.target.value)} aria-label="Add service">
                  <option value="">+ Add from price list</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {inr(s.price)}
                    </option>
                  ))}
                </select>
              )
            )}
            <button type="button" className="btn btn-ghost sm" onClick={() => setLines((l) => [...l, line({ name: '', qty: '1', rate: '0' })])}>
              <Icon name="plus" size={14} /> Custom line
            </button>
          </div>
          {lines.length === 0 && <p className="muted small">Add at least one item.</p>}
          {lines.map((l) => (
            <div key={l.key} className="line">
              <input value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} placeholder="Description" required readOnly={Boolean(l.item_id)} />
              <input type="number" min={l.med ? 1 : 0.01} step={l.med ? 1 : 'any'} max={l.stock} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} aria-label="Quantity" />
              <input type="number" min={0} step="any" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} aria-label="Rate" />
              <span className="num">{inr((Number(l.qty) || 0) * (Number(l.rate) || 0), true)}</span>
              <button type="button" className="icon-btn sm" onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))} aria-label="Remove line">
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="grid-4">
          <Field label={discountType === 'percent' ? 'Discount (%)' : 'Discount (₹)'} group>
            <DiscountInput
              value={discount}
              type={discountType}
              subtotal={subtotal}
              onChange={(v, t) => {
                setDiscount(v);
                setDiscountType(t);
              }}
            />
          </Field>
          <Field label="Amount received (₹)">
            <input type="number" min={0} max={total} value={paid} onChange={(e) => { setPaidTouched(true); setPaid(e.target.value); }} />
          </Field>
          <Field label="Payment mode">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              {(meta?.enums.payModes || []).map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Reference">
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI / card ref" />
          </Field>
        </div>
        <Field label="Notes">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/* Type-to-search over the branch's sellable stock. Enter adds the highlighted item; picking it again adds one more. */
function MedicinePicker({ stock, onPick }: { stock: Item[]; onPick: (it: Item) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const term = q.trim().toLowerCase();
  const matches = useMemo(() => {
    const list = term
      ? stock.filter((it) => [it.name, it.sku, it.category, it.vendor].some((v) => (v || '').toLowerCase().includes(term)))
      : stock;
    return [...list]
      .sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || Number(!a.name.toLowerCase().startsWith(term)) - Number(!b.name.toLowerCase().startsWith(term)) || a.name.localeCompare(b.name))
      .slice(0, 15);
  }, [stock, term]);
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

  const pick = (it: Item | undefined) => {
    if (!it || it.stock <= 0) return;
    onPick(it);
    setQ('');
    setCursor(0);
  };

  return (
    <div className="picker medicine-picker">
      <div className="searchbox">
        <Icon name="search" size={16} />
        <input
          value={q}
          placeholder="Search medicine by name, SKU or category"
          aria-label="Search medicine"
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, matches.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(matches[cursor]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
      </div>
      {open && (
        <div className="picker-list">
          {matches.map((it, i) => {
            const out = it.stock <= 0;
            const expired = it.expiry && it.expiry < today;
            return (
              <button
                key={it.id}
                type="button"
                className={i === cursor ? 'active' : ''}
                disabled={out}
                onMouseEnter={() => setCursor(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(it)}
              >
                <span className="med-row">
                  <strong>{it.name}</strong>
                  <b>{inr(it.price, true)}</b>
                </span>
                <small className={out ? 'neg' : ''}>
                  {out ? 'Out of stock' : `${it.stock} ${it.unit} in stock`}
                  {it.sku ? ` · ${it.sku}` : ''}
                  {it.category ? ` · ${it.category}` : ''}
                  {it.expiry ? (expired ? ' · EXPIRED' : ` · Exp ${it.expiry.slice(5, 7)}/${it.expiry.slice(2, 4)}`) : ''}
                </small>
              </button>
            );
          })}
          {matches.length === 0 && <p className="muted small pad">{stock.length ? `No medicine matches “${q}”.` : 'No sellable stock in this branch yet.'}</p>}
        </div>
      )}
    </div>
  );
}

function TestLinePicker({ category, onPick }: { category: 'lab' | 'diagnostic'; onPick: (s: Service) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { items } = useServiceSearch(category, q, 12);
  return (
    <div className="picker lab-line-picker">
      <div className="searchbox">
        <Icon name="search" size={16} />
        <input
          value={q}
            placeholder={category === 'lab' ? '+ Add lab test' : '+ Add diagnostic test'}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {open && (
        <div className="picker-list">
          {items.map((s) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(s);
                setQ('');
              }}
            >
              <strong>{s.name}</strong>
              <small>
                {inr(s.price)}
                {s.sample_type ? ` · ${s.sample_type}` : ''}
                {s.code ? ` · ${s.code}` : ''}
              </small>
            </button>
          ))}
          {items.length === 0 && <p className="muted small pad">No tests match.</p>}
        </div>
      )}
    </div>
  );
}

function PackageUsageView({ usage: u, onOpenBill }: { usage: PackageUsage; onOpenBill: (id: number) => void }) {
  return (
    <div className="package-usage">
      <h4>
        Package usage · Plan {u.plan_code}
      </h4>
      <div className="usage-stats">
        <span>
          Sessions completed <b>{u.completed} of {u.total_sessions}</b>
        </span>
        <span>
          Value used <b>{inr(u.value_used, true)}</b> <small className="muted">({inr(u.per_session, true)} × {u.completed})</small>
        </span>
        <span>
          Paid <b>{inr(u.paid, true)}</b>
        </span>
        {u.due_for_used > 0 ? (
          <span className="neg">
            Due for sessions taken <b>{inr(u.due_for_used, true)}</b>
          </span>
        ) : u.advance > 0 ? (
          <span className="pos">
            Paid in advance <b>{inr(u.advance, true)}</b>
          </span>
        ) : (
          <span className="pos">Up to date</span>
        )}
      </div>
      <div className="usage-sessions">
        {u.sessions.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`session-chip st-${s.status.replace(/\s/g, '-').toLowerCase()}`}
            disabled={!s.session_bill_id}
            onClick={() => s.session_bill_id && onOpenBill(s.session_bill_id)}
            title={s.session_bill_number ? `Open session invoice ${s.session_bill_number}` : 'No session invoice yet'}
          >
            <b>#{s.session_no}</b>
            <span>{fmtDate(s.date, false)}</span>
            <small>{s.status}</small>
            {s.session_bill_number && <small className="mono">S{s.session_no} invoice</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

type InvoiceDetail = {
  invoice: Invoice & { items: InvoiceLine[] };
  payments: Payment[];
  settings: Settings;
  branch: Partial<Branch> | null;
  session_bills?: { id: number; number: string; session_no: number; amount: number; created_at: string }[];
  package_usage?: PackageUsage | null;
};

export function InvoiceView({ id, onClose }: { id: number; onClose: () => void }) {
  const { can, me, openModal, mutate, meta } = useCare();
  const { data, error } = useApi<InvoiceDetail>(`/invoices/${id}`);
  const inv = data?.invoice;
  const s = data?.settings || {};
  const b = data?.branch;
  const gstin = b?.gst_registered && b.gstin ? b.gstin : s.gstin || '';
  const address = [b?.address, b?.city].filter(Boolean).join(', ') || s.address || '';
  const phone = b?.phone || s.phone || '';
  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState('0');
  const [discountType, setDiscountType] = useState<DiscountType>('flat');
  const [busy, setBusy] = useState(false);
  const print = () => {
    if (data && !printInvoice(data.invoice, data.payments, s, b || null, data.package_usage || null)) window.alert('Allow pop-ups for this site to print the invoice.');
  };
  const due = inv ? inv.total - inv.paid : 0;
  const module = inv?.service_type === 'pharmacy' ? 'Pharmacy' : 'Billing & Invoice';
  const canPay = inv && inv.status !== 'Cancelled' && due > 0 && (can('Billing & Invoice', 'edit') || can('Pharmacy', 'edit'));
  const canCancel = inv && inv.status !== 'Cancelled' && !inv.trf_id && (can('Billing & Invoice', 'approve') || can(module, 'approve'));
  /* Edit bill is for managers with Portal Access “All branches” (or System Manager), not branch staff. */
  const managerAllBranches = me.branches == null && (me.exempt || /manager/i.test(me.role_label) || me.roles.some((role) => /care manager|aesthetic manager|system manager|administrator/i.test(role)));
  const canEdit = Boolean(inv && inv.status !== 'Cancelled' && !data?.package_usage && managerAllBranches && (can('Billing & Invoice', 'approve') || (inv.service_type === 'pharmacy' && can('Pharmacy', 'approve'))));
  const editSubtotal = lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const editDiscount = discountAmount(editSubtotal, discount, discountType);
  const editTotal = Math.max(Math.round((editSubtotal - editDiscount) * 100) / 100, 0);
  const editPaid = inv ? Math.min(inv.paid, editTotal) : 0;
  const editDue = Math.max(Math.round((editTotal - editPaid) * 100) / 100, 0);
  const services = (meta?.services || []).filter((svc) => svc.active && inv && svc.category === inv.service_type);

  const startEdit = () => {
    if (!inv) return;
    const type: DiscountType = inv.discount_type === 'percent' ? 'percent' : 'flat';
    setLines(inv.items.map((it) => line({ name: it.name, qty: String(it.qty), rate: String(it.rate), item_id: it.item_id, med: it.med, item: it.item, batches: it.batches })));
    setDiscountType(type);
    setDiscount(String(type === 'percent' ? inv.discount_value || 0 : inv.discount_value || inv.discount || 0));
    setEditing(true);
  };
  const setLine = (key: number, patch: Partial<Line>) => setLines((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const saveBill = async () => {
    if (!inv) return;
    setBusy(true);
    const saved = await mutate(
      () =>
        api(`/invoices/${id}/items`, {
          method: 'POST',
          body: {
            items: lines.map((l) => ({ item_id: l.med ? undefined : l.item_id, med: l.med, item: l.item, name: l.name, qty: Number(l.qty), rate: Number(l.rate) })),
            discount: Number(discount) || 0,
            discount_type: discountType,
          },
        }),
      'Bill updated',
    );
    setBusy(false);
    if (saved) setEditing(false);
  };

  const cancel = async () => {
    const reason = window.prompt('Reason for cancelling this invoice?');
    if (reason === null) return;
    await mutate(() => api(`/invoices/${id}/cancel`, { method: 'POST', body: { reason } }), 'Invoice cancelled');
  };

  return (
    <Modal
      title={inv ? inv.number : 'Invoice'}
      onClose={onClose}
      wide
      footer={
        inv && (
          <>
            {canCancel && !editing && (
              <button type="button" className="btn btn-danger-ghost" onClick={cancel}>
                Cancel invoice
              </button>
            )}
            <span className="spacer" />
            {editing ? (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)} disabled={busy}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={saveBill} disabled={busy || !lines.length}>
                  {busy ? 'Saving…' : 'Save bill'}
                </button>
              </>
            ) : (
              <>
                {canEdit && (
                  <button type="button" className="btn btn-soft" onClick={startEdit}>
                    <Icon name="edit" size={16} /> Edit bill
                  </button>
                )}
                {canPay && (
                  <button type="button" className="btn btn-soft" onClick={() => openModal({ kind: 'payment', invoice: inv })}>
                    <Icon name="rupee" size={16} /> Record payment
                  </button>
                )}
                <button type="button" className="btn btn-primary" onClick={print} title="Prints on the top half of an A4 sheet — choose “Save as PDF” in the print dialog for a PDF">
                  <Icon name="printer" size={16} /> Print / PDF
                </button>
              </>
            )}
          </>
        )
      }
    >
      {error && <ErrorNote text={error} />}
      {!inv && !error && <Loading />}
      {inv && (
        <div className="invoice-print" id="invoice-print">
          <div className="inv-head">
            <div>
              {LOGO_URL ? <img className="inv-logo" src={LOGO_URL} alt={s.clinic_name || 'Remedium Care'} /> : <h2>{s.clinic_name}</h2>}
              {b?.name && <p className="inv-branch">{b.name}</p>}
              {address && <p>{address}</p>}
              {(phone || b?.email) && <p>{[phone && `Phone: ${phone}`, b?.email].filter(Boolean).join(' · ')}</p>}
              {gstin && (
                <p>
                  <b>GSTIN: {gstin}</b>
                  {b?.state ? ` · State: ${b.state}${b.state_code ? ` (${b.state_code})` : ''}` : ''}
                </p>
              )}
            </div>
            <div className="inv-meta">
              <h3>{gstin ? 'TAX INVOICE' : 'INVOICE'}</h3>
              <p className="mono">{inv.number}</p>
              <p>{fmtStamp(inv.created_at)}</p>
              <p>
                <Pill status={inv.status} /> <TypePill type={inv.service_type} />
              </p>
            </div>
          </div>
          <div className="inv-to">
            <span className="muted small">Billed to</span>
            <strong>{inv.patient}</strong>
            {inv.patient_code && <span>{inv.patient_code}</span>}
            {inv.mobile && <span>{inv.mobile}</span>}
            {inv.patient_address && <span>{inv.patient_address}</span>}
            {inv.doctor && (
              <span>
                Consultant: <b>{inv.doctor}</b>
                {[inv.doctor_specialty, inv.doctor_qualification].filter(Boolean).length ? ` (${[inv.doctor_specialty, inv.doctor_qualification].filter(Boolean).join(', ')})` : ''}
                {inv.doctor_registration ? ` · Reg. ${inv.doctor_registration}` : ''}
              </span>
            )}
            {inv.referred_by && (
              <span>
                Ref. by: <b>{inv.referred_by}</b>
              </span>
            )}
            {inv.trf_id && (
              <span>
                Remedium Labs booking <b className="mono">{inv.trf_id}</b>
              </span>
            )}
          </div>
          {editing ? (
            <div className="lines">
              <div className="lines-head">
                <strong>Edit items</strong>
                {inv.service_type === 'lab' || inv.service_type === 'diagnostic' ? (
                  <TestLinePicker
                    category={inv.service_type}
                    onPick={(svc) => setLines((current) => [...current, line({ name: svc.name, qty: '1', rate: String(svc.price), item: svc.code || undefined })])}
                  />
                ) : (
                  services.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => {
                        const svc = services.find((row) => String(row.id) === e.target.value);
                        if (svc) setLines((current) => [...current, line({ name: svc.name, qty: '1', rate: String(svc.price) })]);
                      }}
                      aria-label="Add service"
                    >
                      <option value="">+ Add from price list</option>
                      {services.map((svc) => (
                        <option key={svc.id} value={svc.id}>
                          {svc.name} — {inr(svc.price)}
                        </option>
                      ))}
                    </select>
                  )
                )}
                {inv.service_type !== 'lab' && (
                  <button type="button" className="btn btn-ghost sm" onClick={() => setLines((current) => [...current, line({ name: '', qty: '1', rate: '0' })])}>
                    <Icon name="plus" size={14} /> Custom line
                  </button>
                )}
              </div>
              {inv.service_type === 'pharmacy' && lines.some((l) => l.med) && (
                <p className="muted small">Dispensed medicines keep their quantity, because the batch was already taken. The rate can be changed.</p>
              )}
              {inv.trf_id && <p className="muted small">Saving also updates the Remedium Labs booking. A higher total leaves the extra as due.</p>}
              {lines.map((l) => (
                <div key={l.key} className="line">
                  <input value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} placeholder="Description" required />
                  <input
                    type="number"
                    min={l.med ? 1 : 0.01}
                    step={l.med ? 1 : 'any'}
                    value={l.qty}
                    readOnly={Boolean(l.med)}
                    onChange={(e) => setLine(l.key, { qty: e.target.value })}
                    aria-label="Quantity"
                  />
                  <input type="number" min={0} step="any" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} aria-label="Rate" />
                  <span className="num">{inr((Number(l.qty) || 0) * (Number(l.rate) || 0), true)}</span>
                  {l.med ? (
                    <span />
                  ) : (
                    <button type="button" className="icon-btn sm" onClick={() => setLines((current) => current.filter((row) => row.key !== l.key))} aria-label="Remove line">
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>
              ))}
              <div className="grid-2">
                <Field label={discountType === 'percent' ? 'Discount (%)' : 'Discount (₹)'} group>
                  <DiscountInput
                    value={discount}
                    type={discountType}
                    subtotal={editSubtotal}
                    onChange={(v, t) => {
                      setDiscount(v);
                      setDiscountType(t);
                    }}
                  />
                </Field>
              </div>
              <p className={editDue > 0 ? 'bill-adjust due' : 'bill-adjust'}>
                New total <b>{inr(editTotal, true)}</b>
                {' · '}
                {editPaid + 0.001 < inv.paid ? (
                  <>
                    Paid will be reduced from {inr(inv.paid, true)} to <b>{inr(editPaid, true)}</b>
                  </>
                ) : editDue > 0.001 ? (
                  <>
                    Paid stays {inr(editPaid, true)}. Balance due <b>{inr(editDue, true)}</b>
                  </>
                ) : (
                  <>Paid {inr(editPaid, true)} covers this bill</>
                )}
              </p>
            </div>
          ) : (
          <table className="table inv-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Description</th>
                <th className="num">Qty</th>
                <th className="num">Rate</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.items.map((it, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    {it.name}
                    {it.batches && <small className="block muted">Batch {it.batches}</small>}
                  </td>
                  <td className="num">{it.qty}</td>
                  <td className="num">{inr(it.rate, true)}</td>
                  <td className="num">{inr(it.amount, true)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Subtotal</td>
                <td className="num">{inr(inv.subtotal, true)}</td>
              </tr>
              {inv.discount > 0 && (
                <tr>
                  <td colSpan={4}>Discount{inv.discount_type === 'percent' && inv.discount_value ? ` (${inv.discount_value}%)` : ''}</td>
                  <td className="num">− {inr(inv.discount, true)}</td>
                </tr>
              )}
              {Number(inv.gst_amount) > 0 && (
                <>
                  <tr>
                    <td colSpan={4}>Taxable value</td>
                    <td className="num">{inr(inv.total - Number(inv.gst_amount), true)}</td>
                  </tr>
                  <tr>
                    <td colSpan={4}>GST {inv.gst_rate || 5}% (included)</td>
                    <td className="num">{inr(inv.gst_amount, true)}</td>
                  </tr>
                </>
              )}
              <tr className="grand">
                <td colSpan={4}>Total</td>
                <td className="num">{inr(inv.total, true)}</td>
              </tr>
              <tr>
                <td colSpan={4}>Paid</td>
                <td className="num">{inr(inv.paid, true)}</td>
              </tr>
              {due > 0 && inv.status !== 'Cancelled' && (
                <tr className="due">
                  <td colSpan={4}>Balance due</td>
                  <td className="num">{inr(due, true)}</td>
                </tr>
              )}
            </tfoot>
          </table>
          )}
          {data.payments.length > 0 && (
            <div className="inv-payments">
              <span className="muted small">Payments</span>
              {data.payments.map((p) => (
                <p key={p.id}>
                  {fmtStamp(p.at)} · {p.mode} · {inr(p.amount, true)}
                  {p.reference ? ` · Ref ${p.reference}` : ''}
                </p>
              ))}
            </div>
          )}
          <p className="inv-words">{rupeesInWords(editing ? editTotal : inv.total)}</p>
          {inv.notes && <p className="inv-notes">{inv.notes}</p>}
          {data.package_usage && <PackageUsageView usage={data.package_usage} onOpenBill={(id) => openModal({ kind: 'sessionBill', id })} />}
          <div className="inv-sign">
            <span>For {s.clinic_name || 'Remedium Care'}</span>
            {s.invoice_signature ? <img src={s.invoice_signature} alt="Authorised signature" /> : <span className="inv-sign-space" />}
            <b>{s.signatory_name || 'Authorised Signatory'}</b>
            {s.signatory_name && <small>{s.signatory_title || 'Authorised Signatory'}</small>}
          </div>
          {s.invoice_footer && <p className="inv-foot">{s.invoice_footer}</p>}
        </div>
      )}
    </Modal>
  );
}

export function PaymentForm({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { meta, mutate, openModal } = useCare();
  const due = useMemo(() => Math.round((invoice.total - invoice.paid) * 100) / 100, [invoice]);
  const [amount, setAmount] = useState(String(due));
  const [mode, setMode] = useState('UPI');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await mutate(() => api(`/invoices/${invoice.id}/payments`, { method: 'POST', body: { amount: Number(amount), mode, reference } }), `Payment of ${inr(Number(amount))} recorded`);
    setBusy(false);
    if (r) openModal({ kind: 'viewInvoice', id: invoice.id });
  };

  return (
    <Modal
      title="Record payment"
      subtitle={`${invoice.number} · ${invoice.patient} · ${inr(due, true)} due`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => openModal({ kind: 'viewInvoice', id: invoice.id })}>
            Back
          </button>
          <button type="submit" form="pay-form" className="btn btn-primary" disabled={busy}>
            Save payment
          </button>
        </>
      }
    >
      <form id="pay-form" onSubmit={submit} className="grid-3">
        <Field label="Amount (₹)">
          <input type="number" min={1} max={due} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
        </Field>
        <Field label="Mode">
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {(meta?.enums.payModes || []).map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Reference">
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
