import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api } from '../../../api';
import type { PfEarnings, PfJobCard, PfJobStatus, PfMyJobs, PfOpenJobs, PfRiderProfile } from '../../../types/phlebofirst';
import { usePfPaths } from '../../phlebofirst/app/pfPaths';
import '../collector-v2.css';
import './pf-rider.css';

type Tab = 'available' | 'mine' | 'earnings';
type Coords = { lat: number; lng: number };

const REFRESH_MS = 30_000;
const NOT_RIDER = /not an? (active )?phlebofirst rider/i;
const POSITION_LABEL: Record<string, string> = { live: 'live location', home: 'home base', device: 'this device' };

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
  return d ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
}

function fmtWindow(start?: string | null, end?: string | null) {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s && !e) return 'Any time';
  const time = (d: Date) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  if (s && e) return `${s.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} ${time(s)} – ${time(e)}`;
  return fmtDateTime(start || end);
}

function slaInfo(due: string | null | undefined, now: number) {
  const d = parseDate(due);
  if (!d) return null;
  const diff = d.getTime() - now;
  const mins = Math.max(0, Math.round(Math.abs(diff) / 60000));
  const span = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  if (diff < 0) return { text: `SLA overdue by ${span}`, tone: 'bad' };
  return { text: `SLA ${span} left`, tone: diff < 30 * 60000 ? 'warn' : 'ok' };
}

function statusTone(status: PfJobStatus | string) {
  if (status === 'Accepted' || status === 'Open') return 'pending';
  if (status === 'Started' || status === 'Collected') return 'inroute';
  if (status === 'Dropped' || status === 'Received') return 'done';
  return 'bad';
}

function statusLabel(status: string) {
  return status === 'Started' ? 'En Route' : status;
}

function currentPosition(timeoutMs = 7000): Promise<Coords | null> {
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
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

function RiderStock({ rider }: { rider: PfRiderProfile }) {
  const stock = Object.entries(rider.barcode_stock || {});
  return (
    <section className="pfr-panel">
      <div className="pfr-panel-head">
        <h2>My barcode stock</h2>
        <span className="pfr-muted">{rider.kit ? `Kit ${rider.kit}` : 'No kit assigned'}</span>
      </div>
      {stock.length ? (
        <div className="pfr-stock">
          {stock.map(([tube, count]) => (
            <span key={tube} className={`pfr-stock-chip${count <= 2 ? ' low' : ''}`}>
              <i className={`pfr-cap cap-${tube}`} aria-hidden />
              {tube} <b>{count}</b>
            </span>
          ))}
        </div>
      ) : (
        <p className="pfr-muted">No unused PF labels with you. Ask operations for a kit before accepting jobs.</p>
      )}
    </section>
  );
}

export function PfJobBoardPage({ initialTab = 'available' }: { initialTab?: Tab }) {
  const navigate = useNavigate();
  const paths = usePfPaths();
  const now = useNow();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [pos, setPos] = useState<Coords | null>(null);
  const [posReady, setPosReady] = useState(false);
  const [open, setOpen] = useState<PfOpenJobs | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);

  const [mine, setMine] = useState<PfMyJobs | null>(null);
  const [mineLoading, setMineLoading] = useState(false);
  const [mineError, setMineError] = useState<string | null>(null);
  const [releasing, setReleasing] = useState<string | null>(null);

  const [earnings, setEarnings] = useState<PfEarnings | null>(null);
  const [earnLoading, setEarnLoading] = useState(false);
  const [earnError, setEarnError] = useState<string | null>(null);

  const handleError = useCallback((e: unknown, fallback: string, set: (v: string | null) => void) => {
    const message = errText(e, fallback);
    if (NOT_RIDER.test(message)) setBlocked(message);
    else set(message);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    void currentPosition().then((p) => {
      if (cancelled) return;
      setPos(p);
      setPosReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadOpen = useCallback(async () => {
    setOpenLoading(true);
    setOpenError(null);
    try {
      const res = await api.pfOpenJobs(pos?.lat, pos?.lng);
      setOpen(res.data);
    } catch (e) {
      handleError(e, 'Could not load available jobs', setOpenError);
    } finally {
      setOpenLoading(false);
    }
  }, [pos, handleError]);

  const loadMine = useCallback(async () => {
    setMineLoading(true);
    setMineError(null);
    try {
      const res = await api.pfMyJobs();
      setMine(res.data);
    } catch (e) {
      handleError(e, 'Could not load your jobs', setMineError);
    } finally {
      setMineLoading(false);
    }
  }, [handleError]);

  const loadEarnings = useCallback(async () => {
    setEarnLoading(true);
    setEarnError(null);
    try {
      const res = await api.pfMyEarnings();
      setEarnings(res.data);
    } catch (e) {
      handleError(e, 'Could not load earnings', setEarnError);
    } finally {
      setEarnLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    if (tab !== 'available' || !posReady || blocked) return undefined;
    void loadOpen();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadOpen();
    }, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [tab, posReady, blocked, loadOpen]);

  useEffect(() => {
    if (blocked) return;
    if (tab === 'mine') void loadMine();
    if (tab === 'earnings') void loadEarnings();
  }, [tab, blocked, loadMine, loadEarnings]);

  async function accept(job: PfJobCard) {
    setAccepting(job.name);
    setOpenError(null);
    try {
      await api.pfAcceptJob(job.name, pos?.lat, pos?.lng);
      navigate(`${paths.jobs}/${encodeURIComponent(job.name)}`);
    } catch (e) {
      const message = errText(e, 'Could not accept this job');
      if (/already been taken/i.test(message)) {
        setToast('Another rider accepted this job first. The list has been refreshed.');
        void loadOpen();
      } else {
        handleError(e, 'Could not accept this job', setOpenError);
      }
    } finally {
      setAccepting(null);
    }
  }

  async function release(job: PfJobCard) {
    const reason = window.prompt('Why are you releasing this job? It will go back to other riders.');
    if (reason == null) return;
    setReleasing(job.name);
    setMineError(null);
    try {
      await api.pfReleaseJob(job.name, reason.trim());
      setToast(`Released ${job.name}.`);
      await loadMine();
    } catch (e) {
      handleError(e, 'Could not release the job', setMineError);
    } finally {
      setReleasing(null);
    }
  }

  if (blocked) {
    return (
      <div className="cp-page pfr-page">
        <section className="pfr-hero">
          <h1>PhleboFirst jobs</h1>
        </section>
        <div className="pfr-empty pfr-panel">
          <strong>PhleboFirst is not enabled for you</strong>
          <p>{blocked}</p>
        </div>
      </div>
    );
  }

  const position = open?.position;

  return (
    <div className="cp-page pfr-page">
      <section className="pfr-hero">
        <div>
          <h1>PhleboFirst jobs</h1>
          <p>Pick up home collections near you, draw against the plan and drop at a hub.</p>
        </div>
      </section>

      {toast ? (
        <div className="pfr-toast" role="status">
          {toast}
        </div>
      ) : null}

      <nav className="pfr-tabs" aria-label="Job board sections">
        {(
          [
            ['available', `Available${open ? ` (${open.jobs.length})` : ''}`],
            ['mine', `My jobs${mine ? ` (${mine.active.length})` : ''}`],
            ['earnings', 'Earnings'],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button key={key} type="button" className={`pfr-tab${tab === key ? ' is-on' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'available' ? (
        <section className="pfr-section">
          <div className="pfr-bar">
            <span className="pfr-muted">
              {!posReady
                ? 'Getting your location…'
                : position
                  ? `Distances from your ${POSITION_LABEL[position.source] || position.source}`
                  : 'Location unavailable — distances may be missing'}
              {' · auto-refresh 30 s'}
            </span>
            <button type="button" className="pfr-btn ghost" disabled={openLoading || !posReady} onClick={() => void loadOpen()}>
              {openLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {openError ? <p className="pfr-error">{openError}</p> : null}
          {!open && openLoading ? <p className="pfr-empty">Loading jobs near you…</p> : null}
          {open && !open.jobs.length ? (
            <div className="pfr-empty pfr-panel">
              <strong>No open jobs right now</strong>
              <p>New collections are broadcast in widening circles. Keep this page open; it refreshes every 30 seconds.</p>
            </div>
          ) : null}
          <div className="pfr-cards">
            {open?.jobs.map((job) => {
              const sla = slaInfo(job.sla_due, now);
              return (
                <article key={job.name} className={`pfr-card${job.offered ? ' is-offered' : ''}`}>
                  <div className="pfr-card-head">
                    <div className="pfr-card-title">
                      <strong>{job.pickup_area || 'Area not set'}</strong>
                      <small>{job.lab_name || job.lab || 'Lab'}</small>
                    </div>
                    <div className="pfr-pay">
                      <b>{money(job.rider_payout)}</b>
                      <small>your payout</small>
                    </div>
                  </div>
                  <div className="pfr-badges">
                    {job.offered ? <span className="pfr-badge offer">Offered to you</span> : null}
                    {sla ? <span className={`pfr-badge ${sla.tone}`}>{sla.text}</span> : null}
                  </div>
                  <dl className="pfr-facts">
                    <div>
                      <dt>Distance</dt>
                      <dd>{job.distance_km != null ? `${job.distance_km.toFixed(1)} km` : '—'}</dd>
                    </div>
                    <div>
                      <dt>Window</dt>
                      <dd>{fmtWindow(job.window_start, job.window_end)}</dd>
                    </div>
                    <div>
                      <dt>Tests / tubes</dt>
                      <dd>
                        {job.test_count} / {job.tube_count}
                      </dd>
                    </div>
                    <div>
                      <dt>Collection fee</dt>
                      <dd>{money(job.collection_fee)}</dd>
                    </div>
                  </dl>
                  <p className="pfr-hint">Exact address and patient phone are shown after you accept.</p>
                  <button
                    type="button"
                    className="pfr-btn primary block"
                    disabled={accepting !== null}
                    onClick={() => void accept(job)}
                  >
                    {accepting === job.name ? 'Accepting…' : 'Accept job'}
                  </button>
                </article>
              );
            })}
          </div>
          {open?.rider ? <RiderStock rider={open.rider} /> : null}
        </section>
      ) : null}

      {tab === 'mine' ? (
        <section className="pfr-section">
          <div className="pfr-bar">
            <span className="pfr-muted">Active and recent PhleboFirst jobs</span>
            <button type="button" className="pfr-btn ghost" disabled={mineLoading} onClick={() => void loadMine()}>
              {mineLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {mineError ? <p className="pfr-error">{mineError}</p> : null}
          {!mine && mineLoading ? <p className="pfr-empty">Loading your jobs…</p> : null}
          {mine ? (
            <>
              {mine.active.length ? (
                <div className="pfr-cards">
                  {mine.active.map((job) => {
                    const sla = slaInfo(job.sla_due, now);
                    return (
                      <article key={job.name} className="pfr-card">
                        <Link className="pfr-card-link" to={`${paths.jobs}/${encodeURIComponent(job.name)}`}>
                          <div className="pfr-card-head">
                            <div className="pfr-card-title">
                              <strong>{job.pickup_area || 'Area not set'}</strong>
                              <small>
                                {job.name} · {job.lab_name || job.lab || 'Lab'}
                              </small>
                            </div>
                            <div className="pfr-pay">
                              <b>{money(job.rider_payout)}</b>
                              <small>payout</small>
                            </div>
                          </div>
                          <div className="pfr-badges">
                            <span className={`pfr-status ${statusTone(job.status)}`}>{statusLabel(job.status)}</span>
                            {sla ? <span className={`pfr-badge ${sla.tone}`}>{sla.text}</span> : null}
                          </div>
                          <p className="pfr-muted">Window: {fmtWindow(job.window_start, job.window_end)}</p>
                        </Link>
                        <div className="pfr-card-actions">
                          <Link className="pfr-btn primary" to={`${paths.jobs}/${encodeURIComponent(job.name)}`}>
                            Open job
                          </Link>
                          {job.status === 'Accepted' ? (
                            <button
                              type="button"
                              className="pfr-btn danger-ghost"
                              disabled={releasing !== null}
                              onClick={() => void release(job)}
                            >
                              {releasing === job.name ? 'Releasing…' : 'Release'}
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="pfr-empty pfr-panel">
                  <strong>No active jobs</strong>
                  <p>Accept a job from the Available tab to get started.</p>
                </div>
              )}

              <RiderStock rider={mine.rider} />

              <section className="pfr-panel">
                <div className="pfr-panel-head">
                  <h2>Recent</h2>
                </div>
                {mine.recent.length ? (
                  <ul className="pfr-list">
                    {mine.recent.map((job) => (
                      <li key={job.name}>
                        <Link to={`${paths.jobs}/${encodeURIComponent(job.name)}`}>
                          <span>
                            <strong>{job.pickup_area || job.name}</strong>
                            <small>
                              {job.name} · {fmtDateTime(job.dropped_on || job.collected_on || job.accepted_on)}
                            </small>
                          </span>
                          <span className="pfr-list-end">
                            <span className={`pfr-status ${statusTone(job.status)}`}>{statusLabel(job.status)}</span>
                            <b>{money(job.rider_payout)}</b>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="pfr-muted">No completed jobs yet.</p>
                )}
              </section>
            </>
          ) : null}
        </section>
      ) : null}

      {tab === 'earnings' ? (
        <section className="pfr-section">
          <div className="pfr-bar">
            <span className="pfr-muted">PhleboFirst payouts</span>
            <button type="button" className="pfr-btn ghost" disabled={earnLoading} onClick={() => void loadEarnings()}>
              {earnLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {earnError ? <p className="pfr-error">{earnError}</p> : null}
          {!earnings && earnLoading ? <p className="pfr-empty">Loading earnings…</p> : null}
          {earnings ? (
            <>
              <div className="pfr-stats">
                <article>
                  <small>This month</small>
                  <strong>{money(earnings.this_month)}</strong>
                </article>
                <article>
                  <small>Jobs done</small>
                  <strong>{earnings.jobs_done}</strong>
                </article>
                {(['Accrued', 'Approved', 'Paid'] as const).map((k) => (
                  <article key={k} className={`tone-${k.toLowerCase()}`}>
                    <small>{k}</small>
                    <strong>{money(earnings.totals[k])}</strong>
                  </article>
                ))}
              </div>
              <section className="pfr-panel">
                <div className="pfr-panel-head">
                  <h2>Entries</h2>
                </div>
                {earnings.rows.length ? (
                  <div className="pfr-table-wrap">
                    <table className="pfr-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Job</th>
                          <th>Status</th>
                          <th className="num">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {earnings.rows.map((row) => (
                          <tr key={row.name}>
                            <td>{fmtDateTime(row.posted_on)}</td>
                            <td>{row.entry_type}</td>
                            <td>{row.source_name || '—'}</td>
                            <td>
                              <span className={`pfr-pill ${row.status.toLowerCase()}`}>{row.status}</span>
                              {row.paid_ref ? <small className="pfr-muted"> {row.paid_ref}</small> : null}
                            </td>
                            <td className="num">{money(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="pfr-muted">No payout entries yet. Payouts accrue when you drop samples at a hub.</p>
                )}
              </section>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
