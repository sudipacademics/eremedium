import { useCallback, useEffect, useState } from 'react';

import { api, Booking, Franchisee, PhleboMapData } from '../../api';
import { MarkOfflinePaymentButton } from '../../components/MarkOfflinePaymentButton';
import { PhlebotomistMap } from '../../components/PhlebotomistMap';
import { paymentMethodLabel } from '../../components/PaymentMethodPicker';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { hubCheckinWithGps, usePhleboGps } from '../../hooks/usePhleboGps';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { useViewMode } from '../../hooks/useViewMode';

function CollectionOrderCard({
  order,
  acting,
  onCollect,
  onRefresh,
}: {
  order: Booking;
  acting: string | null;
  onCollect: (trfId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <article className="card collection-card">
      <div className="collection-card-head">
        <strong>{order.patient_name}</strong>
        <span className="badge">{order.order_status}</span>
      </div>
      <p className="muted payment-badge">
        {paymentMethodLabel(order.payment_method)}
        {order.razorpay_payment_status ? ` · ${order.razorpay_payment_status}` : ''}
      </p>
      <p className="muted">
        <a href={`tel:${order.patient_phone || ''}`}>{order.patient_phone || 'No phone'}</a>
      </p>
      <p className="collection-test">{order.test_name || order.test_labels?.join(', ') || order.test_required}</p>
      <p className="collection-address">{order.collection_address || 'No address'}</p>
      {order.collection_slot && (
        <p className="muted">Slot: {String(order.collection_slot).replace('T', ' ').slice(0, 16)}</p>
      )}
      <div className="barcode-block">
        <span className="muted">Barcode</span>
        <code className="barcode-value">{order.barcode || order.trf_id}</code>
      </div>
      {order.order_status === 'Booked' && (
        <button
          className="btn"
          type="button"
          disabled={acting === order.trf_id}
          onClick={() => onCollect(order.trf_id)}
        >
          {acting === order.trf_id ? 'Updating…' : 'Sample collected'}
        </button>
      )}
      {order.payment_method === 'Cash on Delivery' && order.razorpay_payment_status !== 'Paid' && (
        <MarkOfflinePaymentButton
          referenceDoctype="Customer TRF"
          referenceName={order.trf_id}
          label="Cash received"
          className="btn secondary"
          onSuccess={onRefresh}
        />
      )}
    </article>
  );
}

const DUTY_KEY = 'hec_phlebo_on_duty';

function loadOnDuty(): boolean {
  try {
    return localStorage.getItem(DUTY_KEY) === '1';
  } catch {
    return false;
  }
}

export function PhlebotomistDashboard() {
  const [orders, setOrders] = useState<Booking[]>([]);
  const [franchisee, setFranchisee] = useState<Franchisee | null>(null);
  const [mapData, setMapData] = useState<PhleboMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [checkinMsg, setCheckinMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [onDuty, setOnDuty] = useState(loadOnDuty);
  const [viewMode, setViewMode] = useViewMode('phlebo-view-mode');

  usePhleboGps(onDuty);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPhlebotomistQueue();
      setOrders(res.data.orders || []);
      setFranchisee(res.data.franchisee || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load collection queue');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMap = useCallback(async () => {
    setMapError(null);
    try {
      const res = await api.getPhlebotomistMapData();
      setMapData(res.data);
    } catch (e) {
      setMapError(e instanceof Error ? e.message : 'Failed to load map');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (viewMode !== 'map') return;
    void loadMap();
  }, [viewMode, loadMap]);

  useLiveRefresh(() => {
    void load();
    if (viewMode === 'map') void loadMap();
  }, 30000);

  useEffect(() => {
    localStorage.setItem(DUTY_KEY, onDuty ? '1' : '0');
  }, [onDuty]);

  async function markCollected(trfId: string) {
    setActing(trfId);
    setError(null);
    try {
      await api.markSampleCollected(trfId);
      await load();
      if (viewMode === 'map') await loadMap();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update status');
    } finally {
      setActing(null);
    }
  }

  async function onHubCheckin() {
    setCheckinLoading(true);
    setCheckinMsg(null);
    setError(null);
    try {
      const msg = await hubCheckinWithGps();
      setCheckinMsg(msg);
      setOnDuty(true);
      await loadMap();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check-in failed');
    } finally {
      setCheckinLoading(false);
    }
  }

  const routeKm = mapData?.route?.distance_m ? (mapData.route.distance_m / 1000).toFixed(1) : null;
  const routeMin = mapData?.route?.duration_s ? Math.round(mapData.route.duration_s / 60) : null;

  return (
    <>
      <section className="hero hero-compact">
        <h1>Sample collections</h1>
        <p>
          {franchisee
            ? `${franchisee.franchise_name} (${franchisee.branch_code}) — home visits assigned to your hub`
            : 'Orders assigned to your franchise hub appear here when customers book diagnostics.'}
        </p>
      </section>

      <div className="phlebo-gps-bar card">
        <label className="phlebo-duty-toggle">
          <input type="checkbox" checked={onDuty} onChange={(e) => setOnDuty(e.target.checked)} />
          <span>On duty — share live GPS (updates every 60s)</span>
        </label>
        <button className="btn secondary btn-sm" type="button" disabled={checkinLoading} onClick={() => void onHubCheckin()}>
          {checkinLoading ? 'Checking in…' : 'Check in at hub'}
        </button>
      </div>
      {checkinMsg && <p className="muted phlebo-checkin-msg">{checkinMsg}</p>}

      <div className="toolbar">
        <h2>Collection queue</h2>
        <div className="toolbar-actions">
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          <button className="btn secondary btn-sm" type="button" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && viewMode !== 'map' && <p className="muted">Loading orders…</p>}

      {viewMode === 'map' && (
        <section className="phlebo-map-section">
          {mapError && <div className="error">{mapError}</div>}
          {routeKm && routeMin && (
            <p className="muted phlebo-route-summary">
              Suggested route: ~{routeKm} km · ~{routeMin} min driving (booked stops)
            </p>
          )}
          <PhlebotomistMap data={mapData} />
          {!mapData?.stops?.length && !loading && (
            <p className="muted">No geocoded collection addresses yet — patients should use GPS when booking.</p>
          )}
        </section>
      )}

      {viewMode === 'cards' && (
        <>
          {!loading && orders.length === 0 && (
            <p className="muted">No pending collections. New bookings at your hub will appear here automatically.</p>
          )}
          <div className="collection-grid">
            {orders.map((o) => (
              <CollectionOrderCard
                key={o.trf_id}
                order={o}
                acting={acting}
                onCollect={(id) => void markCollected(id)}
                onRefresh={() => void load()}
              />
            ))}
          </div>
        </>
      )}

      {viewMode === 'list' && (
        <>
          {!loading && orders.length === 0 && (
            <p className="muted">No pending collections. New bookings at your hub will appear here automatically.</p>
          )}
          <div className="table-wrap">
            <table className="data-table collection-list-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Phone</th>
                  <th>Test</th>
                  <th>Address</th>
                  <th>Barcode</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.trf_id}>
                    <td>{o.patient_name}</td>
                    <td>
                      <a href={`tel:${o.patient_phone || ''}`}>{o.patient_phone || '—'}</a>
                    </td>
                    <td>{o.test_name || o.test_labels?.join(', ') || o.test_required}</td>
                    <td className="collection-address-cell">{o.collection_address || '—'}</td>
                    <td>
                      <code className="barcode-value">{o.barcode || o.trf_id}</code>
                    </td>
                    <td>
                      <span className="muted">
                        {paymentMethodLabel(o.payment_method)}
                        {o.razorpay_payment_status ? ` · ${o.razorpay_payment_status}` : ''}
                      </span>
                    </td>
                    <td>
                      <span className="badge">{o.order_status}</span>
                    </td>
                    <td>
                      {o.order_status === 'Booked' && (
                        <button
                          className="btn btn-sm"
                          type="button"
                          disabled={acting === o.trf_id}
                          onClick={() => void markCollected(o.trf_id)}
                        >
                          {acting === o.trf_id ? '…' : 'Sample collected'}
                        </button>
                      )}
                      {o.payment_method === 'Cash on Delivery' && o.razorpay_payment_status !== 'Paid' && (
                        <MarkOfflinePaymentButton
                          referenceDoctype="Customer TRF"
                          referenceName={o.trf_id}
                          label="Cash received"
                          className="btn secondary btn-sm"
                          onSuccess={() => void load()}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
