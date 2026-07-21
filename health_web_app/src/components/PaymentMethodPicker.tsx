export type PaymentMethod = 'Online' | 'Cash on Delivery' | 'Pay at Hub';

type Variant = 'default' | 'doctor';

const OPTION_LABELS: Record<PaymentMethod, string> = {
  Online: 'Pay online',
  'Cash on Delivery': 'Cash on delivery',
  'Pay at Hub': 'Pay at collection centre',
};

const HINTS: Record<Variant, Record<PaymentMethod, string>> = {
  default: {
    Online: 'Secure checkout with Razorpay',
    'Cash on Delivery': 'Pay when the phlebotomist collects your sample',
    'Pay at Hub': 'Pay the franchisee when you visit the hub',
  },
  doctor: {
    Online: 'Secure checkout with Razorpay',
    'Cash on Delivery': 'Pay in cash when you arrive for your appointment',
    'Pay at Hub': 'Pay at the franchise reception before your consultation',
  },
};

type Props = {
  value: PaymentMethod;
  onChange: (value: PaymentMethod) => void;
  variant?: Variant;
};

export function isOnlinePayment(method?: string | null) {
  return !method || method === 'Online';
}

export function paymentMethodLabel(method?: string | null) {
  if (!method || method === 'Online') return 'Online';
  return method;
}

export function PaymentMethodPicker({ value, onChange, variant = 'default' }: Props) {
  const hints = HINTS[variant];
  const methods = Object.keys(OPTION_LABELS) as PaymentMethod[];

  return (
    <fieldset className="payment-method-picker">
      <legend>Payment method</legend>
      {methods.map((method) => (
        <label key={method} className="payment-option">
          <input
            type="radio"
            name="payment_method"
            value={method}
            checked={value === method}
            onChange={() => onChange(method)}
          />
          <span className="payment-option-body">
            <strong>{OPTION_LABELS[method]}</strong>
            <span className="muted">{hints[method]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
