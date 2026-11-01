import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { api, Booking, Franchisee, PeopleHrmsDashboard, PhleboMapData } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { MarkOfflinePaymentButton } from '../../components/MarkOfflinePaymentButton';
import { MaskedCallButton } from '../../components/MaskedCallButton';
import { PhlebotomistMap } from '../../components/PhlebotomistMap';
import { paymentMethodLabel } from '../../components/PaymentMethodPicker';
import { ensureNavLocation, hubCheckinWithGps, usePhleboDuty } from '../../hooks/usePhleboGps';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { formatPatientAge } from '../../utils/patientAge';
import { mapsDirectionsUrl } from '../../utils/googleMaps';
import { PhlebotomistCollections } from './PhlebotomistCollections';
import './collector-v2.css';

const PAGE_SIZE = 10;

function Ico({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

type QueueFilter = 'all' | 'pending' | 'inroute' | 'completed' | 'cancelled';
type CollectorView = '' | 'collections' | 'map';

function collectorStatus(order: Booking, inRouteTrf?: string | null) {
  if (order.order_status === 'Cancelled') return 'cancelled';
  if (order.order_status === 'Sample Collected') return 'completed';
  if (inRouteTrf && inRouteTrf === order.trf_id) return 'inroute';
  return 'pending';
}

function statusLabel(status: string) {
  if (status === 'inroute') return 'In route';
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled') return 'Cancelled';
  return 'Pending';
}

function formatSlot(slot?: string | null) {
  if (!slot) return '—';
  const raw = String(slot).replace('T', ' ');
  const date = new Date(slot);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 16);
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function isSameDay(value: string | null | undefined, day: Date) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === day.getFullYear() &&
    date.getMonth() === day.getMonth() &&
    date.getDate() === day.getDate()
  );
}

function testLabel(order: Booking) {
  return order.test_name || order.test_labels?.join(', ') || order.test_required || 'Diagnostics';
}

function testCount(order: Booking) {
  const fromLabels = order.test_labels?.filter(Boolean).length || 0;
  if (fromLabels) return fromLabels;
  const fromTubes = order.collection_tubes?.length || 0;
  return fromTubes || 1;
}

function patientMeta(order: Booking) {
  const gender = (order.gender || '').trim();
  const age = order.age_label || formatPatientAge(order);
  if (gender && age) return `${gender} · ${age}`;
  return gender || age;
}

function mapPlaceUrl(order: Booking) {
  if (order.collection_latitude && order.collection_longitude) {
    return `https://www.google.com/maps/search/?api=1&query=${order.collection_latitude},${order.collection_longitude}`;
  }
  if (order.collection_address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.collection_address)}`;
  }
  return '';
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'CP';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function CollectionDetail({
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
    <div className="cp-detail">
      <p className="cp-muted">{paymentMethodLabel(order.payment_method)}{order.razorpay_payment_status ? ` · ${order.razorpay_payment_status}` : ''}</p>
      <p>
        Barcode <code>{order.barcode || order.trf_id}</code>
      </p>
      {order.patient_phone ? (
        <MaskedCallButton
          referenceDoctype="Customer TRF"
          referenceName={order.trf_id}
          label="Call (masked)"
          className="btn secondary btn-sm"
        />
      ) : null}
      {order.collection_tubes && order.collection_tubes.length > 0 ? (
        <ul>
          {order.collection_tubes.map((tube) => (
            <li key={tube.accession_id || `${tube.tube_code}-${tube.draw_order}`}>
              <strong>
                {tube.draw_order ?? '—'}. {tube.tube_code}
              </strong>
              {tube.cap_color ? ` · ${tube.cap_color}` : ''}
              {tube.accession_id ? ` · ${tube.accession_id}` : ''}
              {tube.status ? ` · ${tube.status}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {order.order_status === 'Booked' ? (
        <button className="cp-start" type="button" disabled={acting === order.trf_id} onClick={() => onCollect(order.trf_id)}>
          {acting === order.trf_id ? 'Updating…' : 'Sample collected'}
        </button>
      ) : null}
      {order.payment_method === 'Cash on Delivery' && order.razorpay_payment_status !== 'Paid' ? (
        <MarkOfflinePaymentButton
          referenceDoctype="Customer TRF"
          referenceName={order.trf_id}
          label="Cash received"
          className="btn secondary btn-sm"
          onSuccess={onRefresh}
        />
      ) : null}
    </div>
  );
}

export function PhlebotomistDashboard() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawView = searchParams.get('view') || '';
  const view = ((rawView === 'plan' ? '' : rawView) as CollectorView);
  const [orders, setOrders] = useState<Booking[]>([]);
  const [franchisee, setFranchisee] = useState<Franchisee | null>(null);
  const [inRouteTrf, setInRouteTrf] = useState<string | null>(null);
  const [mapData, setMapData] = useState<PhleboMapData | null>(null);
  const [people, setPeople] = useState<PeopleHrmsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [checkinMsg, setCheckinMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<QueueFilter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [onDuty] = usePhleboDuty();
  const barcodeRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPhlebotomistQueue();
      setOrders(res.data.orders || []);
      setFranchisee(res.data.franchisee || null);
      setInRouteTrf(res.data.in_route_trf || null);
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
      if (res.data.phlebotomist?.in_route_trf) {
        setInRouteTrf(res.data.phlebotomist.in_route_trf);
      }
    } catch (e) {
      setMapError(e instanceof Error ? e.message : 'Failed to load map');
    }
  }, []);

  useEffect(() => {
    void load();
    void loadMap();
    api.getPeopleHrmsDashboard().then((res) => setPeople(res.data)).catch(() => undefined);
  }, [load, loadMap]);

  useLiveRefresh(() => {
    void load();
    void loadMap();
  }, 30000);

  useEffect(() => {
    if (view === 'map' || searchParams.get('focus') === 'barcode') {
      barcodeRef.current?.focus();
    }
  }, [view, searchParams]);

  async function markCollected(trfId: string) {
    setActing(trfId);
    setError(null);
    try {
      await api.markSampleCollected(trfId);
      await load();
      await loadMap();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update status');
    } finally {
      setActing(null);
    }
  }

  async function openNavigation(order: Booking) {
    const access = await ensureNavLocation();
    if (!access.ok) {
      setError(access.message);
      return;
    }
    const dest =
      order.collection_latitude && order.collection_longitude
        ? { lat: order.collection_latitude, lng: order.collection_longitude }
        : order.collection_address || '';
    if (!dest) {
      setError('This collection has no address or map coordinates yet.');
      return;
    }
    window.open(
      mapsDirectionsUrl({
        origin: access.coords,
        destination: dest,
      }),
      '_blank',
      'noopener,noreferrer',
    );
  }

  async function startVisit(order: Booking) {
    setActing(order.trf_id);
    setError(null);
    try {
      const access = await ensureNavLocation();
      if (!access.ok) {
        setError(access.message);
        return;
      }
      await api.startPhlebotomistVisit(order.trf_id);
      setInRouteTrf(order.trf_id);
      const dest =
        order.collection_latitude && order.collection_longitude
          ? { lat: order.collection_latitude, lng: order.collection_longitude }
          : order.collection_address || '';
      if (dest) {
        window.open(
          mapsDirectionsUrl({
            origin: access.coords,
            destination: dest,
          }),
          '_blank',
          'noopener,noreferrer',
        );
      }
      await loadMap();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start visit');
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
      await loadMap();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check-in failed');
    } finally {
      setCheckinLoading(false);
    }
  }

  const today = useMemo(() => new Date(), []);
  const visibleOrders = useMemo(() => {
    return orders.filter((order) => {
      if (order.order_status === 'Booked') return true;
      return isSameDay(order.collection_slot, today) || isSameDay(order.modified, today) || isSameDay(order.creation, today);
    });
  }, [orders, today]);

  const stats = useMemo(() => {
    const assigned = visibleOrders.length;
    const completed = visibleOrders.filter((o) => collectorStatus(o, inRouteTrf) === 'completed').length;
    const pending = visibleOrders.filter((o) => collectorStatus(o, inRouteTrf) === 'pending').length;
    const inRoute = visibleOrders.filter((o) => collectorStatus(o, inRouteTrf) === 'inroute').length;
    const cancelled = visibleOrders.filter((o) => collectorStatus(o, inRouteTrf) === 'cancelled').length;
    const pct = (n: number) => (assigned ? `${Math.round((n / assigned) * 100)}%` : '0%');
    return { assigned, completed, pending, inRoute, cancelled, pct };
  }, [visibleOrders, inRouteTrf]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visibleOrders.filter((order) => {
      const status = collectorStatus(order, inRouteTrf);
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (!q) return true;
      const hay = [
        order.patient_name,
        order.patient_phone,
        order.collection_address,
        testLabel(order),
        order.barcode,
        order.trf_id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [visibleOrders, inRouteTrf, statusFilter, query]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const showingFrom = filtered.length ? (safePage - 1) * PAGE_SIZE + 1 : 0;
  const showingTo = Math.min(safePage * PAGE_SIZE, filtered.length);

  const routeKm = mapData?.route?.distance_m ? (mapData.route.distance_m / 1000).toFixed(1) : null;
  const routeMin = mapData?.route?.duration_s ? Math.round(mapData.route.duration_s / 60) : null;
  const displayName = people?.employee?.name || user?.fullName || user?.user || 'Collector';
  const hubLabel = franchisee
    ? `${franchisee.franchise_name}${franchisee.branch_code ? ` (${franchisee.branch_code})` : ''}`
    : '';
  const showHero = view !== 'map';
  const showStats = view === '';
  const showQueue = view !== 'map';
  const showAside = view === '' || view === 'map';

  function setView(next: CollectorView, extra?: Record<string, string>) {
    const params = new URLSearchParams();
    if (next) params.set('view', next);
    Object.entries(extra || {}).forEach(([key, value]) => params.set(key, value));
    setSearchParams(params);
  }

  if (view === 'collections') {
    return <PhlebotomistCollections />;
  }

  return (
    <div className="cp-page">
      {showHero ? (
        <section className="cp-hero">
          <h1>Sample Collections</h1>
          <p>
            {franchisee
              ? `Home visits assigned to you today — ${hubLabel}`
              : 'Home visits assigned to you today. Stay safe · Collect accurately · Serve better'}
          </p>
        </section>
      ) : null}

      {showStats ? (
        <div className="cp-stats">
          <article className="cp-stat">
            <div className="cp-stat-icon blue" aria-hidden>▦</div>
            <strong>{stats.assigned}</strong>
            <span>Total assigned</span>
            <small>View all</small>
          </article>
          <article className="cp-stat">
            <div className="cp-stat-icon green" aria-hidden>✓</div>
            <strong>{stats.completed}</strong>
            <span>Completed</span>
            <small>{stats.pct(stats.completed)}</small>
          </article>
          <article className="cp-stat">
            <div className="cp-stat-icon amber" aria-hidden>◷</div>
            <strong>{stats.pending}</strong>
            <span>Pending</span>
            <small>{stats.pct(stats.pending)}</small>
          </article>
          <article className="cp-stat">
            <div className="cp-stat-icon sky" aria-hidden>📍</div>
            <strong>{stats.inRoute}</strong>
            <span>In route</span>
            <small>{stats.pct(stats.inRoute)}</small>
          </article>
          <article className="cp-stat">
            <div className="cp-stat-icon rose" aria-hidden>×</div>
            <strong>{stats.cancelled}</strong>
            <span>Cancelled</span>
            <small>{stats.pct(stats.cancelled)}</small>
          </article>
        </div>
      ) : null}

      {error ? <div className="error cp-error">{error}</div> : null}
      {checkinMsg ? <p className="cp-muted">{checkinMsg}</p> : null}

      <div className={`cp-body${view === 'map' ? ' is-map' : ''}`}>
        {showQueue ? (
          <section className="cp-queue">
            <div className="cpq-head">
              <div>
                <h2>Today’s Collection Queue ({filtered.length})</h2>
                <p>Patients assigned for home sample collection today</p>
              </div>
              <div className="cpq-head-actions">
                <Link className="cpq-map-btn" to="/dashboard/phlebotomist?view=map">
                  <Ico><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" /><circle cx="12" cy="10" r="2.2" /></Ico>
                  Route Map
                </Link>
                <button className="cpq-refresh" type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh">
                  <Ico><path d="M20 12a8 8 0 1 1-2.2-5.6" /><path d="M20 4v5h-5" /></Ico>
                </button>
              </div>
            </div>
            <div className="cp-queue-tools">
              <label className="cpq-search">
                <Ico><circle cx="11" cy="11" r="6.5" /><path d="M16 16l5 5" /></Ico>
                <input
                  ref={barcodeRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by patient name, mobile, test, barcode or address..."
                />
              </label>
              <label className="cpq-status-filter">
                <Ico><path d="M4 6h16M7 12h10M10 18h4" /></Ico>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as QueueFilter)}>
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="inroute">In route</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
            </div>
            <div className="cpq-tabs">
              <button type="button" className={`cpq-tab all${statusFilter === 'all' ? ' is-on' : ''}`} onClick={() => setStatusFilter('all')}>
                <Ico><path d="M4 7h16M4 12h16M4 17h10" /></Ico>
                All ({visibleOrders.length})
              </button>
              <button type="button" className={`cpq-tab pending${statusFilter === 'pending' ? ' is-on' : ''}`} onClick={() => setStatusFilter('pending')}>
                <Ico><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></Ico>
                Pending ({stats.pending})
              </button>
              <button type="button" className={`cpq-tab inroute${statusFilter === 'inroute' ? ' is-on' : ''}`} onClick={() => setStatusFilter('inroute')}>
                <Ico><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></Ico>
                In route ({stats.inRoute})
              </button>
              <button type="button" className={`cpq-tab completed${statusFilter === 'completed' ? ' is-on' : ''}`} onClick={() => setStatusFilter('completed')}>
                <Ico><circle cx="12" cy="12" r="8" /><path d="M8.5 12.5 11 15l4.5-5" /></Ico>
                Completed ({stats.completed})
              </button>
              <Link className="cpq-tab map" to="/dashboard/phlebotomist?view=map">
                <Ico><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" /><circle cx="12" cy="10" r="2.2" /></Ico>
                Route map
              </Link>
            </div>
            {loading && !orders.length ? <p className="cp-empty">Loading orders…</p> : null}
            {!loading && filtered.length === 0 ? (
              <p className="cp-empty">No collections in this view. New bookings at your hub will appear here.</p>
            ) : null}
            <div className="cp-table-wrap">
              <table className="cp-table cpq-table">
                <thead>
                  <tr>
                    <th className="cpq-check" />
                    <th>#</th>
                    <th>Patient Details</th>
                    <th>Test / Package</th>
                    <th>Address & Time</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((order, index) => {
                    const status = collectorStatus(order, inRouteTrf);
                    const dest = mapPlaceUrl(order);
                    const meta = patientMeta(order);
                    const count = testCount(order);
                    return (
                      <tr key={order.trf_id}>
                        <td className="cpq-check">
                          <input type="checkbox" aria-label={`Select ${order.patient_name}`} />
                        </td>
                        <td>
                          <span className="cpq-num">{(safePage - 1) * PAGE_SIZE + index + 1}</span>
                        </td>
                        <td className="cp-patient">
                          <strong>{order.patient_name}</strong>
                          <small>
                            <Ico><path d="M22 16.9v2a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h2a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.4 2.1L7.1 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6A2 2 0 0 1 22 16.9z" /></Ico>
                            {order.patient_phone || 'No phone'}
                          </small>
                          {meta ? (
                            <small>
                              <Ico><circle cx="12" cy="8" r="3.2" /><path d="M5 20c.7-3.6 3.4-5.5 7-5.5s6.3 1.9 7 5.5" /></Ico>
                              {meta}
                            </small>
                          ) : null}
                          <small>
                            <Ico><path d="M5 6v12M8 6v12M11 6v12M15 6v12M18 6v12" /></Ico>
                            {order.barcode || order.trf_id}
                          </small>
                        </td>
                        <td>
                          <strong className="cpq-test">{testLabel(order)}</strong>
                          <small className="cp-muted">{count} {count === 1 ? 'Test' : 'Tests'}</small>
                        </td>
                        <td>
                          <small>
                            <Ico><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" /><circle cx="12" cy="10" r="2.2" /></Ico>
                            {order.collection_address || 'No address'}
                          </small>
                          <small>
                            <Ico><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></Ico>
                            {formatSlot(order.collection_slot)}
                          </small>
                          {dest ? (
                            <button className="cpq-viewmap" type="button" onClick={() => void openNavigation(order)}>
                              <Ico><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" /><circle cx="12" cy="10" r="2.2" /></Ico>
                              View on Map
                            </button>
                          ) : null}
                        </td>
                        <td>
                          <span className={`cp-status ${status}`}>{statusLabel(status)}</span>
                        </td>
                        <td>
                          <div className="cp-actions">
                            {order.patient_phone ? (
                              <a className="cp-icon-btn" href={`tel:${order.patient_phone}`} aria-label="Call">
                                <Ico><path d="M22 16.9v2a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h2a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.4 2.1L7.1 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6A2 2 0 0 1 22 16.9z" /></Ico>
                              </a>
                            ) : (
                              <span className="cp-icon-btn is-off" aria-hidden>
                                <Ico><path d="M22 16.9v2a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h2a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.4 2.1L7.1 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6A2 2 0 0 1 22 16.9z" /></Ico>
                              </span>
                            )}
                            <button
                              className={`cp-icon-btn${dest ? '' : ' is-off'}`}
                              type="button"
                              aria-label="Navigate"
                              disabled={!dest}
                              onClick={() => void openNavigation(order)}
                            >
                              <Ico><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></Ico>
                            </button>
                            <button className="cp-icon-btn" type="button" aria-label="More" onClick={() => setSelected(selected === order.trf_id ? null : order.trf_id)}>
                              <Ico><circle cx="6" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="18" cy="12" r="1.3" /></Ico>
                            </button>
                            {status === 'pending' || status === 'inroute' ? (
                              <button className="cp-start cpq-start" type="button" disabled={acting === order.trf_id} onClick={() => void startVisit(order)}>
                                <Ico><path d="M8 5v14l11-7z" /></Ico>
                                {acting === order.trf_id ? 'Starting…' : 'Start Collection'}
                              </button>
                            ) : (
                              <button className="cp-view" type="button" onClick={() => setSelected(selected === order.trf_id ? null : order.trf_id)}>
                                View
                              </button>
                            )}
                          </div>
                          {selected === order.trf_id ? (
                            <CollectionDetail
                              order={order}
                              acting={acting}
                              onCollect={(id) => void markCollected(id)}
                              onRefresh={() => void load()}
                            />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="cp-cards">
              {paged.map((order) => {
                const status = collectorStatus(order, inRouteTrf);
                const dest = mapPlaceUrl(order);
                const meta = patientMeta(order);
                return (
                  <article key={order.trf_id} className="cpq-card">
                    <div className="cp-queue-head">
                      <strong>{order.patient_name}</strong>
                      <span className={`cp-status ${status}`}>{statusLabel(status)}</span>
                    </div>
                    {meta ? <p className="cp-muted">{meta}</p> : null}
                    <p>{testLabel(order)}</p>
                    <p className="cp-muted">{order.collection_address || 'No address'}</p>
                    <p className="cp-muted">{order.patient_phone || 'No phone'} · {formatSlot(order.collection_slot)}</p>
                    {dest ? (
                      <button className="cpq-viewmap" type="button" onClick={() => void openNavigation(order)}>
                        View on Map
                      </button>
                    ) : null}
                    <div className="cp-actions">
                      {order.patient_phone ? <a className="cp-icon-btn" href={`tel:${order.patient_phone}`} aria-label="Call">☎</a> : null}
                      {status === 'pending' || status === 'inroute' ? (
                        <button className="cp-start cpq-start" type="button" onClick={() => void startVisit(order)}>
                          Start Collection
                        </button>
                      ) : null}
                      {order.order_status === 'Booked' ? (
                        <button className="cp-view" type="button" onClick={() => void markCollected(order.trf_id)}>
                          Sample collected
                        </button>
                      ) : null}
                    </div>
                    <CollectionDetail order={order} acting={acting} onCollect={(id) => void markCollected(id)} onRefresh={() => void load()} />
                  </article>
                );
              })}
            </div>
            <div className="cpq-foot">
              <span>
                Showing {showingFrom} to {showingTo} of {filtered.length} {filtered.length === 1 ? 'patient' : 'patients'}
              </span>
              <div className="cpq-pager">
                <button type="button" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page">
                  ‹
                </button>
                <span>{safePage}</span>
                <button type="button" disabled={safePage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} aria-label="Next page">
                  ›
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {showAside ? (
          <aside className="cp-aside">
            <section className="cp-aside-card">
              <div className="cp-aside-head">
                <h2>Today’s Route</h2>
                <Link to="/dashboard/phlebotomist?view=map">View full map</Link>
              </div>
              {mapError ? <p className="cp-error">{mapError}</p> : null}
              <PhlebotomistMap data={mapData} height={view === 'map' ? 560 : 220} className={`cp-map-box${view === 'map' ? ' is-tall' : ''}`} />
              <p className="cp-map-meta">
                {routeKm && routeMin
                  ? `${routeKm} km · ${routeMin} min driving`
                  : mapData?.stops?.length
                    ? `${mapData.stops.length} mapped collection ${mapData.stops.length === 1 ? 'stop' : 'stops'}`
                    : 'No geocoded collection addresses yet'}
                {onDuty ? ' · Live location sharing on' : ''}
              </p>
            </section>
            {view !== 'map' ? (
              <>
                <section className="cp-aside-card">
                  <div className="cp-aside-head">
                    <h2>Quick Actions</h2>
                  </div>
                  <div className="cp-qa">
                    <button type="button" onClick={() => void onHubCheckin()} disabled={checkinLoading}>
                      <span className="cp-qa-icon teal">📍</span>
                      {checkinLoading ? 'Checking in…' : 'Check in at hub'}
                    </button>
                    <button type="button" onClick={() => setView('', { focus: 'barcode' })}>
                      <span className="cp-qa-icon blue">▦</span>
                      Scan barcode
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = filtered.find((o) => o.order_status === 'Booked');
                        if (next) setSelected(next.trf_id);
                      }}
                    >
                      <span className="cp-qa-icon rose">🧪</span>
                      Collect sample
                    </button>
                  </div>
                </section>
                <section className="cp-aside-card cp-profile-card">
                  <div className="cp-aside-head" style={{ width: '100%' }}>
                    <h2>My Profile</h2>
                    <Link to="/dashboard/profile">View profile</Link>
                  </div>
                  <span className="cp-profile-avatar">{initials(displayName)}</span>
                  <strong>{displayName}</strong>
                  <span className="cp-chip">{people?.employee?.status === 'Active' || onDuty ? 'Active' : people?.employee?.status || 'Collector'}</span>
                  <p>Phlebotomist</p>
                  <p>{people?.employee?.phone || user?.user}</p>
                  <p>{people?.employee?.email || user?.user}</p>
                  <p>{hubLabel || people?.employee?.branch || 'Assigned hub'}</p>
                  {people?.employee?.id ? <p>{people.employee.id}</p> : null}
                </section>
              </>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
