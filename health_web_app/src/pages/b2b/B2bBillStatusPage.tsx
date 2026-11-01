import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { printHubBill, printHubPaymentReceipt } from '../../utils/hubBillPrint';
import { formatPatientAge } from '../../utils/patientAge';
import './partner-bill-status-v2.css';

type BillRow = {
  name: string;
  unique_barcode?: string;
  patient_name?: string;
  patient_phone?: string;
  age?: number | string;
  age_months?: number | string;
  age_days?: number | string;
  gender?: string;
  amount?: number;
  hec_net_amount?: number;
  hec_amount_paid?: number;
  hec_received?: number;
  hec_receipt_amount?: number;
  hec_due_amount?: number;
  hec_patient_payment_status?: string;
  hec_receipt_mode?: string;
  hec_bill_datetime?: string;
  creation?: string;
  order_status?: string;
  referred_doctor?: string;
};

type PaymentEntry = {
  id?: string;
  at?: string;
  event?: string;
  amount?: number;
  mode?: string;
  notes?: string;
  running_paid?: number;
  running_due?: number;
  status_after?: string;
  by?: string;
};

type PaymentStatus = 'Unpaid' | 'Partially Paid' | 'Paid';
type Filter = 'All' | PaymentStatus;

function money(n?: number) {
  return `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatWhen(raw?: string) {
  if (!raw) return '—';
  const d = new Date(String(raw).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function derivePayment(source: {
  amount?: number;
  hec_net_amount?: number;
  hec_amount_paid?: number;
  hec_received?: number;
  hec_receipt_amount?: number;
  hec_due_amount?: number;
  hec_patient_payment_status?: string;
  tests?: unknown;
  hec_coll_charge?: number;
}): { total: number; paid: number; due: number; status: PaymentStatus } {
  let total = Number(source.hec_net_amount) || 0;
  if (total <= 0) total = Number(source.amount) || 0;
  if (total <= 0 && Array.isArray(source.tests)) {
    total = (source.tests as Array<Record<string, unknown>>).reduce((sum, t) => {
      const qty = Number(t.qty || 1) || 1;
      const rate = Number(t.rate || 0) || 0;
      const line = Number(t.hec_r_amount != null ? t.hec_r_amount : qty * rate) || 0;
      return sum + line;
    }, 0);
    total += Number(source.hec_coll_charge) || 0;
  }
  const paid = Math.max(
    Number(source.hec_amount_paid) || 0,
    Number(source.hec_received) || 0,
    Number(source.hec_receipt_amount) || 0,
  );
  const due = Math.max(Math.round((total - paid) * 100) / 100, 0);
  let status: PaymentStatus = 'Unpaid';
  if (paid > 0 && due <= 0.009) status = 'Paid';
  else if (paid > 0) status = 'Partially Paid';
  return { total, paid, due: due <= 0.009 ? 0 : due, status };
}

function statusClass(status?: string) {
  const s = (status || '').toLowerCase();
  if (s === 'paid') return 'pbs-pill is-ok';
  if (s === 'partial' || s === 'partially paid') return 'pbs-pill is-warn';
  return 'pbs-pill';
}

function normalizeFilterStatus(value: string): Filter {
  if (value === 'All') return 'All';
  if (value === 'Partial' || value === 'Partially Paid') return 'Partially Paid';
  if (value === 'Paid') return 'Paid';
  return 'Unpaid';
}

function str(value: unknown, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function B2bBillStatusPage() {
  const [bills, setBills] = useState<BillRow[]>([]);
  const [filter, setFilter] = useState<Filter>('All');
  const [txt, setTxt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [history, setHistory] = useState<PaymentEntry[]>([]);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState('CASH');
  const [payNotes, setPayNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const apiFilter = filter === 'Partially Paid' ? 'Partially Paid' : filter === 'All' ? '' : filter;
      const res = await api.listHubLabBills(80, txt.trim(), apiFilter);
      setBills((res.data.bills || []) as BillRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bills');
    } finally {
      setLoading(false);
    }
  }, [filter, txt]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayBills = useMemo(
    () =>
      bills.map((row) => {
        const snap = derivePayment(row);
        return { ...row, ...snap, hec_patient_payment_status: snap.status };
      }),
    [bills],
  );

  const summary = useMemo(() => {
    const unpaid = displayBills.filter((b) => b.status === 'Unpaid').length;
    const partial = displayBills.filter((b) => b.status === 'Partially Paid').length;
    const paid = displayBills.filter((b) => b.status === 'Paid').length;
    const dueTotal = displayBills.reduce((s, b) => s + b.due, 0);
    return { unpaid, partial, paid, dueTotal, count: displayBills.length };
  }, [displayBills]);

  const detailSnap = useMemo(
    () => (detail ? derivePayment(detail as BillRow & { tests?: unknown }) : null),
    [detail],
  );

  const tests = useMemo(
    () => (Array.isArray(detail?.tests) ? (detail?.tests as Array<Record<string, unknown>>) : []),
    [detail],
  );

  function closeModal() {
    setSelected(null);
    setDetail(null);
    setHistory([]);
    setPayAmount('');
    setPayNotes('');
    setBusy(false);
  }

  async function openBill(name: string) {
    setSelected(name);
    setDetail(null);
    setHistory([]);
    setMessage(null);
    setError(null);
    setPayAmount('');
    setPayNotes('');
    setDetailLoading(true);
    try {
      const res = await api.getHubLabBill(name);
      const bill = res.data.bill;
      setDetail(bill);
      setHistory((bill.payment_history as PaymentEntry[]) || []);
      const snap = derivePayment(bill as BillRow & { tests?: unknown });
      if (snap.due > 0) setPayAmount(String(snap.due));
      setPayMode(String(bill.hec_receipt_mode || 'CASH').toUpperCase() || 'CASH');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open bill');
      closeModal();
    } finally {
      setDetailLoading(false);
    }
  }

  async function onUpdatePayment(e: FormEvent) {
    e.preventDefault();
    if (!selected || !detailSnap) return;
    const amount = Number(payAmount);
    if (!(amount > 0)) {
      setError('Enter amount received greater than zero.');
      return;
    }
    if (amount > detailSnap.due + 0.5) {
      setError(`Amount cannot exceed due ${money(detailSnap.due)}.`);
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.updateHubPatientPayment({
        trf_name: selected,
        amount_received: amount,
        payment_mode: payMode,
        notes: payNotes.trim() || 'Balance collected at hub',
      });
      setDetail(res.data.bill);
      setHistory(res.data.payment_history || []);
      const dueNow = Number(res.data.hec_due_amount || 0);
      setMessage(
        dueNow <= 0
          ? `Bill marked Paid. Updated payment receipt ready.`
          : `Payment recorded. Due now ${money(dueNow)}.`,
      );
      setPayAmount(dueNow > 0 ? String(dueNow) : '');
      const receipt = res.data.receipt || {
        bill_total: res.data.hec_net_amount,
        previous_payment: res.data.previous_paid,
        new_payment: res.data.new_payment,
        total_received: res.data.hec_amount_paid,
        remaining_due: res.data.hec_due_amount,
        payment_mode: payMode,
        payment_date: String(res.data.payment_entry?.at || ''),
        status: res.data.hec_patient_payment_status,
      };
      printHubPaymentReceipt(res.data.bill, receipt);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!selected) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) closeModal();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [selected, busy]);

  const tabs: Filter[] = ['All', 'Unpaid', 'Partially Paid', 'Paid'];

  return (
    <div className="pbs">
      <div className="pbs-head">
        <h1>Bill Status</h1>
        <p>
          Track patient payments separately from platform wallet fees. Collect dues when the balance is paid — e.g. at
          report handover. Platform fee was already deducted from your wallet at billing.
        </p>
      </div>

      <div className="pbs-stats">
        <button type="button" className={`pbs-stat${filter === 'All' ? ' is-on' : ''}`} onClick={() => setFilter('All')}>
          <span>Bills</span>
          <strong>{summary.count}</strong>
        </button>
        <button
          type="button"
          className={`pbs-stat${filter === 'Unpaid' ? ' is-on' : ''}`}
          onClick={() => setFilter('Unpaid')}
        >
          <span>Unpaid</span>
          <strong>{summary.unpaid}</strong>
        </button>
        <button
          type="button"
          className={`pbs-stat${filter === 'Partially Paid' ? ' is-on' : ''}`}
          onClick={() => setFilter('Partially Paid')}
        >
          <span>Partially paid</span>
          <strong>{summary.partial}</strong>
        </button>
        <button type="button" className={`pbs-stat${filter === 'Paid' ? ' is-on' : ''}`} onClick={() => setFilter('Paid')}>
          <span>Paid</span>
          <strong>{summary.paid}</strong>
        </button>
        <article className="pbs-stat" style={{ cursor: 'default' }}>
          <span>Total due</span>
          <strong>{money(summary.dueTotal)}</strong>
        </article>
      </div>

      <div className="pbs-toolbar">
        <label className="pbs-search">
          <input
            value={txt}
            onChange={(e) => setTxt(e.target.value)}
            placeholder="Search patient, TRF, barcode, phone"
            aria-label="Search bills"
          />
        </label>
        <select
          className="pbs-btn"
          value={filter}
          onChange={(e) => setFilter(normalizeFilterStatus(e.target.value))}
          aria-label="Payment status"
        >
          <option value="All">All statuses</option>
          <option value="Unpaid">Unpaid</option>
          <option value="Partially Paid">Partially Paid</option>
          <option value="Paid">Paid</option>
        </select>
        <button type="button" className="pbs-btn is-primary" onClick={() => void load()}>
          Refresh
        </button>
        <Link className="pbs-btn" to="/b2b/order">
          New walk-in
        </Link>
      </div>

      <div className="pbs-tabs" role="tablist" aria-label="Payment status">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={filter === tab}
            className={filter === tab ? 'is-on' : ''}
            onClick={() => setFilter(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {!selected && message ? <div className="pbs-alert is-ok">{message}</div> : null}
      {!selected && error ? <div className="pbs-alert is-err">{error}</div> : null}

      <div className="pbs-table-wrap">
        {loading ? <p className="pbs-empty">Loading bills…</p> : null}
        {!loading && displayBills.length === 0 ? <p className="pbs-empty">No bills match this filter.</p> : null}
        {!loading && displayBills.length ? (
          <table className="pbs-table">
            <thead>
              <tr>
                <th>Bill / TRF</th>
                <th>Patient</th>
                <th>Date & time</th>
                <th>Total</th>
                <th>Received</th>
                <th>Due</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {displayBills.map((row) => (
                <tr key={row.name}>
                  <td>
                    <b>{row.name}</b>
                    <br />
                    <small>{row.unique_barcode || '—'}</small>
                  </td>
                  <td>
                    {row.patient_name || '—'}
                    <br />
                    <small>{row.patient_phone || '—'}</small>
                  </td>
                  <td>{formatWhen(row.hec_bill_datetime || row.creation)}</td>
                  <td>{money(row.total)}</td>
                  <td>{money(row.paid)}</td>
                  <td>{money(row.due)}</td>
                  <td>
                    <span className={statusClass(row.status)}>{row.status}</span>
                  </td>
                  <td>
                    <button type="button" className="pbs-btn" onClick={() => void openBill(row.name)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      {selected ? (
        <div
          className="pbs-backdrop"
          onClick={() => {
            if (!busy) closeModal();
          }}
        >
          <div
            className="pbs-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pbs-bill-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="pbs-modal-head">
              <div>
                <h2 id="pbs-bill-title">{str(detail?.patient_name, selected)}</h2>
                <p>
                  {selected}
                  {detail ? ` · Barcode ${str(detail.unique_barcode)}` : ''}
                </p>
              </div>
              <button type="button" className="pbs-btn" onClick={closeModal} disabled={busy}>
                Close
              </button>
            </header>

            <div className="pbs-modal-body">
              {message ? <div className="pbs-alert is-ok">{message}</div> : null}
              {error ? <div className="pbs-alert is-err">{error}</div> : null}
              {detailLoading || !detail || !detailSnap ? (
                <p className="pbs-empty">Loading bill details…</p>
              ) : (
                <>
                  <section className="pbs-section">
                    <h3>Patient information</h3>
                    <div className="pbs-dl">
                      <div>
                        <span>Name</span>
                        <b>{str(detail.patient_name)}</b>
                      </div>
                      <div>
                        <span>Age / Gender</span>
                        <b>
                          {[formatPatientAge(detail), str(detail.gender)].filter(Boolean).join(' / ') || '—'}
                        </b>
                      </div>
                      <div>
                        <span>Phone</span>
                        <b>{str(detail.patient_phone)}</b>
                      </div>
                      <div>
                        <span>WhatsApp</span>
                        <b>{str(detail.hec_whatsapp)}</b>
                      </div>
                      <div>
                        <span>Address</span>
                        <b>{str(detail.collection_address)}</b>
                      </div>
                      <div>
                        <span>Ref. by</span>
                        <b>{str(detail.referred_doctor, 'Self')}</b>
                      </div>
                    </div>
                  </section>

                  <section className="pbs-section">
                    <h3>Bill / TRF details</h3>
                    <div className="pbs-dl">
                      <div>
                        <span>TRF / Bill no.</span>
                        <b>{str(detail.name, selected)}</b>
                      </div>
                      <div>
                        <span>Barcode</span>
                        <b>{str(detail.unique_barcode)}</b>
                      </div>
                      <div>
                        <span>Date & time</span>
                        <b>{formatWhen(String(detail.hec_bill_datetime || detail.creation || ''))}</b>
                      </div>
                      <div>
                        <span>Order status</span>
                        <b>{str(detail.order_status)}</b>
                      </div>
                      <div>
                        <span>Receipt mode</span>
                        <b>{str(detail.hec_receipt_mode)}</b>
                      </div>
                      <div>
                        <span>Payment status</span>
                        <b>
                          <span className={statusClass(detailSnap.status)}>{detailSnap.status}</span>
                        </b>
                      </div>
                    </div>
                  </section>

                  <section className="pbs-section">
                    <h3>Test details</h3>
                    <div className="pbs-table-wrap">
                      <table className="pbs-table" style={{ minWidth: 520 }}>
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Test</th>
                            <th>Code</th>
                            <th>Qty</th>
                            <th>Rate</th>
                            <th>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tests.length ? (
                            tests.map((t, i) => {
                              const qty = Number(t.qty || 1) || 1;
                              const rate = Number(t.rate || 0) || 0;
                              const line = Number(t.hec_r_amount != null ? t.hec_r_amount : qty * rate) || 0;
                              return (
                                <tr key={`${t.item || i}`}>
                                  <td>{i + 1}</td>
                                  <td>{str(t.item_name || t.item)}</td>
                                  <td>{str(t.item)}</td>
                                  <td>{qty}</td>
                                  <td>{money(rate)}</td>
                                  <td>{money(line)}</td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan={6}>No tests on this bill.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="pbs-section">
                    <h3>Amounts</h3>
                    <div className="pbs-amounts">
                      <article>
                        <span>Total amount</span>
                        <strong>{money(detailSnap.total)}</strong>
                      </article>
                      <article>
                        <span>Received amount</span>
                        <strong>{money(detailSnap.paid)}</strong>
                      </article>
                      <article>
                        <span>Due amount</span>
                        <strong>{money(detailSnap.due)}</strong>
                      </article>
                    </div>
                  </section>

                  {detailSnap.due > 0 ? (
                    <section className="pbs-section">
                      <h3>Collect due payment / update payment</h3>
                      <form className="pbs-form" id="pbs-pay-form" onSubmit={(e) => void onUpdatePayment(e)}>
                        <label>
                          Amount received now
                          <input
                            type="number"
                            min={0.01}
                            step={0.01}
                            max={detailSnap.due + 0.5}
                            required
                            value={payAmount}
                            onChange={(e) => setPayAmount(e.target.value)}
                          />
                        </label>
                        <label>
                          Payment mode
                          <select value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                            <option value="CASH">CASH</option>
                            <option value="UPI">UPI</option>
                            <option value="CARD">CARD</option>
                            <option value="NEFT">NEFT</option>
                          </select>
                        </label>
                        <label className="is-wide">
                          Notes
                          <input
                            value={payNotes}
                            onChange={(e) => setPayNotes(e.target.value)}
                            placeholder="e.g. Collected at report handover"
                          />
                        </label>
                      </form>
                    </section>
                  ) : null}

                  <section className="pbs-section">
                    <h3>Payment history</h3>
                    {history.length === 0 ? (
                      <p className="pbs-empty" style={{ margin: 0 }}>
                        No payment events recorded yet.
                      </p>
                    ) : (
                      <div className="pbs-table-wrap">
                        <table className="pbs-table" style={{ minWidth: 640 }}>
                          <thead>
                            <tr>
                              <th>When</th>
                              <th>Event</th>
                              <th>Amount</th>
                              <th>Mode</th>
                              <th>Paid / Due</th>
                              <th>Status</th>
                              <th>Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {history.map((h) => (
                              <tr key={h.id || `${h.at}-${h.amount}`}>
                                <td>
                                  <small>{h.at || '—'}</small>
                                </td>
                                <td>{h.event || 'payment'}</td>
                                <td>{money(h.amount)}</td>
                                <td>{h.mode || '—'}</td>
                                <td>
                                  {money(h.running_paid)} / {money(h.running_due)}
                                </td>
                                <td>
                                  <span className={statusClass(h.status_after)}>{h.status_after || '—'}</span>
                                </td>
                                <td>
                                  <small>{h.notes || '—'}</small>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>

            <footer className="pbs-modal-foot">
              <button type="button" className="pbs-btn" onClick={closeModal} disabled={busy}>
                Close
              </button>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {detail ? (
                  <button type="button" className="pbs-btn" onClick={() => printHubBill(detail)} disabled={busy}>
                    {detailSnap && detailSnap.due <= 0 ? 'Print final receipt' : 'Print current bill'}
                  </button>
                ) : null}
                {detailSnap && detailSnap.due > 0 ? (
                  <button className="pbs-btn is-primary" type="submit" form="pbs-pay-form" disabled={busy}>
                    {busy ? 'Updating…' : 'Save / Update Payment'}
                  </button>
                ) : null}
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
