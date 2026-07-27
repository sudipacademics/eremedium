const PAYMENT_HISTORY_TYPES = new Set([
  'foco_phase_2_payment_received',
  'foco_phase_3_payment_received',
  'foco_phase_2_payment_unlocked',
  'foco_phase_3_payment_unlocked',
  'foco_phase_2_payment_pending_manager_unlock',
  'foco_phase_2_terms_accepted',
  'foco_phase_3_terms_accepted',
]);

const PAYMENT_KEY_HISTORY = {
  application_fee: ['foco_phase_2_payment_pending_manager_unlock'],
  franchise_fee: ['foco_phase_2_payment_unlocked', 'foco_phase_2_terms_accepted', 'foco_phase_2_payment_received'],
  security_deposit: ['foco_phase_3_payment_unlocked', 'foco_phase_3_terms_accepted', 'foco_phase_3_payment_received'],
  fofo_one_time_fee: [],
};

function text(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

export function paymentStatusLabel(status) {
  if (status === 'paid') return 'Verified';
  if (status === 'under_verification') return 'Under verification';
  if (status === 'due') return 'Pending';
  if (status === 'locked') return 'Locked';
  if (status === 'rejected') return 'Rejected';
  return text(status, 40).replaceAll('_', ' ') || 'Unknown';
}

export function paymentVerificationStatus(status) {
  if (status === 'paid') return 'verified';
  if (status === 'under_verification') return 'pending_verification';
  if (status === 'due') return 'pending_payment';
  if (status === 'locked') return 'locked';
  if (status === 'rejected') return 'rejected';
  return 'unknown';
}

export function paymentVerificationLabel(paymentOrStatus) {
  const payment = typeof paymentOrStatus === 'string' ? { status: paymentOrStatus } : paymentOrStatus;
  const status = payment?.status ?? '';
  if (status === 'paid') return 'Verified by RFMS';
  if (status === 'under_verification') return 'Awaiting payment verification';
  if (payment?.verification?.status === 'rejected') return 'Rejected — resubmit required';
  if (status === 'due') return 'Awaiting applicant payment';
  if (status === 'locked') return 'Awaiting manager release';
  return 'Unknown';
}

export function paymentTransactionNumber(payment) {
  const saved = text(payment?.transaction_number, 80);
  if (saved) return saved;
  const suffix = text(payment?.receipt_number, 80).replace(/^RCP-/, '');
  return suffix ? `TXN-${suffix}` : '';
}

export function paymentGatewayReference(payment) {
  const transaction = paymentTransactionNumber(payment);
  if (!transaction) return '';
  return transaction.startsWith('GW-') ? transaction : `GW-${transaction.replace(/^TXN-/, '')}`;
}

function paymentEligibleApplication(application) {
  return Boolean(application?.visible_to_admin);
}

function paymentHistoryForPhase(application, paymentKey) {
  const history = Array.isArray(application?.review_history) ? application.review_history : [];
  const scopedTypes = new Set(PAYMENT_KEY_HISTORY[paymentKey] ?? []);
  return history
    .filter((entry) => PAYMENT_HISTORY_TYPES.has(entry.type) && (scopedTypes.size === 0 || scopedTypes.has(entry.type)))
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      message: entry.message,
      actor: entry.actor,
      created_at: entry.created_at,
    }));
}

function paymentTermsForPhase(application, paymentKey) {
  if (paymentKey === 'franchise_fee') return application.payment_terms?.franchise_fee ?? null;
  if (paymentKey === 'security_deposit') return application.payment_terms?.security_deposit ?? null;
  return null;
}

export function paymentPhaseSummary(application, payment, options = {}) {
  const adminBasePath = options.adminBasePath ?? '/api/v1/admin';
  const transactionId = paymentTransactionNumber(payment);
  const paid = payment.status === 'paid';
  const terms = paymentTermsForPhase(application, payment.key);
  const originalAmount = Number(payment.original_amount ?? payment.amount ?? 0);
  const discountAmount = Number(payment.discount_amount ?? 0);
  const payableAmount = paid ? Number(payment.amount ?? 0) : originalAmount;
  return {
    key: payment.key,
    label: payment.label,
    purpose: payment.purpose,
    amount: payableAmount,
    original_amount: originalAmount,
    discount_amount: discountAmount,
    coupon_code: payment.coupon_code ?? '',
    status: payment.status,
    status_label: paymentStatusLabel(payment.status),
    paid_amount: paid ? payableAmount : 0,
    pending_amount: paid ? 0 : payableAmount,
    payment_date: payment.paid_at ?? '',
    paid_at: payment.paid_at ?? '',
    receipt_number: payment.receipt_number ?? '',
    transaction_id: transactionId,
    gateway_reference: paid ? paymentGatewayReference(payment) : '',
    verification_status: paymentVerificationStatus(payment.status),
    verification_status_label: paymentVerificationLabel(payment),
    payment_method: payment.payment_method ?? payment.submission?.method ?? '',
    submission: payment.submission ? {
      method: payment.submission.method ?? '',
      submitted_at: payment.submission.submitted_at ?? '',
      cheque_number: payment.submission.cheque_number ?? '',
      account_number: payment.submission.account_number ?? '',
      ifsc_code: payment.submission.ifsc_code ?? '',
      account_holder_name: payment.submission.account_holder_name ?? '',
      transaction_reference: payment.submission.transaction_reference ?? '',
      proof: payment.submission.proof ?? null,
      remarks: payment.submission.remarks ?? '',
    } : null,
    verification: payment.verification ? {
      status: payment.verification.status ?? '',
      verified_at: payment.verification.verified_at ?? '',
      verified_by: payment.verification.verified_by ?? '',
      rejected_at: payment.verification.rejected_at ?? '',
      rejected_by: payment.verification.rejected_by ?? '',
      remarks: payment.verification.remarks ?? '',
    } : null,
    audit_trail: Array.isArray(payment.audit_trail) ? payment.audit_trail.slice().reverse() : [],
    terms_accepted_at: terms?.accepted_at ?? '',
    terms_accepted_by: terms?.accepted_by ?? '',
    remarks: paymentHistoryForPhase(application, payment.key),
    can_download_receipt: paid && Boolean(payment.receipt_number),
    receipt_download_url: paid && payment.receipt_number
      ? `${adminBasePath}/applications/${application.id}/payments/${payment.key}/receipt`
      : '',
  };
}

export function paymentLedgerRow(application, payment) {
  const transactionId = paymentTransactionNumber(payment);
  const amount = Number(payment.amount ?? 0);
  return {
    row_id: `${application.id}:${payment.key}`,
    application_id: application.id,
    application_number: application.application_number,
    applicant_name: application.full_name,
    franchise_model: application.franchise_model,
    payment_key: payment.key,
    payment_phase: payment.label,
    amount,
    original_amount: Number(payment.original_amount ?? amount),
    discount_amount: Number(payment.discount_amount ?? 0),
    coupon_code: payment.coupon_code ?? '',
    payment_date: payment.paid_at || payment.submission?.submitted_at || '',
    transaction_id: transactionId,
    current_status: payment.status,
    current_status_label: paymentStatusLabel(payment.status),
    updated_at: payment.paid_at || payment.submission?.submitted_at || application.updated_at || application.created_at,
  };
}

export function paymentLedgerForApplications(applications) {
  return applications
    .filter(paymentEligibleApplication)
    .flatMap((application) => (Array.isArray(application.payments) ? application.payments : []).map((payment) => paymentLedgerRow(application, payment)))
    .sort((first, second) => second.updated_at.localeCompare(first.updated_at));
}

export function paymentLedgerMetrics(rows) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const openItems = rows.filter((row) => row.current_status === 'due' || row.current_status === 'locked' || row.current_status === 'under_verification').length;
  const pendingVerification = rows.filter((row) => row.current_status === 'under_verification').length;
  const completedThisMonth = rows.filter((row) => {
    if (row.current_status !== 'paid' || !row.payment_date) return false;
    const paidAt = new Date(row.payment_date);
    return !Number.isNaN(paidAt.getTime()) && paidAt >= monthStart;
  }).length;
  const verifiedCount = rows.filter((row) => row.current_status === 'paid').length;
  const verificationRate = rows.length ? Math.round((verifiedCount / rows.length) * 100) : 0;
  return {
    open_items: openItems,
    pending_verification: pendingVerification,
    completed_this_month: completedThisMonth,
    verification_rate: verificationRate,
  };
}

function paymentPermissions(application, role) {
  const normalized = String(role ?? '').replace('franchise_manager', 'manager');
  const canManageUnlocks = ['super_admin', 'manager'].includes(normalized);
  const phaseTwo = application.payments?.find((payment) => payment.key === 'franchise_fee');
  const phaseThree = application.payments?.find((payment) => payment.key === 'security_deposit');
  const territoryIssued = Boolean(application.territory_allotment?.letter_number || application.territory_allotments?.length);
  const phaseOnePaid = application.payments?.some((payment) => payment.key === 'application_fee' && payment.status === 'paid');
  const phaseTwoPaid = application.payments?.some((payment) => payment.key === 'franchise_fee' && payment.status === 'paid');
  const brandingApproved = application.branding_signage?.status === 'approved';
  const hrApproved = application.hr_process?.status === 'approved';

  const canVerifyPayments = ['super_admin', 'manager', 'accountant'].includes(normalized);

  return {
    can_view: true,
    can_download_receipt: true,
    can_verify_payments: canVerifyPayments,
    can_unlock_phase_2: canManageUnlocks && application.franchise_model === 'FOCO' && phaseTwo?.status === 'locked' && phaseOnePaid && territoryIssued,
    can_unlock_phase_3: canManageUnlocks && application.franchise_model === 'FOCO' && phaseThree?.status === 'locked' && phaseTwoPaid && brandingApproved && hrApproved,
  };
}

export function paymentDetailForApplication(application, role, options = {}) {
  const payments = Array.isArray(application.payments) ? application.payments : [];
  const paidTotal = payments.filter((payment) => payment.status === 'paid').reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const pendingTotal = payments.filter((payment) => payment.status !== 'paid').reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const history = (Array.isArray(application.review_history) ? application.review_history : [])
    .filter((entry) => PAYMENT_HISTORY_TYPES.has(entry.type))
    .slice(-20)
    .reverse();
  const permissions = paymentPermissions(application, role);

  return {
    application_id: application.id,
    application_number: application.application_number,
    applicant_name: application.full_name,
    franchise_model: application.franchise_model,
    stage: application.stage,
    summary: {
      total_paid: paidTotal,
      total_pending: pendingTotal,
      total_due: pendingTotal,
      phases_total: payments.length,
      phases_paid: payments.filter((payment) => payment.status === 'paid').length,
    },
    payments: payments.map((payment) => ({
      ...paymentPhaseSummary(application, payment, options),
      can_verify: permissions.can_verify_payments && payment.status === 'under_verification',
      can_reject: permissions.can_verify_payments && payment.status === 'under_verification',
    })),
    history,
    permissions,
  };
}
