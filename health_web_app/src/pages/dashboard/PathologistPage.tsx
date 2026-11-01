import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { RemarkPresetLibrary } from '../../components/RemarkPresetLibrary';
import type { JourneyActivity } from '../../types/journey';
import type { LabReportDetail } from '../../types/labReport';
import type { PathologistQueue, PathologistQueueRow } from '../../types/pathologist';
import { formatPatientAge } from '../../utils/patientAge';
import './pathologist-v2.css';

type Tab = 'pending_review' | 'ready_for_sign' | 'signed_today' | 'sent_back' | 'all' | 'signed' | 'overdue';
type PreviewTab = 'preview' | 'details' | 'history';

const PAGE_SIZES = [10, 15, 25];

function htmlToPlain(html?: string | null) {
  if (!html) return '';
  if (typeof document === 'undefined') return html.replace(/<[^>]+>/g, '').trim();
  const box = document.createElement('div');
  box.innerHTML = html;
  return (box.innerText || box.textContent || '').replace(/\u00a0/g, ' ').trim();
}

function Icon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
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

function stageTone(stage?: string) {
  if (stage === 'pending_review') return 'amber';
  if (stage === 'ready_for_sign') return 'blue';
  if (stage === 'sent_back') return 'purple';
  if (stage === 'signed') return 'green';
  return 'muted';
}

function priorityTone(priority?: string | null) {
  if (priority === 'STAT') return 'red';
  if (priority === 'High') return 'amber';
  return 'muted';
}

function rowKey(row: PathologistQueueRow) {
  return row.journey_id || row.lab_report || row.trf_id || '';
}

function matchesTab(row: PathologistQueueRow, tab: Tab) {
  if (tab === 'all') return true;
  if (tab === 'signed_today') return Boolean(row.signed_today);
  if (tab === 'overdue') return Boolean(row.overdue);
  if (tab === 'signed') return row.stage === 'signed';
  return row.stage === tab;
}

function rangeLabel(p: LabReportDetail['parameters'][number]) {
  if (p.reference_range_label) return p.reference_range_label;
  const lo = p.lower_range;
  const hi = p.upper_range;
  if (lo != null && hi != null) return `${lo} - ${hi}`;
  if (lo != null) return `≥ ${lo}`;
  if (hi != null) return `≤ ${hi}`;
  return '—';
}

function isAbnormal(flag?: string) {
  const v = (flag || '').toLowerCase();
  return v === 'h' || v === 'l' || v === 'critical' || v === 'high' || v === 'low';
}

function demoOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const LOCKED_STATUSES = new Set(['Authorized', 'Printed', 'signed']);

export function PathologistPage({ signedOnly = false }: { signedOnly?: boolean }) {
  const [queue, setQueue] = useState<PathologistQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<Tab>(signedOnly ? 'signed' : 'pending_review');
  const [q, setQ] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [priority, setPriority] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<PreviewTab>('preview');
  const [detail, setDetail] = useState<LabReportDetail | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [activity, setActivity] = useState<JourneyActivity[]>([]);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState('');
  const [zoom, setZoom] = useState(1);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendReason, setSendReason] = useState('');
  const [signStep, setSignStep] = useState<'confirm' | 'verify' | null>(null);
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [expectedOtp, setExpectedOtp] = useState('');
  const [password, setPassword] = useState('');
  const [signError, setSignError] = useState('');
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api.getPathologistQueue(200);
      setQueue(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load pathologist queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setTab(signedOnly ? 'signed' : 'pending_review');
    setSelectedKey(null);
  }, [signedOnly]);

  const counts = queue?.counts;
  const canAct = Boolean(queue?.can_act);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (queue?.items || []).filter((row) => {
      if (!matchesTab(row, tab)) return false;
      if (priority !== 'all' && (row.priority || '') !== priority) return false;
      if (fromDate && (row.sample_date || row.modified || '') < fromDate) return false;
      if (toDate && (row.sample_date || row.modified || '') > `${toDate} 23:59:59`) return false;
      if (!needle) return true;
      return [row.trf_id, row.patient_name, row.tests, row.lab_report].some((v) =>
        (v || '').toLowerCase().includes(needle),
      );
    });
  }, [fromDate, priority, q, queue?.items, tab, toDate]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [tab, q, priority, fromDate, toDate, pageSize]);

  const selected = useMemo(
    () => (queue?.items || []).find((row) => rowKey(row) === selectedKey) || null,
    [queue?.items, selectedKey],
  );

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setPreviewHtml('');
      setActivity([]);
      return;
    }
    let cancelled = false;
    setRemarks(selected.pathologist_notes || '');
    setPreviewTab('preview');
    (async () => {
      try {
        const detailRes = selected.lab_report
          ? await api.getLabReportDetail({ lab_report: selected.lab_report })
          : selected.trf_id
            ? await api.getLabReportDetail({ trf_id: selected.trf_id })
            : null;
        if (cancelled) return;
        const next = detailRes?.data || null;
        setDetail(next);
        const savedRemarks = htmlToPlain(next?.comments) || selected.pathologist_notes || '';
        if (savedRemarks) setRemarks(savedRemarks);
        if (next?.lab_report) {
          try {
            const html = await api.getLabReportPreviewHtml(next.lab_report);
            if (!cancelled) setPreviewHtml(html);
          } catch {
            if (!cancelled) setPreviewHtml('');
          }
        }
        if (selected.journey_id) {
          try {
            const act = await api.getJourneyActivity(selected.journey_id);
            if (!cancelled) setActivity(act.data?.activity || []);
          } catch {
            if (!cancelled) setActivity([]);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to open report.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function run(action: string, fn: () => Promise<void>) {
    setBusy(action);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy('');
    }
  }

  function openReview(row: PathologistQueueRow) {
    setSelectedKey(rowKey(row));
  }

  async function refreshPreview(labReport?: string | null) {
    const name = labReport || detail?.lab_report || selected?.lab_report;
    if (!name) return;
    try {
      const html = await api.getLabReportPreviewHtml(name);
      setPreviewHtml(html);
      const fresh = await api.getLabReportDetail({ lab_report: name });
      setDetail(fresh.data);
    } catch {
      /* keep current preview */
    }
  }

  async function saveDraft() {
    if (!selected || !canAct) return;
    if (!selected.lab_report && !selected.journey_id) {
      setError('Open a report before saving remarks.');
      return;
    }
    await run('draft', async () => {
      const res = await api.pathologistSaveDraft({
        journey_id: selected.journey_id || undefined,
        lab_report: selected.lab_report || detail?.lab_report || undefined,
        remarks,
      });
      setNotice(res.message || 'Remarks saved with the report.');
      await load();
      await refreshPreview(res.data.lab_report || selected.lab_report);
    });
  }

  async function confirmSendBack() {
    if (!selected || !canAct) return;
    const reason = sendReason.trim();
    if (!reason) {
      setError('A send-back reason is required.');
      return;
    }
    await run('send', async () => {
      await api.pathologistSendBack({
        journey_id: selected.journey_id || undefined,
        lab_report: selected.lab_report || undefined,
        reason,
      });
      setSendBackOpen(false);
      setSendReason('');
      setSelectedKey(null);
      setNotice('Report sent back to the lab for modification.');
      await load();
    });
  }

  function startSign() {
    if (!selected || !canAct) return;
    if (!selected.lab_report && !selected.journey_id && !detail?.lab_report) {
      setError('Open a report before signing.');
      return;
    }
    setSignError('');
    setSignStep('confirm');
    const code = demoOtp();
    setExpectedOtp(code);
    setOtp(code.split(''));
    setPassword('');
  }

  async function finalizeSign() {
    setSignError('');
    if (otp.join('') !== expectedOtp) {
      setSignError('Verification code does not match. Re-enter the 6-digit OTP shown above.');
      return;
    }
    if (!password.trim()) {
      setSignError('Enter your password to complete the digital signature.');
      return;
    }
    await run('sign', async () => {
      try {
        await api.verifyLabUserPassword(password);
        const res = await api.pathologistFinalize({
          journey_id: selected?.journey_id || detail?.care_journey || undefined,
          lab_report: selected?.lab_report || detail?.lab_report || undefined,
          remarks,
        });
        setSignStep(null);
        setPassword('');
        setNotice(res.message || 'Report signed and finalized as Authorized.');
        await load();
        await refreshPreview(res.data.lab_report || selected?.lab_report);
      } catch (err) {
        setSignError(err instanceof Error ? err.message : 'Could not sign and finalize this report.');
      }
    });
  }

  function onOtpChange(idx: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[idx] = digit;
    setOtp(next);
    if (digit && idx < 5) otpRefs.current[idx + 1]?.focus();
  }

  const splitOpen = Boolean(selected);
  const signedLocked =
    signedOnly ||
    selected?.stage === 'signed' ||
    LOCKED_STATUSES.has(detail?.report_status || '') ||
    LOCKED_STATUSES.has(selected?.report_status || '');

  return (
    <div className="po-page">
      {error ? <p className="po-error">{error}</p> : null}
      {notice ? <p className="po-empty" style={{ background: '#ecfdf5', color: '#047857' }}>{notice}</p> : null}

      {!signedOnly ? (
        <div className="po-kpis">
          <button type="button" className={`po-kpi tone-mint${tab === 'pending_review' ? ' is-active' : ''}`} onClick={() => setTab('pending_review')}>
            <span className="po-kpi-icon">
              <Icon>
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <path d="M14 3v5h5M9 13h6M9 17h6" />
              </Icon>
            </span>
            <span className="po-kpi-copy">
              <strong>{counts?.pending_review ?? 0}</strong>
              <b>Pending Review</b>
              <small>Reports awaiting your review</small>
            </span>
            <span className="po-kpi-go">›</span>
          </button>
          <button type="button" className={`po-kpi tone-blue${tab === 'ready_for_sign' ? ' is-active' : ''}`} onClick={() => setTab('ready_for_sign')}>
            <span className="po-kpi-icon">
              <Icon>
                <circle cx="12" cy="12" r="8" />
                <path d="m8.5 12.5 2.2 2.2 4.8-5" />
              </Icon>
            </span>
            <span className="po-kpi-copy">
              <strong>{counts?.ready_for_sign ?? 0}</strong>
              <b>Ready for Sign</b>
              <small>Reviewed and awaiting signature</small>
            </span>
            <span className="po-kpi-go">›</span>
          </button>
          <button type="button" className={`po-kpi tone-purple${tab === 'sent_back' ? ' is-active' : ''}`} onClick={() => setTab('sent_back')}>
            <span className="po-kpi-icon">
              <Icon>
                <path d="M9 14H4V9" />
                <path d="M20 12a8 8 0 1 0-2.2 5.5L4 9" />
              </Icon>
            </span>
            <span className="po-kpi-copy">
              <strong>{counts?.sent_back ?? 0}</strong>
              <b>Sent Back</b>
              <small>Returned for modification</small>
            </span>
            <span className="po-kpi-go">›</span>
          </button>
          <button type="button" className={`po-kpi tone-amber${tab === 'overdue' ? ' is-active' : ''}`} onClick={() => setTab('overdue')}>
            <span className="po-kpi-icon">
              <Icon>
                <circle cx="12" cy="12" r="8" />
                <path d="M12 8v4l3 2" />
              </Icon>
            </span>
            <span className="po-kpi-copy">
              <strong>{counts?.overdue ?? 0}</strong>
              <b>Overdue</b>
              <small>Reports {'>'} 24 hours</small>
            </span>
            <span className="po-kpi-go">›</span>
          </button>
        </div>
      ) : null}

      <div className="po-toolbar">
        <div className="po-tabs" role="tablist">
          {(signedOnly
            ? [
                ['signed', `All Signed (${counts?.signed ?? 0})`],
                ['signed_today', `Signed Today (${counts?.signed_today ?? 0})`],
              ]
            : [
                ['pending_review', `Pending Review (${counts?.pending_review ?? 0})`],
                ['ready_for_sign', `Ready for Sign (${counts?.ready_for_sign ?? 0})`],
                ['signed_today', `Signed (Today)`],
                ['sent_back', `Sent Back (${counts?.sent_back ?? 0})`],
                ['all', 'All Reports'],
              ]
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" className={`po-tab${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id as Tab)}>
              {label}
            </button>
          ))}
        </div>
        <div className="po-tools">
          <label className="po-search">
            <Icon size={16}>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </Icon>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by TRF No., patient name, test name…"
            />
          </label>
          <button type="button" className={`po-adv${filtersOpen ? ' is-open' : ''}`} onClick={() => setFiltersOpen((v) => !v)}>
            + Advanced Filters
          </button>
        </div>
      </div>

      {filtersOpen ? (
        <div className="po-filters">
          <label>
            From
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          <label>
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="all">All</option>
              <option value="STAT">STAT</option>
              <option value="High">High</option>
              <option value="Routine">Routine</option>
            </select>
          </label>
          <label>
            Rows
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div className={`po-split${splitOpen ? ' is-open' : ''}`}>
        <div className="po-card">
          <div className="po-table-wrap">
            <table className="po-table">
              <thead>
                <tr>
                  <th>TRF No.</th>
                  <th>Patient</th>
                  <th>Tests</th>
                  <th>Sample Date</th>
                  <th>Status</th>
                  <th>TAT</th>
                  <th>Priority</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8}>
                      <p className="po-empty">Loading reports…</p>
                    </td>
                  </tr>
                ) : pageRows.length ? (
                  pageRows.map((row) => (
                    <tr
                      key={rowKey(row)}
                      className={rowKey(row) === selectedKey ? 'is-selected' : ''}
                      onClick={() => openReview(row)}
                    >
                      <td className="po-trf">{row.trf_id || '—'}</td>
                      <td>
                        <div>{row.patient_name || '—'}</div>
                        <small style={{ color: '#64748b' }}>{row.age_gender || ''}</small>
                      </td>
                      <td className="po-tests">{row.tests || '—'}</td>
                      <td>{formatWhen(row.sample_date)}</td>
                      <td>
                        <span className={`po-badge tone-${stageTone(row.stage)}`}>{row.stage_label || row.stage}</span>
                      </td>
                      <td>{row.tat || '—'}</td>
                      <td>
                        <span className={`po-badge tone-${priorityTone(row.priority)}`}>{row.priority || 'Routine'}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="po-review"
                          onClick={(e) => {
                            e.stopPropagation();
                            openReview(row);
                          }}
                        >
                          {row.stage === 'signed' ? 'View' : 'Review'}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8}>
                      <p className="po-empty">No reports in this view.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="po-foot">
            <span>
              Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
            </span>
            <div className="po-pager">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ‹
              </button>
              <button type="button" className="is-active">
                {page}
              </button>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                ›
              </button>
            </div>
          </div>
        </div>

        {selected ? (
          <div className="po-card po-workspace">
            <div className="po-ws-tabs">
              <button type="button" className={`po-ws-tab${previewTab === 'preview' ? ' is-active' : ''}`} onClick={() => setPreviewTab('preview')}>
                Report Preview
              </button>
              <button type="button" className={`po-ws-tab${previewTab === 'details' ? ' is-active' : ''}`} onClick={() => setPreviewTab('details')}>
                Patient & Sample Details
              </button>
              <button type="button" className={`po-ws-tab${previewTab === 'history' ? ' is-active' : ''}`} onClick={() => setPreviewTab('history')}>
                History
              </button>
            </div>

            {previewTab === 'preview' ? (
              <>
                <div className="po-preview-tools">
                  <button type="button" onClick={() => setZoom((z) => Math.max(0.7, z - 0.1))}>−</button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button type="button" onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))}>+</button>
                  <span style={{ marginLeft: 'auto', fontSize: '0.78rem' }}>Page 1</span>
                  {detail?.lab_report ? (
                    <button
                      type="button"
                      onClick={() => {
                        const win = window.open('', '_blank');
                        if (win) {
                          win.document.write(previewHtml || document.querySelector('.po-report')?.outerHTML || '');
                          win.document.close();
                        }
                      }}
                    >
                      Open
                    </button>
                  ) : null}
                </div>
                <div className="po-preview-frame">
                  {previewHtml ? (
                    <iframe title="Lab report preview" srcDoc={previewHtml} style={{ transform: `scale(${zoom})`, width: `${100 / zoom}%` }} />
                  ) : (
                    <FallbackReport detail={detail} selected={selected} />
                  )}
                </div>
              </>
            ) : null}

            {previewTab === 'details' ? (
              <div className="po-details">
                <dl className="po-dl">
                  <dt>Patient</dt>
                  <dd>{detail?.patient_name || selected.patient_name || '—'}</dd>
                  <dt>Age / Gender</dt>
                  <dd>{formatPatientAge(detail) || selected.age_gender || '—'}{detail?.gender ? ` / ${detail.gender}` : ''}</dd>
                  <dt>TRF No.</dt>
                  <dd>{detail?.customer_trf || selected.trf_id || '—'}</dd>
                  <dt>Sample ID</dt>
                  <dd>{detail?.unique_barcode || '—'}</dd>
                  <dt>Specimen</dt>
                  <dd>{detail?.specimen || '—'}</dd>
                  <dt>Sample date</dt>
                  <dd>{formatWhen(detail?.sample_date || selected.sample_date)}</dd>
                  <dt>Received</dt>
                  <dd>{formatWhen(detail?.lab_receipt_date)}</dd>
                  <dt>Referred by</dt>
                  <dd>{detail?.referral_doctor || '—'}</dd>
                  <dt>Tests</dt>
                  <dd>{detail?.test_required || selected.tests || '—'}</dd>
                  <dt>Report status</dt>
                  <dd>{detail?.report_status || selected.report_status || '—'}</dd>
                </dl>
              </div>
            ) : null}

            {previewTab === 'history' ? (
              <div className="po-history">
                {activity.length ? (
                  <ul className="po-timeline">
                    {activity.map((item, idx) => (
                      <li key={`${item.creation}-${idx}`}>
                        {item.content}
                        <small>
                          {item.owner || 'System'} · {item.ago || formatWhen(item.creation)}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="po-empty">No audit trail yet for this report.</p>
                )}
              </div>
            ) : null}

            <div className="po-remarks">
              <h3>Write Remarks {signedLocked ? '' : '(saved with the report)'}</h3>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Write your clinical comments or observations…"
                disabled={signedLocked || !canAct}
              />
              {!signedLocked ? (
                <RemarkPresetLibrary
                  locked={!canAct || Boolean(busy)}
                  remarks={remarks}
                  onInsert={(text) => setRemarks((cur) => (cur ? `${cur.trim()}\n${text}` : text))}
                />
              ) : null}
              <div className="po-actions">
                <button type="button" className="po-btn ghost" onClick={() => setSelectedKey(null)}>
                  Close
                </button>
                {!signedLocked ? (
                  <>
                    <button type="button" className="po-btn send" disabled={!canAct || Boolean(busy)} onClick={() => setSendBackOpen(true)}>
                      Send Back
                    </button>
                    <button type="button" className="po-btn draft" disabled={!canAct || busy === 'draft'} onClick={() => void saveDraft()}>
                      {busy === 'draft' ? 'Saving remarks…' : 'Save Remarks'}
                    </button>
                    <button type="button" className="po-btn sign" disabled={!canAct || Boolean(busy)} onClick={startSign}>
                      Sign & Finalize Report
                    </button>
                  </>
                ) : (
                  <span className="po-badge tone-green">Authorized / Finalized</span>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {sendBackOpen ? (
        <div className="po-modal" role="dialog" aria-modal="true">
          <form
            className="po-modal-card"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void confirmSendBack();
            }}
          >
            <h2>Send report back</h2>
            <p>A reason is required so the lab technician knows what to correct.</p>
            <textarea
              value={sendReason}
              onChange={(e) => setSendReason(e.target.value)}
              placeholder="Describe the correction needed…"
              required
            />
            <div className="po-actions">
              <button type="button" className="po-btn ghost" onClick={() => setSendBackOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="po-btn send" disabled={busy === 'send'}>
                {busy === 'send' ? 'Sending…' : 'Send Back'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {signStep ? (
        <div className="po-modal" role="dialog" aria-modal="true">
          <div className="po-modal-card">
            {signStep === 'confirm' ? (
              <>
                <h2>Sign & finalize report</h2>
                <p>
                  You are about to digitally authorize {selected?.trf_id || 'this report'} for {selected?.patient_name || 'the patient'}.
                  Results will be locked after signature.
                </p>
                <div className="po-actions">
                  <button type="button" className="po-btn ghost" onClick={() => setSignStep(null)}>
                    Cancel
                  </button>
                  <button type="button" className="po-btn primary" onClick={() => setSignStep('verify')}>
                    Continue to verification
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2>Digital signature verification</h2>
                <p>Confirm the OTP and enter your password to authorize and lock this report.</p>
                <div className="po-demo">Verification OTP (simulated): {expectedOtp}</div>
                <div className="po-otp">
                  {otp.map((d, i) => (
                    <input
                      key={i}
                      ref={(el) => {
                        otpRefs.current[i] = el;
                      }}
                      inputMode="numeric"
                      maxLength={1}
                      value={d}
                      onChange={(e) => onOtpChange(i, e.target.value)}
                      aria-label={`OTP digit ${i + 1}`}
                    />
                  ))}
                </div>
                <label>
                  Password
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setSignError('');
                    }}
                    autoComplete="current-password"
                    style={{ width: '100%', height: 40, marginTop: 6, borderRadius: 8, border: '1px solid #dbe4ea', padding: '0 10px', boxSizing: 'border-box' }}
                  />
                </label>
                {signError ? <p className="po-error">{signError}</p> : null}
                <div className="po-actions">
                  <button type="button" className="po-btn ghost" disabled={busy === 'sign'} onClick={() => setSignStep('confirm')}>
                    Back
                  </button>
                  <button type="button" className="po-btn sign" disabled={busy === 'sign' || !password.trim()} onClick={() => void finalizeSign()}>
                    {busy === 'sign' ? 'Signing & finalizing…' : 'Verify & Finalize'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FallbackReport({ detail, selected }: { detail: LabReportDetail | null; selected: PathologistQueueRow }) {
  const grouped = new Map<string, LabReportDetail['parameters']>();
  for (const p of detail?.parameters || []) {
    if (p.include_in_report === 0) continue;
    const key = p.test_name || p.before_heading || 'Results';
    const list = grouped.get(key) || [];
    list.push(p);
    grouped.set(key, list);
  }
  return (
    <div className="po-report">
      <div className="po-report-head">
        <div>
          <h2 className="po-lab-name">Remedium Lab</h2>
          <p className="po-lab-tag">Transparency, Accuracy & Speed</p>
        </div>
        <span className="po-nabl">NABL Accredited</span>
      </div>
      <div className="po-meta">
        <div><b>Patient Name:</b> {detail?.patient_name || selected.patient_name || '—'}</div>
        <div><b>Sample Date:</b> {formatWhen(detail?.sample_date || selected.sample_date)}</div>
        <div><b>Age / Gender:</b> {formatPatientAge(detail) || selected.age_gender || '—'}{detail?.gender ? ` / ${detail.gender}` : ''}</div>
        <div><b>Received At:</b> {formatWhen(detail?.lab_receipt_date)}</div>
        <div><b>TRF No.:</b> {detail?.customer_trf || selected.trf_id || '—'}</div>
        <div><b>Referred By:</b> {detail?.referral_doctor || '—'}</div>
        <div><b>Status:</b> {detail?.report_status || selected.report_status || '—'}</div>
      </div>
      {htmlToPlain(detail?.comments) ? (
        <div className="po-notes-box">
          <strong>Pathologist Remarks</strong>
          <p>{htmlToPlain(detail?.comments)}</p>
        </div>
      ) : null}
      {grouped.size ? (
        [...grouped.entries()].map(([title, rows]) => (
          <div key={title}>
            <h3 className="po-section">{title}</h3>
            <table className="po-params">
              <thead>
                <tr>
                  <th>Test Name</th>
                  <th>Result</th>
                  <th>Unit</th>
                  <th>Biological Reference Interval</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.name}>
                    <td>{p.description || p.parameter_code}</td>
                    <td className={isAbnormal(p.abnormal_flag) ? 'is-abn' : ''}>{p.result_value || '—'}</td>
                    <td>{p.unit || ''}</td>
                    <td>{rangeLabel(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      ) : (
        <p className="po-empty">Select a report to preview results and reference ranges.</p>
      )}
    </div>
  );
}
