import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../../api';
import type {
  PfJobBoard,
  PfLabInbox,
  PfOcrResult,
  PfRequestDetail,
  PfRequestStatus,
  PfTestHit,
} from '../../../types/phlebofirst';
import { matchesLabTestQuery } from '../../../utils/labTestSearch';
import { PfStatusChip } from '../../pf/PfStatusChip';
import { PfOpenAppLink } from '../../phlebofirst/app/PfOpenAppLink';
import { usePfPaths } from '../../phlebofirst/app/pfPaths';
import '../lab-tech-v2.css';
import './pf-inbox.css';

type Tab = 'pending' | 'active' | 'all' | 'jobs';
type QuoteRow = { item_code: string; item_name: string; mrp: number; rate: string; qty: string };
type FileView = { url: string; type: string };
type OcrMatch = PfOcrResult['diagnostics'][number]['matches'][number];

const PAGE_SIZE = 30;
const QUOTABLE: PfRequestStatus[] = ['Uploaded', 'Under Review'];

function money(n?: number | null) {
  return `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function when(raw?: string | null) {
  if (!raw) return '—';
  const d = new Date(String(raw).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

function windowLabel(start?: string | null, end?: string | null) {
  if (!start && !end) return 'Any time';
  return [start ? when(start) : '', end ? when(end) : ''].filter(Boolean).join(' – ');
}

function num(raw: string) {
  const n = Number(raw);
  return raw.trim() === '' || !Number.isFinite(n) ? NaN : n;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

function rankHits(q: string, hits: PfTestHit[]) {
  const strong: PfTestHit[] = [];
  const weak: PfTestHit[] = [];
  hits.forEach((h) => (matchesLabTestQuery(q, [h.item_name, h.item_code]) ? strong : weak).push(h));
  return [...strong, ...weak];
}

function Info({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children || '—'}</dd>
    </div>
  );
}

export function PfInboxPage() {
  const { inApp } = usePfPaths();
  const [tab, setTab] = useState<Tab>('pending');
  const [q, setQ] = useState('');
  const [qApplied, setQApplied] = useState('');
  const [page, setPage] = useState(1);
  const [inbox, setInbox] = useState<PfLabInbox | null>(null);
  const [counts, setCounts] = useState<PfLabInbox['counts']>({});
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<PfJobBoard | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<PfRequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const openSeq = useRef(0);
  const detailRef = useRef<HTMLElement>(null);

  const [fileView, setFileView] = useState<FileView | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [ocr, setOcr] = useState<PfOcrResult | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [addingCode, setAddingCode] = useState<string | null>(null);

  const [items, setItems] = useState<QuoteRow[]>([]);
  const [testQ, setTestQ] = useState('');
  const [hits, setHits] = useState<PfTestHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [fee, setFee] = useState('0');
  const [payout, setPayout] = useState('0');
  const [payoutPct, setPayoutPct] = useState(0);
  const [payoutTouched, setPayoutTouched] = useState(false);
  const [discount, setDiscount] = useState('0');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQApplied(q.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const loadInbox = useCallback(
    async (silent = false) => {
      if (tab === 'jobs') return;
      if (!silent) setListLoading(true);
      setListError(null);
      try {
        const res = await api.pfLabInbox(tab, qApplied, page, PAGE_SIZE);
        setInbox(res.data);
        setCounts(res.data.counts || {});
      } catch (e) {
        setListError(errMsg(e, 'Could not load the PhleboFirst inbox'));
      } finally {
        if (!silent) setListLoading(false);
      }
    },
    [tab, qApplied, page],
  );

  const loadJobs = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await api.pfLabJobs();
      setJobs(res.data);
    } catch (e) {
      setListError(errMsg(e, 'Could not load active jobs'));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'jobs') void loadJobs();
    else void loadInbox();
  }, [tab, loadInbox, loadJobs]);

  function initBuilder(d: PfRequestDetail) {
    const quote = d.quotation;
    const defaults = d.defaults;
    const pct = defaults?.rider_payout_pct ?? 0;
    const feeValue = quote ? quote.collection_fee : defaults?.collection_fee ?? 0;
    setItems(
      quote
        ? quote.items.map((it) => ({
            item_code: it.item_code,
            item_name: it.item_name || it.item_code,
            mrp: it.mrp,
            rate: String(it.rate),
            qty: String(it.qty || 1),
          }))
        : [],
    );
    setFee(String(feeValue));
    setPayoutPct(pct);
    setPayout(String(quote ? quote.rider_payout : defaults?.rider_payout ?? round2((feeValue * pct) / 100)));
    setPayoutTouched(Boolean(quote));
    setDiscount(String(quote?.discount ?? 0));
    setQuoteNotes(quote?.notes || '');
    setTestQ('');
    setHits([]);
    setFormError(null);
    setRejectOpen(false);
    setRejectReason('');
    setOcr(d.ocr ?? null);
    setOcrError(null);
  }

  async function openRow(name: string, keepNotice = false) {
    const seq = ++openSeq.current;
    setSelected(name);
    setDetail(null);
    setDetailError(null);
    if (!keepNotice) setNotice(null);
    setDetailLoading(true);
    if (window.innerWidth < 1100) {
      window.setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
    try {
      const res = await api.pfOpenRequest(name);
      if (seq !== openSeq.current) return;
      setDetail(res.data);
      initBuilder(res.data);
      setInbox((prev) =>
        prev ? { ...prev, rows: prev.rows.map((r) => (r.name === name ? { ...r, status: res.data.status } : r)) } : prev,
      );
    } catch (e) {
      if (seq === openSeq.current) setDetailError(errMsg(e, 'Could not open the request'));
    } finally {
      if (seq === openSeq.current) setDetailLoading(false);
    }
  }

  function closeDetail() {
    openSeq.current += 1;
    setSelected(null);
    setDetail(null);
    setDetailError(null);
    setNotice(null);
  }

  const fileReqName = detail?.name;
  const fileHas = Boolean(detail?.has_file);
  const fileDeclaredType = detail?.file_type || '';

  useEffect(() => {
    setFileView(null);
    setFileError(null);
    if (!fileReqName || !fileHas) return;
    let cancelled = false;
    let url: string | null = null;
    setFileLoading(true);
    api
      .fetchPfRequestFile(fileReqName)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setFileView({ url, type: fileDeclaredType || blob.type || '' });
      })
      .catch((e: unknown) => {
        if (!cancelled) setFileError(errMsg(e, 'Could not load the file'));
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileReqName, fileHas, fileDeclaredType]);

  const canQuote = Boolean(detail && QUOTABLE.includes(detail.status));

  useEffect(() => {
    const term = testQ.trim();
    if (!canQuote || term.length < 2) {
      setHits([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = window.setTimeout(() => {
      api
        .pfSearchTests(term)
        .then((res) => {
          if (cancelled) return;
          setHits(rankHits(term, res.data.items || []));
          setSearchError(null);
        })
        .catch((e: unknown) => {
          if (!cancelled) setSearchError(errMsg(e, 'Test search failed'));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [testQ, canQuote]);

  function addRow(row: { item_code: string; item_name: string; mrp: number }) {
    setItems((prev) =>
      prev.some((r) => r.item_code === row.item_code)
        ? prev
        : [...prev, { ...row, rate: String(row.mrp || 0), qty: '1' }],
    );
    setFormError(null);
  }

  function updateRow(code: string, patch: Partial<Pick<QuoteRow, 'rate' | 'qty'>>) {
    setItems((prev) => prev.map((r) => (r.item_code === code ? { ...r, ...patch } : r)));
  }

  function removeRow(code: string) {
    setItems((prev) => prev.filter((r) => r.item_code !== code));
  }

  async function addFromMatch(m: OcrMatch) {
    if (items.some((r) => r.item_code === m.item_code)) return;
    setAddingCode(m.item_code);
    let hit: PfTestHit | undefined;
    const queries = Array.from(new Set([m.test_name, m.item_code].map((s) => (s || '').trim()).filter((s) => s.length >= 2)));
    for (const query of queries) {
      try {
        const res = await api.pfSearchTests(query);
        hit = (res.data.items || []).find((h) => h.item_code === m.item_code);
      } catch {
        hit = undefined;
      }
      if (hit) break;
    }
    addRow({ item_code: m.item_code, item_name: hit?.item_name || m.test_name || m.item_code, mrp: hit?.mrp ?? 0 });
    setAddingCode(null);
  }

  async function runOcr() {
    if (!detail) return;
    setOcrBusy(true);
    setOcrError(null);
    try {
      const res = await api.pfRequestOcr(detail.name);
      setOcr(res.data);
    } catch (e) {
      setOcrError(errMsg(e, 'Could not read the photo'));
    } finally {
      setOcrBusy(false);
    }
  }

  function onFeeChange(value: string) {
    setFee(value);
    if (!payoutTouched) {
      const f = num(value);
      setPayout(Number.isFinite(f) ? String(round2((f * payoutPct) / 100)) : '0');
    }
  }

  const totals = useMemo(() => {
    const testTotal = items.reduce((sum, r) => {
      const rate = num(r.rate);
      const qty = num(r.qty);
      return sum + (Number.isFinite(rate) && Number.isFinite(qty) ? rate * qty : 0);
    }, 0);
    const feeN = num(fee);
    const discountN = num(discount);
    const grand = testTotal + (Number.isFinite(feeN) ? feeN : 0) - (Number.isFinite(discountN) ? discountN : 0);
    return { testTotal: round2(testTotal), grand: round2(grand) };
  }, [items, fee, discount]);

  function validateQuote(): string | null {
    if (!items.length) return 'Add at least one test to the quotation.';
    for (const r of items) {
      const rate = num(r.rate);
      const qty = num(r.qty);
      if (!Number.isFinite(rate) || rate < 0) return `Enter a valid rate for ${r.item_name}.`;
      if (!Number.isInteger(qty) || qty < 1 || qty > 10) return `Quantity for ${r.item_name} must be 1–10.`;
    }
    const feeN = num(fee);
    const payoutN = num(payout);
    const discountN = num(discount);
    if (!Number.isFinite(feeN) || feeN < 0) return 'Collection fee must be zero or more.';
    if (!Number.isFinite(payoutN) || payoutN < 0) return 'Rider payout must be zero or more.';
    if (!Number.isFinite(discountN) || discountN < 0) return 'Discount must be zero or more.';
    if (discountN > totals.testTotal + feeN) return 'Discount cannot exceed tests + collection fee.';
    return null;
  }

  async function approve() {
    if (!detail || actionBusy) return;
    const problem = validateQuote();
    setFormError(problem);
    if (problem) return;
    setActionBusy(true);
    setNotice(null);
    try {
      const res = await api.pfApproveRequest(
        detail.name,
        items.map((r) => ({ item_code: r.item_code, rate: num(r.rate), qty: num(r.qty) })),
        { collection_fee: num(fee), rider_payout: num(payout), discount: num(discount), notes: quoteNotes.trim() },
      );
      setDetail(res.data);
      const offers = res.data.offers ?? 0;
      setNotice(
        `${res.data.name} approved — status ${res.data.status}. ${
          offers ? `Offered to ${offers} rider${offers === 1 ? '' : 's'}.` : 'No riders in range yet; it will be re-broadcast.'
        }`,
      );
      void loadInbox(true);
    } catch (e) {
      setFormError(errMsg(e, 'Could not approve the request'));
    } finally {
      setActionBusy(false);
    }
  }

  async function reject() {
    if (!detail || actionBusy) return;
    const reason = rejectReason.trim();
    if (reason.length < 3) {
      setFormError('Enter a rejection reason (at least 3 characters).');
      return;
    }
    setActionBusy(true);
    setFormError(null);
    try {
      const res = await api.pfRejectRequest(detail.name, reason);
      setDetail(res.data);
      setRejectOpen(false);
      setRejectReason('');
      setNotice(`${res.data.name} rejected.`);
      void loadInbox(true);
    } catch (e) {
      setFormError(errMsg(e, 'Could not reject the request'));
    } finally {
      setActionBusy(false);
    }
  }

  function pickTab(next: Tab) {
    setTab(next);
    setPage(1);
  }

  const rows = inbox?.rows || [];
  const total = inbox?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isImage = fileView ? fileView.type.startsWith('image/') : false;
  const isPdf = fileView ? fileView.type.includes('pdf') : false;
  const labNames = (inbox?.labs || []).map((l) => l.lab_name || l.lab).join(', ');

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'pending', label: 'Pending', count: counts.pending },
    { key: 'active', label: 'Active', count: counts.active },
    { key: 'all', label: 'All' },
    { key: 'jobs', label: 'Active jobs', count: jobs ? jobs.rows.length : undefined },
  ];

  return (
    <div className="lt-page pfi-page">
      <div className="pfi-head">
        <div>
          <h2>PhleboFirst inbox</h2>
          <p>
            Review uploaded prescriptions, quote tests and broadcast home collections to riders
            {labNames ? ` · ${labNames}` : ''}.
          </p>
        </div>
        <div className="pfi-head-actions">
          {!inApp ? <PfOpenAppLink className="lt-action is-ghost" path="/app/lab" /> : null}
          <button
            type="button"
            className="lt-action is-ghost"
            onClick={() => void (tab === 'jobs' ? loadJobs() : loadInbox())}
            disabled={listLoading}
          >
            {listLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="pfi-toolbar">
        <div className="lt-chips" role="tablist" aria-label="Inbox view">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`lt-chip${tab === t.key ? ' is-active' : ''}`}
              onClick={() => pickTab(t.key)}
            >
              {t.label}
              {t.count != null ? <span className="pfi-count">{t.count}</span> : null}
            </button>
          ))}
        </div>
        {tab !== 'jobs' ? (
          <label className="lt-search pfi-search">
            <span aria-hidden>⌕</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search request, patient, phone, account" aria-label="Search requests" />
          </label>
        ) : null}
      </div>

      {listError ? <div className="pfi-alert is-err">{listError}</div> : null}

      <div className={`pfi-split${selected ? ' has-detail' : ''}`}>
        <section className="lt-table-card pfi-list">
          {tab === 'jobs' ? (
            <div className="lt-table-wrap">
              {jobs && Object.keys(jobs.job_counts || {}).length ? (
                <div className="pfi-jobcounts">
                  {Object.entries(jobs.job_counts).map(([k, v]) => (
                    <span key={k} className="lt-badge tone-muted">
                      {k}: {v}
                    </span>
                  ))}
                </div>
              ) : null}
              <table className="lt-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Status</th>
                    <th>Pickup area</th>
                    <th>Rider</th>
                    <th>Window</th>
                    <th>Tubes</th>
                    <th>SLA due</th>
                    <th>Hub</th>
                  </tr>
                </thead>
                <tbody>
                  {listLoading && !jobs ? (
                    <tr>
                      <td colSpan={8} className="lt-empty">
                        Loading jobs…
                      </td>
                    </tr>
                  ) : null}
                  {jobs && !jobs.rows.length ? (
                    <tr>
                      <td colSpan={8} className="lt-empty">
                        No active collection jobs.
                      </td>
                    </tr>
                  ) : null}
                  {(jobs?.rows || []).map((j) => (
                    <tr
                      key={j.name}
                      className={`pfi-row${selected === j.request ? ' is-selected' : ''}`}
                      onClick={() => void openRow(j.request)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void openRow(j.request);
                      }}
                    >
                      <td className="lt-trf">
                        {j.name}
                        <small className="pfi-sub">{j.request}</small>
                      </td>
                      <td>
                        <span className="lt-badge tone-blue">{j.status}</span>
                        {j.overdue ? <span className="lt-badge tone-red pfi-gap">Overdue</span> : null}
                      </td>
                      <td>{j.pickup_area || '—'}</td>
                      <td>{j.rider_name || j.rider || <span className="pfi-muted">{j.offers} offers</span>}</td>
                      <td>{windowLabel(j.window_start, j.window_end)}</td>
                      <td>{j.tube_count || '—'}</td>
                      <td>{when(j.sla_due)}</td>
                      <td>
                        {j.dropped_hub || '—'}
                        {j.drop_geofence_warning ? (
                          <span className="lt-badge tone-amber pfi-gap" title="Drop recorded outside the hub geofence">
                            Geofence
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div className="lt-table-wrap">
                <table className="lt-table">
                  <thead>
                    <tr>
                      <th>Request</th>
                      <th>Patient</th>
                      <th>Account</th>
                      <th>Lab</th>
                      <th>Pickup</th>
                      <th>Window</th>
                      <th>Submitted</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listLoading && !rows.length ? (
                      <tr>
                        <td colSpan={8} className="lt-empty">
                          Loading requests…
                        </td>
                      </tr>
                    ) : null}
                    {!listLoading && inbox && !rows.length ? (
                      <tr>
                        <td colSpan={8} className="lt-empty">
                          {tab === 'pending' ? 'Nothing waiting for review.' : 'No requests match.'}
                        </td>
                      </tr>
                    ) : null}
                    {rows.map((r) => (
                      <tr
                        key={r.name}
                        className={`pfi-row${selected === r.name ? ' is-selected' : ''}`}
                        onClick={() => void openRow(r.name)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void openRow(r.name);
                        }}
                      >
                        <td className="lt-trf">{r.name}</td>
                        <td>
                          {r.patient_name}
                          <small className="pfi-sub">
                            {[r.patient_age != null ? `${r.patient_age} y` : '', r.patient_gender || ''].filter(Boolean).join(' / ')}
                          </small>
                        </td>
                        <td>
                          {r.account_name || r.account || '—'}
                          {r.account_type ? <small className="pfi-sub">{r.account_type}</small> : null}
                        </td>
                        <td>{r.lab_name || r.assigned_lab || '—'}</td>
                        <td>{r.pickup_area || '—'}</td>
                        <td>{windowLabel(r.preferred_window_start, r.preferred_window_end)}</td>
                        <td>{when(r.submitted_on)}</td>
                        <td>
                          <PfStatusChip status={r.status} />
                          {r.job_status ? <small className="pfi-sub">Job: {r.job_status}</small> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 ? (
                <div className="lt-table-foot">
                  <span>
                    Page {page} of {pages} · {total} requests
                  </span>
                  <div className="pfi-pager">
                    <button type="button" className="lt-action is-ghost" disabled={page <= 1 || listLoading} onClick={() => setPage((p) => p - 1)}>
                      ‹ Prev
                    </button>
                    <button type="button" className="lt-action is-ghost" disabled={page >= pages || listLoading} onClick={() => setPage((p) => p + 1)}>
                      Next ›
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>

        {selected ? (
          <section className="pfi-detail" ref={detailRef} aria-label="Request detail">
            <div className="pfi-detail-head">
              <div>
                <h3>{selected}</h3>
                {detail ? <PfStatusChip status={detail.status} /> : null}
              </div>
              <div className="pfi-row-actions">
                <button type="button" className="lt-action is-ghost" onClick={() => void openRow(selected, true)} disabled={detailLoading}>
                  Reload
                </button>
                <button type="button" className="lt-action is-ghost" onClick={closeDetail}>
                  Close
                </button>
              </div>
            </div>

            {notice ? <div className="pfi-alert is-ok">{notice}</div> : null}
            {detailError ? <div className="pfi-alert is-err">{detailError}</div> : null}
            {detailLoading ? <p className="lt-empty">Opening request…</p> : null}

            {detail ? (
              <>
                {detail.status_reason ? (
                  <div className={`pfi-alert ${['Rejected', 'Cancelled', 'Expired'].includes(detail.status) ? 'is-err' : 'is-warn'}`}>
                    {detail.status_reason}
                  </div>
                ) : null}

                <div className="pfi-cards">
                  <div className="pfi-card">
                    <h4>Patient</h4>
                    <dl className="pfi-dl">
                      <Info label="Name">{detail.patient_name}</Info>
                      <Info label="Age / gender">
                        {[detail.patient_age != null ? `${detail.patient_age} y` : '', detail.patient_gender || ''].filter(Boolean).join(' / ')}
                      </Info>
                      <Info label="Mobile">{detail.patient_phone}</Info>
                      <Info label="UPID">{detail.universal_patient_id}</Info>
                    </dl>
                  </div>
                  <div className="pfi-card">
                    <h4>Account</h4>
                    <dl className="pfi-dl">
                      <Info label="Account">{detail.account_name || detail.account}</Info>
                      <Info label="Type">{detail.account_type}</Info>
                      <Info label="Lab">{detail.lab_name || detail.assigned_lab}</Info>
                      <Info label="Submitted">{when(detail.submitted_on)}</Info>
                      {detail.reviewed_by ? <Info label="Reviewed by">{detail.reviewed_by}</Info> : null}
                    </dl>
                  </div>
                  <div className="pfi-card">
                    <h4>Pickup</h4>
                    <dl className="pfi-dl">
                      <Info label="Address">{detail.pickup_address}</Info>
                      <Info label="Area">{detail.pickup_area}</Info>
                      <Info label="Window">{windowLabel(detail.preferred_window_start, detail.preferred_window_end)}</Info>
                    </dl>
                    {detail.pickup_lat != null && detail.pickup_lng != null ? (
                      <a
                        className="pfi-link"
                        href={`https://www.google.com/maps?q=${detail.pickup_lat},${detail.pickup_lng}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Google Maps
                      </a>
                    ) : null}
                  </div>
                </div>

                {detail.suggested_tests || detail.notes ? (
                  <div className="pfi-card">
                    {detail.suggested_tests ? (
                      <p className="pfi-note">
                        <b>Suggested tests:</b> {detail.suggested_tests}
                      </p>
                    ) : null}
                    {detail.notes ? (
                      <p className="pfi-note">
                        <b>Notes:</b> {detail.notes}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="pfi-card">
                  <div className="pfi-card-head">
                    <h4>Prescription / TRF{detail.file_name ? ` · ${detail.file_name}` : ''}</h4>
                    <div className="pfi-row-actions">
                      {fileView ? (
                        <a className="lt-action is-ghost" href={fileView.url} target="_blank" rel="noreferrer">
                          Open in new tab
                        </a>
                      ) : null}
                      {canQuote && isImage ? (
                        <button type="button" className="lt-action" onClick={() => void runOcr()} disabled={ocrBusy}>
                          {ocrBusy ? 'Reading…' : 'Suggest tests from photo'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {!detail.has_file ? <p className="pfi-muted">No file attached.</p> : null}
                  {fileLoading ? <p className="pfi-muted">Loading file…</p> : null}
                  {fileError ? <div className="pfi-alert is-err">{fileError}</div> : null}
                  {fileView && isImage ? (
                    <a href={fileView.url} target="_blank" rel="noreferrer" className="pfi-viewer">
                      <img src={fileView.url} alt={`Prescription for ${detail.patient_name}`} />
                    </a>
                  ) : null}
                  {fileView && isPdf ? (
                    <object className="pfi-viewer pfi-pdf" data={fileView.url} type="application/pdf" aria-label="Prescription PDF">
                      <p className="pfi-muted">PDF preview not supported here — use “Open in new tab”.</p>
                    </object>
                  ) : null}
                  {fileView && !isImage && !isPdf ? <p className="pfi-muted">Preview not available — use “Open in new tab”.</p> : null}

                  {ocrError ? <div className="pfi-alert is-err">{ocrError}</div> : null}
                  {ocr ? (
                    <div className="pfi-ocr">
                      {ocr.diagnostics.length ? (
                        ocr.diagnostics.map((d, i) => (
                          <div key={`${d.raw_name}-${i}`} className="pfi-ocr-row">
                            <span className="pfi-ocr-raw">{d.raw_name}</span>
                            <div className="pfi-ocr-chips">
                              {d.matches.length ? (
                                d.matches.map((m) => {
                                  const added = items.some((r) => r.item_code === m.item_code);
                                  return (
                                    <button
                                      key={m.item_code}
                                      type="button"
                                      className={`pfi-ocr-chip${added ? ' is-added' : ''}`}
                                      disabled={!canQuote || added || addingCode === m.item_code}
                                      onClick={() => void addFromMatch(m)}
                                      title={m.item_code}
                                    >
                                      {added ? '✓ ' : '+ '}
                                      {m.test_name || m.item_code}
                                    </button>
                                  );
                                })
                              ) : (
                                <span className="pfi-muted">No catalogue match</span>
                              )}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="pfi-muted">No test names detected in the photo.</p>
                      )}
                    </div>
                  ) : null}
                </div>

                {canQuote ? (
                  <div className="pfi-card pfi-builder">
                    <h4>Quotation</h4>
                    <div className="pfi-test-search">
                      <label className="lt-search">
                        <span aria-hidden>⌕</span>
                        <input
                          value={testQ}
                          onChange={(e) => setTestQ(e.target.value)}
                          placeholder="Add test — type at least 2 letters (e.g. CBC, HbA1c)"
                          aria-label="Search tests"
                        />
                      </label>
                      {searching ? <p className="pfi-muted">Searching…</p> : null}
                      {searchError ? <div className="pfi-alert is-err">{searchError}</div> : null}
                      {hits.length ? (
                        <ul className="pfi-hits" role="listbox">
                          {hits.map((h) => {
                            const added = items.some((r) => r.item_code === h.item_code);
                            return (
                              <li key={h.item_code}>
                                <button
                                  type="button"
                                  disabled={added}
                                  onClick={() => {
                                    addRow({ item_code: h.item_code, item_name: h.item_name, mrp: h.mrp });
                                    setTestQ('');
                                    setHits([]);
                                  }}
                                >
                                  <span>
                                    {h.item_name}
                                    <small>
                                      {h.item_code}
                                      {h.item_group ? ` · ${h.item_group}` : ''}
                                    </small>
                                  </span>
                                  <b>{added ? 'Added' : money(h.mrp)}</b>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                      {!searching && testQ.trim().length >= 2 && !hits.length && !searchError ? (
                        <p className="pfi-muted">No tests found.</p>
                      ) : null}
                    </div>

                    <div className="lt-table-wrap">
                      <table className="lt-table pfi-quote">
                        <thead>
                          <tr>
                            <th>Test</th>
                            <th className="num">MRP</th>
                            <th className="num">Rate</th>
                            <th className="num">Qty</th>
                            <th className="num">Amount</th>
                            <th aria-label="Remove" />
                          </tr>
                        </thead>
                        <tbody>
                          {!items.length ? (
                            <tr>
                              <td colSpan={6} className="lt-empty">
                                No tests yet — search above or use the photo suggestions.
                              </td>
                            </tr>
                          ) : null}
                          {items.map((r) => {
                            const rate = num(r.rate);
                            const qty = num(r.qty);
                            const amount = Number.isFinite(rate) && Number.isFinite(qty) ? rate * qty : 0;
                            return (
                              <tr key={r.item_code}>
                                <td>
                                  {r.item_name}
                                  <small className="pfi-sub">
                                    {r.item_code}
                                    {!r.mrp ? ' · MRP unknown — set rate' : ''}
                                  </small>
                                </td>
                                <td className="num">{r.mrp ? money(r.mrp) : '—'}</td>
                                <td className="num">
                                  <input
                                    className="pfi-num"
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={r.rate}
                                    onChange={(e) => updateRow(r.item_code, { rate: e.target.value })}
                                    aria-label={`Rate for ${r.item_name}`}
                                  />
                                </td>
                                <td className="num">
                                  <input
                                    className="pfi-num pfi-qty"
                                    type="number"
                                    min={1}
                                    max={10}
                                    step={1}
                                    value={r.qty}
                                    onChange={(e) => updateRow(r.item_code, { qty: e.target.value })}
                                    aria-label={`Quantity for ${r.item_name}`}
                                  />
                                </td>
                                <td className="num">{money(amount)}</td>
                                <td>
                                  <button type="button" className="pfi-remove" onClick={() => removeRow(r.item_code)} aria-label={`Remove ${r.item_name}`}>
                                    ×
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="pfi-fees">
                      <label className="lt-field">
                        Collection fee (₹)
                        <input type="number" min={0} step="1" value={fee} onChange={(e) => onFeeChange(e.target.value)} />
                      </label>
                      <label className="lt-field">
                        Rider payout (₹)
                        <input
                          type="number"
                          min={0}
                          step="1"
                          value={payout}
                          onChange={(e) => {
                            setPayout(e.target.value);
                            setPayoutTouched(true);
                          }}
                        />
                        <small className="pfi-muted">
                          {payoutTouched ? (
                            <button
                              type="button"
                              className="pfi-linkbtn"
                              onClick={() => {
                                setPayoutTouched(false);
                                const f = num(fee);
                                setPayout(Number.isFinite(f) ? String(round2((f * payoutPct) / 100)) : '0');
                              }}
                            >
                              Reset to {payoutPct}% of fee
                            </button>
                          ) : (
                            `Auto: ${payoutPct}% of fee`
                          )}
                        </small>
                      </label>
                      <label className="lt-field">
                        Discount (₹)
                        <input type="number" min={0} step="1" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                      </label>
                      <label className="lt-field pfi-span">
                        Notes on quotation
                        <textarea rows={2} value={quoteNotes} onChange={(e) => setQuoteNotes(e.target.value)} placeholder="Optional — visible to the customer" />
                      </label>
                    </div>

                    <dl className="pfi-totals">
                      <div>
                        <dt>Tests</dt>
                        <dd>{money(totals.testTotal)}</dd>
                      </div>
                      <div>
                        <dt>Collection fee</dt>
                        <dd>{money(Number.isFinite(num(fee)) ? num(fee) : 0)}</dd>
                      </div>
                      <div>
                        <dt>Discount</dt>
                        <dd>− {money(Number.isFinite(num(discount)) ? num(discount) : 0)}</dd>
                      </div>
                      <div className="is-grand">
                        <dt>Grand total</dt>
                        <dd>{money(totals.grand)}</dd>
                      </div>
                    </dl>

                    {formError ? <div className="pfi-alert is-err">{formError}</div> : null}

                    {rejectOpen ? (
                      <div className="pfi-reject">
                        <label className="lt-field">
                          Rejection reason (shown to the customer)
                          <textarea rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} autoFocus />
                        </label>
                        <div className="pfi-row-actions">
                          <button type="button" className="lt-action is-ghost" onClick={() => setRejectOpen(false)} disabled={actionBusy}>
                            Back
                          </button>
                          <button type="button" className="lt-action pfi-danger" onClick={() => void reject()} disabled={actionBusy}>
                            {actionBusy ? 'Rejecting…' : 'Confirm reject'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="pfi-row-actions pfi-submit">
                        <button
                          type="button"
                          className="lt-action is-ghost pfi-danger-ghost"
                          onClick={() => {
                            setRejectOpen(true);
                            setFormError(null);
                          }}
                          disabled={actionBusy}
                        >
                          Reject
                        </button>
                        <button type="button" className="lt-action" onClick={() => void approve()} disabled={actionBusy || !items.length}>
                          {actionBusy ? 'Approving…' : 'Approve & broadcast to riders'}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <ReadOnlySections detail={detail} />
                )}
              </>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function ReadOnlySections({ detail }: { detail: PfRequestDetail }) {
  const quote = detail.quotation;
  const job = detail.job;
  const rider = detail.rider;
  const trf = detail.trf;
  return (
    <>
      {quote ? (
        <div className="pfi-card">
          <div className="pfi-card-head">
            <h4>Quotation · {quote.name}</h4>
            <span className="lt-badge tone-muted">{quote.status}</span>
          </div>
          <div className="lt-table-wrap">
            <table className="lt-table pfi-quote">
              <thead>
                <tr>
                  <th>Test</th>
                  <th className="num">MRP</th>
                  <th className="num">Rate</th>
                  <th className="num">Qty</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {quote.items.map((it) => (
                  <tr key={it.item_code}>
                    <td>
                      {it.item_name || it.item_code}
                      <small className="pfi-sub">
                        {it.item_code}
                        {it.tube_hint ? ` · ${it.tube_hint}` : ''}
                      </small>
                    </td>
                    <td className="num">{money(it.mrp)}</td>
                    <td className="num">{money(it.rate)}</td>
                    <td className="num">{it.qty}</td>
                    <td className="num">{money(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="pfi-totals">
            <div>
              <dt>Tests</dt>
              <dd>{money(quote.test_total)}</dd>
            </div>
            <div>
              <dt>Collection fee</dt>
              <dd>{money(quote.collection_fee)}</dd>
            </div>
            <div>
              <dt>Rider payout</dt>
              <dd>{money(quote.rider_payout)}</dd>
            </div>
            <div>
              <dt>Discount</dt>
              <dd>− {money(quote.discount)}</dd>
            </div>
            <div className="is-grand">
              <dt>Grand total</dt>
              <dd>{money(quote.grand_total)}</dd>
            </div>
          </dl>
          <p className="pfi-muted">
            {quote.authorised_by ? `Authorised by ${quote.authorised_by} · ${when(quote.authorised_on)}` : ''}
            {quote.valid_until ? ` · Valid until ${when(quote.valid_until)}` : ''}
            {` · Payment: ${detail.payment_status}`}
          </p>
          {quote.notes ? <p className="pfi-note">{quote.notes}</p> : null}
        </div>
      ) : null}

      {job || rider ? (
        <div className="pfi-cards">
          {job ? (
            <div className="pfi-card">
              <h4>Job · {job.name}</h4>
              <dl className="pfi-dl">
                <Info label="Status">{job.status}</Info>
                <Info label="Broadcast">
                  {`Round ${job.broadcast_round} · ${job.broadcast_radius_km} km${detail.offers != null ? ` · ${detail.offers} offers` : ''}`}
                </Info>
                <Info label="SLA due">{when(job.sla_due)}</Info>
                <Info label="Accepted">{job.accepted_on ? when(job.accepted_on) : ''}</Info>
                <Info label="Collected">{job.collected_on ? when(job.collected_on) : ''}</Info>
                <Info label="Tubes">{job.tube_count ? String(job.tube_count) : ''}</Info>
                <Info label="Dropped hub">{job.dropped_hub ? `${job.dropped_hub} · ${when(job.dropped_on)}` : ''}</Info>
              </dl>
            </div>
          ) : null}
          {rider ? (
            <div className="pfi-card">
              <h4>Rider</h4>
              <dl className="pfi-dl">
                <Info label="Name">{rider.name}</Info>
                <Info label="Phone">
                  {rider.phone ? <a href={`tel:${rider.phone}`}>{rider.phone}</a> : rider.phone_masked}
                </Info>
                <Info label="Vehicle">{rider.vehicle_type}</Info>
                {rider.rating != null ? <Info label="Rating">{rider.rating.toFixed(1)}</Info> : null}
                {rider.eta_minutes != null ? <Info label="ETA">{`${Math.round(rider.eta_minutes)} min`}</Info> : null}
                {rider.distance_km != null ? <Info label="Distance">{`${rider.distance_km.toFixed(1)} km`}</Info> : null}
                {rider.location_at ? <Info label="Last fix">{when(rider.location_at)}</Info> : null}
              </dl>
            </div>
          ) : null}
        </div>
      ) : null}

      {trf ? (
        <div className="pfi-card">
          <div className="pfi-card-head">
            <h4>TRF · {trf.name}</h4>
            <span className="pfi-muted">
              {[trf.barcode ? `Barcode ${trf.barcode}` : '', trf.order_status || '', trf.payment_status || ''].filter(Boolean).join(' · ')}
            </span>
          </div>
          {trf.tubes.length ? (
            <div className="lt-table-wrap">
              <table className="lt-table">
                <thead>
                  <tr>
                    <th>Tube</th>
                    <th>Accession</th>
                    <th>Barcode</th>
                    <th>Tests</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {trf.tubes.map((t) => (
                    <tr key={t.row}>
                      <td>
                        {t.tube_code}
                        {t.cap_color ? <small className="pfi-sub">{t.cap_color}</small> : null}
                      </td>
                      <td>{t.accession_id || '—'}</td>
                      <td>{t.universal_barcode || '—'}</td>
                      <td className="lt-tests">{t.linked_tests || '—'}</td>
                      <td>
                        <span
                          className={`lt-badge ${
                            t.status === 'Received' ? 'tone-green' : t.status === 'Rejected' ? 'tone-red' : t.status === 'Drawn' ? 'tone-blue' : 'tone-muted'
                          }`}
                        >
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="pfi-muted">No tubes planned yet.</p>
          )}
        </div>
      ) : null}

      {!quote && !job && !trf ? <p className="pfi-muted">No quotation or job for this request.</p> : null}
    </>
  );
}
