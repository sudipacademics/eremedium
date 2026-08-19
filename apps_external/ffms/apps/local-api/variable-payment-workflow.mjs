import { markPaymentPaid } from './payment-submissions-workflow.mjs';

export const FOCO_CONTRACT_TOTAL = 320000;
export const FOCO_DEFAULT_AMOUNTS = {
  application_fee: 10000,
  franchise_fee: 110000,
  security_deposit: 200000,
};
export const FOCO_PHASE_ORDER = ['application_fee', 'franchise_fee', 'security_deposit'];

function text(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

export function ensureFocoPaymentSchedule(application) {
  if (String(application?.franchise_model || '').toUpperCase() !== 'FOCO') return null;
  if (!application.payment_schedule || typeof application.payment_schedule !== 'object') {
    application.payment_schedule = {
      mode: 'variable',
      contract_total: FOCO_CONTRACT_TOTAL,
      variable_payment_enabled: true,
    };
  }
  const payments = Array.isArray(application.payments) ? application.payments : [];
  for (const key of FOCO_PHASE_ORDER) {
    const payment = payments.find((item) => item.key === key);
    if (!payment) continue;
    if (payment.scheduled_amount == null) {
      payment.scheduled_amount = Number(payment.amount ?? FOCO_DEFAULT_AMOUNTS[key] ?? 0);
    }
    if (payment.original_amount == null && payment.amount != null) {
      payment.original_amount = payment.amount;
    }
  }
  return application.payment_schedule;
}

export function focoTotalPaid(application) {
  return (application?.payments ?? [])
    .filter((payment) => FOCO_PHASE_ORDER.includes(payment.key) && payment.status === 'paid')
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

export function focoTotalRemaining(application) {
  ensureFocoPaymentSchedule(application);
  const contract = Number(application?.payment_schedule?.contract_total ?? FOCO_CONTRACT_TOTAL);
  return Math.max(0, contract - focoTotalPaid(application));
}

export function unpaidFocoPhases(application) {
  return FOCO_PHASE_ORDER
    .map((key) => application.payments?.find((payment) => payment.key === key))
    .filter((payment) => payment && payment.status !== 'paid');
}

export function recalculateFocoRemainingPhases(application, options = {}) {
  ensureFocoPaymentSchedule(application);
  const remaining = focoTotalRemaining(application);
  const unpaid = unpaidFocoPhases(application);
  if (!unpaid.length) {
    application.payment_schedule.total_remaining = 0;
    return { remaining: 0, updated: [] };
  }

  const weights = options.weights && typeof options.weights === 'object' ? options.weights : {};
  const totalWeight = unpaid.reduce(
    (sum, payment) => sum + Number(weights[payment.key] ?? payment.scheduled_amount ?? FOCO_DEFAULT_AMOUNTS[payment.key] ?? 1),
    0,
  );

  let left = remaining;
  const updated = [];
  unpaid.forEach((payment, index) => {
    const weight = Number(weights[payment.key] ?? payment.scheduled_amount ?? FOCO_DEFAULT_AMOUNTS[payment.key] ?? 1);
    const share = index === unpaid.length - 1
      ? left
      : Math.round((weight / Math.max(totalWeight, 1)) * remaining);
    left -= share;
    payment.scheduled_amount = share;
    if (payment.status !== 'paid') {
      payment.amount = share;
      payment.original_amount = share;
      payment.discount_amount = 0;
    }
    updated.push({ key: payment.key, amount: share });
  });

  application.payment_schedule.total_remaining = remaining;
  application.payment_schedule.last_recalculated_at = new Date().toISOString();
  if (options.actor) application.payment_schedule.last_recalculated_by = text(options.actor, 120);
  return { remaining, updated };
}

export function setPhaseScheduledAmount(application, phaseKey, amount, actor = '') {
  ensureFocoPaymentSchedule(application);
  if (!FOCO_PHASE_ORDER.includes(phaseKey)) {
    return { error: 'INVALID_PHASE', message: 'Unknown FOCO payment phase.' };
  }
  const payment = application.payments?.find((item) => item.key === phaseKey);
  if (!payment) return { error: 'NOT_FOUND', message: 'Payment phase not found.' };
  if (payment.status === 'paid') {
    return { error: 'PHASE_ALREADY_PAID', message: 'Paid phases cannot be rescheduled.' };
  }

  const parsed = Math.max(0, Math.round(Number(amount) || 0));
  const contract = Number(application.payment_schedule.contract_total ?? FOCO_CONTRACT_TOTAL);
  const paid = focoTotalPaid(application);
  const otherUnpaidTotal = unpaidFocoPhases(application)
    .filter((item) => item.key !== phaseKey)
    .reduce((sum, item) => sum + Number(item.scheduled_amount ?? item.amount ?? 0), 0);

  if (paid + parsed + otherUnpaidTotal > contract) {
    return {
      error: 'SCHEDULE_OVERFLOW',
      message: `Phase amounts cannot exceed the FOCO contract total of ₹${contract.toLocaleString('en-IN')}. Remaining balance after payments received: ₹${Math.max(0, contract - paid).toLocaleString('en-IN')}.`,
    };
  }

  payment.scheduled_amount = parsed;
  payment.amount = parsed;
  payment.original_amount = parsed;
  payment.discount_amount = 0;
  application.payment_schedule.last_updated_at = new Date().toISOString();
  application.payment_schedule.last_updated_by = text(actor, 120);
  return { payment, scheduled_amount: parsed };
}

export function paymentScheduleSummary(application) {
  ensureFocoPaymentSchedule(application);
  const contract = Number(application.payment_schedule?.contract_total ?? FOCO_CONTRACT_TOTAL);
  const paid = focoTotalPaid(application);
  return {
    mode: application.payment_schedule?.mode ?? 'variable',
    variable_payment_enabled: Boolean(application.payment_schedule?.variable_payment_enabled ?? true),
    contract_total: contract,
    total_paid: paid,
    total_remaining: Math.max(0, contract - paid),
    last_recalculated_at: application.payment_schedule?.last_recalculated_at ?? '',
    last_recalculated_by: application.payment_schedule?.last_recalculated_by ?? '',
    phases: FOCO_PHASE_ORDER.map((key) => {
      const payment = application.payments?.find((item) => item.key === key);
      if (!payment) return null;
      return {
        key,
        label: payment.label,
        scheduled_amount: Number(payment.scheduled_amount ?? payment.amount ?? 0),
        amount: Number(payment.amount ?? 0),
        status: payment.status,
        paid_amount: payment.status === 'paid' ? Number(payment.amount ?? 0) : 0,
        manager_recorded: Boolean(payment.manager_recorded),
      };
    }).filter(Boolean),
  };
}

export function recordManagerDirectPayment(application, phaseKey, body, actor) {
  ensureFocoPaymentSchedule(application);
  if (!FOCO_PHASE_ORDER.includes(phaseKey)) {
    return { error: 'INVALID_PHASE', message: 'Unknown FOCO payment phase.' };
  }
  const payment = application.payments?.find((item) => item.key === phaseKey);
  if (!payment) return { error: 'NOT_FOUND', message: 'Payment phase not found.' };
  if (payment.status === 'paid') {
    return { error: 'ALREADY_PAID', message: 'This payment phase is already marked as paid.' };
  }
  if (payment.status === 'locked') {
    return { error: 'PHASE_LOCKED', message: 'Unlock this payment phase before recording a manager payment.' };
  }

  const amount = Math.max(1, Math.round(Number(body.amount) || 0));
  const method = text(body.method, 40) || 'bank_transfer';
  const contract = Number(application.payment_schedule.contract_total ?? FOCO_CONTRACT_TOTAL);
  const paidBefore = focoTotalPaid(application);
  if (paidBefore + amount > contract) {
    return {
      error: 'AMOUNT_EXCEEDS_CONTRACT',
      message: `This payment would exceed the FOCO contract total of ₹${contract.toLocaleString('en-IN')}. Remaining payable: ₹${Math.max(0, contract - paidBefore).toLocaleString('en-IN')}.`,
    };
  }

  payment.scheduled_amount = Number(payment.scheduled_amount ?? payment.amount ?? amount);
  payment.original_amount = amount;
  payment.amount = amount;
  payment.discount_amount = 0;
  payment.manager_recorded = true;
  payment.manager_recorded_at = new Date().toISOString();
  payment.manager_recorded_by = text(actor, 120);
  payment.submission = {
    method,
    submitted_at: new Date().toISOString(),
    submitted_by: text(actor, 120),
    transaction_reference: text(body.transaction_reference ?? body.transaction_id ?? body.utr_number, 80),
    cheque_number: text(body.cheque_number, 40),
    account_number: text(body.account_number, 40),
    ifsc_code: text(body.ifsc_code, 20).toUpperCase(),
    account_holder_name: text(body.account_holder_name, 120),
    remarks: text(body.remarks, 2000),
    manager_direct: true,
  };

  markPaymentPaid(payment, method, {
    verified_by: text(actor, 120),
    remarks: text(body.remarks, 2000),
    transaction_number: text(body.transaction_reference ?? body.transaction_id ?? body.utr_number, 80) || undefined,
  });

  if (body.auto_recalculate !== false) {
    recalculateFocoRemainingPhases(application, { actor });
  }

  return { payment, amount };
}

export function ensureOnboardingModules(application, helpers = {}) {
  const territoryAllotted = helpers.territoryAllotted ?? (() => Boolean(application?.territory_allotment?.letter_number));
  const paymentIsPaid = helpers.paymentIsPaid ?? ((app, key) => app?.payments?.some((payment) => payment.key === key && payment.status === 'paid'));

  if (!application.onboarding_modules || typeof application.onboarding_modules !== 'object') {
    const legacyBranding = application.franchise_model === 'FOFO'
      ? territoryAllotted(application) && paymentIsPaid(application, 'fofo_one_time_fee')
      : territoryAllotted(application) && paymentIsPaid(application, 'franchise_fee');
    const legacyHr = application.franchise_model === 'FOCO' && legacyBranding;
    application.onboarding_modules = {
      branding_released: legacyBranding,
      branding_released_at: legacyBranding ? String(application.updated_at || application.created_at || '') : '',
      branding_released_by: legacyBranding ? 'Legacy payment gate' : '',
      hr_released: legacyHr,
      hr_released_at: legacyHr ? String(application.updated_at || application.created_at || '') : '',
      hr_released_by: legacyHr ? 'Legacy payment gate' : '',
    };
  }
  return application.onboarding_modules;
}

export function onboardingModulesSummary(application) {
  const modules = ensureOnboardingModules(application);
  return {
    branding_released: Boolean(modules.branding_released),
    branding_released_at: modules.branding_released_at ?? '',
    branding_released_by: modules.branding_released_by ?? '',
    hr_released: Boolean(modules.hr_released),
    hr_released_at: modules.hr_released_at ?? '',
    hr_released_by: modules.hr_released_by ?? '',
  };
}
