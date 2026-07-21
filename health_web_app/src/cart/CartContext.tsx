import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { CatalogItem, CouponResult, itemRate } from '../api';

export type CartLine = {
  itemCode: string;
  itemName: string;
  rate: number;
  qty: number;
};

type CartContextValue = {
  lines: CartLine[];
  count: number;
  subtotal: number;
  total: number;
  coupon: CouponResult | null;
  setCoupon: (coupon: CouponResult | null) => void;
  addItem: (item: CatalogItem) => void;
  updateQty: (itemCode: string, qty: number) => void;
  removeItem: (itemCode: string) => void;
  clear: () => void;
};

const STORAGE_KEY = 'hec_pharmacy_cart';

const CartContext = createContext<CartContextValue | null>(null);

function loadCart(): CartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CartLine[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCart(lines: CartLine[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => loadCart());
  const [coupon, setCoupon] = useState<CouponResult | null>(null);

  const persist = useCallback((next: CartLine[]) => {
    setLines(next);
    saveCart(next);
  }, []);

  const addItem = useCallback(
    (item: CatalogItem) => {
      const rate = itemRate(item);
      setLines((prev) => {
        const existing = prev.find((l) => l.itemCode === item.name);
        const next = existing
          ? prev.map((l) =>
              l.itemCode === item.name ? { ...l, qty: l.qty + 1 } : l,
            )
          : [
              ...prev,
              {
                itemCode: item.name,
                itemName: item.item_name || item.name,
                rate,
                qty: 1,
              },
            ];
        saveCart(next);
        return next;
      });
    },
    [],
  );

  const updateQty = useCallback((itemCode: string, qty: number) => {
    setLines((prev) => {
      const next =
        qty <= 0
          ? prev.filter((l) => l.itemCode !== itemCode)
          : prev.map((l) => (l.itemCode === itemCode ? { ...l, qty } : l));
      saveCart(next);
      return next;
    });
  }, []);

  const removeItem = useCallback((itemCode: string) => {
    setLines((prev) => {
      const next = prev.filter((l) => l.itemCode !== itemCode);
      saveCart(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => persist([]), [persist]);

  const count = useMemo(() => lines.reduce((sum, l) => sum + l.qty, 0), [lines]);
  const subtotal = useMemo(() => lines.reduce((sum, l) => sum + l.rate * l.qty, 0), [lines]);
  const total = useMemo(
    () => Math.max(0, subtotal - (coupon?.discount_amount || 0)),
    [subtotal, coupon],
  );

  const value = useMemo<CartContextValue>(
    () => ({ lines, count, subtotal, total, coupon, setCoupon, addItem, updateQty, removeItem, clear }),
    [lines, count, subtotal, total, coupon, addItem, updateQty, removeItem, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
