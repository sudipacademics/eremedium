import { CatalogItem, itemDiscountPercent, itemMrp, itemRate } from '../api';

type Props = {
  item: CatalogItem;
  size?: 'sm' | 'md';
  /** Hide wallet earn chip (e.g. dense lists) */
  compact?: boolean;
};

export function PriceTag({ item, size = 'md', compact = false }: Props) {
  const rate = itemRate(item);
  const mrp = itemMrp(item);
  const discount = itemDiscountPercent(item);
  const hasDiscount = mrp > rate && discount > 0;
  const basis = item.price_basis || (item.foco_rate && item.foco_rate > 0 ? 'foco' : 'ten_percent');
  const dealLabel =
    basis === 'foco' ? 'FOCO Deal' : hasDiscount ? `${discount}% OFF` : null;
  const walletEarn =
    item.wallet_earn_amount ??
    (item.wallet_earn_percent ? (rate * item.wallet_earn_percent) / 100 : rate * 0.1);

  return (
    <div className={`price-tag price-tag-offer ${size === 'sm' ? 'price-tag-sm' : ''}`}>
      <div className="price-tag-row">
        {hasDiscount && (
          <span className="price-slash-wrap" aria-label={`Was ₹${mrp.toFixed(0)}`}>
            <span className="price-mrp">₹{mrp.toFixed(0)}</span>
            <span className="price-slash" aria-hidden />
          </span>
        )}
        <span className="price-sale">₹{rate.toFixed(0)}</span>
        {dealLabel && (
          <span className={`price-deal ${basis === 'foco' ? 'price-deal-foco' : 'price-deal-pct'}`}>
            {dealLabel}
          </span>
        )}
      </div>
      {!compact && (
        <div className="price-tag-chips">
          {item.member_tag && <span className="price-member">{item.member_tag}</span>}
          {item.coupon_label && item.coupon_label !== item.member_tag && (
            <span className="price-coupon">{item.coupon_label}</span>
          )}
          {walletEarn > 0 && (
            <span className="price-wallet">+₹{walletEarn.toFixed(0)} wallet</span>
          )}
        </div>
      )}
    </div>
  );
}
