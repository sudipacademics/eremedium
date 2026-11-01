import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Booking } from '../../api';
import { MarkOfflinePaymentButton, type OfflinePaymentResult } from '../../components/MarkOfflinePaymentButton';
import { isOnlinePayment, paymentMethodLabel } from '../../components/PaymentMethodPicker';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';

export function BookingsTable({ title, showCollect = false }: { title?: string; showCollect?: boolean }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMyBookings();
      setBookings(res.data.bookings || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh(load);

  function onCollected(trfId: string, result: OfflinePaymentResult) {
    const billing = result?.hub_billing;
    if (billing?.status === 'pending') {
      setNotice(
        `${trfId}: payment recorded. Your wallet did not cover the platform fee yet; it will be charged automatically after you recharge the wallet.`,
      );
    } else if (billing?.status === 'billed') {
      const fee = Number(billing.wholesale_amount || 0);
      setNotice(`${trfId}: payment recorded.${fee > 0 ? ` Platform fee ₹${fee.toFixed(0)} taken from your wallet.` : ''}`);
    } else {
      setNotice(`${trfId}: payment recorded.`);
    }
    void load();
  }

  return (
    <section className="card card-wide">
      <div className="toolbar">
        <h2>{title || 'Recent bookings'}</h2>
        <button className="btn secondary btn-sm" type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {notice && <p className="alert">{notice}</p>}
      {loading && <p className="muted">Loading…</p>}
      {!loading && bookings.length === 0 && <p className="muted">No bookings in your scope yet.</p>}
      {bookings.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>TRF</th>
                <th>Patient</th>
                <th>Test</th>
                <th>Status</th>
                <th>Amount</th>
                {showCollect && <th>Payment</th>}
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.trf_id}>
                  <td>
                    <Link to={`/bookings/${encodeURIComponent(b.trf_id)}`}>{b.trf_id}</Link>
                  </td>
                  <td>{b.patient_name}</td>
                  <td>{b.test_name || b.test_labels?.join(', ') || b.test_required}</td>
                  <td>
                    <span className="badge">{b.order_status}</span>
                  </td>
                  <td>₹{Number(b.amount || 0).toFixed(0)}</td>
                  {showCollect && (
                    <td>
                      {paymentMethodLabel(b.payment_method)}
                      {b.razorpay_payment_status ? ` · ${b.razorpay_payment_status}` : ''}
                      {!isOnlinePayment(b.payment_method) &&
                        b.razorpay_payment_status !== 'Paid' &&
                        b.order_status !== 'Cancelled' &&
                        Number(b.amount || 0) > 0 && (
                          <MarkOfflinePaymentButton
                            referenceDoctype="Customer TRF"
                            referenceName={b.trf_id}
                            label="Payment received"
                            onSuccess={(result) => onCollected(b.trf_id, result)}
                          />
                        )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
