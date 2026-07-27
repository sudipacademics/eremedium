import { randomUUID } from 'node:crypto';

export const PAYMENT_PHASE_OPTIONS = [
  { key: 'all', label: 'All payment phases' },
  { key: 'fofo_one_time_fee', label: 'FOFO one-time franchise fee' },
  { key: 'application_fee', label: 'Phase 1 — Application fee' },
  { key: 'franchise_fee', label: 'Phase 2 — Franchise fee' },
  { key: 'security_deposit', label: 'Phase 3 — Security deposit' },
];

const IMMUTABLE_FIELDS_AFTER_USE = [
  'code',
  'discount_type',
  'discount_value',
  'applicable_franchise_model',
  'applicable_payment_phase',
  'minimum_payment_amount',
];

function text(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text(value, 10));
}

function dateEndOfDay(value) {
  const date = new Date(`${text(value, 10)}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateStartOfDay(value) {
  const date = new Date(`${text(value, 10)}T00:00:00.000`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeCouponCode(value) {
  return text(value, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

export function couponPhaseLabel(key) {
  return PAYMENT_PHASE_OPTIONS.find((item) => item.key === key)?.label ?? key;
}

export function ensureCouponsArray(database) {
  database.coupons = Array.isArray(database.coupons) ? database.coupons : [];
  database.coupon_usages = Array.isArray(database.coupon_usages) ? database.coupon_usages : [];
  return database;
}

export function couponUsagesForCoupon(database, couponId) {
  ensureCouponsArray(database);
  return database.coupon_usages.filter((item) => item.coupon_id === couponId);
}

export function couponHasCompletedUsage(database, couponId) {
  return couponUsagesForCoupon(database, couponId).some((item) => item.transaction_status === 'completed');
}

export function couponUsageCount(database, couponId) {
  return couponUsagesForCoupon(database, couponId).filter((item) => item.transaction_status === 'completed').length;
}

export function couponUsageCountForApplicant(database, couponId, applicationId) {
  return couponUsagesForCoupon(database, couponId)
    .filter((item) => item.application_id === applicationId && item.transaction_status === 'completed')
    .length;
}

export function calculateCouponDiscount(originalAmount, coupon) {
  const original = boundedNumber(originalAmount, 0, 0, 10_000_000);
  if (!original || !coupon) return { original_amount: original, discount_amount: 0, final_amount: original };
  const discountValue = boundedNumber(coupon.discount_value, 0, 0, 10_000_000);
  let discount = 0;
  if (coupon.discount_type === 'percent') {
    discount = Math.round((original * boundedNumber(discountValue, 0, 0, 100)) / 100);
  } else {
    discount = Math.round(discountValue);
  }
  discount = Math.min(original, Math.max(0, discount));
  return {
    original_amount: original,
    discount_amount: discount,
    final_amount: Math.max(0, original - discount),
  };
}

export function validateCouponForPayment(database, application, payment, rawCode, now = new Date(), options = {}) {
  ensureCouponsArray(database);
  const code = normalizeCouponCode(rawCode);
  if (!code) return { valid: false, code: 'COUPON_REQUIRED', message: 'Enter a coupon code to apply a discount.' };

  const coupon = database.coupons.find((item) => normalizeCouponCode(item.code) === code);
  if (!coupon) return { valid: false, code: 'COUPON_NOT_FOUND', message: 'This coupon code is not recognized. Check the code and try again.' };
  if (!coupon.is_active) return { valid: false, code: 'COUPON_INACTIVE', message: 'This coupon is inactive and cannot be used.' };

  const validFrom = dateStartOfDay(coupon.valid_from);
  const validUntil = dateEndOfDay(coupon.valid_until);
  if (!validFrom || !validUntil) return { valid: false, code: 'COUPON_INVALID', message: 'This coupon has invalid validity dates.' };
  if (now < validFrom) return { valid: false, code: 'COUPON_NOT_STARTED', message: `This coupon becomes valid on ${coupon.valid_from}.` };
  if (now > validUntil) return { valid: false, code: 'COUPON_EXPIRED', message: 'This coupon has expired and can no longer be used.' };

  const model = application.franchise_model;
  const applicableModel = coupon.applicable_franchise_model;
  if (applicableModel !== 'both' && applicableModel !== model) {
    return { valid: false, code: 'COUPON_MODEL_MISMATCH', message: `This coupon applies only to ${applicableModel} franchise applications.` };
  }

  const paymentKey = options.payment_key ?? payment.key;
  const applicablePhase = coupon.applicable_payment_phase || 'all';
  if (applicablePhase !== 'all' && applicablePhase !== paymentKey && !(options.foco_full && applicablePhase === 'application_fee')) {
    return { valid: false, code: 'COUPON_PHASE_MISMATCH', message: `This coupon does not apply to ${payment.label}.` };
  }

  const originalAmount = boundedNumber(options.amount_override ?? payment.amount, 0, 0, 10_000_000);
  const minimumAmount = boundedNumber(coupon.minimum_payment_amount, 0, 0, 10_000_000);
  if (originalAmount < minimumAmount) {
    return { valid: false, code: 'COUPON_MINIMUM_NOT_MET', message: `This coupon requires a minimum payment amount of INR ${minimumAmount.toLocaleString('en-IN')}.` };
  }

  const maxUsage = boundedNumber(coupon.max_usage_limit, 0, 0, 1_000_000);
  const usesCount = couponUsageCount(database, coupon.id);
  if (maxUsage > 0 && usesCount >= maxUsage) {
    return { valid: false, code: 'COUPON_EXHAUSTED', message: 'This coupon has reached its maximum usage limit.' };
  }

  const perApplicantLimit = boundedNumber(coupon.per_applicant_usage_limit, 0, 0, 1_000_000);
  const applicantUses = couponUsageCountForApplicant(database, coupon.id, application.id);
  if (perApplicantLimit > 0 && applicantUses >= perApplicantLimit) {
    return { valid: false, code: 'COUPON_APPLICANT_LIMIT', message: 'You have already used this coupon the maximum number of times allowed for your application.' };
  }

  const pricing = calculateCouponDiscount(originalAmount, coupon);
  return {
    valid: true,
    coupon,
    code: coupon.code,
    ...pricing,
    message: pricing.discount_amount > 0 ? 'Coupon applied successfully.' : 'This coupon does not reduce the payable amount.',
  };
}

export function couponSummary(database, coupon) {
  const usages = couponUsagesForCoupon(database, coupon.id);
  const completed = usages.filter((item) => item.transaction_status === 'completed');
  const totalDiscount = completed.reduce((sum, item) => sum + Number(item.discount_amount || 0), 0);
  return {
    id: coupon.id,
    code: coupon.code,
    discount_type: coupon.discount_type,
    discount_value: coupon.discount_value,
    applicable_franchise_model: coupon.applicable_franchise_model,
    applicable_payment_phase: coupon.applicable_payment_phase,
    applicable_payment_phase_label: couponPhaseLabel(coupon.applicable_payment_phase),
    minimum_payment_amount: coupon.minimum_payment_amount,
    valid_from: coupon.valid_from,
    valid_until: coupon.valid_until,
    max_usage_limit: coupon.max_usage_limit,
    per_applicant_usage_limit: coupon.per_applicant_usage_limit,
    is_active: Boolean(coupon.is_active),
    uses_count: completed.length,
    remaining_uses: coupon.max_usage_limit > 0 ? Math.max(0, coupon.max_usage_limit - completed.length) : null,
    total_discount_given: totalDiscount,
    has_completed_usage: completed.length > 0,
    locked_fields: completed.length ? IMMUTABLE_FIELDS_AFTER_USE : [],
    created_at: coupon.created_at,
    updated_at: coupon.updated_at,
    created_by: coupon.created_by ?? '',
    updated_by: coupon.updated_by ?? '',
  };
}

export function couponUsageSummary(usage) {
  return {
    id: usage.id,
    coupon_id: usage.coupon_id,
    coupon_code: usage.coupon_code,
    application_id: usage.application_id,
    application_number: usage.application_number,
    applicant_name: usage.applicant_name,
    payment_key: usage.payment_key,
    payment_phase: usage.payment_phase,
    original_amount: usage.original_amount,
    discount_amount: usage.discount_amount,
    final_amount: usage.final_amount,
    redeemed_at: usage.redeemed_at,
    transaction_status: usage.transaction_status,
    receipt_number: usage.receipt_number ?? '',
    transaction_number: usage.transaction_number ?? '',
  };
}

export function couponRecordFromBody(body, actor, current = null) {
  const code = normalizeCouponCode(body.code ?? current?.code);
  const discountType = text(body.discount_type ?? current?.discount_type, 20).toLowerCase();
  const discountValue = boundedNumber(body.discount_value ?? current?.discount_value, 0, 0, 10_000_000);
  const applicableModel = text(body.applicable_franchise_model ?? current?.applicable_franchise_model, 10).toUpperCase();
  const applicablePhase = text(body.applicable_payment_phase ?? current?.applicable_payment_phase ?? 'all', 40);
  const minimumPaymentAmount = boundedNumber(body.minimum_payment_amount ?? current?.minimum_payment_amount, 0, 0, 10_000_000);
  const validFrom = text(body.valid_from ?? current?.valid_from, 10);
  const validUntil = text(body.valid_until ?? current?.valid_until, 10);
  const maxUsageLimit = boundedNumber(body.max_usage_limit ?? current?.max_usage_limit, 0, 0, 1_000_000);
  const perApplicantLimit = boundedNumber(body.per_applicant_usage_limit ?? current?.per_applicant_usage_limit, 1, 0, 1_000_000);
  const isActive = body.is_active === undefined ? Boolean(current?.is_active ?? true) : Boolean(body.is_active);

  if (!code) return { error: 'Enter a coupon code.' };
  if (!['fixed', 'percent'].includes(discountType)) return { error: 'Choose Fixed Amount or Percentage discount type.' };
  if (discountType === 'percent' && (discountValue <= 0 || discountValue > 100)) return { error: 'Percentage discount must be between 1 and 100.' };
  if (discountType === 'fixed' && discountValue <= 0) return { error: 'Fixed discount amount must be greater than zero.' };
  if (!['FOFO', 'FOCO', 'BOTH'].includes(applicableModel)) return { error: 'Choose FOFO, FOCO, or Both for the applicable franchise model.' };
  if (!PAYMENT_PHASE_OPTIONS.some((item) => item.key === applicablePhase)) return { error: 'Choose a valid applicable payment phase.' };
  if (!isIsoDate(validFrom) || !isIsoDate(validUntil)) return { error: 'Enter valid start and expiry dates.' };
  if (validFrom > validUntil) return { error: 'Expiry date must be on or after the start date.' };

  const now = new Date().toISOString();
  return {
    record: {
      id: current?.id ?? randomUUID(),
      code,
      discount_type: discountType,
      discount_value: discountValue,
      applicable_franchise_model: applicableModel === 'BOTH' ? 'both' : applicableModel,
      applicable_payment_phase: applicablePhase,
      minimum_payment_amount: minimumPaymentAmount,
      valid_from: validFrom,
      valid_until: validUntil,
      max_usage_limit: maxUsageLimit,
      per_applicant_usage_limit: perApplicantLimit || 1,
      is_active: isActive,
      created_at: current?.created_at ?? now,
      updated_at: now,
      created_by: current?.created_by ?? actor,
      updated_by: actor,
    },
  };
}

export function applyCouponPatch(current, body, database) {
  const hasCompletedUsage = couponHasCompletedUsage(database, current.id);
  const next = { ...current };
  const errors = [];

  const setField = (field, value) => {
    if (hasCompletedUsage && IMMUTABLE_FIELDS_AFTER_USE.includes(field) && value !== current[field]) {
      errors.push(`${field.replaceAll('_', ' ')} cannot be changed after this coupon has been used in a completed payment.`);
      return;
    }
    next[field] = value;
  };

  if (body.code !== undefined) setField('code', normalizeCouponCode(body.code));
  if (body.discount_type !== undefined) setField('discount_type', text(body.discount_type, 20).toLowerCase());
  if (body.discount_value !== undefined) setField('discount_value', boundedNumber(body.discount_value, current.discount_value, 0, 10_000_000));
  if (body.applicable_franchise_model !== undefined) {
    const model = text(body.applicable_franchise_model, 10).toUpperCase();
    setField('applicable_franchise_model', model === 'BOTH' ? 'both' : model);
  }
  if (body.applicable_payment_phase !== undefined) setField('applicable_payment_phase', text(body.applicable_payment_phase, 40));
  if (body.minimum_payment_amount !== undefined) setField('minimum_payment_amount', boundedNumber(body.minimum_payment_amount, current.minimum_payment_amount, 0, 10_000_000));
  if (body.valid_from !== undefined && !hasCompletedUsage) next.valid_from = text(body.valid_from, 10);
  if (body.valid_until !== undefined) next.valid_until = text(body.valid_until, 10);
  if (body.max_usage_limit !== undefined) {
    const nextLimit = boundedNumber(body.max_usage_limit, current.max_usage_limit, 0, 1_000_000);
    const completedUses = couponUsageCount(database, current.id);
    if (hasCompletedUsage && nextLimit > 0 && nextLimit < completedUses) {
      errors.push('Maximum usage limit cannot be reduced below completed redemptions.');
    } else {
      next.max_usage_limit = nextLimit;
    }
  }
  if (body.per_applicant_usage_limit !== undefined) {
    next.per_applicant_usage_limit = boundedNumber(body.per_applicant_usage_limit, current.per_applicant_usage_limit, 1, 1_000_000);
  }
  if (body.is_active !== undefined) next.is_active = Boolean(body.is_active);

  const rebuilt = couponRecordFromBody(next, next.updated_by ?? current.updated_by ?? 'RFMS Officer', current);
  if (rebuilt.error) errors.push(rebuilt.error);
  if (errors.length) return { error: errors[0] };
  return { record: rebuilt.record };
}

export function recordCouponUsage(database, {
  coupon,
  application,
  payment,
  pricing,
  receiptNumber,
  transactionNumber,
  transactionStatus = 'completed',
}) {
  ensureCouponsArray(database);
  const usage = {
    id: randomUUID(),
    coupon_id: coupon.id,
    coupon_code: coupon.code,
    application_id: application.id,
    application_number: application.application_number,
    applicant_name: application.full_name,
    payment_key: payment.key,
    payment_phase: payment.label,
    original_amount: pricing.original_amount,
    discount_amount: pricing.discount_amount,
    final_amount: pricing.final_amount,
    redeemed_at: new Date().toISOString(),
    transaction_status: transactionStatus,
    receipt_number: receiptNumber ?? '',
    transaction_number: transactionNumber ?? '',
  };
  database.coupon_usages.unshift(usage);
  return usage;
}
