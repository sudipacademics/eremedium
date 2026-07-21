import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, Booking } from '../api';
import { useLiveRefresh } from '../hooks/useLiveRefresh';

type LabResult = {
  analyte_test_name?: string;
  numeric_result_value?: number | string;
  unit_of_measure?: string;
  reference_range?: string;
  abnormal_flag?: string;
};

export function BookingDetailPage() {
  const { trfId = '' } = useParams();
  const [trf, setTrf] = useState<Booking | null>(null);
  const [results, setResults] = useState<LabResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!trfId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getTrfDetail(trfId);
      setTrf(res.data.trf);
      setResults((res.data.results as LabResult[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load booking');
    } finally {
      setLoading(false);
    }
  }, [trfId]);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh(load);

  if (loading && !trf) {
    return <p className="muted">Loading booking…</p>;
  }

  if (error || !trf) {
    return (
      <>
        <div className="error">{error || 'Booking not found'}</div>
        <Link to="/bookings">← Back to bookings</Link>
      </>
    );
  }

  return (
    <>
      <Link to="/bookings" className="muted">
        ← Back to bookings
      </Link>
      <h1 style={{ marginTop: 12 }}>TRF {trf.trf_id}</h1>
      <span className="badge badge-lg">{trf.order_status}</span>

      <section className="card card-wide" style={{ marginTop: 16 }}>
        <dl className="detail-list">
          <div>
            <dt>Patient</dt>
            <dd>{trf.patient_name}</dd>
          </div>
          <div>
            <dt>Barcode</dt>
            <dd>{trf.barcode}</dd>
          </div>
          <div>
            <dt>Test</dt>
            <dd>{trf.test_name || trf.test_labels?.join(', ') || trf.test_required}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd>₹{Number(trf.amount || 0).toFixed(0)}</dd>
          </div>
          <div>
            <dt>Payment</dt>
            <dd>{trf.razorpay_payment_status || 'Pending'}</dd>
          </div>
          {trf.collection_slot && (
            <div>
              <dt>Collection slot</dt>
              <dd>{trf.collection_slot}</dd>
            </div>
          )}
          {trf.collection_address && (
            <div>
              <dt>Address</dt>
              <dd>{trf.collection_address}</dd>
            </div>
          )}
        </dl>
      </section>

      {results.length > 0 && (
        <section className="card card-wide">
          <h2>Lab results</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Value</th>
                  <th>Ref</th>
                  <th>Flag</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td>{r.analyte_test_name}</td>
                    <td>
                      {r.numeric_result_value} {r.unit_of_measure}
                    </td>
                    <td>{r.reference_range}</td>
                    <td>{r.abnormal_flag}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Link className="btn secondary" to="/journey" style={{ marginTop: 16 }}>
        View full care journey
      </Link>
    </>
  );
}
