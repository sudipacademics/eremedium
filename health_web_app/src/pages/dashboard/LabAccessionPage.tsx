import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  AccessionPatient,
  AccessionSummary,
  AccessionTrfHit,
  CollectionTubeRow,
} from '../../api';
import { formatPatientAge } from '../../utils/patientAge';
import './lab-tech-v2.css';
import './lab-accession-v2.css';

/**
 * Lab reception accession — receive / reject collection tubes (Phase 89).
 * Reject writes Sample Rejection Record (NABL) via ERP.
 */

const REJECT_REASONS = ['Wrong Container', 'Hemolysis', 'Quantity Not Sufficient', 'Labeling Error', 'Clotted'];

const CAP_COLORS: Record<string, string> = {
  'light blue': '#60a5fa',
  blue: '#2563eb',
  red: '#dc2626',
  gold: '#d4a017',
  yellow: '#facc15',
  'tiger top': '#f97316',
  green: '#16a34a',
  'light green': '#4ade80',
  lavender: '#a78bfa',
  purple: '#7c3aed',
  pink: '#ec4899',
  grey: '#6b7280',
  gray: '#6b7280',
  'royal blue': '#1d4ed8',
  white: '#e5e7eb',
  black: '#111827',
};

function capDot(color?: string): string {
  const key = (color || '').trim().toLowerCase();
  if (CAP_COLORS[key]) return CAP_COLORS[key];
  const hit = Object.keys(CAP_COLORS).find((k) => key.includes(k));
  return hit ? CAP_COLORS[hit] : '#94a3b8';
}

function statusView(status?: string): { label: string; tone: string } {
  switch (status) {
    case 'Received':
      return { label: 'Received', tone: 'tone-green' };
    case 'Rejected':
      return { label: 'Rejected', tone: 'tone-red' };
    case 'Drawn':
      return { label: 'Ready', tone: 'tone-blue' };
    case 'Planned':
      return { label: 'Planned', tone: 'tone-amber' };
    default:
      return { label: status || '—', tone: 'tone-muted' };
  }
}

function formatWhen(raw?: string | null): string {
  if (!raw) return '—';
  const d = new Date(raw.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function AIcon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const ICON_QR = (
  <>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
  </>
);
const ICON_TUBE = (
  <>
    <path d="M9 3h6M10 3v13a2 2 0 0 0 4 0V3" />
    <path d="M10 10h4" />
  </>
);

type TubeAction = 'receive' | 'reject';

export function LabAccessionPage() {
  const [lookup, setLookup] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [trfId, setTrfId] = useState<string | null>(null);
  const [patient, setPatient] = useState<AccessionPatient | null>(null);
  const [tubes, setTubes] = useState<CollectionTubeRow[]>([]);
  const [hits, setHits] = useState<AccessionTrfHit[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [rowAction, setRowAction] = useState<Record<string, TubeAction>>({});
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [summary, setSummary] = useState<AccessionSummary | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [rejectFor, setRejectFor] = useState<string[] | null>(null);
  const [rejectReason, setRejectReason] = useState(REJECT_REASONS[0]);
  const [rejectNote, setRejectNote] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const loadSummary = useCallback(async () => {
    try {
      const res = await api.getAccessionSummary();
      setSummary(res.data);
    } catch {
      setSummary(null);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuFor]);

  async function loadPlan(id: string) {
    const plan = await api.getTrfDrawPlan(id);
    setTubes(plan.data.tubes || []);
    if (plan.data.patient) setPatient(plan.data.patient);
    setSelected([]);
  }

  async function openTrf(id: string, fallback?: AccessionPatient) {
    setTrfId(id);
    setHits([]);
    if (fallback) setPatient(fallback);
    await loadPlan(id);
  }

  async function legacyLookup(code: string) {
    let row;
    try {
      row = (await api.getTrfDetail({ barcode: code })).data.trf;
    } catch {
      row = (await api.getTrfDetail(code)).data.trf;
    }
    if (!row?.trf_id) throw new Error('TRF not found for this barcode');
    await openTrf(row.trf_id, {
      patient_name: row.patient_name,
      patient_phone: row.patient_phone,
      unique_barcode: row.barcode,
      order_status: row.order_status,
      creation: row.creation,
    });
    return row.trf_id;
  }

  async function onLookup(e?: FormEvent) {
    e?.preventDefault();
    const code = lookup.trim();
    if (!code) return;
    setBusy('lookup');
    setError(null);
    setNotice(null);
    setTrfId(null);
    setPatient(null);
    setTubes([]);
    setHits([]);
    try {
      let found: AccessionTrfHit[] | null = null;
      try {
        found = (await api.findTrfForAccession(code)).data.trfs || [];
      } catch {
        found = null;
      }
      if (found === null) {
        const id = await legacyLookup(code);
        setNotice(`Loaded ${id}`);
      } else if (found.length === 0) {
        setError('No TRF matches this barcode, accession ID, mobile number or name.');
      } else if (found.length === 1) {
        const hit = found[0];
        await openTrf(hit.trf_id);
        setNotice(`Loaded ${hit.patient_name || ''} · ${hit.trf_id}`);
      } else {
        setHits(found);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setBusy(null);
    }
  }

  async function onReceive(accessionIds: string[]) {
    if (!trfId || !accessionIds.length) return;
    setBusy(accessionIds.length > 1 ? 'receive-all' : accessionIds[0]);
    setError(null);
    const failed: string[] = [];
    for (const id of accessionIds) {
      try {
        await api.receiveTrfTube(trfId, id);
      } catch (err) {
        failed.push(`${id}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
    try {
      await loadPlan(trfId);
    } catch {
      /* keep current rows */
    }
    void loadSummary();
    const ok = accessionIds.length - failed.length;
    if (ok) setNotice(ok === 1 && accessionIds.length === 1 ? `Received ${accessionIds[0]}` : `Received ${ok} tube(s)`);
    if (failed.length) setError(`Receive failed — ${failed.join('; ')}`);
    setBusy(null);
  }

  function askReject(accessionIds: string[]) {
    if (!trfId || !accessionIds.length) return;
    setRejectReason(REJECT_REASONS[0]);
    setRejectNote('');
    setRejectFor(accessionIds);
  }

  async function confirmReject() {
    if (!trfId || !rejectFor?.length) return;
    const reason = rejectNote.trim() ? `${rejectReason} — ${rejectNote.trim()}` : rejectReason;
    const ids = rejectFor;
    setRejectFor(null);
    setBusy('reject');
    setError(null);
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await api.rejectTrfTube(trfId, id, reason);
      } catch (err) {
        failed.push(`${id}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
    try {
      await loadPlan(trfId);
    } catch {
      /* keep current rows */
    }
    void loadSummary();
    const ok = ids.length - failed.length;
    if (ok) setNotice(`Rejected ${ok} tube(s) — rejection record created`);
    if (failed.length) setError(`Reject failed — ${failed.join('; ')}`);
    setBusy(null);
  }

  async function onRebuild() {
    if (!trfId) return;
    setBusy('rebuild');
    setError(null);
    try {
      await api.rebuildTrfDrawPlan(trfId);
      await loadPlan(trfId);
      setNotice('Draw plan rebuilt from ordered tests.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rebuild failed');
    } finally {
      setBusy(null);
    }
  }

  function clearAll() {
    setLookup('');
    setTrfId(null);
    setPatient(null);
    setTubes([]);
    setHits([]);
    setSelected([]);
    setRowAction({});
    setError(null);
    setNotice(null);
    inputRef.current?.focus();
  }

  const actionable = useMemo(
    () => tubes.filter((t) => t.accession_id && t.status !== 'Received' && t.status !== 'Rejected'),
    [tubes],
  );
  const allChecked = actionable.length > 0 && actionable.every((t) => selected.includes(t.accession_id!));

  function toggleAll() {
    setSelected(allChecked ? [] : actionable.map((t) => t.accession_id!));
  }

  function toggleOne(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  const bulkTargets = selected.length ? selected : actionable.map((t) => t.accession_id!);
  const working = busy !== null;
  const ageGender = [formatPatientAge(patient || {}), patient?.gender || ''].filter(Boolean).join(' / ');

  return (
    <div className="lt-page la2-page">
      <section className="la2-hero">
        <div className="la2-hero-main">
          <span className="la2-hero-icon">
            <AIcon size={30}>{ICON_TUBE}</AIcon>
          </span>
          <div>
            <h2>Sample accession</h2>
            <p>
              Receive or reject collection tubes by accession ID. Rejections create a NABL Sample Rejection
              Record in ERPNext.
            </p>
            <div className="la2-hero-links">
              <Link to="/dashboard/lab-bill-entry">New direct/online bill</Link>
              <Link to="/dashboard/lab-reports">Result entry</Link>
              <Link to="/dashboard/lab-tech">Barcode bench</Link>
            </div>
          </div>
        </div>
        <button type="button" className="la2-help-btn" onClick={() => setShowHelp((v) => !v)}>
          <span aria-hidden>?</span> How to accession?
        </button>
      </section>

      {showHelp ? (
        <section className="la2-help">
          <ol>
            <li>Scan the TRF barcode (or type the accession ID, patient mobile or name) and press Load tubes.</li>
            <li>Check each tube against the list — cap colour, volume and test.</li>
            <li>
              Choose <strong>Accession</strong> per tube, or tick tubes and press <strong>Accession All</strong>.
              Received tubes move the TRF into the result-entry queue.
            </li>
            <li>
              For haemolysed, clotted, insufficient or mislabelled samples use <strong>Reject Sample</strong> — a
              NABL rejection record is created.
            </li>
          </ol>
        </section>
      ) : null}

      <div className="lt-stats">
        <div className="lt-stat tone-green">
          <span className="lt-stat-icon">
            <AIcon size={26}>
              <circle cx="12" cy="12" r="9" />
              <path d="m8 12 3 3 5-6" />
            </AIcon>
          </span>
          <span className="lt-stat-copy">
            <strong>{summary?.received_today ?? '—'}</strong>
            <b>Received Today</b>
            <small>Samples accessioned</small>
          </span>
        </div>
        <div className="lt-stat tone-blue">
          <span className="lt-stat-icon">
            <AIcon size={26}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </AIcon>
          </span>
          <span className="lt-stat-copy">
            <strong>{summary?.pending ?? '—'}</strong>
            <b>Pending</b>
            <small>Waiting for accession</small>
          </span>
        </div>
        <div className="lt-stat tone-amber">
          <span className="lt-stat-icon">
            <AIcon size={26}>
              <circle cx="12" cy="12" r="9" />
              <path d="m9 9 6 6M15 9l-6 6" />
            </AIcon>
          </span>
          <span className="lt-stat-copy">
            <strong>{summary?.rejected_today ?? '—'}</strong>
            <b>Rejected</b>
            <small>Samples rejected today</small>
          </span>
        </div>
        <div className="lt-stat tone-purple">
          <span className="lt-stat-icon">
            <AIcon size={26}>{ICON_TUBE}</AIcon>
          </span>
          <span className="lt-stat-copy">
            <strong>{summary?.total_today ?? '—'}</strong>
            <b>Total Today</b>
            <small>All samples</small>
          </span>
        </div>
      </div>

      <section className="la2-scan">
        <form className="la2-scan-main" onSubmit={(e) => void onLookup(e)}>
          <span className="la2-scan-icon">
            <AIcon size={30}>{ICON_QR}</AIcon>
          </span>
          <div className="la2-scan-body">
            <label htmlFor="la2-lookup">Scan TRF barcode or enter Accession ID</label>
            <div className="la2-scan-row">
              <div className="la2-input">
                <input
                  id="la2-lookup"
                  ref={inputRef}
                  value={lookup}
                  onChange={(e) => setLookup(e.target.value)}
                  placeholder="Scan barcode or type accession ID, mobile or name"
                  autoFocus
                />
                {lookup ? (
                  <button type="button" aria-label="Clear" onClick={() => setLookup('')}>
                    ✕
                  </button>
                ) : null}
              </div>
              <button className="la2-load" type="submit" disabled={busy === 'lookup' || !lookup.trim()}>
                {busy === 'lookup' ? 'Looking up…' : 'Load tubes ›'}
              </button>
            </div>
          </div>
        </form>
        <aside className="la2-supported">
          <b>Supported scan</b>
          <ul>
            <li>TRF barcode</li>
            <li>Accession ID</li>
            <li>Patient mobile number</li>
            <li>Patient name</li>
          </ul>
        </aside>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="notice">{notice}</div> : null}

      {hits.length ? (
        <section className="lt-table-card la2-hits">
          <h3>Multiple bookings match — pick one</h3>
          <div className="lt-table-wrap">
            <table className="lt-table">
              <thead>
                <tr>
                  <th>TRF</th>
                  <th>Patient</th>
                  <th>Mobile</th>
                  <th>Barcode</th>
                  <th>Status</th>
                  <th>Booked</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {hits.map((h) => (
                  <tr key={h.trf_id}>
                    <td className="lt-trf">{h.trf_id}</td>
                    <td>{h.patient_name || '—'}</td>
                    <td>{h.patient_phone || '—'}</td>
                    <td>
                      <code>{h.barcode || '—'}</code>
                    </td>
                    <td>
                      <span className="lt-badge tone-muted">{h.order_status || '—'}</span>
                    </td>
                    <td>{formatWhen(h.creation)}</td>
                    <td>
                      <button
                        type="button"
                        className="lt-action"
                        disabled={working}
                        onClick={() => {
                          setBusy('lookup');
                          setError(null);
                          openTrf(h.trf_id)
                            .then(() => setNotice(`Loaded ${h.patient_name || ''} · ${h.trf_id}`))
                            .catch((err) => setError(err instanceof Error ? err.message : 'Load failed'))
                            .finally(() => setBusy(null));
                        }}
                      >
                        Load tubes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="lt-table-card la2-details">
        <div className="la2-details-head">
          <div className="la2-details-title">
            <h3>Scanned Sample Details</h3>
            {trfId ? <span className="la2-trf-chip">TRF: {patient?.unique_barcode || trfId}</span> : null}
            {patient?.order_status ? <span className="lt-badge tone-muted">{patient.order_status}</span> : null}
          </div>
          <div className="la2-details-actions">
            {trfId ? (
              <button type="button" className="la2-btn is-ghost" disabled={working} onClick={() => void onRebuild()}>
                {busy === 'rebuild' ? 'Rebuilding…' : 'Rebuild draw plan'}
              </button>
            ) : null}
            <button
              type="button"
              className="la2-btn is-danger"
              disabled={!trfId || working || !bulkTargets.length}
              onClick={() => askReject(bulkTargets)}
            >
              Reject Sample
            </button>
            <button type="button" className="la2-btn is-ghost" disabled={working} onClick={clearAll}>
              Clear All
            </button>
            <button
              type="button"
              className="la2-btn is-primary"
              disabled={!trfId || working || !bulkTargets.length}
              onClick={() => void onReceive(bulkTargets)}
            >
              {busy === 'receive-all' ? 'Accessioning…' : selected.length ? `Accession Selected (${selected.length})` : 'Accession All'}
            </button>
          </div>
        </div>

        <div className="lt-table-wrap">
          <table className="lt-table la2-table">
            <thead>
              <tr>
                <th className="lt-col-check">
                  <input
                    type="checkbox"
                    aria-label="Select all tubes"
                    checked={allChecked}
                    disabled={!actionable.length}
                    onChange={toggleAll}
                  />
                </th>
                <th>Sr. No.</th>
                <th>Barcode</th>
                <th>Test Name</th>
                <th>Tube Type</th>
                <th>Volume</th>
                <th>Status</th>
                <th>Action</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!trfId ? (
                <tr>
                  <td colSpan={9} className="lt-empty">
                    Scan a TRF barcode to load its collection tubes.
                  </td>
                </tr>
              ) : !tubes.length ? (
                <tr>
                  <td colSpan={9} className="lt-empty">
                    No collection tubes on this TRF. Rebuild draw plan or check Desk masters (HEC Collection Tube).
                  </td>
                </tr>
              ) : (
                tubes.map((tube, idx) => {
                  const id = tube.accession_id || '';
                  const view = statusView(tube.status);
                  const done = tube.status === 'Received' || tube.status === 'Rejected';
                  const action = rowAction[id] || 'receive';
                  return (
                    <tr key={id || `${tube.tube_code}-${idx}`}>
                      <td className="lt-col-check">
                        <input
                          type="checkbox"
                          aria-label={`Select ${id}`}
                          checked={selected.includes(id)}
                          disabled={!id || done}
                          onChange={() => toggleOne(id)}
                        />
                      </td>
                      <td>{idx + 1}</td>
                      <td>
                        <code className="la2-barcode">{id || '—'}</code>
                      </td>
                      <td className="lt-tests">{tube.linked_tests || tube.specimen || '—'}</td>
                      <td>
                        <span className="la2-tube">
                          <i style={{ background: capDot(tube.cap_color) }} />
                          {tube.cap_color ? `${tube.cap_color} (${tube.tube_code})` : tube.tube_code || '—'}
                        </span>
                      </td>
                      <td>{tube.volume_ml ? `${tube.volume_ml} ml` : '—'}</td>
                      <td>
                        <span className={`lt-badge ${view.tone}`}>{view.label}</span>
                      </td>
                      <td>
                        {done ? (
                          <span className="muted">—</span>
                        ) : (
                          <div className="la2-action">
                            <select
                              value={action}
                              disabled={!id || working}
                              onChange={(e) => setRowAction((m) => ({ ...m, [id]: e.target.value as TubeAction }))}
                            >
                              <option value="receive">Accession</option>
                              <option value="reject">Reject</option>
                            </select>
                            <button
                              type="button"
                              className={action === 'reject' ? 'is-danger' : ''}
                              disabled={!id || working}
                              onClick={() => (action === 'reject' ? askReject([id]) : void onReceive([id]))}
                            >
                              {busy === id ? '…' : 'Go'}
                            </button>
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="lt-row-menu">
                          <button
                            type="button"
                            className="lt-kebab"
                            aria-label="More actions"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuFor(menuFor === id ? null : id);
                            }}
                          >
                            ⋮
                          </button>
                          {menuFor === id ? (
                            <div className="lt-row-menu-pop">
                              <button
                                type="button"
                                disabled={!id || done || working}
                                onClick={() => void onReceive([id])}
                              >
                                Accession tube
                              </button>
                              <button type="button" disabled={!id || done || working} onClick={() => askReject([id])}>
                                Reject tube…
                              </button>
                              <button
                                type="button"
                                disabled={!id}
                                onClick={() => void navigator.clipboard?.writeText(id)}
                              >
                                Copy accession ID
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="la2-patient">
        <h3>Patient &amp; Booking Information</h3>
        <div className="la2-patient-grid">
          <div>
            <small>Patient Name</small>
            <strong>{patient?.patient_name || '—'}</strong>
          </div>
          <div>
            <small>Age / Gender</small>
            <strong>{ageGender || '—'}</strong>
          </div>
          <div>
            <small>Mobile Number</small>
            <strong>{patient?.patient_phone || '—'}</strong>
          </div>
          <div>
            <small>Booking Channel</small>
            <strong>{patient?.sample_intake_channel || '—'}</strong>
          </div>
          <div>
            <small>Booking Date &amp; Time</small>
            <strong>{formatWhen(patient?.hec_bill_datetime || patient?.creation)}</strong>
          </div>
        </div>
      </section>

      {rejectFor ? (
        <div className="la2-modal-backdrop" role="presentation" onClick={() => setRejectFor(null)}>
          <div className="la2-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Reject {rejectFor.length === 1 ? rejectFor[0] : `${rejectFor.length} tubes`}</h3>
            <p className="muted">Logged to the Sample Rejection Record (NABL).</p>
            <label>
              Reason
              <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}>
                {REJECT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Note (optional)
              <input value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Details for the record" />
            </label>
            <div className="la2-modal-actions">
              <button type="button" className="la2-btn is-ghost" onClick={() => setRejectFor(null)}>
                Cancel
              </button>
              <button type="button" className="la2-btn is-danger-solid" onClick={() => void confirmReject()}>
                Reject
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
