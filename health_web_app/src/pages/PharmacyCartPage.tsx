import { Link } from 'react-router-dom';
import { CouponField } from '../components/CouponField';
import { useCart } from '../cart/CartContext';

export function PharmacyCartPage() {
  const { lines, subtotal, total, count, coupon, setCoupon, updateQty, removeItem } = useCart();

  if (count === 0) {
    return (
      <section className="card card-wide">
        <h1>Shopping cart</h1>
        <p className="muted">Your cart is empty.</p>
        <Link className="btn" to="/pharmacy">
          Browse pharmacy
        </Link>
      </section>
    );
  }

  const discount = coupon?.discount_amount || 0;

  return (
    <>
      <div className="toolbar">
        <h1>Shopping cart ({count} items)</h1>
        <Link className="btn secondary" to="/pharmacy">
          Add more
        </Link>
      </div>

      <section className="card card-wide">
        {lines.map((line) => (
          <div key={line.itemCode} className="cart-line">
            <div>
              <strong>{line.itemName}</strong>
              <div className="muted">₹{line.rate.toFixed(0)} each</div>
            </div>
            <div className="cart-line-actions">
              <button
                className="btn secondary btn-sm"
                type="button"
                onClick={() => updateQty(line.itemCode, line.qty - 1)}
              >
                −
              </button>
              <span>{line.qty}</span>
              <button
                className="btn secondary btn-sm"
                type="button"
                onClick={() => updateQty(line.itemCode, line.qty + 1)}
              >
                +
              </button>
              <button
                className="btn secondary btn-sm"
                type="button"
                onClick={() => removeItem(line.itemCode)}
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        <CouponField
          subtotal={subtotal}
          context="pharmacy"
          value={coupon}
          onChange={setCoupon}
        />

        <div className="cart-summary">
          <div className="cart-summary-row">
            <span>Subtotal</span>
            <span>₹{subtotal.toFixed(0)}</span>
          </div>
          {discount > 0 ? (
            <div className="cart-summary-row discount">
              <span>Coupon {coupon?.promo_code}</span>
              <span>−₹{discount.toFixed(0)}</span>
            </div>
          ) : null}
          <div className="cart-summary-row total">
            <strong>Total</strong>
            <strong>₹{total.toFixed(0)}</strong>
          </div>
        </div>

        <div className="cart-footer">
          <Link className="btn" to="/pharmacy/checkout">
            Checkout · ₹{total.toFixed(0)}
          </Link>
        </div>
      </section>
    </>
  );
}
