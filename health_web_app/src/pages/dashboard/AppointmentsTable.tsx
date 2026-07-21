import { useCallback, useEffect, useState } from 'react';
import { api, Appointment } from '../../api';
import { MarkOfflinePaymentButton } from '../../components/MarkOfflinePaymentButton';
import { isOnlinePayment, paymentMethodLabel } from '../../components/PaymentMethodPicker';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';

export function AppointmentsTable({ title }: { title?: string }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMyAppointments();
      setAppointments(res.data.appointments || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load appointments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh(load);

  return (
    <section className="card card-wide">
      <div className="toolbar">
        <h2>{title || 'Doctor appointments'}</h2>
        <button className="btn secondary btn-sm" type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading…</p>}
      {!loading && appointments.length === 0 && <p className="muted">No appointments in your scope yet.</p>}
      {appointments.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Doctor</th>
                <th>When</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.name}>
                  <td>{a.patient_name}</td>
                  <td>{a.practitioner_name || '—'}</td>
                  <td>
                    {a.appointment_date}
                    {a.appointment_time ? ` · ${String(a.appointment_time).slice(0, 5)}` : ''}
                  </td>
                  <td>
                    <span className="badge">{a.status}</span>
                  </td>
                  <td>
                    {paymentMethodLabel(a.payment_method)}
                    {a.razorpay_payment_status ? ` · ${a.razorpay_payment_status}` : ''}
                  </td>
                  <td>₹{Number(a.amount || 0).toFixed(0)}</td>
                  <td>
                    {!isOnlinePayment(a.payment_method) &&
                      a.razorpay_payment_status !== 'Paid' &&
                      Number(a.amount || 0) > 0 && (
                        <MarkOfflinePaymentButton
                          referenceDoctype="Doctor Appointment"
                          referenceName={a.name}
                          label={
                            a.payment_method === 'Cash on Delivery' ? 'Cash received' : 'Payment received'
                          }
                          onSuccess={() => void load()}
                        />
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
