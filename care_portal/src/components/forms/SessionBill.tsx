import { useApi, useCare } from '../../store';
import type { Branch, SessionBill, Settings } from '../../types';
import { fmtDate, fmtStamp, fmtTime, inr } from '../../format';
import { LOGO_URL, printSessionBill } from '../../invoicePrint';
import { F } from '../../flavor';
import { Icon } from '../../icons';
import { ErrorNote, Loading, Modal, Pill } from '../ui';

type Detail = { bill: SessionBill; settings: Settings; branch: Partial<Branch> | null };

export function SessionBillView({ id, onClose }: { id: number; onClose: () => void }) {
  const { openModal } = useCare();
  const { data, error } = useApi<Detail>(`/session-bills/${id}`);
  const bill = data?.bill;
  const snap = bill?.snapshot;
  const s = data?.settings || {};

  return (
    <Modal
      title={bill ? bill.number : 'Session invoice'}
      subtitle={snap ? `Session ${snap.session.no} of ${snap.session.of} · ${snap.package.name}` : undefined}
      onClose={onClose}
      wide
      footer={
        bill && (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => openModal({ kind: 'viewInvoice', id: bill.package_invoice_id })}>
              <Icon name="invoice" size={16} /> Package invoice
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (data && !printSessionBill(data.bill, s, data.branch)) window.alert('Allow pop-ups for this site to print.');
              }}
            >
              <Icon name="printer" size={16} /> Print / PDF
            </button>
          </>
        )
      }
    >
      {error && <ErrorNote text={error} />}
      {!bill && !error && <Loading />}
      {bill && snap && (
        <div className="invoice-print">
          <div className="inv-head">
            <div>
              {LOGO_URL ? <img className="inv-logo" src={LOGO_URL} alt={s.clinic_name || 'Remedium Care'} /> : <h2>{s.clinic_name}</h2>}
              {data?.branch?.name && <p className="inv-branch">{data.branch.name}</p>}
            </div>
            <div className="inv-meta">
              <h3>SESSION INVOICE</h3>
              <p className="mono">{bill.number}</p>
              <p>{fmtStamp(bill.updated_at || bill.created_at)}</p>
              <p>
                <Pill tone={snap.balance > 0 ? 'orange' : 'green'}>{snap.balance > 0 ? 'Package balance due' : 'Package paid'}</Pill>
              </p>
            </div>
          </div>
          <div className="inv-to">
            <span className="muted small">Billed to</span>
            <strong>{bill.patient}</strong>
            {bill.patient_code && <span>{bill.patient_code}</span>}
            {bill.mobile && <span>{bill.mobile}</span>}
            {bill.patient_address && <span>{bill.patient_address}</span>}
            <span>
              Package invoice <b className="mono">{snap.package.invoice_number}</b> · Plan {snap.package.code}
            </span>
            {snap.package.referred_by && (
              <span>
                Ref. by: <b>{snap.package.referred_by}</b>
              </span>
            )}
          </div>
          <table className="table inv-table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Date &amp; time</th>
                <th>{F.therapist}</th>
                <th className="num">Session value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  {snap.session.service} — Session {snap.session.no} of {snap.session.of}
                </td>
                <td>
                  {fmtDate(snap.session.date)}, {fmtTime(snap.session.time)}
                </td>
                <td>{snap.session.therapist || '—'}</td>
                <td className="num">{inr(snap.session.value, true)}</td>
              </tr>
            </tbody>
          </table>
          <div className="session-bill-grid">
            <div>
              <h4>Package payment history (up to this session)</h4>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Mode</th>
                    <th>Reference</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.payments.map((p, i) => (
                    <tr key={i}>
                      <td>{fmtStamp(p.at)}</td>
                      <td>{p.mode || '—'}</td>
                      <td>{p.reference || ''}</td>
                      <td className="num">{inr(p.amount, true)}</td>
                    </tr>
                  ))}
                  {snap.payments.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">
                        No payment received yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <table className="table compact session-totals">
              <tbody>
                <tr>
                  <td colSpan={2}>
                    <b>
                      {snap.package.name} — {snap.package.sessions} sessions
                    </b>
                  </td>
                </tr>
                <tr>
                  <td>Package amount</td>
                  <td className="num">{inr(snap.package.subtotal, true)}</td>
                </tr>
                {snap.package.discount > 0 && (
                  <tr>
                    <td>Discount{snap.package.discount_type === 'percent' && snap.package.discount_value ? ` (${snap.package.discount_value}%)` : ''}</td>
                    <td className="num">− {inr(snap.package.discount, true)}</td>
                  </tr>
                )}
                {Number(snap.package.gst_amount) > 0 && (
                  <>
                    <tr>
                      <td>Taxable value</td>
                      <td className="num">{inr(snap.package.total - Number(snap.package.gst_amount), true)}</td>
                    </tr>
                    <tr>
                      <td>GST {snap.package.gst_rate || 5}% (included)</td>
                      <td className="num">{inr(snap.package.gst_amount, true)}</td>
                    </tr>
                  </>
                )}
                <tr className="grand">
                  <td>Package total</td>
                  <td className="num">{inr(snap.package.total, true)}</td>
                </tr>
                <tr>
                  <td>Paid to date</td>
                  <td className="num">{inr(snap.paid_to_date, true)}</td>
                </tr>
                {snap.balance > 0 && (
                  <tr className="due">
                    <td>Balance due</td>
                    <td className="num">{inr(snap.balance, true)}</td>
                  </tr>
                )}
                <tr>
                  <td>Sessions completed</td>
                  <td className="num">
                    {snap.sessions_completed} of {snap.package.sessions}
                  </td>
                </tr>
                <tr>
                  <td>Value used</td>
                  <td className="num">{inr(snap.value_used, true)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="inv-foot">This session is covered by package invoice {snap.package.invoice_number}; it is not a separate charge.</p>
        </div>
      )}
    </Modal>
  );
}
