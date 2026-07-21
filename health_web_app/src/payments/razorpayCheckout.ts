import { api } from '../api';

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void; on: (event: string, cb: () => void) => void };
  }
}

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  order_id: string;
  handler: (response: RazorpayPaymentResponse) => void;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
};

type RazorpayPaymentResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

export type PayOrderInput = {
  referenceDoctype: 'Customer TRF' | 'Pharmacy Order' | 'Doctor Appointment' | 'Health Subscription';
  referenceName: string;
  amount: number;
  customerName?: string;
  email?: string;
  phone?: string;
};

let scriptPromise: Promise<void> | null = null;

function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-razorpay-checkout]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Razorpay')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.razorpayCheckout = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Razorpay checkout'));
    document.body.appendChild(script);
  });
  return scriptPromise;
}

async function verifyTestPayment(input: PayOrderInput, orderId: string) {
  await api.verifyRazorpayPayment({
    razorpay_payment_id: `pay_test_${input.referenceName}`,
    razorpay_order_id: orderId,
    razorpay_signature: 'test_mode',
    reference_doctype: input.referenceDoctype,
    reference_name: input.referenceName,
  });
}

export async function payWithRazorpay(input: PayOrderInput): Promise<void> {
  const orderRes = await api.createRazorpayOrder({
    reference_doctype: input.referenceDoctype,
    reference_name: input.referenceName,
    amount: input.amount,
  });
  const order = orderRes.data;

  if (order.test_mode) {
    await verifyTestPayment(input, order.order_id);
    return;
  }

  if (!order.razorpay_key_id || !order.order_id) {
    throw new Error('Payment is not configured on the server');
  }

  await loadRazorpayScript();
  if (!window.Razorpay) {
    throw new Error('Razorpay checkout unavailable');
  }

  await new Promise<void>((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: order.razorpay_key_id!,
      amount: order.amount_paise,
      currency: order.currency || 'INR',
      name: 'Health Ecosystem',
      description: `${input.referenceDoctype} ${input.referenceName}`,
      order_id: order.order_id,
      prefill: {
        name: input.customerName,
        email: input.email,
        contact: input.phone,
      },
      theme: { color: '#0d9488' },
      handler: async (response) => {
        try {
          await api.verifyRazorpayPayment({
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_signature: response.razorpay_signature,
            reference_doctype: input.referenceDoctype,
            reference_name: input.referenceName,
          });
          resolve();
        } catch (e) {
          reject(e);
        }
      },
      modal: {
        ondismiss: () => reject(new Error('Payment cancelled')),
      },
    });
    rzp.on('payment.failed', () => reject(new Error('Payment failed')));
    rzp.open();
  });
}

/** B2B wallet recharge via Razorpay (Phase 23 — dedicated wallet order/verify). */
export async function payB2bWalletRecharge(input: {
  amount: number;
}): Promise<{ amount: number; wallet_balance: number }> {
  const order = await api.createB2bWalletRazorpayOrder({ amount: input.amount });

  if (order.data.test_mode) {
    const verified = await api.verifyB2bWalletRazorpayPayment({
      razorpay_payment_id: `pay_test_${order.data.order_id}`,
      razorpay_order_id: order.data.order_id,
      razorpay_signature: 'test_mode',
    });
    return { amount: input.amount, wallet_balance: Number(verified.data?.wallet_balance || 0) };
  }

  if (!order.data.razorpay_key_id || !order.data.order_id) {
    throw new Error('Payment is not configured on the server');
  }

  await loadRazorpayScript();
  if (!window.Razorpay) {
    throw new Error('Razorpay checkout unavailable');
  }
  await new Promise<void>((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: order.data.razorpay_key_id!,
      amount: order.data.amount_paise,
      currency: order.data.currency || 'INR',
      name: 'Health Ecosystem',
      description: 'B2B wallet recharge',
      order_id: order.data.order_id,
      theme: { color: '#0d9488' },
      handler: async (response) => {
        try {
          await api.verifyB2bWalletRazorpayPayment({
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_signature: response.razorpay_signature,
          });
          resolve();
        } catch (e) {
          reject(e);
        }
      },
      modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
    });
    rzp.on('payment.failed', () => reject(new Error('Payment failed')));
    rzp.open();
  });
  const wallet = await api.getB2bWallet();
  return { amount: input.amount, wallet_balance: Number(wallet.data?.wallet_balance || 0) };
}
