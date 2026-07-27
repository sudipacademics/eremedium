import { randomBytes, randomUUID } from 'node:crypto';

export const PAYMENT_METHODS = [
  { key: 'cheque', label: 'Cheque' },
  { key: 'gateway', label: 'UPI / Credit Card / Debit Card' },
  { key: 'bank_transfer', label: 'Bank Transfer (NEFT / RTGS / IMPS)' },
];

function text(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function paymentStatusLabel(status) {
  if (status === 'paid') return 'Paid';
  if (status === 'under_verification') return 'Under verification';
  if (status === 'due') return 'Pending';
  if (status === 'locked') return 'Locked';
  if (status === 'rejected') return 'Rejected';
  return text(status, 40).replaceAll('_', ' ') || 'Unknown';
}

export function paymentVerificationLabel(payment) {
  if (payment.status === 'paid') return 'Verified by RFMS';
  if (payment.status === 'under_verification') return 'Awaiting payment verification';
  if (payment.verification?.status === 'rejected') return 'Rejected — resubmit required';
  if (payment.status === 'due') return 'Awaiting applicant payment';
  if (payment.status === 'locked') return 'Awaiting manager release';
  return 'Unknown';
}

export function focoAllPaymentsPaid(application) {
  return ['application_fee', 'franchise_fee', 'security_deposit'].every((key) => application?.payments?.some((payment) => payment.key === key && payment.status === 'paid'));
}

export function focoFullPaymentEligible(application) {
  if (application?.franchise_model !== 'FOCO') return false;
  const phaseOne = application.payments?.find((payment) => payment.key === 'application_fee');
  const phaseTwo = application.payments?.find((payment) => payment.key === 'franchise_fee');
  const phaseThree = application.payments?.find((payment) => payment.key === 'security_deposit');
  return Boolean(phaseOne?.status === 'due' && phaseTwo?.status === 'locked' && phaseThree?.status === 'locked');
}

export function focoFullPaymentTotal(application) {
  return (application?.payments ?? [])
    .filter((payment) => ['application_fee', 'franchise_fee', 'security_deposit'].includes(payment.key))
    .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
}

export function paymentAuditEntry(payment, type, message, actor) {
  const entry = { id: randomUUID(), type, message, actor, created_at: new Date().toISOString() };
  payment.audit_trail = Array.isArray(payment.audit_trail) ? payment.audit_trail : [];
  payment.audit_trail.push(entry);
  payment.audit_trail = payment.audit_trail.slice(-30);
  return entry;
}

export function submissionSummary(payment) {
  const submission = payment.submission && typeof payment.submission === 'object' ? payment.submission : null;
  if (!submission) return null;
  return {
    method: submission.method ?? payment.payment_method ?? '',
    submitted_at: submission.submitted_at ?? '',
    cheque_number: submission.cheque_number ?? '',
    account_number: submission.account_number ?? '',
    ifsc_code: submission.ifsc_code ?? '',
    account_holder_name: submission.account_holder_name ?? '',
    transaction_reference: submission.transaction_reference ?? '',
    proof: submission.proof ?? null,
    remarks: submission.remarks ?? '',
  };
}

export function verificationSummary(payment) {
  const verification = payment.verification && typeof payment.verification === 'object' ? payment.verification : {};
  return {
    status: verification.status ?? (payment.status === 'paid' ? 'verified' : payment.status === 'under_verification' ? 'pending' : ''),
    verified_at: verification.verified_at ?? '',
    verified_by: verification.verified_by ?? '',
    rejected_at: verification.rejected_at ?? '',
    rejected_by: verification.rejected_by ?? '',
    remarks: verification.remarks ?? '',
  };
}

export function applyPricingToPayment(payment, pricing, couponResult = null) {
  payment.original_amount = pricing.original_amount;
  payment.discount_amount = pricing.discount_amount;
  payment.amount = pricing.final_amount;
  if (couponResult?.valid) {
    payment.coupon_code = couponResult.coupon.code;
    payment.coupon_id = couponResult.coupon.id;
  }
}

export function markPaymentUnderVerification(payment, method, submission, actor) {
  payment.status = 'under_verification';
  payment.payment_method = method;
  payment.submission = submission;
  payment.verification = { status: 'pending', verified_at: '', verified_by: '', rejected_at: '', rejected_by: '', remarks: '' };
  paymentAuditEntry(payment, 'payment_submitted', `${method === 'cheque' ? 'Cheque' : 'Bank transfer'} payment submitted for verification.`, actor);
}

export function markPaymentPaid(payment, method, details = {}) {
  const now = new Date().toISOString();
  payment.status = 'paid';
  payment.payment_method = method;
  payment.paid_at = now;
  payment.receipt_number = details.receipt_number ?? `RCP-${Date.now().toString().slice(-8)}`;
  payment.transaction_number = details.transaction_number ?? `TXN-${Date.now().toString().slice(-10)}-${randomBytes(3).toString('hex').toUpperCase()}`;
  payment.gateway_reference = details.gateway_reference ?? (method === 'gateway' ? `GW-${payment.transaction_number.replace(/^TXN-/, '')}` : '');
  payment.verification = {
    status: 'verified',
    verified_at: method === 'gateway' ? now : details.verified_at ?? now,
    verified_by: method === 'gateway' ? 'Payment gateway' : details.verified_by ?? 'RFMS Officer',
    rejected_at: '',
    rejected_by: '',
    remarks: details.remarks ?? '',
  };
  paymentAuditEntry(payment, method === 'gateway' ? 'gateway_payment_completed' : 'payment_verified', `${payment.label} marked as paid.`, details.verified_by ?? 'Payment gateway');
}

export function rejectPaymentSubmission(payment, remarks, actor) {
  payment.status = 'due';
  payment.verification = {
    status: 'rejected',
    verified_at: '',
    verified_by: '',
    rejected_at: new Date().toISOString(),
    rejected_by: actor,
    remarks: text(remarks, 2000),
  };
  paymentAuditEntry(payment, 'payment_rejected', `Payment submission rejected: ${text(remarks, 2000) || 'No remarks provided.'}`, actor);
}

export function validateOfflineSubmission(body, method) {
  const accountNumber = text(body.account_number, 40);
  const ifscCode = text(body.ifsc_code, 20).toUpperCase();
  const accountHolderName = text(body.account_holder_name, 120);
  if (!accountNumber || accountNumber.replace(/\D/g, '').length < 6) return { error: 'Enter a valid account number.' };
  if (!/^[\dA-Z]{11}$/.test(ifscCode)) return { error: 'Enter a valid IFSC code.' };
  if (!accountHolderName) return { error: 'Enter the account holder name.' };
  if (method === 'cheque') {
    const chequeNumber = text(body.cheque_number, 40);
    if (!chequeNumber) return { error: 'Enter the cheque number.' };
    return { cheque_number: chequeNumber, account_number: accountNumber, ifsc_code: ifscCode, account_holder_name: accountHolderName };
  }
  const transactionReference = text(body.transaction_reference ?? body.transaction_id ?? body.utr_number, 80);
  if (!transactionReference) return { error: 'Enter the transaction ID or UTR number.' };
  return { transaction_reference: transactionReference, account_number: accountNumber, ifsc_code: ifscCode, account_holder_name: accountHolderName };
}

export function buildOfflineSubmission(method, fields, proof, actor) {
  return {
    method,
    submitted_at: new Date().toISOString(),
    submitted_by: actor,
    cheque_number: fields.cheque_number ?? '',
    account_number: fields.account_number,
    ifsc_code: fields.ifsc_code,
    account_holder_name: fields.account_holder_name,
    transaction_reference: fields.transaction_reference ?? '',
    proof: proof ?? null,
    remarks: '',
  };
}

export function completeFocoFullPayment(application, pricing, method, details, actor) {
  const keys = ['application_fee', 'franchise_fee', 'security_deposit'];
  const now = new Date().toISOString();
  const receiptNumber = details.receipt_number ?? `RCP-${Date.now().toString().slice(-8)}`;
  const transactionNumber = details.transaction_number ?? `TXN-${Date.now().toString().slice(-10)}-${randomBytes(3).toString('hex').toUpperCase()}`;
  const perPhaseOriginal = keys.map((key) => application.payments.find((payment) => payment.key === key)).filter(Boolean);
  const totalOriginal = perPhaseOriginal.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
  let remainingDiscount = pricing.discount_amount;
  keys.forEach((key, index) => {
    const payment = application.payments.find((item) => item.key === key);
    if (!payment) return;
    const listAmount = Number(payment.amount ?? 0);
    const share = index === keys.length - 1
      ? remainingDiscount
      : Math.round((listAmount / Math.max(totalOriginal, 1)) * pricing.discount_amount);
    remainingDiscount -= share;
    payment.original_amount = listAmount;
    payment.discount_amount = share;
    payment.amount = Math.max(0, listAmount - share);
    if (pricing.coupon_code) {
      payment.coupon_code = pricing.coupon_code;
      payment.coupon_id = pricing.coupon_id ?? '';
    }
    if (method === 'gateway' || details.immediate_paid) {
      markPaymentPaid(payment, method, {
        receipt_number: `${receiptNumber}-${key.slice(0, 3).toUpperCase()}`,
        transaction_number: transactionNumber,
        gateway_reference: details.gateway_reference ?? '',
        verified_by: details.verified_by ?? (method === 'gateway' ? 'Payment gateway' : actor),
        verified_at: now,
      });
    } else {
      markPaymentUnderVerification(payment, method, {
        ...details.submission,
        foco_full_payment: true,
        bundle_reference: receiptNumber,
      }, actor);
    }
    payment.foco_full_payment = true;
    payment.bundle_reference = receiptNumber;
  });
  application.foco_full_payment_selected = true;
  if (method === 'gateway' || details.immediate_paid) {
    application.stage = 'payment_3_received';
  }
  application.visible_to_admin = true;
  application.updated_at = now;
  return { receipt_number: receiptNumber, transaction_number: transactionNumber };
}

export function paymentPhaseDetail(payment) {
  return {
    key: payment.key,
    label: payment.label,
    amount: payment.amount,
    original_amount: payment.original_amount ?? payment.amount,
    discount_amount: payment.discount_amount ?? 0,
    coupon_code: payment.coupon_code ?? '',
    status: payment.status,
    status_label: paymentStatusLabel(payment.status),
    payment_method: payment.payment_method ?? '',
    payment_date: payment.paid_at ?? '',
    paid_at: payment.paid_at ?? '',
    receipt_number: payment.receipt_number ?? '',
    transaction_id: payment.transaction_number ?? '',
    gateway_reference: payment.gateway_reference ?? '',
    verification_status_label: paymentVerificationLabel(payment),
    submission: submissionSummary(payment),
    verification: verificationSummary(payment),
    audit_trail: Array.isArray(payment.audit_trail) ? payment.audit_trail.slice().reverse() : [],
    foco_full_payment: Boolean(payment.foco_full_payment),
  };
}

export function ensureGatewayOrders(database) {
  database.payment_gateway_orders = Array.isArray(database.payment_gateway_orders) ? database.payment_gateway_orders : [];
  return database.payment_gateway_orders;
}

export function createGatewayOrder(database, application, options) {
  ensureGatewayOrders(database);
  const order = {
    id: randomUUID(),
    order_number: `RFMS-PAY-${Date.now().toString().slice(-8)}`,
    application_id: application.id,
    payment_key: options.payment_key ?? '',
    foco_full: Boolean(options.foco_full),
    amount: boundedNumber(options.amount, 0, 0, 10_000_000),
    original_amount: boundedNumber(options.original_amount ?? options.amount, 0, 0, 10_000_000),
    discount_amount: boundedNumber(options.discount_amount, 0, 0, 10_000_000),
    coupon_code: options.coupon_code ?? '',
    coupon_id: options.coupon_id ?? '',
    status: 'pending',
    created_at: new Date().toISOString(),
    completed_at: '',
  };
  database.payment_gateway_orders.unshift(order);
  return order;
}

export function completeGatewayOrder(database, orderId) {
  const order = ensureGatewayOrders(database).find((item) => item.id === orderId);
  if (!order || order.status !== 'pending') return null;
  order.status = 'completed';
  order.completed_at = new Date().toISOString();
  return order;
}
