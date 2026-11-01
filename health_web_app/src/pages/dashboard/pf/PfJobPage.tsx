import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { api } from '../../../api';
import { BarcodeScanner } from '../../../components/BarcodeScanner';
import { normalizePfCode, pfCodeError } from '../../../types/phlebofirst';
import type { PfHub, PfJobDetail, PfJobStatus, PfTube } from '../../../types/phlebofirst';
import { usePfPaths } from '../../phlebofirst/app/pfPaths';
import '../collector-v2.css';
import './pf-rider.css';

type Coords = { lat: number; lng: number };
type TubeNote = { kind: 'busy' | 'error' | 'ok'; text: string };

const DEVICE_KEY = 'pf_device_id';
const STEPS: Array<{ status: PfJobStatus; label: string }> = [
  { status: 'Accepted', label: 'Accepted' },
  { status: 'Started', label: 'En Route' },
  { status: 'Collected', label: 'Collected' },
  { status: 'Dropped', label: 'Dropped' },
  { status: 'Received', label: 'Received' },
];
const CAP_COLORS: Record<string, string> = {
  BLU: '#4ea3e0',
  RED: '#d93025',
  SST: '#d4a017',
  GRN: '#2e9d4f',
  LAV: '#8e6bbf',
  GRY: '#8a8f98',
  RBL: '#1f3f99',
};

function errText(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

function money(n?: number | null) {
  return `₹${(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDateTime(value?: string | null) {
  const d = parseDate(value);
  return d ? d.toLocaleString('en-IN') : '—';
}

function fmtWindow(start?: string | null, end?: string | null) {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s && !e) return 'Any time';
  const time = (d: Date) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  if (s && e) return `${s.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} ${time(s)} – ${time(e)}`;
  return fmtDateTime(start || end);
}

function capColor(tubeCode: string) {
  return CAP_COLORS[tubeCode.toUpperCase()] ?? '#999';
}

function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

function currentPosition(timeoutMs = 6000): Promise<Coords | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (value: Coords | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };
    // Some browsers never call back when the permission prompt is ignored.
    const timer = window.setTimeout(() => finish(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => finish({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => finish(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

function distanceMeters(a: Coords, b: Coords) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function fmtDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function navigateUrl(d: PfJobDetail) {
  if (d.navigate_url) return d.navigate_url;
  if (d.pickup_lat != null && d.pickup_lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${d.pickup_lat},${d.pickup_lng}`;
  }
  if (d.pickup_address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.pickup_address)}`;
  return null;
}

function Stepper({ status }: { status: PfJobStatus }) {
  const current = STEPS.findIndex((s) => s.status === status);
  return (
    <ol className="pfr-stepper" aria-label="Job progress">
      {STEPS.map((step, i) => (
        <li key={step.status} className={i < current ? 'is-done' : i === current ? 'is-current' : ''}>
          <span className="pfr-step-dot">{i < current ? '✓' : i + 1}</span>
          <span className="pfr-step-label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function PfJobPage() {
  const { job = '' } = useParams<{ job: string }>();
  const navigate = useNavigate();
  const boardPath = usePfPaths().jobs;
  const device = useMemo(deviceId, []);
  const posRef = useRef<Coords | null>(null);

  const [detail, setDetail] = useState<PfJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [scanTube, setScanTube] = useState<PfTube | null>(null);
  const [tubeNotes, setTubeNotes] = useState<Record<string, TubeNote>>({});

  const [hubScanOpen, setHubScanOpen] = useState(false);
  const [hub, setHub] = useState<PfHub | null>(null);
  const [hubError, setHubError] = useState<string | null>(null);
  const [hubPos, setHubPos] = useState<Coords | null>(null);
  const [codeScanOpen, setCodeScanOpen] = useState(false);
  const [scanned, setScanned] = useState<string[]>([]);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [dropResult, setDropResult] = useState<PfJobDetail | null>(null);

  const load = useCallback(async () => {
    if (!job) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.pfJobDetail(job);
      setDetail(res.data);
    } catch (e) {
      setLoadError(errText(e, 'Could not load this job'));
    } finally {
      setLoading(false);
    }
  }, [job]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      void currentPosition().then((p) => {
        if (!cancelled && p) posRef.current = p;
      });
    refresh();
    const t = window.setInterval(refresh, 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  async function freshPosition() {
    const p = await currentPosition();
    if (p) posRef.current = p;
    return p ?? posRef.current;
  }

  const merge = (next: PfJobDetail) => setDetail((prev) => (prev ? { ...prev, ...next } : next));

  const jobCodes = useMemo(
    () =>
      (detail?.tubes || [])
        .filter((t) => t.status !== 'Rejected' && t.universal_barcode)
        .map((t) => normalizePfCode(t.universal_barcode || '')),
    [detail],
  );
  const allScanned = jobCodes.length > 0 && jobCodes.every((c) => scanned.includes(c));

  useEffect(() => {
    if (allScanned && codeScanOpen) setCodeScanOpen(false);
  }, [allScanned, codeScanOpen]);

  function note(row: string, value: TubeNote | null) {
    setTubeNotes((cur) => {
      const next = { ...cur };
      if (value) next[row] = value;
      else delete next[row];
      return next;
    });
  }

  async function runAction(key: string, fn: () => Promise<void>, fallback: string) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e, fallback));
    } finally {
      setBusy(null);
    }
  }

  function startJob() {
    void runAction(
      'start',
      async () => {
        const res = await api.pfStartJob(job);
        merge(res.data);
      },
      'Could not start the job',
    );
  }

  function releaseJob() {
    const reason = window.prompt('Why are you releasing this job? It will go back to other riders.');
    if (reason == null) return;
    void runAction(
      'release',
      async () => {
        await api.pfReleaseJob(job, reason.trim());
        navigate(boardPath);
      },
      'Could not release the job',
    );
  }

  function markCollected() {
    void runAction(
      'collected',
      async () => {
        const res = await api.pfMarkCollected(job);
        merge(res.data);
      },
      'Could not mark the job collected',
    );
  }

  async function onTubeScanned(tube: PfTube, raw: string) {
    setScanTube(null);
    const code = normalizePfCode(raw);
    note(tube.row, { kind: 'busy', text: `Checking ${code}…` });
    setBusy(`tube:${tube.row}`);
    try {
      const check = await api.pfCheckBarcode(job, tube.row, code);
      if (!check.data.ok) {
        note(tube.row, { kind: 'error', text: check.data.error || `${code} cannot be used for this ${tube.tube_code} tube` });
        return;
      }
      note(tube.row, { kind: 'busy', text: `Binding ${code}…` });
      const pos = posRef.current;
      const res = await api.pfBindBarcode(job, tube.row, code, pos?.lat, pos?.lng, device);
      setDetail((prev) => (prev ? { ...prev, tubes: res.data.tubes } : prev));
      note(tube.row, null);
    } catch (e) {
      note(tube.row, { kind: 'error', text: errText(e, 'Could not bind this label') });
    } finally {
      setBusy(null);
    }
  }

  async function unbind(tube: PfTube) {
    const code = tube.universal_barcode;
    if (!code) return;
    const reason = window.prompt(`Why are you removing ${code} from the ${tube.tube_code} tube?`);
    if (reason == null) return;
    if (reason.trim().length < 3) {
      note(tube.row, { kind: 'error', text: 'Enter a reason of at least 3 characters to remove a label.' });
      return;
    }
    note(tube.row, { kind: 'busy', text: `Removing ${code}…` });
    setBusy(`tube:${tube.row}`);
    try {
      const res = await api.pfUnbindBarcode(job, code, reason.trim(), device);
      setDetail((prev) => (prev ? { ...prev, tubes: res.data.tubes } : prev));
      note(tube.row, null);
    } catch (e) {
      note(tube.row, { kind: 'error', text: errText(e, 'Could not remove this label') });
    } finally {
      setBusy(null);
    }
  }

  async function onHubScanned(raw: string) {
    setHubScanOpen(false);
    const code = normalizePfCode(raw);
    setBusy('hub');
    setHubError(null);
    try {
      const [res, p] = await Promise.all([api.pfHubLookup(code), freshPosition()]);
      setHub(res.data);
      setHubPos(p);
    } catch (e) {
      setHub(null);
      setHubError(errText(e, `Hub ${code} was not found`));
    } finally {
      setBusy(null);
    }
  }

  const validateDropCode = useCallback(
    (raw: string) => {
      const problem = pfCodeError(raw, 'PF');
      if (problem) return problem;
      const code = normalizePfCode(raw);
      return jobCodes.includes(code) ? null : `${code} is not part of this job`;
    },
    [jobCodes],
  );

  function onDropCodeScanned(raw: string) {
    const code = normalizePfCode(raw);
    setScanned((cur) => (cur.includes(code) ? cur : [...cur, code]));
    setScanMsg(`${code} matched`);
  }

  function confirmDrop() {
    if (!hub || !allScanned) return;
    void runAction(
      'drop',
      async () => {
        const p = await freshPosition();
        const res = await api.pfDropAtHub(job, hub.hub_code, scanned, p?.lat, p?.lng, device);
        setDropResult(res.data);
        merge(res.data);
      },
      'Could not complete the handover',
    );
  }

  if (loading && !detail) {
    return (
      <div className="cp-page pfr-page">
        <p className="pfr-empty">Loading job…</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="cp-page pfr-page">
        <Link className="pfr-back" to={boardPath}>
          ‹ Back to jobs
        </Link>
        <div className="pfr-empty pfr-panel">
          <strong>Job unavailable</strong>
          <p>{loadError || 'This job could not be found.'}</p>
          <button type="button" className="pfr-btn ghost" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const d = detail;
  const firstName = (d.patient_name || '').trim().split(/\s+/)[0] || 'Patient';
  const patientMeta = [d.patient_age != null ? `${d.patient_age} y` : '', d.patient_gender || ''].filter(Boolean).join(' · ');
  const started = d.status !== 'Accepted' && d.status !== 'Open';
  const navUrl = started ? navigateUrl(d) : null;
  const activeTubes = d.tubes.filter((t) => t.status !== 'Rejected');
  const canCollect = activeTubes.length > 0 && activeTubes.every((t) => t.universal_barcode);
  const boundCount = activeTubes.filter((t) => t.universal_barcode).length;
  const hubCoords = hub && hub.lat != null && hub.lng != null ? { lat: hub.lat, lng: hub.lng } : null;
  const hubDistance = hubCoords && hubPos ? distanceMeters(hubPos, hubCoords) : null;
  const geofence = hub?.geofence_m ?? 0;
  const terminal = d.status === 'Expired' || d.status === 'Cancelled';

  return (
    <div className="cp-page pfr-page">
      <Link className="pfr-back" to={boardPath}>
        ‹ Back to jobs
      </Link>

      <section className="pfr-job-head pfr-panel">
        <div>
          <h1>{d.pickup_area || 'PhleboFirst job'}</h1>
          <small className="pfr-muted">
            {d.name} · {d.lab_name || d.lab || 'Lab'}
          </small>
        </div>
        <div className="pfr-pay">
          <b>{money(d.rider_payout)}</b>
          <small>your payout</small>
        </div>
      </section>

      {terminal ? (
        <p className="pfr-error">This job is {d.status.toLowerCase()}. No further actions are possible.</p>
      ) : (
        <Stepper status={d.status} />
      )}

      {error ? <p className="pfr-error">{error}</p> : null}

      <section className="pfr-panel">
        <div className="pfr-panel-head">
          <h2>Patient</h2>
        </div>
        <dl className="pfr-facts">
          <div>
            <dt>Name</dt>
            <dd>
              {started ? d.patient_name || firstName : firstName}
              {patientMeta ? <small className="pfr-muted"> · {patientMeta}</small> : null}
            </dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>
              {started && d.patient_phone ? (
                <a className="pfr-tel" href={`tel:${d.patient_phone}`}>
                  {d.patient_phone}
                </a>
              ) : (
                d.patient_phone_masked || '—'
              )}
            </dd>
          </div>
          <div>
            <dt>Window</dt>
            <dd>{fmtWindow(d.window_start, d.window_end)}</dd>
          </div>
          <div>
            <dt>Tests / tubes</dt>
            <dd>
              {d.test_count} / {d.tube_count}
            </dd>
          </div>
          <div className="wide">
            <dt>{started ? 'Address' : 'Area'}</dt>
            <dd>{started ? d.pickup_address || d.pickup_area || '—' : `${d.pickup_area || '—'} (full address after you start)`}</dd>
          </div>
          {started && d.notes ? (
            <div className="wide">
              <dt>Notes</dt>
              <dd>{d.notes}</dd>
            </div>
          ) : null}
        </dl>
        {navUrl && d.status === 'Started' ? (
          <a className="pfr-btn ghost block" href={navUrl} target="_blank" rel="noreferrer">
            Navigate to patient
          </a>
        ) : null}
      </section>

      {d.status === 'Accepted' ? (
        <div className="pfr-actions">
          <button type="button" className="pfr-btn primary" disabled={busy !== null} onClick={startJob}>
            {busy === 'start' ? 'Starting…' : 'Start job'}
          </button>
          <button type="button" className="pfr-btn danger-ghost" disabled={busy !== null} onClick={releaseJob}>
            {busy === 'release' ? 'Releasing…' : 'Release'}
          </button>
        </div>
      ) : null}

      {d.status === 'Started' ? (
        <section className="pfr-panel">
          <div className="pfr-panel-head">
            <h2>Draw plan</h2>
            <span className="pfr-muted">
              {boundCount} / {activeTubes.length} labelled
            </span>
          </div>
          <p className="pfr-hint">Draw each tube in this order, stick a PF label on it and scan the label to bind it to the TRF.</p>
          <div className="pfr-tubes">
            {d.tubes.map((tube, i) => {
              const tn = tubeNotes[tube.row];
              const bound = Boolean(tube.universal_barcode);
              const rejected = tube.status === 'Rejected';
              const rowBusy = busy === `tube:${tube.row}`;
              return (
                <article key={tube.row} className={`pfr-tube${bound ? ' is-bound' : ''}${rejected ? ' is-rejected' : ''}`}>
                  <span className="pfr-tube-cap" style={{ background: capColor(tube.tube_code) }} aria-hidden>
                    {i + 1}
                  </span>
                  <div className="pfr-tube-body">
                    <div className="pfr-tube-head">
                      <strong>{tube.tube_code}</strong>
                      {tube.volume_ml ? <span className="pfr-muted">{tube.volume_ml} ml</span> : null}
                      <span className={`pfr-pill ${tube.status.toLowerCase()}`}>{tube.status}</span>
                    </div>
                    {tube.linked_tests ? <p className="pfr-tube-tests">{tube.linked_tests}</p> : null}
                    {tube.accession_id ? <small className="pfr-muted">Accession {tube.accession_id}</small> : null}
                    {bound ? <p className="pfr-bound">✓ {tube.universal_barcode}</p> : null}
                    {tn ? <p className={`pfr-note ${tn.kind}`}>{tn.text}</p> : null}
                  </div>
                  {!rejected ? (
                    <div className="pfr-tube-actions">
                      {bound ? (
                        <button type="button" className="pfr-btn danger-ghost sm" disabled={busy !== null} onClick={() => void unbind(tube)}>
                          {rowBusy ? '…' : 'Remove'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="pfr-btn primary sm"
                          disabled={busy !== null}
                          onClick={() => {
                            note(tube.row, null);
                            setScanTube(tube);
                          }}
                        >
                          {rowBusy ? '…' : 'Scan'}
                        </button>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
          {!d.tubes.length ? <p className="pfr-muted">No draw plan yet. Pull to refresh or contact operations.</p> : null}
          <button type="button" className="pfr-btn primary block" disabled={!canCollect || busy !== null} onClick={markCollected}>
            {busy === 'collected' ? 'Saving…' : canCollect ? 'Mark collected' : `Label all tubes to continue (${boundCount}/${activeTubes.length})`}
          </button>
        </section>
      ) : null}

      {d.status === 'Collected' ? (
        <section className="pfr-panel">
          <div className="pfr-panel-head">
            <h2>Drop at hub</h2>
          </div>

          <div className={`pfr-handover-step${hub ? ' is-done' : ''}`}>
            <h3>1. Scan hub QR / barcode</h3>
            {hub ? (
              <div className="pfr-hub">
                <strong>{hub.hub_name}</strong>
                <small className="pfr-muted">{hub.hub_code}</small>
                {hub.address ? <p>{hub.address}</p> : null}
                <p className="pfr-muted">Receiving lab: {hub.receiving_lab_name || hub.receiving_lab || '—'}</p>
                {hubDistance != null ? (
                  <p className={geofence && hubDistance > geofence ? 'pfr-note warn' : 'pfr-muted'}>
                    {fmtDistance(hubDistance)} from you
                    {geofence && hubDistance > geofence ? ` — outside the ${fmtDistance(geofence)} hub zone. You can still hand over; ops will review.` : ''}
                  </p>
                ) : null}
              </div>
            ) : null}
            {hubError ? <p className="pfr-error">{hubError}</p> : null}
            <button type="button" className={`pfr-btn ${hub ? 'ghost' : 'primary'}`} disabled={busy !== null} onClick={() => setHubScanOpen(true)}>
              {busy === 'hub' ? 'Looking up…' : hub ? 'Scan a different hub' : 'Scan hub code'}
            </button>
          </div>

          <div className={`pfr-handover-step${allScanned ? ' is-done' : ''}`}>
            <h3>
              2. Scan every tube ({scanned.filter((c) => jobCodes.includes(c)).length}/{jobCodes.length})
            </h3>
            <ul className="pfr-checklist">
              {jobCodes.map((code) => {
                const ok = scanned.includes(code);
                return (
                  <li key={code} className={ok ? 'is-ok' : ''}>
                    <span className="pfr-check" aria-hidden>
                      {ok ? '✓' : ''}
                    </span>
                    {code}
                  </li>
                );
              })}
            </ul>
            {scanMsg ? <p className="pfr-note ok">{scanMsg}</p> : null}
            <button
              type="button"
              className={`pfr-btn ${allScanned ? 'ghost' : 'primary'}`}
              disabled={busy !== null || !jobCodes.length || allScanned}
              onClick={() => {
                setScanMsg(null);
                setCodeScanOpen(true);
              }}
            >
              {allScanned ? 'All tubes scanned' : 'Scan tubes'}
            </button>
          </div>

          <div className="pfr-handover-step">
            <h3>3. Confirm handover</h3>
            <button type="button" className="pfr-btn primary block" disabled={!hub || !allScanned || busy !== null} onClick={confirmDrop}>
              {busy === 'drop' ? 'Handing over…' : 'Confirm handover'}
            </button>
          </div>
        </section>
      ) : null}

      {(d.status === 'Dropped' || d.status === 'Received') && dropResult ? (
        <section className="pfr-panel pfr-success">
          <h2>✓ Handed over</h2>
          <p>
            Payout <b>{money(dropResult.payout?.amount ?? dropResult.rider_payout)}</b> has been recorded for this job.
          </p>
          {dropResult.geofence_warning ? (
            <p className="pfr-note warn">
              Your location was {dropResult.distance_m != null ? fmtDistance(dropResult.distance_m) : 'too far'} from the hub. Operations
              will review this drop.
            </p>
          ) : null}
          {dropResult.hub_lab_mismatch ? (
            <p className="pfr-note warn">This hub sends samples to a different lab than the one on the TRF. Operations has been alerted.</p>
          ) : null}
        </section>
      ) : null}

      {d.status === 'Dropped' || d.status === 'Received' ? (
        <section className="pfr-panel">
          <div className="pfr-panel-head">
            <h2>Summary</h2>
            <span className={`pfr-status ${d.status === 'Received' ? 'done' : 'inroute'}`}>{d.status}</span>
          </div>
          <dl className="pfr-facts">
            <div>
              <dt>Hub</dt>
              <dd>{d.dropped_hub || '—'}</dd>
            </div>
            <div>
              <dt>Dropped</dt>
              <dd>{fmtDateTime(d.dropped_on)}</dd>
            </div>
            <div>
              <dt>Collected</dt>
              <dd>{fmtDateTime(d.collected_on)}</dd>
            </div>
            <div>
              <dt>Payout</dt>
              <dd>
                {money(d.payout?.amount ?? d.rider_payout)}
                {d.payout_entry || d.payout?.name ? <small className="pfr-muted"> · {d.payout_entry || d.payout?.name}</small> : null}
              </dd>
            </div>
          </dl>
          <ul className="pfr-checklist">
            {d.tubes
              .filter((t) => t.universal_barcode)
              .map((t) => (
                <li key={t.row} className="is-ok">
                  <span className="pfr-tube-dot" style={{ background: capColor(t.tube_code) }} aria-hidden />
                  {t.universal_barcode} · {t.tube_code} · {t.status}
                </li>
              ))}
          </ul>
          <Link className="pfr-btn ghost block" to={boardPath}>
            Back to job board
          </Link>
        </section>
      ) : null}

      <BarcodeScanner
        open={scanTube !== null}
        onClose={() => setScanTube(null)}
        onDetected={(code) => {
          if (scanTube) void onTubeScanned(scanTube, code);
        }}
        formats={['code_128', 'qr_code']}
        title={scanTube ? `Scan ${scanTube.tube_code} label` : 'Scan label'}
        hint="Scan the PF label you just stuck on this tube."
        validate={(code) => pfCodeError(code, 'PF')}
      />
      <BarcodeScanner
        open={hubScanOpen}
        onClose={() => setHubScanOpen(false)}
        onDetected={(code) => void onHubScanned(code)}
        formats={['qr_code', 'code_128']}
        title="Scan hub QR / barcode"
        hint="The hub code is printed on the drop box or counter (HUB-…)."
        validate={(code) => pfCodeError(code, 'HUB')}
      />
      <BarcodeScanner
        open={codeScanOpen}
        onClose={() => setCodeScanOpen(false)}
        onDetected={onDropCodeScanned}
        formats={['code_128', 'qr_code']}
        title={`Scan tubes (${scanned.filter((c) => jobCodes.includes(c)).length}/${jobCodes.length})`}
        hint="Scan each tube label one after another; matched tubes turn green."
        validate={validateDropCode}
        continuous
      />
    </div>
  );
}
