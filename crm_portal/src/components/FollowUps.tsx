import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { formatNumber, initials, wingById, type CrmActivity, type CrmLead } from '../data';
import {
  activityMatchesModule,
  moduleTitle,
  parseModuleParams,
  type CrmDomain,
  type CrmModuleWing,
} from '../crmModules';
import { downloadCsv, exportPdfTable, stampFile } from '../exportData';
import { Icon, type IconName } from '../icons';
import { safeTelHref } from '../security';
import { useCrm } from '../store';
import { ExportMenu } from './ExportMenu';
import { ScheduleFollowUpModal, TransferOwnershipModal } from './Forms';
import { FollowUpDetailModal } from './FollowUpDetailModal';
import {
  countActiveFranchiseFilters,
  EMPTY_FRANCHISE_FILTERS,
  FranchiseFilterButton,
  FranchiseFilterModal,
  type FranchiseFilterValues,
} from './FranchiseFilterModal';
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
    return {
      key: monthKey(d),
      label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
      from: startOfMonth(d),
      to: endOfMonth(d),
    };
  });
}

function inRange(iso: string | undefined, from: Date, to: Date) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t <= to.getTime();
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

function fmtEntryDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function normMobile(m?: string) {
  return (m || '').replace(/\D/g, '').slice(-10);
}

const CHECK_CARDS: Array<{
  id: Tab | 'conversion';
  label: string;
  tone: string;
  icon: IconName;
}> = [
  { id: 'today', label: "Today's Follow-ups", tone: 'today', icon: 'calendar' },
  { id: 'overdue', label: 'Overdue', tone: 'overdue', icon: 'alarm' },
  { id: 'upcoming', label: 'Upcoming (7 days)', tone: 'upcoming', icon: 'calendar' },
  { id: 'completed', label: 'Completed (month)', tone: 'completed', icon: 'check' },
  { id: 'conversion', label: 'Conversion', tone: 'conversion', icon: 'chart' },
];

export function FollowUpsPage() {
  const crm = useCrm();
  const params = useParams<{ domain?: string; wing?: string }>();
  const parsedModule = parseModuleParams(params.domain, params.wing);
  const domain: CrmDomain = parsedModule?.domain ?? 'service';
  const moduleWing: CrmModuleWing = parsedModule?.wing ?? 'aesthetic';

  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [month, setMonth] = useState(() => monthKey());
  const [filters, setFilters] = useState<FranchiseFilterValues>(EMPTY_FRANCHISE_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<'view' | 'whatsapp'>('view');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferActivityIds, setTransferActivityIds] = useState<string[] | undefined>(undefined);
  const [transferLeadIds, setTransferLeadIds] = useState<string[] | undefined>(undefined);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);

  const isFranchise = domain === 'franchise';
  const months = useMemo(() => monthOptions(12), []);
  const range = useMemo(() => {
    const hit = months.find((m) => m.key === month) || months[0];
    return { from: hit.from, to: hit.to, label: fmtRangeLabel(hit.from, hit.to) };
  }, [month, months]);

  useEffect(() => {
    setSelectedId(null);
    setTab('all');
    setFilters(EMPTY_FRANCHISE_FILTERS);
    setFilterOpen(false);
    setCheckedIds([]);
  }, [domain, moduleWing]);

  const owners = useMemo(() => {
    const set = new Set(crm.activities.map((a) => a.owner).filter(Boolean));
    return Array.from(set).sort();
  }, [crm.activities]);

  const reachReps = useMemo(() => {
    const set = new Set(
      crm.leads.map((l) => String(l.reachRepName || '').trim()).filter(Boolean),
    );
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [crm.leads]);

  const entryFilterRange = useMemo(() => {
    if (filters.entryFrom || filters.entryTo) {
      const from = filters.entryFrom ? startOfDay(new Date(`${filters.entryFrom}T00:00:00`)) : new Date(0);
      const to = filters.entryTo ? endOfDay(new Date(`${filters.entryTo}T00:00:00`)) : endOfDay(new Date());
      return { from, to };
    }
    if (filters.entryMonth !== 'all') {
      const hit = months.find((m) => m.key === filters.entryMonth);
      if (hit) return { from: hit.from, to: hit.to };
    }
    return null;
  }, [filters.entryFrom, filters.entryTo, filters.entryMonth, months]);

  const resolveLead = useMemo(() => {
    const byId = new Map<string, CrmLead>();
    const byMobile = new Map<string, CrmLead>();
    const byName = new Map<string, CrmLead>();
    for (const l of crm.leads) {
      byId.set(l.id, l);
      const mob = normMobile(l.mobile);
      if (mob) byMobile.set(mob, l);
      byName.set(l.name.toLowerCase(), l);
    }
    return (a: CrmActivity): CrmLead | undefined => {
      if (a.leadId && byId.has(a.leadId)) return byId.get(a.leadId);
      const mob = normMobile(a.mobile);
      if (mob && byMobile.has(mob)) return byMobile.get(mob);
      return byName.get((a.leadName || '').toLowerCase());
    };
  }, [crm.leads]);

  const leadEntryAt = useMemo(() => {
    return (a: CrmActivity) => resolveLead(a)?.createdAt;
  }, [resolveLead]);

  const matchesDirectoryFilters = (a: CrmActivity, lead: CrmLead | undefined) => {
    if (filters.owner !== 'all' && a.owner !== filters.owner) return false;
    if (filters.status !== 'all' && lead?.status !== filters.status) return false;
    const reach = filters.reachFilter;
    if (reach !== 'all') {
      const onReach = Boolean(lead?.reachLeadId);
      if (reach === 'reach' && !onReach) return false;
      if (reach === 'crm_only' && onReach) return false;
      if (reach !== 'reach' && reach !== 'crm_only' && String(lead?.reachRepName || '') !== reach) return false;
    }
    if (isFranchise) {
      if (filters.model !== 'all' && (lead?.franchiseModel || '') !== filters.model) return false;
      if (
        filters.propertyOwnership !== 'all'
        && (lead?.propertyOwnership || '') !== filters.propertyOwnership
      ) {
        return false;
      }
      if (
        filters.investmentCapacity !== 'all'
        && !(lead?.investmentCapacity || '').includes(filters.investmentCapacity)
      ) {
        return false;
      }
      if (filters.timeline !== 'all' && (lead?.timeline || '') !== filters.timeline) return false;
      if (filters.state && lead?.state !== filters.state) return false;
      if (filters.district && lead?.district !== filters.district) return false;
      if (
        filters.subdivision.trim() &&
        !(lead?.subdivision || '').toLowerCase().includes(filters.subdivision.trim().toLowerCase())
      ) {
        return false;
      }
      if (
        filters.village.trim() &&
        !`${lead?.village || ''} ${lead?.city || ''}`.toLowerCase().includes(filters.village.trim().toLowerCase())
      ) {
        return false;
      }
      if (filters.pinCode.trim() && (lead?.pinCode || '') !== filters.pinCode.trim()) return false;
    }
    return true;
  };

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...crm.activities]
      .filter((a) => {
        if (!activityMatchesModule(a, crm.leads, domain, moduleWing)) return false;
        /* Include open follow-ups due in range, overdue still open, or completed in range. */
        const dueIn = inRange(a.dueAt, range.from, range.to);
        const doneIn = a.done && inRange(a.completedAt || a.dueAt, range.from, range.to);
        const overdueOpen = !a.done && new Date(a.dueAt).getTime() < range.from.getTime();
        if (!(dueIn || doneIn || overdueOpen)) return false;
        if (entryFilterRange) {
          const entry = leadEntryAt(a);
          if (!inRange(entry, entryFilterRange.from, entryFilterRange.to)) return false;
        }
        if (!matchesDirectoryFilters(a, resolveLead(a))) return false;
        if (!needle) return true;
        return `${a.leadName} ${a.mobile || ''} ${a.leadId || ''} ${a.title} ${a.owner} ${a.notes || ''}`
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    crm.activities,
    crm.leads,
    q,
    range.from,
    range.to,
    entryFilterRange,
    leadEntryAt,
    resolveLead,
    domain,
    moduleWing,
    isFranchise,
    filters,
  ]);

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
    const completed = items.filter(
      (a) => a.done && inRange(a.completedAt || a.dueAt, range.from, range.to),
    ).length;
    const totalDone = items.filter((a) => a.done).length;
    const conversion = items.length ? Math.round((totalDone / items.length) * 1000) / 10 : 0;
    return { today, overdue, upcoming, completed, conversion };
  }, [items, range.from, range.to]);

  const rows = useMemo(() => {
    if (tab === 'all') return items;
    if (tab === 'upcoming') {
      const eod = endOfDay().getTime();
      const week = eod + 7 * 86400000;
      return items.filter((a) => {
        if (a.done) return false;
        const due = new Date(a.dueAt).getTime();
        return due > eod && due <= week;
      });
    }
    if (tab === 'completed') {
      return items.filter((a) => a.done && inRange(a.completedAt || a.dueAt, range.from, range.to));
    }
    return items.filter((a) => bucket(a) === tab);
  }, [items, tab, range.from, range.to]);

  const checkValue = (id: (typeof CHECK_CARDS)[number]['id']) => {
    if (id === 'today') return formatNumber(counts.today);
    if (id === 'overdue') return formatNumber(counts.overdue);
    if (id === 'upcoming') return formatNumber(counts.upcoming);
    if (id === 'completed') return formatNumber(counts.completed);
    return `${counts.conversion}%`;
  };

  const onCheckCard = (id: (typeof CHECK_CARDS)[number]['id']) => {
    if (id === 'conversion') {
      setTab(tab === 'completed' ? 'all' : 'completed');
      return;
    }
    setTab(tab === id ? 'all' : id);
  };

  const detailOpen = Boolean(selectedId && (rows.some((a) => a.id === selectedId) || items.some((a) => a.id === selectedId) || crm.activities.some((a) => a.id === selectedId)));

  const openFollowUp = (a: CrmActivity, mode: 'view' | 'whatsapp' = 'view') => {
    setDetailMode(mode);
    setSelectedId(a.id);
  };

  const closeDetail = () => {
    setSelectedId(null);
    setDetailMode('view');
  };

  /** Transfer Lead from follow-up rows — always include linked leads (completed FUs still transfer the lead). */
  const openTransferForActivities = (activityIds?: string[]) => {
    const ids = (activityIds?.length ? activityIds : checkedIds).filter(Boolean);
    if (!ids.length) {
      setTransferLeadIds(undefined);
      setTransferActivityIds(undefined);
      setTransferOpen(true);
      return;
    }
    const leadIds: string[] = [];
    const pendingIds: string[] = [];
    for (const id of ids) {
      const a = crm.activities.find((x) => x.id === id);
      if (!a) continue;
      if (!a.done) pendingIds.push(a.id);
      const leadId = a.leadId || resolveLead(a)?.id;
      if (leadId && !leadIds.includes(leadId)) leadIds.push(leadId);
    }
    setTransferLeadIds(leadIds.length ? leadIds : undefined);
    setTransferActivityIds(pendingIds.length ? pendingIds : undefined);
    setTransferOpen(true);
  };

  if (!parsedModule) {
    return <Navigate to="/activities/service/aesthetic" replace />;
  }

  const pageHeading = moduleTitle(domain, 'followup', moduleWing);

  const exportFollowUps = (kind: 'csv' | 'pdf') => {
    const header = ['Lead / Patient', 'Mobile', 'Lead ID', 'Entry date', 'Wing', 'Next follow-up', 'Type', 'Status', 'Owner', 'Notes'];
    const data = rows.map((a) => [
      a.leadName,
      a.mobile || '',
      a.leadId || '',
      fmtEntryDate(leadEntryAt(a)),
      wingById(a.wing).short,
      fmtWhen(a.dueAt),
      a.type,
      statusLabel(a),
      a.owner,
      a.notes || '',
    ]);
    const file = stampFile(`crm-followups-${domain}-${moduleWing}`);
    if (kind === 'csv') {
      downloadCsv(file, header, data);
      crm.pushToast(`Exported ${data.length} follow-up(s) to CSV`);
      return;
    }
    exportPdfTable({
      title: pageHeading,
      subtitle: 'Smilecure CRM · filtered follow-up directory',
      header,
      rows: data,
      fileHint: file,
    });
  };

  return (
    <div className="fu-page">
      <header className="page-head page-head-compact">
        <div>
          <h1>{pageHeading}</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: '0.82rem' }}>
            {domain === 'service' ? 'Service' : 'Franchise'} follow-up directory · {moduleWing} submodule
          </p>
        </div>
      </header>

      <section className="fu-check" aria-label="Follow-up Check">
        <div className="fu-check-head">
          <div className="fu-check-title">
            <span className="fu-check-mark" aria-hidden="true">
              <Icon name="activities" size={20} />
            </span>
            <div>
              <strong>Follow-up Check</strong>
              <p>Track today&apos;s, overdue and upcoming follow-ups at a glance.</p>
            </div>
          </div>
          <label className="fu-check-range">
            <Icon name="calendar" size={15} />
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label="Follow-up date range"
              title={range.label}
            >
              {months.map((m) => (
                <option key={m.key} value={m.key}>
                  {fmtRangeLabel(m.from, m.to)}
                </option>
              ))}
            </select>
            <Icon name="chevron" size={14} />
          </label>
        </div>
        <div className="fu-check-grid">
          {CHECK_CARDS.map((card) => {
            const selected = card.id !== 'conversion' && tab === card.id;
            return (
              <button
                key={card.id}
                type="button"
                className={`fu-check-card${selected ? ' on' : ''}`}
                data-tone={card.tone}
                onClick={() => onCheckCard(card.id)}
              >
                <span className="fu-check-ico">
                  <Icon name={card.icon} size={16} />
                </span>
                <div>
                  <span>{card.label}</span>
                  <strong>{checkValue(card.id)}</strong>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="card fu-main">
        <div className="fu-table-tools">
          {crm.isManager ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => openTransferForActivities(checkedIds.length ? checkedIds : undefined)}
            >
              Transfer Lead
            </button>
          ) : null}
          {crm.isManager && checkedIds.length > 0 ? (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: 'var(--danger, #b91c1c)' }}
              onClick={() => {
                const n = checkedIds.length;
                if (
                  !window.confirm(
                    `Delete ${n} selected follow-up${n === 1 ? '' : 's'}? This cannot be undone.`,
                  )
                ) {
                  return;
                }
                const { deleted } = crm.deleteActivities(checkedIds);
                if (selectedId && checkedIds.includes(selectedId)) {
                  setSelectedId(null);
                }
                setCheckedIds([]);
                crm.pushToast(
                  deleted
                    ? `Deleted ${deleted} follow-up${deleted === 1 ? '' : 's'}`
                    : 'No follow-ups deleted',
                  deleted ? 'ok' : 'err',
                );
              }}
            >
              Delete ({checkedIds.length})
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={() => setScheduleOpen(true)}>
            <Icon name="plus" size={16} /> Schedule Follow-up
          </button>
          <div className="search fu-table-search">
            <Icon name="search" size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search lead, phone, ID…"
              aria-label="Search follow-ups"
            />
          </div>
          <FranchiseFilterButton
            activeCount={countActiveFranchiseFilters(filters, {
              includeModel: isFranchise,
              includeGeo: isFranchise,
            })}
            onClick={() => setFilterOpen(true)}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setTab('all');
              setQ('');
              setMonth(monthKey());
              setFilters(EMPTY_FRANCHISE_FILTERS);
            }}
          >
            Reset
          </button>
          <ExportMenu
            onCsv={() => exportFollowUps('csv')}
            onPdf={() => exportFollowUps('pdf')}
            disabled={rows.length === 0}
          />
        </div>

        <table className="table">
          <thead>
            <tr>
              {crm.isManager ? (
                <th style={{ width: 36 }} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label="Select all visible follow-ups"
                    checked={rows.length > 0 && rows.every((a) => checkedIds.includes(a.id))}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate =
                          checkedIds.length > 0 && !rows.every((a) => checkedIds.includes(a.id));
                      }
                    }}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setCheckedIds((ids) => Array.from(new Set([...ids, ...rows.map((a) => a.id)])));
                      } else {
                        const visible = new Set(rows.map((a) => a.id));
                        setCheckedIds((ids) => ids.filter((id) => !visible.has(id)));
                      }
                    }}
                  />
                </th>
              ) : null}
              <th>Lead / Patient</th>
              <th>Entry date</th>
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
              const entry = leadEntryAt(a);
              return (
                <tr
                  key={a.id}
                  className={`row-click${detailOpen && selectedId === a.id ? ' selected' : ''}`}
                  onClick={() => openFollowUp(a)}
                >
                  {crm.isManager ? (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checkedIds.includes(a.id)}
                        aria-label={`Select ${a.leadName}`}
                        onChange={() =>
                          setCheckedIds((ids) =>
                            ids.includes(a.id) ? ids.filter((id) => id !== a.id) : [...ids, a.id],
                          )
                        }
                      />
                    </td>
                  ) : null}
                  <td>
                    <strong>{a.leadName}</strong>
                    <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
                      {a.mobile || '—'}
                      {a.leadId ? ` · ${a.leadId}` : ''}
                    </div>
                  </td>
                  <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{fmtEntryDate(entry)}</td>
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
                    {(() => {
                      const ownerName = resolveLead(a)?.owner || a.owner;
                      return (
                        <div className="owner-cell">
                          <span className="avatar">{initials(ownerName)}</span>
                          {ownerName.split(' ')[0]}
                        </div>
                      );
                    })()}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="fu-actions">
                      {a.mobile ? (
                        <a className="icon-btn" href={safeTelHref(a.mobile) || undefined} title="Call" aria-label="Call">
                          <Icon name="phone" size={15} />
                        </a>
                      ) : null}
                      {a.mobile ? (
                        <button
                          type="button"
                          className="icon-btn"
                          title={isFranchise ? 'WhatsApp follow-up (Franchise)' : 'WhatsApp follow-up (Service)'}
                          aria-label="WhatsApp"
                          onClick={() => openFollowUp(a, 'whatsapp')}
                        >
                          <Icon name="whatsapp" size={15} />
                        </button>
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
                      {crm.isManager ? (
                        <button
                          type="button"
                          className="icon-btn"
                          title="Delete follow-up"
                          aria-label="Delete"
                          onClick={() => {
                            if (!window.confirm(`Delete follow-up for ${a.leadName}? This cannot be undone.`)) {
                              return;
                            }
                            const { deleted } = crm.deleteActivities([a.id]);
                            if (selectedId === a.id) setSelectedId(null);
                            setCheckedIds((ids) => ids.filter((id) => id !== a.id));
                            crm.pushToast(
                              deleted ? 'Follow-up deleted' : 'Could not delete follow-up',
                              deleted ? 'ok' : 'err',
                            );
                          }}
                        >
                          <Icon name="xcircle" size={15} />
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
          initialMode={detailMode}
          onClose={closeDetail}
          onRequestTransfer={(id) => openTransferForActivities([id])}
        />
      ) : null}

      {scheduleOpen ? (
        <ScheduleFollowUpModal
          onClose={() => setScheduleOpen(false)}
        />
      ) : null}
      {transferOpen ? (
        <TransferOwnershipModal
          presetLeadIds={transferLeadIds}
          presetActivityIds={transferActivityIds}
          defaultScope="both"
          onClose={() => {
            setTransferOpen(false);
            setTransferLeadIds(undefined);
            setTransferActivityIds(undefined);
          }}
        />
      ) : null}
      <FranchiseFilterModal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        value={filters}
        onApply={setFilters}
        owners={owners}
        reachReps={reachReps}
        months={months.map((m) => ({ key: m.key, label: m.label }))}
        showOwner={crm.isManager}
        showModel={isFranchise}
        showGeo={isFranchise}
      />
    </div>
  );
}
