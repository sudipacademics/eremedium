import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Booking } from '../../api';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';

export function BookingsTable({ title }: { title?: string }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
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

  return (
    <section className="card card-wide">
      <div className="toolbar">
        <h2>{title || 'Recent bookings'}</h2>
        <button className="btn secondary btn-sm" type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>
      {error && <div className="error">{error}</div>}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
