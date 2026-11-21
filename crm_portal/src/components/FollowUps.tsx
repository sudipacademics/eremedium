import { useMemo, useState } from 'react';
import {
  CARE_BRANCHES,
  AESTHETIC_BRANCHES,
  formatNumber,
  initials,
  type CrmActivity,
  type WingId,
} from '../data';
import { Icon } from '../icons';
import { useCrm } from '../store';
import { ScheduleFollowUpModal, TransferOwnershipModal } from './Forms';
import { FollowUpDetailModal } from './FollowUpDetailModal';
import { WingPill } from './ui';

type Tab = 'all' | 'today' | 'overdue' | 'upcoming' | 'completed';

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

function bucket(a: CrmActivity): 'today' | 'overdue' | 'upcoming' | 'completed' {
  if (a.done) return 'completed';
  const due = new Date(a.dueAt).getTime();
  const sod = startOfDay().getTime();
  const eod = endOfDay().getTime();
  if (due < sod) return 'overdue';
  if (due <= eod) return 'today';
  return 'upcoming';
}

function statusLabel(a: CrmActivity) {
  const b = bucket(a);
  if (b === 'completed') return 'Completed';
  if (b === 'overdue') return 'Overdue';
  if (b === 'today') return 'Due Today';
  return 'Upcoming';
}

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const BRANCHES = [
  ...CARE_BRANCHES.map((b) => ({ id: `care:${b}`, label: `Care · ${b}`, wing: 'care' as WingId })),
  ...AESTHETIC_BRANCHES.map((b) => ({ id: `aesthetic:${b}`, label: `Aesthetic · ${b}`, wing: 'aesthetic' as WingId })),
  { id: 'franchise:Bongaon', label: 'Franchise · Bongaon', wing: 'franchise' as WingId },
  { id: 'lab:Central Hub', label: 'Lab · Central Hub', wing: 'lab' as WingId },
];

export function FollowUpsPage() {
  const crm = useCrm();
  const [q, setQ] = useState('');
  const [branch, setBranch] = useState('all');
  const [tab, setTab] = useState<Tab>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferActivityIds, setTransferActivityIds] = useState<string[] | undefined>(undefined);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...crm.activities]
      .filter((a) => {
        if (branch !== 'all') {
          const meta = BRANCHES.find((b) => b.id === branch);
          if (meta) {
            if (a.wing !== meta.wing) return false;
            if (a.branch && meta.label.split(' · ')[1] && a.branch !== meta.label.split(' · ')[1]) return false;
          }
        }
        if (!needle) return true;
        return `${a.leadName} ${a.mobile || ''} ${a.leadId || ''} ${a.title} ${a.owner} ${a.notes || ''}`
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      });
  }, [crm.activities, q, branch]);

  const counts = useMemo(() => {
    const today = items.filter((a) => bucket(a) === 'today').length;
    const overdue = items.filter((a) => bucket(a) === 'overdue').length;
    const upcoming = items.filter((a) => {
      if (a.done) return false;
      const due = new Date(a.dueAt).getTime();
      const eod = endOfDay().getTime();
      const week = eod + 7 * 86400000;
      return due > eod && due <= week;
    }).length;
    const monthStart = startOfDay();
    monthStart.setDate(1);
    const completed = items.filter(
      (a) => a.done && a.completedAt && new Date(a.completedAt) >= monthStart,
    ).length;
    const totalDone = items.filter((a) => a.done).length;
    const conversion = items.length ? Math.round((totalDone / items.length) * 1000) / 10 : 0;
    return { today, overdue, upcoming, completed, conversion };
  }, [items]);

  const rows = useMemo(() => {
    if (tab === 'all') return items;
    if (tab === 'upcoming') {
      return items.filter((a) => {
        if (a.done) return false;
        const due = new Date(a.dueAt).getTime();
        return due > endOfDay().getTime();
      });
    }
    return items.filter((a) => bucket(a) === tab);
  }, [items, tab]);

  const detailOpen = Boolean(selectedId && (rows.some((a) => a.id === selectedId) || items.some((a) => a.id === selectedId) || crm.activities.some((a) => a.id === selectedId)));

  const openFollowUp = (a: CrmActivity) => {
    setSelectedId(a.id);
  };

  const closeDetail = () => {
    setSelectedId(null);
  };

  return (
    <div className="fu-page">
      <header className="page-head">
        <div>
          <h1>Follow-up Management</h1>
          <p>Track today&apos;s calls, overdue tasks and upcoming follow-ups across all business wings.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {crm.isManager ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setTransferActivityIds(undefined);
                setTransferOpen(true);
              }}
            >
              Transfer
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={() => setScheduleOpen(true)}>
            <Icon name="plus" size={16} /> Schedule Follow-up
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="search" style={{ maxWidth: 360, flex: 1 }}>
          <Icon name="search" size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search lead, phone, ID…"
            aria-label="Search follow-ups"
          />
        </div>
        <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch filter">
          <option value="all">All Branches</option>
          {BRANCHES.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <div className="kpi">
          <span>Today&apos;s Follow-ups</span>
          <strong>{formatNumber(counts.today)}</strong>
        </div>
        <div className="kpi">
          <span>Overdue</span>
          <strong style={{ color: '#b91c1c' }}>{formatNumber(counts.overdue)}</strong>
        </div>
        <div className="kpi">
          <span>Upcoming (7 days)</span>
          <strong>{formatNumber(counts.upcoming)}</strong>
        </div>
        <div className="kpi">
          <span>Completed (month)</span>
          <strong>{formatNumber(counts.completed)}</strong>
        </div>
        <div className="kpi">
          <span>Conversion</span>
          <strong>{counts.conversion}%</strong>
        </div>
      </div>

      <div className="card fu-main">
        <div className="fu-tabs">
          {(
            [
              ['all', 'All'],
              ['today', 'Due Today'],
              ['overdue', 'Overdue'],
              ['upcoming', 'Upcoming'],
              ['completed', 'Completed'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} type="button" className={`fu-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
              {label}
              <b>
                {id === 'all'
                  ? items.length
                  : id === 'upcoming'
                    ? items.filter((a) => !a.done && new Date(a.dueAt) > endOfDay()).length
                    : items.filter((a) => bucket(a) === id).length}
              </b>
            </button>
          ))}
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Lead / Patient</th>
              <th>Service</th>
              <th>Next Follow-up</th>
              <th>Type</th>
              <th>Status</th>
              <th>Owner</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const st = statusLabel(a);
              const urgent = st === 'Overdue' || st === 'Due Today';
              return (
                <tr
                  key={a.id}
                  className={`row-click${detailOpen && selectedId === a.id ? ' selected' : ''}`}
                  onClick={() => openFollowUp(a)}
                >
                  <td>
                    <strong>{a.leadName}</strong>
                    <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
                      {a.mobile || '—'}
                      {a.leadId ? ` · ${a.leadId}` : ''}
                    </div>
                  </td>
                  <td>
                    <WingPill wing={a.wing} />
                  </td>
                  <td style={{ color: urgent && !a.done ? '#b91c1c' : undefined, fontWeight: urgent ? 700 : 500 }}>
                    {fmtWhen(a.dueAt)}
                  </td>
                  <td>{a.type}</td>
                  <td>
                    <span className={`status fu-${bucket(a)}`}>{st}</span>
                  </td>
                  <td>
                    <div className="owner-cell">
                      <span className="avatar">{initials(a.owner)}</span>
                      {a.owner.split(' ')[0]}
                    </div>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="fu-actions">
                      {a.mobile ? (
                        <a className="icon-btn" href={`tel:${a.mobile}`} title="Call" aria-label="Call">
                          <Icon name="phone" size={15} />
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className="icon-btn"
                        title="Edit"
                        aria-label="Edit"
                        onClick={() => openFollowUp(a)}
                      >
                        <Icon name="edit" size={15} />
                      </button>
                      {!a.done ? (
                        <button
                          type="button"
                          className="icon-btn"
                          title="Complete"
                          aria-label="Complete"
                          onClick={() => {
                            crm.completeActivity(a.id);
                            crm.pushToast(`${a.leadName} marked completed`);
                          }}
                        >
                          <Icon name="check" size={15} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="empty">No follow-ups in this view.</div>
        ) : null}
      </div>

      {detailOpen && selectedId ? (
        <FollowUpDetailModal
          activityId={selectedId}
          onClose={closeDetail}
          onRequestTransfer={(id) => {
            setTransferActivityIds([id]);
            setTransferOpen(true);
          }}
        />
      ) : null}

      {scheduleOpen ? (
        <ScheduleFollowUpModal
          onClose={() => setScheduleOpen(false)}
        />
      ) : null}
      {transferOpen ? (
        <TransferOwnershipModal
          presetActivityIds={transferActivityIds}
          defaultScope={transferActivityIds?.length ? 'followups' : 'both'}
          onClose={() => {
            setTransferOpen(false);
            setTransferActivityIds(undefined);
          }}
        />
      ) : null}
    </div>
  );
}
