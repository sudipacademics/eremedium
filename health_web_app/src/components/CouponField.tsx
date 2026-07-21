import { FormEvent, useState } from 'react';
import { api, CouponResult } from '../api';

type Props = {
  subtotal: number;
  context: 'pharmacy' | 'lab';
  value: CouponResult | null;
  onChange: (coupon: CouponResult | null) => void;
};

export function CouponField({ subtotal, context, value, onChange }: Props) {
  const [code, setCode] = useState(value?.promo_code || '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onApply(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      onChange(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.validateCoupon(trimmed, subtotal, context);
      onChange(res.data);
    } catch (err) {
      onChange(null);
      setError(err instanceof Error ? err.message : 'Invalid coupon');
    } finally {
      setLoading(false);
    }
  }

  function onRemove() {
    setCode('');
    setError(null);
    onChange(null);
  }

  return (
    <div className="coupon-field">
      <form className="coupon-row" onSubmit={onApply}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Coupon code (e.g. HEALTH25)"
          aria-label="Coupon code"
        />
        <button className="btn secondary" type="submit" disabled={loading || subtotal <= 0}>
          {loading ? '…' : 'Apply'}
        </button>
      </form>
      {value ? (
        <div className="coupon-applied">
          <span>
            <strong>{value.promo_code}</strong> — saved ₹{value.discount_amount.toFixed(0)}
          </span>
          <button type="button" className="btn-link" onClick={onRemove}>
            Remove
          </button>
        </div>
      ) : null}
      {error ? <div className="error coupon-error">{error}</div> : null}
    </div>
  );
}
