'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RFMS_API_BASE, adminCanManageCoupons, adminCanManageTerritory, clearNotificationEntity, normalizeAdminRole, peekNotificationEntity } from '@rfms/utils';
import './payment-operations.css';
import { CouponOperationsPanel } from './coupon-operations';

const API_BASE = RFMS_API_BASE;
const API_ORIGIN = new URL(API_BASE).origin;

type PaymentLedgerRow = {
  row_id: string;
  application_id: string;
  application_number: string;
  applicant_name: string;
  franchise_model: 'FOFO' | 'FOCO';
  payment_key: string;
  payment_phase: string;
  amount: number;
  payment_date: string;
  transaction_id: string;
  current_status: string;
  current_status_label: string;
  updated_at: string;
};

type PaymentPhaseDetail = {
  key: string;
  label: string;
  purpose: string;
  amount: number;
  original_amount?: number;
  discount_amount?: number;
  coupon_code?: string;
  status: string;
  status_label: string;
  paid_amount: number;
  pending_amount: number;
  payment_date: string;
  paid_at: string;
  receipt_number: string;
  transaction_id: string;
  gateway_reference: string;
  payment_method?: string;
  verification_status: string;
  verification_status_label: string;
  submission?: {
    method?: string;
    submitted_at?: string;
    cheque_number?: string;
    account_number?: string;
    ifsc_code?: string;
    account_holder_name?: string;
    transaction_reference?: string;
    proof?: { name?: string; url?: string } | null;
    remarks?: string;
  } | null;
  verification?: {
    status?: string;
    verified_at?: string;
    verified_by?: string;
    rejected_at?: string;
    rejected_by?: string;
    remarks?: string;
  } | null;
  audit_trail?: { id: string; type: string; message: string; actor: string; created_at: string }[];
  terms_accepted_at?: string;
  terms_accepted_by?: string;
  remarks: { id: string; type: string; message: string; actor: string; created_at: string }[];
  can_download_receipt: boolean;
  can_verify?: boolean;
  can_reject?: boolean;
  receipt_download_url: string;
};

type PaymentDetail = {
  application_id: string;
  application_number: string;
  applicant_name: string;
  franchise_model: 'FOFO' | 'FOCO';
  stage: string;
  hec_franchisee_profile?: string;
  hec_hub_activated_at?: string;
  hec_wallet_recharge?: number | null;
  hec_hub_activation_error?: string;
  summary: { total_paid: number; total_pending: number; total_due: number; phases_total: number; phases_paid: number };
  payments: PaymentPhaseDetail[];
  history: { id: string; type: string; message: string; actor: string; created_at: string }[];
  permissions: { can_view: boolean; can_download_receipt: boolean; can_unlock_phase_2: boolean; can_unlock_phase_3: boolean };
};

type LedgerMetrics = { open_items: number; pending_verification?: number; completed_this_month: number; verification_rate: number };

function displayDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatAmount(value: number) {
  return `INR ${Number(value || 0).toLocaleString('en-IN')}`;
}

function networkErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    const port = Number(window.location.port);
    if (port >= 4000 && port <= 4002) return 'Unable to reach the RFMS API at http://localhost:9080. Keep the RFMS Isolated Services window open and hard-refresh this page.';
    return 'The local RFMS API is not running. Start run-api.cmd or start-isolated.cmd and try again.';
  }
  if (error instanceof Error) {
    if (error.message.includes('(404)')) return 'The RFMS API is running an older version. Restart RFMS Isolated Services and hard-refresh this page.';
    return error.message;
  }
  return fallback;
}

function isOfficerSessionExpired(response: Response) {
  if (response.status !== 401 && response.status !== 403) return false;
  window.dispatchEvent(new Event('rfms-session-expired'));
  return true;
}

function resolveReceiptApiUrl(path: string) {
  const value = path.startsWith('/') ? path : `/${path}`;
  const normalized = value.startsWith('/api/v1/') ? value.slice('/api/v1'.length) : value;
  return `${API_BASE}${normalized}`;
}

async function downloadReceipt(path: string, token: string, filename: string) {
  const response = await fetch(resolveReceiptApiUrl(path), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (isOfficerSessionExpired(response)) throw new Error('Your session has expired. Sign in again.');
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? 'Unable to download this receipt.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function PaymentStatusBadge({ status, label }: { status: string; label: string }) {
  const tone = status === 'paid' ? 'paid' : status === 'under_verification' ? 'pending' : status === 'due' ? 'due' : status === 'locked' ? 'locked' : 'pending';
  return <span className={`payment-status ${tone}`}>{label}</span>;
}

function PaymentDetailModal({
  detail,
  token,
  viewerRole,
  busy,
  error,
  onClose,
  onUnlockPhase2,
  onUnlockPhase3,
  onDownloadReceipt,
  onVerifyPayment,
  onRejectPayment,
}: {
  detail: PaymentDetail;
  token: string;
  viewerRole: string;
  busy: string;
  error: string;
  onClose: () => void;
  onUnlockPhase2: () => void;
  onUnlockPhase3: () => void;
  onDownloadReceipt: (payment: PaymentPhaseDetail) => Promise<void>;
  onVerifyPayment: (payment: PaymentPhaseDetail) => Promise<void>;
  onRejectPayment: (payment: PaymentPhaseDetail, remarks: string) => Promise<void>;
}) {
  const canManageUnlocks = adminCanManageTerritory(viewerRole);
  const [rejectingKey, setRejectingKey] = useState('');
  const [rejectRemarks, setRejectRemarks] = useState('');

  return <div className="payment-detail-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="payment-detail-modal" role="dialog" aria-modal="true" aria-labelledby="payment-detail-heading" onMouseDown={(event) => event.stopPropagation()}>
      <header className="payment-detail-head">
        <div>
          <p>Payment history</p>
          <h2 id="payment-detail-heading">{detail.applicant_name}</h2>
          <span>{detail.application_number} · {detail.franchise_model} · Current stage: {detail.stage.replaceAll('_', ' ')}</span>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </header>

      <div className="payment-detail-summary">
        <section><span>Total paid</span><b>{formatAmount(detail.summary.total_paid)}</b></section>
        <section><span>Pending balance</span><b>{formatAmount(detail.summary.total_pending)}</b></section>
        <section><span>Phases paid</span><b>{detail.summary.phases_paid}/{detail.summary.phases_total}</b></section>
        <section><span>Verification</span><b>{detail.summary.phases_paid === detail.summary.phases_total ? 'Complete' : 'In progress'}</b></section>
      </div>

      <div className="payment-hub-status">
        <b>Franchisee hub</b>
        {detail.hec_hub_activated_at ? (
          <span>
            Activated {displayDate(detail.hec_hub_activated_at)}
            {detail.hec_franchisee_profile ? ` · ${detail.hec_franchisee_profile}` : ''}
            {detail.hec_wallet_recharge != null ? ` · wallet ₹${Number(detail.hec_wallet_recharge).toLocaleString('en-IN')}` : ''}
          </span>
        ) : detail.hec_hub_activation_error ? (
          <span className="payment-hub-error">Activation pending / failed: {detail.hec_hub_activation_error}</span>
        ) : detail.hec_franchisee_profile ? (
          <span>Linked ERP profile {detail.hec_franchisee_profile} — wallet activation awaits paid milestone.</span>
        ) : (
          <span>Not activated yet. FOFO activates on one-time fee; FOCO on security deposit / full payment.</span>
        )}
      </div>

      {canManageUnlocks && detail.permissions.can_unlock_phase_2 ? <div className="payment-unlock-panel">
        <b>Release FOCO Phase 2 payment</b>
        <span>The Territory Allotment Letter is issued. Release the franchise fee when management is ready for the applicant to proceed.</span>
        <button type="button" disabled={Boolean(busy)} onClick={onUnlockPhase2}>{busy === 'unlock-phase-2' ? 'Unlocking…' : 'Unlock Phase 2 payment'}</button>
      </div> : null}

      {canManageUnlocks && detail.permissions.can_unlock_phase_3 ? <div className="payment-unlock-panel">
        <b>Unlock Phase 3 security deposit</b>
        <span>Branding Signage and HR Process are approved. Release the security deposit when management is ready for the applicant to proceed.</span>
        <button type="button" disabled={Boolean(busy)} onClick={onUnlockPhase3}>{busy === 'unlock-phase-3' ? 'Unlocking…' : 'Unlock Phase 3 payment'}</button>
      </div> : null}

      <div className="payment-phase-list">
        {detail.payments.map((payment) => <article key={payment.key} className="payment-phase-card">
          <div className="payment-phase-card-head">
            <div>
              <b>{payment.label}</b>
              <small>{payment.purpose}</small>
            </div>
            <PaymentStatusBadge status={payment.status} label={payment.status_label} />
          </div>
          <dl className="payment-phase-grid">
            <div><dt>Amount</dt><dd>{formatAmount(payment.amount)}</dd></div>
            {payment.discount_amount ? <div><dt>Original amount</dt><dd>{formatAmount(payment.original_amount ?? payment.amount)}</dd></div> : null}
            {payment.discount_amount ? <div><dt>Coupon discount</dt><dd>{payment.coupon_code ? `${formatAmount(payment.discount_amount)} (${payment.coupon_code})` : formatAmount(payment.discount_amount)}</dd></div> : null}
            <div><dt>Paid</dt><dd>{formatAmount(payment.paid_amount)}</dd></div>
            <div><dt>Pending</dt><dd>{formatAmount(payment.pending_amount)}</dd></div>
            <div><dt>Payment date</dt><dd>{displayDate(payment.payment_date)}</dd></div>
            <div><dt>Transaction ID</dt><dd>{payment.transaction_id || '—'}</dd></div>
            <div><dt>Gateway reference</dt><dd>{payment.gateway_reference || '—'}</dd></div>
            <div><dt>Receipt number</dt><dd>{payment.receipt_number || '—'}</dd></div>
            <div><dt>Verification</dt><dd>{payment.verification_status_label}</dd></div>
            {payment.payment_method ? <div><dt>Payment method</dt><dd>{payment.payment_method.replaceAll('_', ' ')}</dd></div> : null}
            <div><dt>Terms accepted</dt><dd>{payment.terms_accepted_at ? `${displayDate(payment.terms_accepted_at)}${payment.terms_accepted_by ? ` · ${payment.terms_accepted_by}` : ''}` : '—'}</dd></div>
          </dl>
          {payment.submission ? <div className="payment-phase-submission">
            <b>Submitted payment details</b>
            <dl className="payment-phase-grid">
              {payment.submission.cheque_number ? <div><dt>Cheque number</dt><dd>{payment.submission.cheque_number}</dd></div> : null}
              {payment.submission.transaction_reference ? <div><dt>Transaction / UTR</dt><dd>{payment.submission.transaction_reference}</dd></div> : null}
              {payment.submission.account_number ? <div><dt>Account number</dt><dd>{payment.submission.account_number}</dd></div> : null}
              {payment.submission.ifsc_code ? <div><dt>IFSC</dt><dd>{payment.submission.ifsc_code}</dd></div> : null}
              {payment.submission.account_holder_name ? <div><dt>Account holder</dt><dd>{payment.submission.account_holder_name}</dd></div> : null}
              {payment.submission.submitted_at ? <div><dt>Submitted</dt><dd>{displayDate(payment.submission.submitted_at)}</dd></div> : null}
            </dl>
            {payment.submission.proof?.url ? <a href={`${API_ORIGIN}${payment.submission.proof.url.startsWith('/') ? payment.submission.proof.url : `/${payment.submission.proof.url}`}`} target="_blank" rel="noreferrer">View uploaded proof</a> : null}
          </div> : null}
          {payment.verification?.remarks ? <div className="payment-phase-remarks"><b>Verification remarks</b><p>{payment.verification.remarks}</p></div> : null}
          {(payment.audit_trail ?? []).length ? <div className="payment-phase-remarks">
            <b>Phase audit trail</b>
            {(payment.audit_trail ?? []).map((entry) => <article key={entry.id}>
              <p>{entry.message}</p>
              <small>{entry.actor} · {displayDate(entry.created_at)}</small>
            </article>)}
          </div> : null}
          {payment.remarks.length ? <div className="payment-phase-remarks">
            <b>Remarks</b>
            {payment.remarks.map((entry) => <article key={entry.id}>
              <p>{entry.message}</p>
              <small>{entry.actor} · {displayDate(entry.created_at)}</small>
            </article>)}
          </div> : null}
          <div className="payment-phase-actions">
            {payment.can_verify ? <button type="button" disabled={Boolean(busy)} onClick={() => void onVerifyPayment(payment)}>{busy === `verify:${payment.key}` ? 'Verifying…' : 'Verify payment'}</button> : null}
            {payment.can_reject ? <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => setRejectingKey((current) => current === payment.key ? '' : payment.key)}>{rejectingKey === payment.key ? 'Cancel reject' : 'Reject submission'}</button> : null}
            {payment.can_download_receipt && detail.permissions.can_download_receipt ? <button type="button" disabled={busy === `receipt:${payment.key}`} onClick={() => void onDownloadReceipt(payment)}>
              {busy === `receipt:${payment.key}` ? 'Preparing receipt…' : 'Download receipt'}
            </button> : null}
          </div>
          {rejectingKey === payment.key ? <div className="payment-reject-panel">
            <label>Rejection remarks<textarea value={rejectRemarks} onChange={(event) => setRejectRemarks(event.target.value)} rows={3} placeholder="Explain why this payment submission is rejected." /></label>
            <button type="button" disabled={Boolean(busy) || !rejectRemarks.trim()} onClick={() => void onRejectPayment(payment, rejectRemarks).then(() => { setRejectingKey(''); setRejectRemarks(''); })}>{busy === `reject:${payment.key}` ? 'Rejecting…' : 'Confirm rejection'}</button>
          </div> : null}
        </article>)}
      </div>

      {detail.history.length ? <section>
        <div className="panel-head"><div><h2>Payment audit trail</h2><p>Recent payment unlock, acceptance and verification events for this applicant.</p></div></div>
        <div className="payment-history-list">
          {detail.history.map((entry) => <article key={entry.id}>
            <b>{entry.type.replaceAll('_', ' ')}</b>
            <p>{entry.message}</p>
            <small>{entry.actor} · {displayDate(entry.created_at)}</small>
          </article>)}
        </div>
      </section> : null}

      {error ? <p className="application-review-error" role="alert">{error}</p> : null}
    </section>
  </div>;
}

function Header({ title, text, action, onClick }: { title: string; text: string; action: string; onClick: () => void }) {
  return <div className="panel-head"><div><h2>{title}</h2><p>{text}</p></div><button onClick={onClick}>{action}</button></div>;
}

type PaymentVoucher = {
  id: string;
  voucher_number: string;
  type: string;
  status: string;
  application_id: string;
  application_number: string;
  applicant_name: string;
  franchise_model: string;
  preferred_location: string;
  vendor_name: string;
  vendor_shop_name: string;
  vendor_phone: string;
  amount: number;
  invoice?: { name?: string; url?: string } | null;
  created_at: string;
  created_by: string;
  paid_at?: string;
  paid_by?: string;
  remarks?: string;
};

type VoucherMetrics = { pending_payment: number; pending_amount: number; paid: number; total: number };

function PaymentVouchersPanel({ token, search, notify, reloadSignal }: { token: string; search: string; notify: (message: string) => void; reloadSignal: number }) {
  const [vouchers, setVouchers] = useState<PaymentVoucher[]>([]);
  const [metrics, setMetrics] = useState<VoucherMetrics>({ pending_payment: 0, pending_amount: 0, paid: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const visible = useMemo(() => vouchers.filter((item) => `${item.voucher_number} ${item.applicant_name} ${item.application_number} ${item.vendor_name} ${item.vendor_shop_name} ${item.status}`.toLowerCase().includes(search.toLowerCase())), [vouchers, search]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/payment-vouchers`, { headers: { Authorization: `Bearer ${token}` } });
      if (isOfficerSessionExpired(response)) return;
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { vouchers?: PaymentVoucher[]; metrics?: VoucherMetrics }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data?.vouchers) throw new Error(payload?.error?.message ?? 'Unable to load payment vouchers.');
      setVouchers(payload.data.vouchers);
      setMetrics(payload.data.metrics ?? { pending_payment: 0, pending_amount: 0, paid: 0, total: 0 });
    } catch (requestError) {
      setError(networkErrorMessage(requestError, 'Unable to load payment vouchers.'));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load, reloadSignal]);

  async function markPaid(voucher: PaymentVoucher) {
    setBusy(voucher.id);
    try {
      const response = await fetch(`${API_BASE}/admin/payment-vouchers/${voucher.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_paid' }),
      });
      if (isOfficerSessionExpired(response)) return;
      const payload = await response.json().catch(() => null) as { success?: boolean; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to mark this voucher as paid.');
      notify(`Payment voucher ${voucher.voucher_number} marked as paid.`);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to mark this voucher as paid.');
    } finally {
      setBusy('');
    }
  }

  return <>
    <div className="module-summary">
      <section><span>Pending vouchers</span><b>{metrics.pending_payment}</b><small>Awaiting vendor payout</small></section>
      <section><span>Pending amount</span><b>{formatAmount(metrics.pending_amount)}</b><small>Branding installation payables</small></section>
      <section><span>Paid vouchers</span><b>{metrics.paid}</b><small>Settled by accounts</small></section>
      <section><span>Total vouchers</span><b>{metrics.total}</b><small>Generated from branding approvals</small></section>
    </div>
    <section className="panel data-panel">
      <Header title="Branding payment vouchers" text={loading ? 'Loading payment vouchers…' : `Showing ${visible.length} voucher${visible.length === 1 ? '' : 's'}`} action="Refresh" onClick={() => void load()} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Voucher</th>
              <th>Application</th>
              <th>Vendor</th>
              <th>Amount</th>
              <th>Bill</th>
              <th>Created</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {error ? <tr><td className="empty" colSpan={8}>{error}</td></tr> : null}
            {!error ? visible.map((voucher) => <tr key={voucher.id}>
              <td><b>{voucher.voucher_number}</b><br /><small>Branding installation</small></td>
              <td>{voucher.application_number}<br /><small>{voucher.applicant_name}</small></td>
              <td>{voucher.vendor_name || '—'}{voucher.vendor_shop_name ? <><br /><small>{voucher.vendor_shop_name}</small></> : null}{voucher.vendor_phone ? <><br /><small>{voucher.vendor_phone}</small></> : null}</td>
              <td>{formatAmount(voucher.amount)}</td>
              <td>{voucher.invoice?.url ? <a href={`${API_ORIGIN}${voucher.invoice.url.startsWith('/') ? voucher.invoice.url : `/${voucher.invoice.url}`}`} target="_blank" rel="noreferrer">{voucher.invoice.name || 'View bill'}</a> : '—'}</td>
              <td>{displayDate(voucher.created_at)}<br /><small>{voucher.created_by}</small></td>
              <td>{voucher.status === 'paid' ? `Paid${voucher.paid_at ? ` · ${displayDate(voucher.paid_at)}` : ''}` : voucher.status.replaceAll('_', ' ')}</td>
              <td>{voucher.status === 'pending_payment' ? <button className="row-action" type="button" disabled={busy === voucher.id} onClick={() => void markPaid(voucher)}>{busy === voucher.id ? 'Saving…' : 'Mark paid'}</button> : null}</td>
            </tr>) : null}
            {!loading && !error && visible.length === 0 ? <tr><td className="empty" colSpan={8}>No branding payment vouchers yet. They appear when a manager approves vendor branding work.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  </>;
}

export function PaymentOperationsModule({ token, search, notify, viewerRole }: { token: string; search: string; notify: (message: string) => void; viewerRole: string }) {
  const [rows, setRows] = useState<PaymentLedgerRow[]>([]);
  const [metrics, setMetrics] = useState<LedgerMetrics>({ open_items: 0, completed_this_month: 0, verification_rate: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [selectedApplicationId, setSelectedApplicationId] = useState('');
  const [detail, setDetail] = useState<PaymentDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [busy, setBusy] = useState('');
  const [activeTab, setActiveTab] = useState<'ledger' | 'coupons' | 'vouchers'>('ledger');

  const visibleRows = useMemo(() => rows.filter((row) => `${row.applicant_name} ${row.application_number} ${row.franchise_model} ${row.payment_phase} ${row.transaction_id} ${row.current_status_label}`.toLowerCase().includes(search.toLowerCase())), [rows, search]);

  const loadLedger = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/payments/ledger`, { headers: { Authorization: `Bearer ${token}` } });
      if (isOfficerSessionExpired(response)) return;
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { rows?: PaymentLedgerRow[]; metrics?: LedgerMetrics }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data?.rows) throw new Error(payload?.error?.message ?? 'Unable to load payment records.');
      setRows(payload.data.rows);
      setMetrics(payload.data.metrics ?? { open_items: 0, completed_this_month: 0, verification_rate: 0 });
    } catch (requestError) {
      setError(networkErrorMessage(requestError, 'Unable to load payment records.'));
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadDetail = useCallback(async (applicationId: string) => {
    setDetailError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${applicationId}/payments/detail`, { headers: { Authorization: `Bearer ${token}` } });
      if (isOfficerSessionExpired(response)) return null;
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: PaymentDetail; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to load payment history.');
      setDetail(payload.data);
      return payload.data;
    } catch (requestError) {
      setDetailError(requestError instanceof Error ? requestError.message : 'Unable to load payment history.');
      return null;
    }
  }, [token]);

  const refreshAll = useCallback(async (applicationId?: string) => {
    await loadLedger();
    if (applicationId) await loadDetail(applicationId);
  }, [loadDetail, loadLedger]);

  useEffect(() => { void loadLedger(); }, [loadLedger, reload]);

  useEffect(() => {
    if (!selectedApplicationId) { setDetail(null); return; }
    void loadDetail(selectedApplicationId);
  }, [selectedApplicationId, loadDetail, reload]);

  useEffect(() => {
    if (!rows.length) return;
    const entityId = peekNotificationEntity();
    if (!entityId) return;
    const match = rows.find((row) => row.application_id === entityId);
    if (!match) return;
    clearNotificationEntity();
    setSelectedApplicationId(match.application_id);
  }, [rows]);

  async function unlockPhase(applicationId: string, phase: 'franchise_fee' | 'security_deposit') {
    const busyKey = phase === 'franchise_fee' ? 'unlock-phase-2' : 'unlock-phase-3';
    setBusy(busyKey); setDetailError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${applicationId}/payments/${phase}/unlock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (isOfficerSessionExpired(response)) return;
      const payload = await response.json().catch(() => null) as { success?: boolean; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to unlock this payment phase.');
      notify(phase === 'franchise_fee' ? 'FOCO Phase 2 payment released to the applicant.' : 'FOCO Phase 3 security deposit released to the applicant.');
      await refreshAll(applicationId);
    } catch (requestError) {
      setDetailError(requestError instanceof Error ? requestError.message : 'Unable to unlock this payment phase.');
    } finally {
      setBusy('');
    }
  }

  async function handleDownloadReceipt(payment: PaymentPhaseDetail) {
    if (!detail) return;
    setBusy(`receipt:${payment.key}`); setDetailError('');
    try {
      const safeReceipt = payment.receipt_number.replace(/[^A-Za-z0-9_-]/g, '') || payment.key;
      await downloadReceipt(payment.receipt_download_url, token, `Remedium-Lab-${safeReceipt}.pdf`);
      notify(`${payment.label} receipt downloaded for ${detail.applicant_name}.`);
    } catch (requestError) {
      setDetailError(requestError instanceof Error ? requestError.message : 'Unable to download this receipt.');
    } finally {
      setBusy('');
    }
  }

  async function handleVerifyPayment(payment: PaymentPhaseDetail) {
    if (!detail) return;
    setBusy(`verify:${payment.key}`); setDetailError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${detail.application_id}/payments/${payment.key}/verify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (isOfficerSessionExpired(response)) return;
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: PaymentDetail; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to verify this payment.');
      setDetail(payload.data);
      await loadLedger();
      notify(`${payment.label} verified for ${detail.applicant_name}.`);
    } catch (requestError) {
      setDetailError(requestError instanceof Error ? requestError.message : 'Unable to verify this payment.');
    } finally {
      setBusy('');
    }
  }

  async function handleRejectPayment(payment: PaymentPhaseDetail, remarks: string) {
    if (!detail) return;
    setBusy(`reject:${payment.key}`); setDetailError('');
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${detail.application_id}/payments/${payment.key}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ remarks }),
      });
      if (isOfficerSessionExpired(response)) return;
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: PaymentDetail; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to reject this payment submission.');
      setDetail(payload.data);
      await loadLedger();
      notify(`${payment.label} submission rejected for ${detail.applicant_name}.`);
    } catch (requestError) {
      setDetailError(requestError instanceof Error ? requestError.message : 'Unable to reject this payment submission.');
    } finally {
      setBusy('');
    }
  }

  function exportCsv() {
    const headers = ['Application ID', 'Applicant Name', 'Franchise Model', 'Payment Phase', 'Amount', 'Payment Date', 'Transaction ID', 'Current Status'];
    const lines = visibleRows.map((row) => [
      row.application_number,
      row.applicant_name,
      row.franchise_model,
      row.payment_phase,
      String(row.amount),
      row.payment_date ? displayDate(row.payment_date) : '',
      row.transaction_id,
      row.current_status_label,
    ].map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','));
    const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'rfms-payment-ledger.csv';
    anchor.click();
    URL.revokeObjectURL(url);
    notify('Payment ledger export prepared.');
  }

  const roleLabel = normalizeAdminRole(viewerRole) === 'accountant' ? 'Accountant view' : normalizeAdminRole(viewerRole) === 'manager' ? 'Manager view' : 'Administrator view';
  const canManageCoupons = adminCanManageCoupons(viewerRole);

  return <section className="payment-operations">
    <div className="title-row">
      <div>
        <h1>Payment operations</h1>
        <p>Reconcile verified payments and surface balances that need attention. {roleLabel}.</p>
      </div>
      <button className="date" type="button" onClick={() => setReload((value) => value + 1)}>Refresh</button>
    </div>

    <div className="payment-ops-tabs">
      <button type="button" className={activeTab === 'ledger' ? 'active' : ''} onClick={() => setActiveTab('ledger')}>Work queue</button>
      <button type="button" className={activeTab === 'vouchers' ? 'active' : ''} onClick={() => setActiveTab('vouchers')}>Payment vouchers</button>
      {canManageCoupons ? <button type="button" className={activeTab === 'coupons' ? 'active' : ''} onClick={() => setActiveTab('coupons')}>Coupon codes</button> : null}
    </div>

    {activeTab === 'coupons' && canManageCoupons ? <CouponOperationsPanel token={token} search={search} notify={notify} viewerRole={viewerRole} reloadSignal={reload} /> : activeTab === 'vouchers' ? <PaymentVouchersPanel token={token} search={search} notify={notify} reloadSignal={reload} /> : <>
    <div className="module-summary">
      <section><span>Open items</span><b>{metrics.open_items}</b><small>Requires team attention</small></section>
      <section><span>Pending verification</span><b>{metrics.pending_verification ?? 0}</b><small>Offline submissions awaiting review</small></section>
      <section><span>Completed this month</span><b>{metrics.completed_this_month}</b><small>Verified payments recorded</small></section>
      <section><span>Verification rate</span><b>{metrics.verification_rate}%</b><small>Paid phases across the ledger</small></section>
    </div>

    <section className="panel data-panel">
      <Header title="Work queue" text={loading ? 'Loading payment records…' : `Showing ${visibleRows.length} payment record${visibleRows.length === 1 ? '' : 's'}`} action="Export" onClick={exportCsv} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Application ID</th>
              <th>Applicant</th>
              <th>Franchise model</th>
              <th>Payment phase</th>
              <th>Amount</th>
              <th>Payment date</th>
              <th>Transaction ID</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {error ? <tr><td className="empty" colSpan={9}>{error}</td></tr> : null}
            {!error ? visibleRows.map((row) => <tr key={row.row_id}>
              <td><b>{row.application_number}</b></td>
              <td>{row.applicant_name}</td>
              <td>{row.franchise_model}</td>
              <td>{row.payment_phase}</td>
              <td>{formatAmount(row.amount)}</td>
              <td>{row.payment_date ? displayDate(row.payment_date) : '—'}</td>
              <td>{row.transaction_id || '—'}</td>
              <td><PaymentStatusBadge status={row.current_status} label={row.current_status_label} /></td>
              <td><button className="row-action" type="button" onClick={() => setSelectedApplicationId(row.application_id)}>Open</button></td>
            </tr>) : null}
            {!loading && !error && visibleRows.length === 0 ? <tr><td className="empty" colSpan={9}>No payment records match this search.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>

    {detail ? <PaymentDetailModal
      detail={detail}
      token={token}
      viewerRole={viewerRole}
      busy={busy}
      error={detailError}
      onClose={() => { setSelectedApplicationId(''); setDetail(null); setDetailError(''); }}
      onUnlockPhase2={() => void unlockPhase(detail.application_id, 'franchise_fee')}
      onUnlockPhase3={() => void unlockPhase(detail.application_id, 'security_deposit')}
      onDownloadReceipt={handleDownloadReceipt}
      onVerifyPayment={handleVerifyPayment}
      onRejectPayment={handleRejectPayment}
    /> : null}
    </>}
  </section>;
}
