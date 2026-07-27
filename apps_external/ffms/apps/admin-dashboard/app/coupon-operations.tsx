'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { RFMS_API_BASE, adminCanManageCoupons } from '@rfms/utils';

const API_BASE = RFMS_API_BASE;

const PAYMENT_PHASES = [
  { key: 'all', label: 'All payment phases' },
  { key: 'fofo_one_time_fee', label: 'FOFO one-time franchise fee' },
  { key: 'application_fee', label: 'Phase 1 — Application fee' },
  { key: 'franchise_fee', label: 'Phase 2 — Franchise fee' },
  { key: 'security_deposit', label: 'Phase 3 — Security deposit' },
];

type CouponRecord = {
  id: string;
  code: string;
  discount_type: 'fixed' | 'percent';
  discount_value: number;
  applicable_franchise_model: 'FOFO' | 'FOCO' | 'both';
  applicable_payment_phase: string;
  applicable_payment_phase_label: string;
  minimum_payment_amount: number;
  valid_from: string;
  valid_until: string;
  max_usage_limit: number;
  per_applicant_usage_limit: number;
  is_active: boolean;
  uses_count: number;
  remaining_uses: number | null;
  total_discount_given: number;
  has_completed_usage: boolean;
  locked_fields: string[];
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

type CouponUsage = {
  id: string;
  coupon_id: string;
  coupon_code: string;
  application_id: string;
  application_number: string;
  applicant_name: string;
  payment_key: string;
  payment_phase: string;
  original_amount: number;
  discount_amount: number;
  final_amount: number;
  redeemed_at: string;
  transaction_status: string;
  receipt_number: string;
  transaction_number: string;
};

type CouponForm = {
  code: string;
  discount_type: 'fixed' | 'percent';
  discount_value: string;
  applicable_franchise_model: 'FOFO' | 'FOCO' | 'both';
  applicable_payment_phase: string;
  minimum_payment_amount: string;
  valid_from: string;
  valid_until: string;
  max_usage_limit: string;
  per_applicant_usage_limit: string;
  is_active: boolean;
};

const EMPTY_FORM: CouponForm = {
  code: '',
  discount_type: 'fixed',
  discount_value: '',
  applicable_franchise_model: 'both',
  applicable_payment_phase: 'all',
  minimum_payment_amount: '0',
  valid_from: new Date().toISOString().slice(0, 10),
  valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  max_usage_limit: '0',
  per_applicant_usage_limit: '1',
  is_active: true,
};

function formatAmount(value: number) {
  return `INR ${Number(value || 0).toLocaleString('en-IN')}`;
}

function displayDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function isOfficerSessionExpired(response: Response) {
  if (response.status !== 401 && response.status !== 403) return false;
  window.dispatchEvent(new Event('rfms-session-expired'));
  return true;
}

function formFromCoupon(coupon: CouponRecord): CouponForm {
  return {
    code: coupon.code,
    discount_type: coupon.discount_type,
    discount_value: String(coupon.discount_value),
    applicable_franchise_model: coupon.applicable_franchise_model,
    applicable_payment_phase: coupon.applicable_payment_phase,
    minimum_payment_amount: String(coupon.minimum_payment_amount),
    valid_from: coupon.valid_from,
    valid_until: coupon.valid_until,
    max_usage_limit: String(coupon.max_usage_limit),
    per_applicant_usage_limit: String(coupon.per_applicant_usage_limit),
    is_active: coupon.is_active,
  };
}

function CouponFormModal({
  title,
  form,
  lockedFields,
  busy,
  error,
  onChange,
  onClose,
  onSubmit,
}: {
  title: string;
  form: CouponForm;
  lockedFields: string[];
  busy: boolean;
  error: string;
  onChange: (next: CouponForm) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const locked = new Set(lockedFields);
  return <div className="payment-detail-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="payment-detail-modal coupon-form-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
      <header className="payment-detail-head">
        <div><p>Coupon management</p><h2>{title}</h2></div>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <form className="coupon-form" onSubmit={onSubmit}>
        <label>Coupon code<input required value={form.code} disabled={locked.has('code')} onChange={(event) => onChange({ ...form, code: event.target.value.toUpperCase() })} placeholder="LAUNCH2026" /></label>
        <label>Discount type<select value={form.discount_type} disabled={locked.has('discount_type')} onChange={(event) => onChange({ ...form, discount_type: event.target.value as CouponForm['discount_type'] })}><option value="fixed">Fixed amount</option><option value="percent">Percentage</option></select></label>
        <label>{form.discount_type === 'percent' ? 'Discount value (%)' : 'Discount value (INR)'}<input required inputMode="decimal" value={form.discount_value} disabled={locked.has('discount_value')} onChange={(event) => onChange({ ...form, discount_value: event.target.value })} /></label>
        <label>Applicable franchise model<select value={form.applicable_franchise_model} disabled={locked.has('applicable_franchise_model')} onChange={(event) => onChange({ ...form, applicable_franchise_model: event.target.value as CouponForm['applicable_franchise_model'] })}><option value="both">Both</option><option value="FOFO">FOFO</option><option value="FOCO">FOCO</option></select></label>
        <label>Applicable payment phase<select value={form.applicable_payment_phase} disabled={locked.has('applicable_payment_phase')} onChange={(event) => onChange({ ...form, applicable_payment_phase: event.target.value })}>{PAYMENT_PHASES.map((phase) => <option key={phase.key} value={phase.key}>{phase.label}</option>)}</select></label>
        <label>Minimum payment amount (INR)<input required inputMode="numeric" value={form.minimum_payment_amount} disabled={locked.has('minimum_payment_amount')} onChange={(event) => onChange({ ...form, minimum_payment_amount: event.target.value })} /></label>
        <label>Start date<input required type="date" value={form.valid_from} disabled={locked.has('valid_from')} onChange={(event) => onChange({ ...form, valid_from: event.target.value })} /></label>
        <label>Expiry date<input required type="date" value={form.valid_until} onChange={(event) => onChange({ ...form, valid_until: event.target.value })} /></label>
        <label>Maximum usage limit<input required inputMode="numeric" value={form.max_usage_limit} onChange={(event) => onChange({ ...form, max_usage_limit: event.target.value })} placeholder="0 = unlimited" /></label>
        <label>Per-applicant usage limit<input required inputMode="numeric" value={form.per_applicant_usage_limit} onChange={(event) => onChange({ ...form, per_applicant_usage_limit: event.target.value })} /></label>
        <label className="coupon-active-toggle"><input type="checkbox" checked={form.is_active} onChange={(event) => onChange({ ...form, is_active: event.target.checked })} /> Active coupon</label>
        {lockedFields.length ? <p className="coupon-lock-note">Fields used in completed payments are locked and cannot be changed retroactively.</p> : null}
        {error ? <p className="application-review-error" role="alert">{error}</p> : null}
        <div className="coupon-form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save coupon'}</button></div>
      </form>
    </section>
  </div>;
}

export function CouponOperationsPanel({ token, search, notify, viewerRole, reloadSignal }: { token: string; search: string; notify: (message: string) => void; viewerRole: string; reloadSignal: number }) {
  const canManage = adminCanManageCoupons(viewerRole);
  const [coupons, setCoupons] = useState<CouponRecord[]>([]);
  const [usages, setUsages] = useState<CouponUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CouponRecord | null>(null);
  const [form, setForm] = useState<CouponForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState('');
  const [selectedCouponId, setSelectedCouponId] = useState('');

  const visibleCoupons = useMemo(() => coupons.filter((coupon) => `${coupon.code} ${coupon.applicable_franchise_model} ${coupon.applicable_payment_phase_label}`.toLowerCase().includes(search.toLowerCase())), [coupons, search]);
  const visibleUsages = useMemo(() => usages.filter((usage) => !selectedCouponId || usage.coupon_id === selectedCouponId).filter((usage) => `${usage.coupon_code} ${usage.applicant_name} ${usage.application_number} ${usage.payment_phase}`.toLowerCase().includes(search.toLowerCase())), [usages, selectedCouponId, search]);
  const selectedCoupon = coupons.find((coupon) => coupon.id === selectedCouponId) ?? null;

  const loadCoupons = useCallback(async () => {
    if (!canManage) return;
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/coupons`, { headers: { Authorization: `Bearer ${token}` } });
      if (isOfficerSessionExpired(response)) return;
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: CouponRecord[]; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !Array.isArray(payload.data)) throw new Error(payload?.error?.message ?? 'Unable to load coupon codes.');
      setCoupons(payload.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load coupon codes.');
    } finally {
      setLoading(false);
    }
  }, [canManage, token]);

  const loadUsages = useCallback(async (couponId?: string) => {
    if (!canManage) return;
    try {
      const query = couponId ? `?coupon_id=${encodeURIComponent(couponId)}` : '';
      const response = await fetch(`${API_BASE}/admin/coupons/usages${query}`, { headers: { Authorization: `Bearer ${token}` } });
      if (isOfficerSessionExpired(response)) return;
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: CouponUsage[]; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !Array.isArray(payload.data)) throw new Error(payload?.error?.message ?? 'Unable to load coupon usage history.');
      setUsages(payload.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load coupon usage history.');
    }
  }, [canManage, token]);

  useEffect(() => { void loadCoupons(); void loadUsages(selectedCouponId); }, [loadCoupons, loadUsages, selectedCouponId, reloadSignal]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setFormOpen(true);
  }

  function openEdit(coupon: CouponRecord) {
    setEditing(coupon);
    setForm(formFromCoupon(coupon));
    setFormError('');
    setFormOpen(true);
  }

  async function saveCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('save'); setFormError('');
    try {
      const body = {
        code: form.code,
        discount_type: form.discount_type,
        discount_value: Number(form.discount_value),
        applicable_franchise_model: form.applicable_franchise_model,
        applicable_payment_phase: form.applicable_payment_phase,
        minimum_payment_amount: Number(form.minimum_payment_amount),
        valid_from: form.valid_from,
        valid_until: form.valid_until,
        max_usage_limit: Number(form.max_usage_limit),
        per_applicant_usage_limit: Number(form.per_applicant_usage_limit),
        is_active: form.is_active,
      };
      const response = await fetch(`${API_BASE}/admin/coupons${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (isOfficerSessionExpired(response)) return;
      const payload = await response.json().catch(() => null) as { success?: boolean; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to save this coupon.');
      setFormOpen(false);
      notify(editing ? 'Coupon updated successfully.' : 'Coupon created successfully.');
      await loadCoupons();
      await loadUsages(selectedCouponId);
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'Unable to save this coupon.');
    } finally {
      setBusy('');
    }
  }

  async function deactivateCoupon(coupon: CouponRecord) {
    setBusy(`deactivate:${coupon.id}`);
    try {
      const response = await fetch(`${API_BASE}/admin/coupons/${coupon.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      });
      if (isOfficerSessionExpired(response)) return;
      const payload = await response.json().catch(() => null) as { success?: boolean; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to deactivate this coupon.');
      notify(`${coupon.code} deactivated.`);
      await loadCoupons();
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : 'Unable to deactivate this coupon.');
    } finally {
      setBusy('');
    }
  }

  if (!canManage) {
    return <section className="panel data-panel"><div className="panel-head"><div><h2>Coupon codes</h2><p>Only administrators and accountants can create and manage coupon codes.</p></div></div></section>;
  }

  return <>
    <section className="panel data-panel coupon-panel">
      <div className="panel-head">
        <div><h2>Coupon codes</h2><p>Create, edit, deactivate, and review coupon performance and redemption history.</p></div>
        <button type="button" onClick={openCreate}>Create coupon code</button>
      </div>
      <div className="module-summary coupon-summary">
        <section><span>Active coupons</span><b>{coupons.filter((coupon) => coupon.is_active).length}</b><small>Available for applicant redemption</small></section>
        <section><span>Total redemptions</span><b>{coupons.reduce((sum, coupon) => sum + coupon.uses_count, 0)}</b><small>Completed payment transactions</small></section>
        <section><span>Total discount given</span><b>{formatAmount(coupons.reduce((sum, coupon) => sum + coupon.total_discount_given, 0))}</b><small>Across all coupon campaigns</small></section>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Coupon code</th><th>Discount</th><th>Model</th><th>Payment phase</th><th>Validity</th><th>Usage</th><th>Status</th><th /></tr></thead>
          <tbody>
            {error ? <tr><td colSpan={8} className="empty">{error}</td></tr> : null}
            {!error ? visibleCoupons.map((coupon) => <tr key={coupon.id}>
              <td><b>{coupon.code}</b>{coupon.has_completed_usage ? <small>Locked terms after use</small> : null}</td>
              <td>{coupon.discount_type === 'percent' ? `${coupon.discount_value}%` : formatAmount(coupon.discount_value)}</td>
              <td>{coupon.applicable_franchise_model === 'both' ? 'Both' : coupon.applicable_franchise_model}</td>
              <td>{coupon.applicable_payment_phase_label}</td>
              <td>{coupon.valid_from} → {coupon.valid_until}</td>
              <td>{coupon.uses_count}{coupon.max_usage_limit > 0 ? ` / ${coupon.max_usage_limit}` : ' / ∞'}</td>
              <td><span className={`payment-status ${coupon.is_active ? 'paid' : 'locked'}`}>{coupon.is_active ? 'Active' : 'Inactive'}</span></td>
              <td className="coupon-row-actions">
                <button className="row-action" type="button" onClick={() => setSelectedCouponId(coupon.id)}>Usage</button>
                <button className="row-action" type="button" onClick={() => openEdit(coupon)}>Edit</button>
                {coupon.is_active ? <button className="row-action" type="button" disabled={busy === `deactivate:${coupon.id}`} onClick={() => void deactivateCoupon(coupon)}>Deactivate</button> : null}
              </td>
            </tr>) : null}
            {!loading && !error && visibleCoupons.length === 0 ? <tr><td colSpan={8} className="empty">No coupon codes match this search.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>

    <section className="panel data-panel">
      <div className="panel-head">
        <div><h2>Coupon usage history</h2><p>{selectedCoupon ? `Redemptions for ${selectedCoupon.code}` : 'All coupon redemptions across applicants and payment phases.'}</p></div>
        {selectedCouponId ? <button type="button" onClick={() => setSelectedCouponId('')}>Show all</button> : null}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Coupon</th><th>Applicant</th><th>Application ID</th><th>Payment phase</th><th>Original</th><th>Discount</th><th>Final</th><th>Redeemed</th><th>Status</th></tr></thead>
          <tbody>
            {visibleUsages.map((usage) => <tr key={usage.id}>
              <td><b>{usage.coupon_code}</b></td>
              <td>{usage.applicant_name}</td>
              <td>{usage.application_number}</td>
              <td>{usage.payment_phase}</td>
              <td>{formatAmount(usage.original_amount)}</td>
              <td>{formatAmount(usage.discount_amount)}</td>
              <td>{formatAmount(usage.final_amount)}</td>
              <td>{displayDate(usage.redeemed_at)}</td>
              <td><span className={`payment-status ${usage.transaction_status === 'completed' ? 'paid' : 'due'}`}>{usage.transaction_status}</span></td>
            </tr>)}
            {!visibleUsages.length ? <tr><td colSpan={9} className="empty">No coupon redemptions recorded yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>

    {formOpen ? <CouponFormModal
      title={editing ? `Edit ${editing.code}` : 'Create coupon code'}
      form={form}
      lockedFields={editing?.locked_fields ?? []}
      busy={busy === 'save'}
      error={formError}
      onChange={setForm}
      onClose={() => setFormOpen(false)}
      onSubmit={(event) => void saveCoupon(event)}
    /> : null}
  </>;
}
