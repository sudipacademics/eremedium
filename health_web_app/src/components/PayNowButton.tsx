import { useState } from 'react';
import { payWithRazorpay, PayOrderInput } from '../payments/razorpayCheckout';

type Props = PayOrderInput & {
  label?: string;
  className?: string;
  onSuccess?: () => void;
};

export function PayNowButton({
  label = 'Pay now',
  className = 'btn',
  onSuccess,
  ...input
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPay() {
    setLoading(true);
    setError(null);
    try {
      await payWithRazorpay(input);
      onSuccess?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Payment failed';
      if (msg !== 'Payment cancelled') setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="report-download">
      <button className={className} type="button" disabled={loading} onClick={() => void onPay()}>
        {loading ? 'Processing…' : label}
      </button>
      {error && <p className="error error-inline">{error}</p>}
    </div>
  );
}
