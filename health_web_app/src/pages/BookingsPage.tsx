import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Appointment, Booking, PharmacyOrder } from '../api';
import { useLiveRefresh } from '../hooks/useLiveRefresh';

export function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [orders, setOrders] = useState<PharmacyOrder[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bookingsRes, ordersRes, apptRes] = await Promise.all([
        api.getMyBookings(),
        api.getMyPharmacyOrders(),
        api.getMyAppointments(),
      ]);
      setBookings(bookingsRes.data.bookings || []);
      setOrders(ordersRes.data.orders || []);
      setAppointments(apptRes.data.appointments || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh(load, 15000);

  return (
    <>
      <section className="page-intro">
        <div className="section-head">
          <div>
            <h1>My orders</h1>
            <p className="section-sub">Lab TRFs, doctor appointments, and Rx quote requests — refresh for live status.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link className="btn secondary" to="/journey">
              Care journey
            </Link>
            <button className="btn secondary btn-sm" type="button" onClick={() => void load()} disabled={loading}>
              Refresh
            </button>
          </div>
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      <section className="card card-wide orders-section">
        <h2>Doctor appointments</h2>
        {!loading && appointments.length === 0 && <p className="muted">No appointments yet.</p>}
        {appointments.map((a) => (
          <div key={a.name} className="list-link static">
            <div>
              <strong>{a.practitioner_name || 'Doctor'}</strong>
              <div className="muted">
                {a.appointment_date} {a.appointment_time ? `· ${String(a.appointment_time).slice(0, 5)}` : ''}
              </div>
            </div>
            <span className="badge">{a.status}</span>
          </div>
        ))}
      </section>

      <section className="card card-wide">
        <h2>Lab bookings</h2>
        {loading && <p className="muted">Loading…</p>}
        {!loading && bookings.length === 0 && <p className="muted">No lab bookings yet.</p>}
        {bookings.map((b) => (
          <Link key={b.trf_id} to={`/bookings/${encodeURIComponent(b.trf_id)}`} className="list-link">
            <div>
              <strong>{b.test_name || b.test_labels?.join(', ') || b.trf_id}</strong>
              <div className="muted">
                {b.patient_name} · {b.barcode}
              </div>
            </div>
            <span className="badge">{b.order_status}</span>
          </Link>
        ))}
      </section>

      <section className="card card-wide">
        <h2>Pharmacy orders</h2>
        {!loading && orders.length === 0 && (
          <p className="muted">No pharmacy orders found for your account. Use the same name/phone as checkout.</p>
        )}
        {orders.map((o) => (
          <div key={o.name} className="list-link static">
            <div>
              <strong>{o.name}</strong>
              <div className="muted">{o.customer_name}</div>
              {(o.items || []).length > 0 && (
                <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
                  {(o.items || [])
                    .map((i) => `${i.item_name || i.item_code} ×${i.qty || 1}`)
                    .join(', ')}
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className="badge">{o.delivery_status || 'Pending'}</span>
              <div className="muted">₹{Number(o.order_total || 0).toFixed(0)}</div>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
