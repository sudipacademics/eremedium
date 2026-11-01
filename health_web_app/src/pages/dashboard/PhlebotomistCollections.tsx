import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { api, Booking } from '../../api';
import { ensureNavLocation } from '../../hooks/usePhleboGps';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { formatPatientAge } from '../../utils/patientAge';
import { mapsDirectionsUrl } from '../../utils/googleMaps';
import './collector-v2.css';

const PAGE_SIZE = 10;

type Chip = 'collected' | 'delivered' | 'pending';

function Ico({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function testLabel(order: Booking) {
  return order.test_name || order.test_labels?.join(', ') || order.test_required || 'Diagnostics';
}

function testCount(order: Booking) {
  const fromLabels = order.test_labels?.filter(Boolean).length || 0;
  return fromLabels || order.collection_tubes?.length || 1;
}

function patientMeta(order: Booking) {
  const gender = (order.gender || '').trim();
  const age = order.age_label || formatPatientAge(order);
  if (gender && age) return `${gender} · ${age}`;
  return gender || age;
}

function ymd(value?: Date | string | null) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function formatDay(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDayTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 16);
  return `${formatDay(value)}, ${date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
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

function inRange(value: string | null | undefined, from: string, to: string) {
  const day = ymd(value);
  if (!day) return !from && !to;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function exportCsv(rows: Booking[]) {
  const header = [
    'Patient',
    'Phone',
    'Barcode',
    'Test',
    'Collection',
    'Address',
    'Report status',
    'Delivery',
  ];
  const lines = rows.map((row) =>
    [
      row.patient_name,
      row.patient_phone || '',
      row.barcode || row.trf_id,
      testLabel(row),
      row.collection_slot || row.modified || '',
      row.collection_address || '',
      row.report_ready ? 'Report ready' : 'Processing',
      row.delivery_status === 'delivered' ? 'Delivered' : row.delivery_status === 'pending_delivery' ? 'Not delivered' : 'Pending report',
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(','),
  );
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `my-collections-${ymd(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function PhlebotomistCollections() {
  const [orders, setOrders] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<Chip>('collected');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [acting, setActing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPhlebotomistMyCollections();
      setOrders(res.data.orders || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load collections');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh(load, 30000);

  const dated = useMemo(
    () =>
      orders.filter((order) =>
        inRange(order.collection_slot || order.modified || order.creation, from, to),
      ),
    [orders, from, to],
  );

  const collected = dated.length;
  const delivered = dated.filter((o) => o.delivery_status === 'delivered').length;
  const pending = dated.filter((o) => o.delivery_status === 'pending_delivery').length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dated.filter((order) => {
      if (chip === 'delivered' && order.delivery_status !== 'delivered') return false;
      if (chip === 'pending' && order.delivery_status !== 'pending_delivery') return false;
      if (!q) return true;
      return [
        order.patient_name,
        order.patient_phone,
        order.barcode,
        order.trf_id,
        testLabel(order),
        order.collection_address,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [dated, chip, query]);

  useEffect(() => {
    setPage(1);
  }, [query, chip, from, to]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const showingFrom = filtered.length ? (safePage - 1) * PAGE_SIZE + 1 : 0;
  const showingTo = Math.min(safePage * PAGE_SIZE, filtered.length);

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
      mapsDirectionsUrl({ origin: access.coords, destination: dest }),
      '_blank',
      'noopener,noreferrer',
    );
  }

  async function deliver(order: Booking) {
    if (!order.journey_id || !order.report_ready) return;
    setActing(order.trf_id);
    setError(null);
    try {
      const access = await ensureNavLocation();
      if (!access.ok) {
        setError(access.message);
        return;
      }
      await api.downloadJourneyReport(order.journey_id, `NABL_Report_${order.trf_id}.pdf`).catch(() => undefined);
      await api.deliverPhlebotomistReport(order.trf_id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not deliver report');
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="cp-page">
      <section className="cp-hero cm-hero">
        <div>
          <h1>My Collections</h1>
          <p>Completed sample collections & report delivery</p>
        </div>
        <div className="cm-hero-card">
          <strong>From Collection To Care</strong>
          <div className="cm-hero-kpi">
            <span className="cm-hero-icon" aria-hidden>
              <Ico><path d="M7 3h10v18H7z" /><path d="M9 7h6M9 11h6M9 15h4" /></Ico>
            </span>
            <div>
              <em>Collected Samples</em>
              <b>{collected}</b>
              <small>Reports to deliver: {pending}</small>
            </div>
          </div>
        </div>
      </section>

      {error ? <div className="error cp-error">{error}</div> : null}

      <section className="cp-queue">
        <div className="cp-queue-tools">
          <label className="cpq-search">
            <Ico><circle cx="11" cy="11" r="6.5" /><path d="M16 16l5 5" /></Ico>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by patient name, mobile, test, barcode or address..." />
          </label>
          <label className="cpq-status-filter cm-dates">
            <Ico><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M8 3v4M16 3v4" /></Ico>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <span>–</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </label>
          <button className="cpq-refresh" type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh">
            <Ico><path d="M20 12a8 8 0 1 1-2.2-5.6" /><path d="M20 4v5h-5" /></Ico>
          </button>
        </div>

        <div className="cm-toolbar">
          <div className="cpq-tabs">
            <button type="button" className={`cpq-tab completed${chip === 'collected' ? ' is-on' : ''}`} onClick={() => setChip('collected')}>
              <Ico><circle cx="12" cy="12" r="8" /><path d="M8.5 12.5 11 15l4.5-5" /></Ico>
              Collected ({collected})
            </button>
            <button type="button" className={`cpq-tab all${chip === 'delivered' ? ' is-on' : ''}`} onClick={() => setChip('delivered')}>
              Report Delivered ({delivered})
            </button>
            <button type="button" className={`cpq-tab pending${chip === 'pending' ? ' is-on' : ''}`} onClick={() => setChip('pending')}>
              <Ico><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></Ico>
              Pending Delivery ({pending})
            </button>
          </div>
          <button className="cm-export" type="button" onClick={() => exportCsv(filtered)}>
            <Ico><path d="M12 4v10M8 10l4 4 4-4M5 19h14" /></Ico>
            Export
          </button>
        </div>

        {loading && !orders.length ? <p className="cp-empty">Loading collections…</p> : null}
        {!loading && filtered.length === 0 ? (
          <p className="cp-empty">No collected samples in this view yet.</p>
        ) : null}

        <div className="cp-table-wrap">
          <table className="cp-table cpq-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Patient Details</th>
                <th>Test / Package</th>
                <th>Collection Details</th>
                <th>Report Status</th>
                <th>Report Delivery</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((order, index) => {
                const dest = mapPlaceUrl(order);
                const meta = patientMeta(order);
                const count = testCount(order);
                return (
                  <tr key={order.trf_id}>
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
                        <Ico><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M8 3v4M16 3v4" /></Ico>
                        {formatDay(order.collection_slot || order.modified || order.creation)}
                      </small>
                      <small>
                        <Ico><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></Ico>
                        {formatDayTime(order.collection_slot || order.modified)}
                      </small>
                      <small>
                        <Ico><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" /><circle cx="12" cy="10" r="2.2" /></Ico>
                        {order.collection_address || 'No address'}
                      </small>
                    </td>
                    <td>
                      <span className={`cm-report${order.report_ready ? ' ready' : ' wait'}`}>
                        {order.report_ready ? 'Report ready' : 'Processing'}
                      </span>
                      <small className="cp-muted">{order.report_ready ? 'Deliver to patient' : 'Ready by lab'}</small>
                    </td>
                    <td>
                      {order.delivery_status === 'delivered' ? (
                        <>
                          <span className="cm-report ready">Delivered</span>
                          <small className="cp-muted">{formatDayTime(order.report_delivered_on)}</small>
                        </>
                      ) : order.delivery_status === 'pending_delivery' ? (
                        <>
                          <span className="cm-report miss">Not delivered</span>
                          <small className="cp-muted">Deliver to patient</small>
                        </>
                      ) : (
                        <>
                          <span className="cm-report wait">Pending report</span>
                          <small className="cp-muted">Wait for report</small>
                        </>
                      )}
                    </td>
                    <td>
                      <div className="cp-actions">
                        {order.patient_phone ? (
                          <a className="cp-icon-btn" href={`tel:${order.patient_phone}`} aria-label="Call">
                            <Ico><path d="M22 16.9v2a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h2a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.4 2.1L7.1 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6A2 2 0 0 1 22 16.9z" /></Ico>
                          </a>
                        ) : null}
                        <button
                          className={`cp-icon-btn${dest ? '' : ' is-off'}`}
                          type="button"
                          aria-label="Navigate"
                          disabled={!dest}
                          onClick={() => void openNavigation(order)}
                        >
                          <Ico><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></Ico>
                        </button>
                        {order.delivery_status === 'delivered' ? (
                          <span className="cm-done">Delivered</span>
                        ) : (
                          <button
                            className="cp-start cpq-start"
                            type="button"
                            disabled={!order.report_ready || acting === order.trf_id}
                            onClick={() => void deliver(order)}
                          >
                            {acting === order.trf_id ? 'Delivering…' : 'Deliver Report'}
                          </button>
                        )}
                        <button className="cp-icon-btn" type="button" aria-label="More" onClick={() => setOpen(open === order.trf_id ? null : order.trf_id)}>
                          <Ico><circle cx="6" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="18" cy="12" r="1.3" /></Ico>
                        </button>
                      </div>
                      {open === order.trf_id && order.journey_id && order.report_ready ? (
                        <button
                          className="cp-view"
                          type="button"
                          onClick={() => void api.downloadJourneyReport(order.journey_id as string, `NABL_Report_${order.trf_id}.pdf`)}
                        >
                          Download PDF
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="cp-cards">
          {paged.map((order) => (
            <article key={order.trf_id} className="cpq-card">
              <div className="cp-queue-head">
                <strong>{order.patient_name}</strong>
                <span className={`cm-report${order.report_ready ? ' ready' : ' wait'}`}>
                  {order.report_ready ? 'Report ready' : 'Processing'}
                </span>
              </div>
              <p>{testLabel(order)}</p>
              <p className="cp-muted">{order.collection_address || 'No address'}</p>
              <div className="cp-actions">
                {order.delivery_status === 'delivered' ? (
                  <span className="cm-done">Delivered</span>
                ) : (
                  <button className="cp-start cpq-start" type="button" disabled={!order.report_ready} onClick={() => void deliver(order)}>
                    Deliver Report
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>

        <div className="cpq-foot">
          <span>
            Showing {showingFrom} to {showingTo} of {filtered.length} collected {filtered.length === 1 ? 'sample' : 'samples'}
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
    </div>
  );
}
