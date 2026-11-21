import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  FUNNEL,
  KPI,
  WING_SHARE,
  WINGS,
  executiveCodeFromName,
  formatINR,
  formatNumber,
  wingById,
  type WingId,
} from '../data';
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

function monthBounds(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
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

export function Dashboard() {
  const crm = useCrm();
  const { openModal } = useOutletContext<OutletCtx>();
  const [localWing, setLocalWing] = useState<WingId | 'all'>(crm.wingFilter);
  const [targetCard, setTargetCard] = useState<CrmTargetAchievement | null>(null);
  const [targetLoading, setTargetLoading] = useState(true);
  const [targetError, setTargetError] = useState('');
  const [followUpId, setFollowUpId] = useState<string | null>(null);

  const leads = useMemo(
    () => (localWing === 'all' ? crm.leads : crm.leads.filter((l) => l.wing === localWing)),
    [crm.leads, localWing],
  );

  const { todayFollowUps, upcomingFollowUps } = useMemo(() => {
    const eod = endOfDay().getTime();
    const open = crm.activities
      .filter((a) => !a.done)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
    return {
      todayFollowUps: open.filter((a) => new Date(a.dueAt).getTime() <= eod),
      upcomingFollowUps: open.filter((a) => new Date(a.dueAt).getTime() > eod).slice(0, 20),
    };
  }, [crm.activities]);
  const first = crm.userName.split(/\s+/)[0] || 'there';

  useEffect(() => {
    let cancelled = false;
    setTargetLoading(true);
    setTargetError('');
    const { start, end } = monthBounds();
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
        const pct = target > 0 ? Math.round((achievement / target) * 1000) / 10 : achievement > 0 ? 100 : 0;
        setTargetCard({
          period: api?.period || period,
          period_label: api?.period_label || start.toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
          employee: api?.employee || '',
          employee_name: api?.employee_name || crm.userName,
          target_amount: target,
          achievement_amount: achievement,
          remaining_amount: Math.max(target - achievement, 0),
          percent: Math.min(pct, 999),
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
  }, [crm.userName]);

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
          {WINGS.filter((w) => w.id !== 'franchise').map((w) => (
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
        <div className="date-chip">
          <Icon name="calendar" size={14} />
          01 Oct 2026 – 31 Oct 2026
        </div>
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
          <strong>{formatNumber(KPI.totalLeads)}</strong>
          <em>+{KPI.deltas.totalLeads}%</em>
        </div>
        <div className="kpi">
          <span>Qualified Leads</span>
          <strong>{formatNumber(KPI.qualified)}</strong>
          <em>+{KPI.deltas.qualified}%</em>
        </div>
        <div className="kpi">
          <span>Opportunities</span>
          <strong>{formatNumber(KPI.opportunities)}</strong>
          <em>+{KPI.deltas.opportunities}%</em>
        </div>
        <div className="kpi">
          <span>Deals Won</span>
          <strong>{formatNumber(KPI.dealsWon)}</strong>
          <em>+{KPI.deltas.dealsWon}%</em>
        </div>
        <div className="kpi">
          <span>Deal Value</span>
          <strong>{formatINR(KPI.dealValue)}</strong>
          <em>+{KPI.deltas.dealValue}%</em>
        </div>
        <div className="kpi">
          <span>Conversion Rate</span>
          <strong>{KPI.conversion}%</strong>
          <em>+{KPI.deltas.conversion} pp</em>
        </div>
      </div>

      <div className="grid-3">
        <div className="card">
          <h3>Sales Funnel</h3>
          <div className="funnel">
            {FUNNEL.map((step) => (
              <div key={step.from} className="funnel-row">
                <div className="funnel-bar">
                  {step.from} → {step.to}
                </div>
                <span className="funnel-rate">{step.rate}%</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Leads by Business Wing</h3>
          <div className="donut-wrap">
            <div className="donut" aria-hidden="true" />
            <div className="legend">
              {WING_SHARE.map((row) => {
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
            <h3>Campaign Performance</h3>
            <span className="badge-pill">Meta Ads</span>
          </div>
          <div className="meta-stats">
            <div>
              <span>Ad Spend</span>
              <strong>{formatINR(crm.campaigns[0]?.spend || 0)}</strong>
            </div>
            <div>
              <span>Leads Generated</span>
              <strong>{formatNumber(crm.campaigns[0]?.leads || 0)}</strong>
            </div>
            <div>
              <span>CPL</span>
              <strong>{formatINR(crm.campaigns[0]?.cpl || 0)}</strong>
            </div>
            <div>
              <span>Channel</span>
              <strong>{crm.campaigns[0]?.channel}</strong>
            </div>
          </div>
          <div className="roi">
            <span>ROI</span>
            <strong>{crm.campaigns[0]?.roi || 0}x</strong>
          </div>
        </div>
      </div>

      <div className="grid-3b">
        <div className="card">
          <div className="card-head">
            <h3>Recent Leads</h3>
            <Link to="/leads" className="btn btn-ghost" style={{ padding: '6px 10px' }}>
              View all
            </Link>
          </div>
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
              {leads.slice(0, 5).map((lead) => (
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
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Today&apos;s Follow-up</h3>
            <Link to="/activities" className="btn btn-ghost" style={{ padding: '6px 10px' }}>
              View all
            </Link>
          </div>
          <div className="follow-list follow-list-scroll">
            {todayFollowUps.map((a) => {
              const overdue = new Date(a.dueAt).getTime() < startOfDay().getTime();
              return (
                <button
                  key={a.id}
                  type="button"
                  className="follow-item follow-item-click follow-item-main"
                  onClick={() => setFollowUpId(a.id)}
                >
                  <strong>{a.title}</strong>
                  <span>
                    {overdue ? 'Overdue · ' : ''}
                    {fmtFollowWhen(a.dueAt, 'today')} · {a.owner}
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
            <Link to="/activities" className="btn btn-ghost" style={{ padding: '6px 10px' }}>
              View all
            </Link>
          </div>
          <div className="follow-list follow-list-scroll">
            {upcomingFollowUps.map((a) => (
              <button
                key={a.id}
                type="button"
                className="follow-item follow-item-click follow-item-main"
                onClick={() => setFollowUpId(a.id)}
              >
                <strong>{a.title}</strong>
                <span>
                  {fmtFollowWhen(a.dueAt, 'upcoming')} · {a.owner}
                </span>
              </button>
            ))}
            {upcomingFollowUps.length === 0 ? <div className="empty">No upcoming follow-ups scheduled.</div> : null}
          </div>
        </div>
      </div>

      {followUpId ? <FollowUpDetailModal activityId={followUpId} onClose={() => setFollowUpId(null)} /> : null}
    </>
  );
}
