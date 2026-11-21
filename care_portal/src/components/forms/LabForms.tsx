import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, savedSession } from '../../api';
import { Icon } from '../../icons';
import { useCare } from '../../store';
import type { LabBooking, LabQuote, LabStage } from '../../types';
import { fmtStamp, inr } from '../../format';
import { DiscountInput, discountAmount, ErrorNote, Field, Loading, Modal, Pill, type DiscountType } from '../ui';
import { loadPatientChoice, PatientPicker, resolvePatient, type PatientChoice, type PatientDraft } from './PatientForm';
import { useServiceSearch } from './ServiceSearch';
import { ReferralInput, referralReady, SELF_REFERRAL, type Referral } from './ReferralInput';

export const LAB_STAGE_TONE: Record<string, string> = {
  Booked: 'indigo',
  'Sample Collected': 'purple',
  'In Lab': 'blue',
  Processing: 'blue',
  'Result Ready': 'orange',
  Authorized: 'green',
  Dispatched: 'teal',
  Delivered: 'teal',
  Rejected: 'red',
  Cancelled: 'red',
};

export function LabStatus({ b }: { b: Pick<LabBooking, 'status' | 'report_ready'> }) {
  return (
    <>
      <Pill tone={LAB_STAGE_TONE[b.status || 'Booked'] || 'grey'}>{b.status || 'Booked'}</Pill>
      {b.report_ready && b.status !== 'Authorized' && <Pill tone="green">Report ready</Pill>}
    </>
  );
}

/* Opens the authorised PDF from the lab. The tab is opened first so pop-up blockers allow it. */
export async function openLabReport(id: number, onError: (message: string) => void) {
  const win = window.open('', '_blank');
  try {
    const session = savedSession();
    const res = await fetch(`/care-api/lab/bookings/${id}/report`, { headers: session ? { 'X-Care-Sid': session.sid } : {} });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new ApiError(res.status, json.error || `Report is not available (${res.status})`);
    }
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url;
    else {
      const a = document.createElement('a');
      a.href = url;
      a.download = `lab-report-${id}.pdf`;
      a.click();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (err) {
    win?.close();
    onError((err as Error).message);
  }
}

function referralText(r: Referral, doctors: { id: number; name: string }[]) {
  if (r.ref_type === 'doctor') return doctors.find((d) => String(d.id) === r.ref_doctor_id)?.name || 'Self';
  if (r.ref_type === 'outside') return [r.referred_by.trim(), r.ref_contact.trim()].filter(Boolean).join(', ');
  return 'Self';
}

type Picked = { code: string; name: string };

export function LabBookingForm({ patientId, onClose }: { patientId?: number; onClose: () => void }) {
  const { meta, branch, mutate, can, openModal } = useCare();
  const [patient, setPatient] = useState<PatientChoice>(null);
  const [draft, setDraft] = useState<PatientDraft | null>(null);
  const [q, setQ] = useState('');
  const [tests, setTests] = useState<Picked[]>([]);
  const [quote, setQuote] = useState<LabQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [referral, setReferral] = useState(SELF_REFERRAL);
  const [discount, setDiscount] = useState('0');
  const [discountType, setDiscountType] = useState<DiscountType>('flat');
  const [paid, setPaid] = useState('');
  const [mode, setMode] = useState('UPI');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const { items, total, loading, term } = useServiceSearch('lab', q);
  const erpTests = items.filter((s) => s.source === 'erp' && s.code);
  const doctors = (meta?.practitioners || []).filter((p) => p.role === 'Doctor');
  const canCollect = can('Billing & Invoice', 'create') || can('Test & Lab', 'create');

  useEffect(() => {
    if (patientId) loadPatientChoice(patientId).then(setPatient).catch(() => undefined);
  }, [patientId]);

  const codes = tests.map((t) => t.code).join('|');
  useEffect(() => {
    if (!codes) {
      setQuote(null);
      return;
    }
    let alive = true;
    setQuoteError('');
    const t = window.setTimeout(() => {
      api<LabQuote>('/lab/quote', { method: 'POST', body: { tests: codes.split('|') } })
        .then((r) => alive && setQuote(r))
        .catch((err: Error) => alive && setQuoteError(err.message));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [codes]);

  const subtotal = quote?.subtotal ?? 0;
  const net = Math.max(Math.round((subtotal - discountAmount(subtotal, discount, discountType)) * 100) / 100, 0);
  useEffect(() => setPaid(String(net)), [net]);

  const has = (code: string) => tests.some((t) => t.code === code);
  const toggle = (t: Picked) => setTests((list) => (list.some((x) => x.code === t.code) ? list.filter((x) => x.code !== t.code) : [...list, t]));
  const priced = (code: string) => quote?.tests.find((x) => x.item === code);
  const ready = (patient || draft) && tests.length > 0 && quote && !quoteError && referralReady(referral);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const booking = await mutate(
      async () => {
        const pid = await resolvePatient(patient, draft);
        return api<LabBooking>('/lab/bookings', {
          method: 'POST',
          body: {
            patient_id: pid,
            tests: tests.map((t) => t.code),
            referred_by: referralText(referral, doctors),
            discount: Number(discount) || 0,
            discount_type: discountType,
            paid: canCollect ? Number(paid) || 0 : 0,
            mode,
            notes,
            branch_id: branch || undefined,
          },
        });
      },
      (b) => `Lab booking ${b.trf_id} sent to Remedium Labs${b.barcode ? ` · barcode ${b.barcode}` : ''}`,
    );
    setBusy(false);
    if (booking) openModal({ kind: 'labBooking', id: booking.id });
  };

  return (
    <Modal
      title="Book Lab Test"
      subtitle={`Collection centre booking with Remedium Labs${quote ? ` · ${quote.pricing_rule}` : ''}`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="foot-total">
            {quote ? (
              <>
                Bill <strong>{inr(net, true)}</strong>
              </>
            ) : null}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="lab-form" className="btn btn-primary" disabled={busy || !ready}>
            {busy ? 'Sending to lab…' : 'Confirm booking'}
          </button>
        </>
      }
    >
      <form id="lab-form" onSubmit={submit} className="stack">
        <Field label="Patient *" group>
          <PatientPicker value={patient} onChange={setPatient} newDraft={draft} onNewDraft={setDraft} />
        </Field>
        <Field label="Referred by *" group>
          <ReferralInput value={referral} onChange={setReferral} onNavigate={onClose} />
        </Field>
        <Field label="Tests *" group hint="From the Remedium Labs test master. Rates are the lab's rates for this centre.">
          <div className="test-chooser">
            <div className="searchbox">
              <Icon name="search" size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the test master, e.g. thyroid, vitamin, CBC" />
            </div>
            <div className="test-options">
              {erpTests.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className={`chip chip-lab ${has(s.code!) ? 'on' : ''}`}
                  title={[s.sample_type && `Sample: ${s.sample_type}`, s.preparation && `Prep: ${s.preparation}`].filter(Boolean).join(' · ')}
                  onClick={() => toggle({ code: s.code!, name: s.name })}
                >
                  {has(s.code!) && <Icon name="check" size={13} />} {s.name}
                </button>
              ))}
              {!loading && erpTests.length === 0 && <span className="muted small">{term ? `No lab tests match “${term}”.` : 'The test master has not been imported yet.'}</span>}
              {total > items.length && <span className="muted small">Type to narrow down.</span>}
            </div>
            {tests.length > 0 && (
              <ul className="test-picked readonly">
                {tests.map((t) => {
                  const p = priced(t.code);
                  return (
                    <li key={t.code}>
                      <span>
                        {t.name}
                        {p?.sample_type && <small className="block muted">Sample: {p.sample_type}</small>}
                      </span>
                      <b>
                        {p ? inr(p.rate) : '…'}
                        {p?.mrp && p.mrp > p.rate ? <s className="muted small"> {inr(p.mrp)}</s> : null}
                      </b>
                      <button type="button" className="icon-btn sm" onClick={() => toggle(t)} aria-label={`Remove ${t.name}`}>
                        <Icon name="x" size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {quoteError && <ErrorNote text={quoteError} />}
          </div>
        </Field>

        {quote && (
          <div className="pay-box">
            <strong className="small">Bill (recorded on the lab booking and as a Care invoice)</strong>
            <div className="grid-3">
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
              {canCollect && (
                <>
                  <Field label="Amount received (₹)">
                    <input type="number" min={0} max={net} value={paid} onChange={(e) => setPaid(e.target.value)} />
                  </Field>
                  <Field label="Payment mode">
                    <select value={mode} onChange={(e) => setMode(e.target.value)}>
                      {(meta?.enums.payModes || ['Cash', 'UPI']).map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
            </div>
            <span className="muted small">
              Tests {inr(subtotal, true)}
              {net !== subtotal ? ` − discount ${inr(subtotal - net, true)}` : ''} = {inr(net, true)}
            </span>
          </div>
        )}

        <Field label="Notes for the lab">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Fasting, clinical history, urgent, etc." maxLength={300} />
        </Field>
        <p className="muted small">
          The booking is created on the Remedium Labs system with a barcode. Print the barcode on the sample; the lab receives it, enters results and authorises the
          report, which then appears here for download.
        </p>
      </form>
    </Modal>
  );
}

function Timeline({ steps }: { steps: LabStage[] }) {
  return (
    <ol className="lab-timeline">
      {steps.map((s) => (
        <li key={s.stage} className={`${s.reached ? 'done' : ''} ${s.current ? 'current' : ''} ${s.stage === 'Rejected' || s.stage === 'Cancelled' ? 'bad' : ''}`}>
          <span className="dot" />
          <div>
            <b>{s.stage}</b>
            {s.at && <small>{fmtStamp(s.at)}</small>}
            {s.reason && <small className="neg">{s.reason}</small>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function LabBookingView({ id, onClose }: { id: number; onClose: () => void }) {
  const { meta, can, mutate, openModal, toast } = useCare();
  const [b, setB] = useState<LabBooking | null>(null);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('UPI');
  const [reference, setReference] = useState('');
  const canCollect = can('Billing & Invoice', 'create') || can('Test & Lab', 'create');

  const load = useCallback(() => {
    api<LabBooking>(`/lab/bookings/${id}`)
      .then((r) => {
        setB(r);
        setAmount(r.due > 0 ? String(r.due) : '');
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);
  useEffect(load, [load]);

  const collect = async (e: FormEvent) => {
    e.preventDefault();
    const next = await mutate(
      () => api<LabBooking>(`/lab/bookings/${id}/payments`, { method: 'POST', body: { amount: Number(amount), mode, reference } }),
      (r) => `${inr(Number(amount), true)} received for ${r.trf_id}`,
    );
    if (next) {
      setReference('');
      load();
    }
  };

  if (!b) {
    return (
      <Modal title="Lab booking" onClose={onClose} wide>
        {error ? <ErrorNote text={error} /> : <Loading />}
      </Modal>
    );
  }

  return (
    <Modal title={`${b.patient} · ${b.trf_id}`} subtitle={`Barcode ${b.barcode || '—'} · booked ${fmtStamp(b.booked_at)}${b.branch ? ` · ${b.branch}` : ''}`} onClose={onClose} wide>
      {b.offline && <ErrorNote text={`Showing the last known status: ${b.offline}`} />}
      <div className="detail-grid">
        <div className="detail">
          <dl>
            <dt>Status</dt>
            <dd>
              <LabStatus b={b} />
            </dd>
            <dt>Patient</dt>
            <dd>
              {b.patient}
              {b.patient_code ? ` · ${b.patient_code}` : ''}
              {b.mobile ? ` · ${b.mobile}` : ''}
            </dd>
            <dt>Referred by</dt>
            <dd>{b.referred_by || 'Self'}</dd>
            <dt>Report</dt>
            <dd>
              {b.report_ready ? (
                <button type="button" className="btn btn-primary sm" onClick={() => openLabReport(b.id, (m) => toast(m, 'error'))}>
                  <Icon name="download" size={15} /> Authorised report
                </button>
              ) : (
                <span className="muted">{b.report_status || 'Not ready yet'}</span>
              )}
            </dd>
            <dt>Care invoice</dt>
            <dd>
              {b.invoice_id ? (
                <button type="button" className="link" onClick={() => openModal({ kind: 'viewInvoice', id: b.invoice_id! })}>
                  {b.invoice_number} ({b.invoice_status})
                </button>
              ) : (
                '—'
              )}
            </dd>
          </dl>

          <table className="table inv-table">
            <thead>
              <tr>
                <th>Test</th>
                <th className="num">Rate</th>
              </tr>
            </thead>
            <tbody>
              {b.tests.map((t) => (
                <tr key={t.item}>
                  <td>{t.item_name}</td>
                  <td className="num">{t.rate != null ? inr(t.rate) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {b.discount ? (
                <tr>
                  <td>Discount</td>
                  <td className="num">− {inr(b.discount, true)}</td>
                </tr>
              ) : null}
              <tr>
                <td>
                  <b>Total</b>
                </td>
                <td className="num">
                  <b>{inr(b.net, true)}</b>
                </td>
              </tr>
              <tr>
                <td>Paid</td>
                <td className="num">{inr(b.paid, true)}</td>
              </tr>
              <tr>
                <td>Due</td>
                <td className={`num ${b.due > 0 ? 'neg' : ''}`}>{inr(b.due, true)}</td>
              </tr>
            </tfoot>
          </table>

          {b.due > 0.009 && canCollect && b.status !== 'Cancelled' && (
            <form className="pay-box" onSubmit={collect}>
              <strong className="small">Collect balance (saved on the lab booking and the Care invoice)</strong>
              <div className="grid-3">
                <Field label="Amount (₹)">
                  <input type="number" min={1} max={b.due} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                </Field>
                <Field label="Mode">
                  <select value={mode} onChange={(e) => setMode(e.target.value)}>
                    {(meta?.enums.payModes || ['Cash', 'UPI']).map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Reference">
                  <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI / card ref" />
                </Field>
              </div>
              <button type="submit" className="btn btn-primary sm" disabled={!(Number(amount) > 0)}>
                Record payment
              </button>
            </form>
          )}

          {b.payment_history && b.payment_history.length > 0 && (
            <>
              <h3>Payment history</h3>
              <ul className="pay-history">
                {b.payment_history.map((p, i) => (
                  <li key={i}>
                    <span>{fmtStamp(p.at)}</span>
                    <b>{inr(p.amount, true)}</b>
                    <span className="muted small">
                      {p.mode} · {p.event === 'opening' ? 'at booking' : 'balance'} · due after {inr(p.running_due, true)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="side-form stack">
          <h3>Progress at the lab</h3>
          {b.timeline ? <Timeline steps={b.timeline} /> : <p className="muted small">Status: {b.status}</p>}
          {b.tubes && b.tubes.length > 0 && (
            <>
              <h3>Samples</h3>
              <ul className="tube-list">
                {b.tubes.map((t) => (
                  <li key={t.tube_code}>
                    <span className="mono">{t.tube_code}</span>
                    <Pill tone={t.status === 'Received' ? 'green' : t.status === 'Rejected' ? 'red' : t.status === 'Drawn' ? 'purple' : 'grey'}>{t.status}</Pill>
                    {t.rejected_reason && <small className="neg">{t.rejected_reason}</small>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {b.reports && b.reports.length > 0 && (
            <>
              <h3>Lab reports</h3>
              <ul className="tube-list">
                {b.reports.map((r) => (
                  <li key={r.name}>
                    <span>{r.department || r.name}</span>
                    <Pill tone={['Authorized', 'Printed'].includes(r.report_status) ? 'green' : 'orange'}>{r.report_status}</Pill>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted small">
            Sample receipt, results and authorisation are done by Remedium Labs. This view updates from the lab each time it is opened
            {b.synced_at ? ` (last ${fmtStamp(b.synced_at)})` : ''}.
          </p>
        </div>
      </div>
    </Modal>
  );
}
