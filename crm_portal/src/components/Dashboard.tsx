import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  WINGS,
  executiveCodeFromName,
  formatINR,
  formatNumber,
  wingById,
  type CrmActivity,
  type CrmLead,
  type LeadStatus,
  type WingId,
} from '../data';
import { loadCampaigns, type CrmSheetCampaign } from '../campaignData';
import { getCrmTargetAchievement, listCrmSalesCloses, type CrmTargetAchievement } from '../crmApi';
import { Icon } from '../icons';
import { useCrm } from '../store';
import { FollowUpDetailModal } from './FollowUpDetailModal';
import { StatusPill, WingPill } from './ui';

type OutletCtx = { openModal: (m: 'lead' | 'aesthetic' | 'care' | 'partner' | 'franchise') => void };

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function fmtFollowWhen(iso: string, mode: 'today' | 'upcoming') {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  if (mode === 'today') {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function startOfMonth(d = new Date()) {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

function endOfMonth(d = new Date()) {
  const x = endOfDay(d);
  x.setMonth(x.getMonth() + 1, 0);
  return x;
}

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtRangeLabel(from: Date, to: Date) {
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
  return `${from.toLocaleDateString('en-GB', opts)} – ${to.toLocaleDateString('en-GB', opts)}`;
}

function monthOptions(count = 12) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { key: monthKey(d), from: startOfMonth(d), to: endOfMonth(d) };
  });
}

function monthBoundsFromKey(key: string) {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) {
    return { start: startOfMonth(), end: endOfMonth() };
  }
  const d = new Date(y, m - 1, 1);
  return { start: startOfMonth(d), end: endOfMonth(d) };
}

function parseWhen(iso?: string) {
  if (!iso) return NaN;
  const raw = String(iso).trim();
  if (!raw) return NaN;
  const t = new Date(raw).getTime();
  if (!Number.isNaN(t)) return t;
  /* Sheet / UI dates like 13 Nov 2026 */
  const m = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return NaN;
  const months: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const mi = months[m[2].slice(0, 3).toLowerCase()];
  if (mi === undefined) return NaN;
  const d = new Date(Number(m[3]), mi, Number(m[1]), m[4] ? Number(m[4]) : 12, m[5] ? Number(m[5]) : 0, 0, 0);
  return d.getTime();
}

function inRange(iso: string | undefined, from: Date, to: Date) {
  const t = parseWhen(iso);
  if (Number.isNaN(t)) return false;
  return t >= from.getTime() && t <= to.getTime();
}

function leadWhen(lead: CrmLead) {
  return lead.createdAt || lead.updatedAt || '';
}

function closesMatchExecutive(
  executive: string,
  code: string,
  row: { executive?: string; executive_code?: string; tracking_tag?: string },
) {
  const myCode = code.toUpperCase();
  const name = String(row.executive || '').trim().toLowerCase();
  const rowCode = String(row.executive_code || '').trim().toUpperCase();
  const tag = String(row.tracking_tag || '').trim().toUpperCase();
  if (rowCode && rowCode === myCode) return true;
  /* Portal bill sync often has tag CRM-SG-… but blank executive — credit by tag code. */
  if (tag.startsWith('CRM-')) {
    const tagCode = tag.split('-')[1] || '';
    if (tagCode && tagCode === myCode) return true;
  }
  if (!name) return false;
  const aliases = [executive.toLowerCase(), myCode.toLowerCase(), executive.split(/\s+/)[0]?.toLowerCase()].filter(Boolean);
  return aliases.some((a) => a && (name === a || name.includes(a)));
}

function inMonth(iso: string | undefined, start: Date, end: Date) {
  if (!iso) return true;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return true;
  return at >= start && at <= end;
}

/** Pipeline depth for conversion matrix (Lost / Not Interested do not advance). */
function funnelRank(status: LeadStatus): number {
  switch (status) {
    case 'Won':
      return 6;
    case 'Ready to Proceed':
      return 5;
    case 'Proposal Required':
    case 'Discussion Ongoing':
      return 4;
    case 'Qualified':
      return 3;
    case 'Interested':
      return 2;
    case 'Contacted':
    case 'Connected':
    case 'Not Reachable':
      return 1;
    case 'New':
      return 0;
    case 'Lost':
    case 'Not Interested':
      return -1;
    default:
      return 0;
  }
}

function pct(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function buildFunnel(rows: CrmLead[]) {
  const total = rows.length;
  const qualified = rows.filter((l) => funnelRank(l.status) >= 3).length;
  const proposal = rows.filter((l) => funnelRank(l.status) >= 4).length;
  const won = rows.filter((l) => l.status === 'Won').length;
  return [
    { from: 'Leads', to: 'Qualified', rate: pct(qualified, total), count: qualified, base: total, tone: 'blue' as const },
    { from: 'Qualified', to: 'Proposal', rate: pct(proposal, qualified), count: proposal, base: qualified, tone: 'green' as const },
    { from: 'Proposal', to: 'Won', rate: pct(won, proposal), count: won, base: proposal, tone: 'purple' as const },
  ];
}

function buildWingShare(rows: CrmLead[]) {
  const total = rows.length;
  const counts = new Map<WingId, number>();
  for (const w of WINGS) counts.set(w.id, 0);
  for (const l of rows) counts.set(l.wing, (counts.get(l.wing) || 0) + 1);
  const parts = WINGS.map((w) => ({
    wing: w.id,
    count: counts.get(w.id) || 0,
    pct: pct(counts.get(w.id) || 0, total),
  })).filter((r) => r.count > 0 || total === 0);
  /* Keep every wing visible when empty so the legend still makes sense. */
  return total === 0
    ? WINGS.map((w) => ({ wing: w.id, count: 0, pct: 0 }))
    : parts.sort((a, b) => b.pct - a.pct);
}

function donutGradient(rows: Array<{ wing: WingId; pct: number }>) {
  if (!rows.length || rows.every((r) => r.pct <= 0)) {
    return 'conic-gradient(#e2e8f0 0 100%)';
  }
  let acc = 0;
  const stops: string[] = [];
  for (const row of rows) {
    const start = acc;
    acc += row.pct;
    const color = wingById(row.wing).color;
    stops.push(`${color} ${start}% ${acc}%`);
  }
  if (acc < 100) stops.push(`#e2e8f0 ${acc}% 100%`);
  return `conic-gradient(${stops.join(', ')})`;
}

export function Dashboard() {
  const crm = useCrm();
  const { openModal } = useOutletContext<OutletCtx>();
  const [localWing, setLocalWing] = useState<WingId | 'all'>(crm.wingFilter);
  const months = useMemo(() => monthOptions(12), []);
  /* Default = this month so Total Leads matches Reports & Analytics for the same period. */
  const [month, setMonth] = useState(() => {
    try {
      const saved = sessionStorage.getItem('crm_kpi_period_v1');
      if (saved === 'all' || (saved && /^\d{4}-\d{2}$/.test(saved))) return saved;
    } catch {
      /* ignore */
    }
    return monthKey();
  });
  useEffect(() => {
    try {
      sessionStorage.setItem('crm_kpi_period_v1', month);
    } catch {
      /* ignore */
    }
  }, [month]);
  const range = useMemo(() => {
    if (month === 'all') {
      return {
        from: new Date(0),
        to: endOfDay(new Date(8640000000000000)),
        label: 'All dates',
        all: true as const,
        key: 'all',
      };
    }
    const hit = months.find((m) => m.key === month) || months[0];
    return { from: hit.from, to: hit.to, label: fmtRangeLabel(hit.from, hit.to), all: false as const, key: hit.key };
  }, [month, months]);
  const [targetCard, setTargetCard] = useState<CrmTargetAchievement | null>(null);
  const [targetLoading, setTargetLoading] = useState(true);
  const [targetError, setTargetError] = useState('');
  const [followUpId, setFollowUpId] = useState<string | null>(null);
  const [sheetCampaigns, setSheetCampaigns] = useState<CrmSheetCampaign[]>(() => loadCampaigns());
  const [campPerfMode, setCampPerfMode] = useState<'leads' | 'conversions'>('leads');

  useEffect(() => {
    const sync = () => setSheetCampaigns(loadCampaigns());
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    const timer = window.setInterval(sync, 4000);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', sync);
      window.clearInterval(timer);
    };
  }, []);

  const leads = useMemo(() => {
    const filtered = crm.leads.filter((l) => {
      if (localWing !== 'all' && l.wing !== localWing) return false;
      if (range.all) return true;
      const when = leadWhen(l);
      /* Keep undated leads visible so dashboard stays in sync with lead boards. */
      if (!when || Number.isNaN(parseWhen(when))) return true;
      return inRange(when, range.from, range.to);
    });
    return [...filtered].sort((a, b) => parseWhen(leadWhen(b)) - parseWhen(leadWhen(a)));
  }, [crm.leads, localWing, range]);

  const recentLeads = useMemo(() => leads.slice(0, 8), [leads]);

  const leadsViewAllTo =
    localWing === 'franchise'
      ? '/leads/franchise/lab'
      : localWing === 'all'
        ? '/leads/service/aesthetic'
        : `/leads/service/${localWing}`;

  const followupsViewAllTo =
    localWing === 'franchise'
      ? '/activities/franchise/lab'
      : localWing === 'all'
        ? '/activities/service/aesthetic'
        : `/activities/service/${localWing}`;

  /** Same wing performance numbers as Campaigns page → Campaign performance. */
  const wingCampPerf = useMemo(() => {
    return WINGS.map((w) => {
      const imported =
        crm.leads.filter((l) => l.wing === w.id && l.campaignId).length ||
        sheetCampaigns.filter((c) => c.wing === w.id).reduce((s, c) => s + (c.stats.imported || 0), 0);
      const converted = crm.leads.filter((l) => l.wing === w.id && l.status === 'Won' && l.campaignId).length;
      return { id: w.id, imported, converted, color: w.color, short: w.short };
    });
  }, [crm.leads, sheetCampaigns]);

  const campPerfMax = useMemo(() => {
    const vals = wingCampPerf.map((w) => (campPerfMode === 'leads' ? w.imported : w.converted));
    return Math.max(...vals, 1);
  }, [wingCampPerf, campPerfMode]);

  const funnel = useMemo(() => buildFunnel(leads), [leads]);
  const wingShare = useMemo(() => buildWingShare(leads), [leads]);
  const donutBg = useMemo(() => donutGradient(wingShare), [wingShare]);

  const kpi = useMemo(() => {
    const totalLeads = leads.length;
    const qualified = leads.filter((l) => funnelRank(l.status) >= 3).length;
    const opportunities = leads.filter((l) => funnelRank(l.status) >= 4).length;
    const dealsWon = leads.filter((l) => l.status === 'Won').length;
    const dealValue = crm.deals
      .filter((d) => {
        if (d.stage !== 'Won') return false;
        if (!range.all) {
          const when = d.closeDate || d.createdAt;
          if (!inRange(when, range.from, range.to)) return false;
        }
        if (localWing === 'all') return true;
        const lead = crm.leads.find((l) => l.id === d.leadId);
        return lead?.wing === localWing;
      })
      .reduce((sum, d) => sum + (d.value || 0), 0);
    return {
      totalLeads,
      qualified,
      opportunities,
      dealsWon,
      dealValue,
      conversion: pct(dealsWon, totalLeads),
    };
  }, [leads, crm.deals, crm.leads, localWing, range]);

  const { todayFollowUps, upcomingFollowUps } = useMemo(() => {
    const eod = endOfDay().getTime();
    const acts = crm.activities.filter((a) => {
      if (a.done) return false;
      if (localWing !== 'all' && a.wing !== localWing) return false;
      return !Number.isNaN(parseWhen(a.dueAt));
    });
    const covered = new Set(acts.map((a) => a.leadId).filter(Boolean) as string[]);
    const extras: CrmActivity[] = [];
    for (const l of crm.leads) {
      if (localWing !== 'all' && l.wing !== localWing) continue;
      if (!l.nextFollowUp || Number.isNaN(parseWhen(l.nextFollowUp))) continue;
      if (l.id && covered.has(l.id)) continue;
      extras.push({
        id: `lead-fu-${l.id}`,
        type: 'Follow-up',
        title: `Follow-up · ${l.name}`,
        leadName: l.name,
        leadId: l.id,
        mobile: l.mobile,
        wing: l.wing,
        dueAt: l.nextFollowUp,
        done: false,
        owner: l.owner,
      });
    }
    const open = [...acts, ...extras].sort((a, b) => parseWhen(a.dueAt) - parseWhen(b.dueAt));
    return {
      todayFollowUps: open.filter((a) => parseWhen(a.dueAt) <= eod),
      upcomingFollowUps: open.filter((a) => parseWhen(a.dueAt) > eod).slice(0, 20),
    };
  }, [crm.activities, crm.leads, localWing]);
  const first = crm.userName.split(/\s+/)[0] || 'there';

  useEffect(() => {
    let cancelled = false;
    setTargetLoading(true);
    setTargetError('');
    const { start, end } =
      month === 'all' ? { start: startOfMonth(), end: endOfMonth() } : monthBoundsFromKey(month);
    const period = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;
    const myCode = executiveCodeFromName(crm.userName);

    Promise.all([
      getCrmTargetAchievement(period).catch(() => null),
      listCrmSalesCloses(300).catch(() => ({ closes: [] as Awaited<ReturnType<typeof listCrmSalesCloses>>['closes'], totalAmount: 0 })),
    ])
      .then(([api, sales]) => {
        if (cancelled) return;
        if (sales.closes?.length) crm.applySalesCloses(sales.closes);

        const synced = (sales.closes || []).filter(
          (row) => inMonth(row.closed_at, start, end) && closesMatchExecutive(crm.userName, myCode, row),
        );
        /* Deduplicate by tracking_tag + bill_ref so ERP + portal duplicates don't double-count. */
        const seen = new Set<string>();
        const uniqueSynced = synced.filter((row) => {
          const key = `${String(row.tracking_tag || '').toUpperCase()}::${String(row.bill_ref || '').toUpperCase()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const syncedAmt = uniqueSynced.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

        const closedBookings = crm.bookings.filter((b) => {
          const mine =
            (b.executiveCode || '').toUpperCase() === myCode ||
            (b.executive || '').toLowerCase() === crm.userName.toLowerCase() ||
            (b.owner || '').toLowerCase() === crm.userName.toLowerCase() ||
            (b.trackingTag || '').toUpperCase().startsWith(`CRM-${myCode}-`);
          if (!mine) return false;
          if ((b.salesStatus || 'Open') !== 'Closed' && !(Number(b.billedAmount) > 0)) return false;
          return inMonth(b.closedAt, start, end);
        });
        const bookingAmt = closedBookings.reduce((sum, b) => sum + (Number(b.billedAmount) || 0), 0);

        const achievement = Math.max(Number(api?.achievement_amount) || 0, syncedAmt, bookingAmt);
        const closesCount = Math.max(Number(api?.closes_count) || 0, uniqueSynced.length, closedBookings.length);
        const target = Number(api?.target_amount) || 0;
        const pctVal = target > 0 ? Math.round((achievement / target) * 1000) / 10 : achievement > 0 ? 100 : 0;
        setTargetCard({
          period: api?.period || period,
          period_label: api?.period_label || start.toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
          employee: api?.employee || '',
          employee_name: api?.employee_name || crm.userName,
          target_amount: target,
          achievement_amount: achievement,
          remaining_amount: Math.max(target - achievement, 0),
          percent: Math.min(pctVal, 999),
          closes_count: closesCount,
          set_by: api?.set_by || '',
          has_target: Boolean(api?.has_target && target > 0),
        });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setTargetError(err.message || 'Could not load target');
        setTargetCard(null);
      })
      .finally(() => {
        if (!cancelled) setTargetLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crm.userName, month]);

  const targetPct = Math.min(Math.max(targetCard?.percent || 0, 0), 100);
  const overTarget = (targetCard?.percent || 0) > 100;

  return (
    <>
      <div className="greet-row">
        <h2>
          {greeting()}, {first}.
        </h2>
        <div className="chip-row">
          <button type="button" className={`chip${localWing === 'all' ? ' active' : ''}`} onClick={() => setLocalWing('all')}>
            All Business Wings
          </button>
          {WINGS.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`chip${localWing === w.id ? ' active' : ''}`}
              onClick={() => setLocalWing(w.id)}
            >
              {w.short}
            </button>
          ))}
        </div>
        <label className="date-chip" title={`Filters KPIs, funnel, and target · ${range.label}`}>
          <Icon name="calendar" size={14} />
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="Dashboard date range"
          >
            <option value="all">All dates</option>
            {months.map((m) => (
              <option key={m.key} value={m.key}>
                {fmtRangeLabel(m.from, m.to)}
              </option>
            ))}
          </select>
          <Icon name="chevron" size={14} />
        </label>
      </div>

      <div className="quick-grid">
        <button type="button" className="quick" onClick={() => openModal('aesthetic')}>
          <span className="quick-ico" style={{ background: 'var(--aesthetic)' }}>
            <Icon name="aesthetic" />
          </span>
          <span>
            <strong>Aesthetic booking</strong>
            <span>Create clinic appointment</span>
          </span>
        </button>
        <button type="button" className="quick" onClick={() => openModal('care')}>
          <span className="quick-ico" style={{ background: 'var(--care)' }}>
            <Icon name="care" />
          </span>
          <span>
            <strong>Care booking</strong>
            <span>Consultation / physio</span>
          </span>
        </button>
        <button type="button" className="quick" onClick={() => openModal('franchise')}>
          <span className="quick-ico" style={{ background: 'var(--franchise)' }}>
            <Icon name="franchise" />
          </span>
          <span>
            <strong>Create franchise</strong>
            <span>FFMS / RFMS onboard</span>
          </span>
        </button>
        <button type="button" className="quick" onClick={() => openModal('partner')}>
          <span className="quick-ico" style={{ background: 'var(--lab)' }}>
            <Icon name="partner" />
          </span>
          <span>
            <strong>Partner unit booking</strong>
            <span>Lab for franchise hubs</span>
          </span>
        </button>
      </div>

      <div className="card target-card">
        <div className="card-head">
          <h3>Target &amp; Achievement</h3>
          <span className="badge-pill">{targetCard?.period_label || 'This month'}</span>
        </div>
        {targetLoading ? (
          <p className="target-muted">Loading your monthly target…</p>
        ) : targetError ? (
          <p className="target-muted">{targetError}</p>
        ) : (
          <>
            <div className="target-stats">
              <div>
                <span>Monthly target</span>
                <strong>{formatINR(targetCard?.target_amount || 0)}</strong>
                <em>{targetCard?.has_target ? 'Set by reporting manager' : 'Not set yet — ask your manager in My Team'}</em>
              </div>
              <div>
                <span>Achievement</span>
                <strong>{formatINR(targetCard?.achievement_amount || 0)}</strong>
                <em>{targetCard?.closes_count || 0} synced bill{(targetCard?.closes_count || 0) === 1 ? '' : 's'}</em>
              </div>
              <div>
                <span>{overTarget ? 'Above target' : 'Remaining'}</span>
                <strong>
                  {formatINR(
                    overTarget
                      ? Math.max((targetCard?.achievement_amount || 0) - (targetCard?.target_amount || 0), 0)
                      : targetCard?.remaining_amount || 0,
                  )}
                </strong>
                <em>{overTarget ? 'Exceeded' : 'To go'}</em>
              </div>
              <div>
                <span>Progress</span>
                <strong>{(targetCard?.percent || 0).toFixed(1)}%</strong>
                <em>{targetCard?.employee_name || crm.userName}</em>
              </div>
            </div>
            <div className="target-bar" role="progressbar" aria-valuenow={targetPct} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${targetPct}%` }} className={overTarget ? 'over' : undefined} />
            </div>
            <p className="target-foot">
              Achievement updates when Care / Aesthetic bills sync back to CRM with your tracking tag.
            </p>
          </>
        )}
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <span>Total Leads</span>
          <strong>{formatNumber(kpi.totalLeads)}</strong>
          <em>
            {localWing === 'all' ? 'All wings' : wingById(localWing).short}
            {' · '}
            {range.all ? 'All dates' : range.label}
          </em>
        </div>
        <div className="kpi">
          <span>Qualified Leads</span>
          <strong>{formatNumber(kpi.qualified)}</strong>
          <em>{pct(kpi.qualified, kpi.totalLeads)}% of leads</em>
        </div>
        <div className="kpi">
          <span>Opportunities</span>
          <strong>{formatNumber(kpi.opportunities)}</strong>
          <em>Proposal+</em>
        </div>
        <div className="kpi">
          <span>Deals Won</span>
          <strong>{formatNumber(kpi.dealsWon)}</strong>
          <em>{pct(kpi.dealsWon, kpi.totalLeads)}% win rate</em>
        </div>
        <div className="kpi">
          <span>Deal Value</span>
          <strong>{formatINR(kpi.dealValue)}</strong>
          <em>Won deals</em>
        </div>
        <div className="kpi">
          <span>Conversion Rate</span>
          <strong>{kpi.conversion}%</strong>
          <em>Won / leads</em>
        </div>
      </div>

      <div className="grid-3">
        <div className="card">
          <h3>Sales Funnel</h3>
          <div className="funnel">
            {funnel.map((step) => (
              <div key={`${step.from}-${step.to}`} className="funnel-row" data-tone={step.tone}>
                <span className="funnel-label">
                  {step.from} → {step.to}
                </span>
                <div
                  className="funnel-track"
                  title={`${step.count} of ${step.base} · ${step.rate}%`}
                >
                  <span className="funnel-fill" style={{ width: `${Math.min(Math.max(step.rate, 0), 100)}%` }} />
                </div>
                <span className="funnel-rate">{step.rate}%</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Leads by Business Wing</h3>
          <div className="donut-wrap">
            <div className="donut" aria-hidden="true" style={{ background: donutBg }} />
            <div className="legend">
              {wingShare.map((row) => {
                const w = wingById(row.wing);
                return (
                  <div key={row.wing}>
                    <span className="dot" style={{ background: w.color }} />
                    {w.short}
                    <b>{row.pct}%</b>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Campaign performance</h3>
            <div className="camp-toggle" role="group" aria-label="Campaign performance mode">
              <button
                type="button"
                className={campPerfMode === 'leads' ? 'active' : ''}
                onClick={() => setCampPerfMode('leads')}
              >
                Leads
              </button>
              <button
                type="button"
                className={campPerfMode === 'conversions' ? 'active' : ''}
                onClick={() => setCampPerfMode('conversions')}
              >
                Conversions
              </button>
            </div>
          </div>
          <div className="camp-bars">
            {wingCampPerf.map((w) => {
              const val = campPerfMode === 'leads' ? w.imported : w.converted;
              return (
                <div key={w.id} className="camp-bar-row">
                  <span>{w.short}</span>
                  <div className="camp-bar-track">
                    <div
                      className="camp-bar-fill"
                      style={{ width: `${(val / campPerfMax) * 100}%`, background: w.color }}
                    />
                  </div>
                  <strong>{formatNumber(val)}</strong>
                </div>
              );
            })}
          </div>
          <div className="card-head" style={{ marginTop: 12, marginBottom: 0 }}>
            <Link to="/campaigns" className="btn btn-ghost" style={{ padding: '6px 10px' }}>
              Open Campaigns
            </Link>
          </div>
        </div>
      </div>

      <div className="grid-3b">
        <div className="card">
          <div className="card-head">
            <h3>Recent Leads</h3>
            <Link to={leadsViewAllTo} className="btn btn-ghost" style={{ padding: '6px 10px' }}>
              View all
            </Link>
          </div>
          {recentLeads.length === 0 ? (
            <div className="empty">No leads in this filter.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Wing</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {recentLeads.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      <strong>{lead.name}</strong>
                    </td>
                    <td>
                      <WingPill wing={lead.wing} />
                    </td>
                    <td>{lead.source}</td>
                    <td>
                      <StatusPill value={lead.status} />
                    </td>
                    <td>
                      <div className="owner-cell">
                        <span className="avatar">{lead.ownerInitials}</span>
                        {lead.owner.split(' ')[0]}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Today&apos;s Follow-up</h3>
            <Link to={followupsViewAllTo} className="btn btn-ghost" style={{ padding: '6px 10px' }}>
              View all
            </Link>
          </div>
          <div className="follow-list follow-list-scroll">
            {todayFollowUps.map((a) => {
              const overdue = parseWhen(a.dueAt) < startOfDay().getTime();
              const openable = !String(a.id).startsWith('lead-fu-');
              return (
                <button
                  key={a.id}
                  type="button"
                  className="follow-item follow-item-click follow-item-main"
                  onClick={() => {
                    if (openable) setFollowUpId(a.id);
                  }}
                >
                  <strong>{a.title}</strong>
                  <span>
                    {overdue ? 'Overdue · ' : ''}
                    {fmtFollowWhen(a.dueAt, 'today')} · {a.owner}
                    {a.wing ? ` · ${wingById(a.wing).short}` : ''}
                  </span>
                </button>
              );
            })}
            {todayFollowUps.length === 0 ? <div className="empty">No follow-ups due today.</div> : null}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Upcoming Follow-up</h3>
            <Link to={followupsViewAllTo} className="btn btn-ghost" style={{ padding: '6px 10px' }}>
              View all
            </Link>
          </div>
          <div className="follow-list follow-list-scroll">
            {upcomingFollowUps.map((a) => {
              const openable = !String(a.id).startsWith('lead-fu-');
              return (
                <button
                  key={a.id}
                  type="button"
                  className="follow-item follow-item-click follow-item-main"
                  onClick={() => {
                    if (openable) setFollowUpId(a.id);
                  }}
                >
                  <strong>{a.title}</strong>
                  <span>
                    {fmtFollowWhen(a.dueAt, 'upcoming')} · {a.owner}
                    {a.wing ? ` · ${wingById(a.wing).short}` : ''}
                  </span>
                </button>
              );
            })}
            {upcomingFollowUps.length === 0 ? <div className="empty">No upcoming follow-ups scheduled.</div> : null}
          </div>
        </div>
      </div>

      {followUpId ? <FollowUpDetailModal activityId={followUpId} onClose={() => setFollowUpId(null)} /> : null}
    </>
  );
}
