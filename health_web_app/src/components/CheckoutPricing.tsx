import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, CheckoutPricing } from '../api';
import { useAuth } from '../auth/AuthContext';

type Props = {
  subtotal: number;
  context: 'pharmacy' | 'lab';
  promoCode?: string;
  className?: string;
};

export function CheckoutPricing({ subtotal, context, promoCode, className }: Props) {
  const { user } = useAuth();
  const [pricing, setPricing] = useState<CheckoutPricing | null>(null);

  useEffect(() => {
    if (!user || subtotal <= 0) {
      setPricing(null);
      return;
    }
    let cancelled = false;
    void api
      .previewCheckoutPrice(subtotal, context, promoCode)
      .then((res) => {
        if (!cancelled) setPricing(res.data);
      })
      .catch(() => {
        if (!cancelled) setPricing(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user, subtotal, context, promoCode]);

  if (!pricing?.membership_active && !pricing?.membership_discount) {
    if (pricing && pricing.final_total < subtotal) {
      return (
        <div className={`checkout-pricing ${className || ''}`}>
          <div className="price-breakdown">
            <div>
              <span>Subtotal</span>
              <span>₹{pricing.subtotal.toFixed(0)}</span>
            </div>
            <div>
              <span>You pay</span>
              <strong>₹{pricing.final_total.toFixed(0)}</strong>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div className={`checkout-pricing ${className || ''}`}>
      <div className="circle-member-badge">
        <span className="circle-dot" />
        Health Circle member · {pricing.membership_plan_title || 'Active plan'}
      </div>
      <div className="price-breakdown">
        <div>
          <span>MRP / list price</span>
          <span>₹{pricing.subtotal.toFixed(0)}</span>
        </div>
        {pricing.membership_discount > 0 ? (
          <div className="price-savings">
            <span>Circle discount ({pricing.membership_discount_percent}%)</span>
            <span>−₹{pricing.membership_discount.toFixed(0)}</span>
          </div>
        ) : null}
        {pricing.coupon_discount > 0 ? (
          <div className="price-savings">
            <span>Coupon</span>
            <span>−₹{pricing.coupon_discount.toFixed(0)}</span>
          </div>
        ) : null}
        <div>
          <span>You pay</span>
          <strong>₹{pricing.final_total.toFixed(0)}</strong>
        </div>
      </div>
      {pricing.free_home_collection && context === 'lab' ? (
        <p className="muted circle-perk">Free home collection included with your membership.</p>
      ) : null}
      {!pricing.membership_active ? (
        <p className="muted">
          <Link to="/circle">Join Health Circle</Link> to save on every order.
        </p>
      ) : null}
    </div>
  );
}

export function useCheckoutTotal(
  subtotal: number,
  context: 'pharmacy' | 'lab',
  couponFinal?: number | null,
  promoCode?: string,
) {
  const { user } = useAuth();
  const [memberTotal, setMemberTotal] = useState<number | null>(null);

  useEffect(() => {
    if (!user || subtotal <= 0) {
      setMemberTotal(null);
      return;
    }
    let cancelled = false;
    void api
      .previewCheckoutPrice(subtotal, context, promoCode)
      .then((res) => {
        if (!cancelled) setMemberTotal(res.data.final_total);
      })
      .catch(() => {
        if (!cancelled) setMemberTotal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user, subtotal, context, promoCode]);

  if (couponFinal != null) return couponFinal;
  if (memberTotal != null) return memberTotal;
  return subtotal;
}
