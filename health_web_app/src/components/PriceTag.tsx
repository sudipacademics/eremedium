import { CatalogItem, itemDiscountPercent, itemMrp, itemRate } from '../api';

type Props = {
  item: CatalogItem;
  size?: 'sm' | 'md';
};

export function PriceTag({ item, size = 'md' }: Props) {
  const rate = itemRate(item);
  const mrp = itemMrp(item);
  const discount = itemDiscountPercent(item);
  const hasDiscount = mrp > rate && discount > 0;

  return (
    <div className={`price-tag ${size === 'sm' ? 'price-tag-sm' : ''}`}>
      {hasDiscount && <span className="price-mrp">₹{mrp.toFixed(0)}</span>}
      <span className="price-sale">₹{rate.toFixed(0)}</span>
      {hasDiscount && <span className="price-off">{discount}% off</span>}
      {item.coupon_label && <span className="price-coupon">{item.coupon_label}</span>}
    </div>
  );
}
