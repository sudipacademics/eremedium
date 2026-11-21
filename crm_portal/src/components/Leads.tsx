import { useMemo, useState, type ChangeEvent } from 'react';
import {
  LEAD_PIPELINE,
  LEAD_STATUSES,
  LOST_REASONS,
  WINGS,
  formatNumber,
  initials,
  type CrmActivity,
  type CrmLead,
  type LeadStatus,
  type LostReason,
  type WingId,
} from '../data';
import { Icon } from '../icons';
import { useCrm } from '../store';
import {
  AssignReachForm,
  EditLeadModal,
  ImportLeadsModal,
  ScheduleFollowUpForm,
  TransferOwnershipModal,
} from './Forms';
import { syncCrmLeadStatusToReach } from '../crmApi';
import { Empty, WingPill } from './ui';

type DetailTab = 'overview' | 'followups' | 'activity' | 'notes' | 'documents';
type TimeFilter = 'all' | 'today' | '7d' | '30d';

function fmtWhen(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function leadScore(lead: CrmLead) {
  let score = 35;
  if (lead.mobile) score += 10;
  if (lead.email) score += 8;
  if (lead.city) score += 5;
  if (lead.notes) score += 7;
  if (lead.nextFollowUp) score += 10;
  if (lead.value && lead.value > 0) score += 10;
  if (lead.status === 'Qualified' || lead.status === 'Interested') score += 8;
  if (lead.status === 'Proposal Required' || lead.status === 'Discussion Ongoing') score += 12;
  if (lead.status === 'Ready to Proceed') score += 15;
  if (lead.status === 'Won') score += 20;
  if (lead.status === 'Lost' || lead.status === 'Not Interested') score -= 15;
  if (lead.history && lead.history.length > 1) score += Math.min(lead.history.length * 2, 10);
  return Math.max(5, Math.min(98, score));
}

function activityMatchesLead(a: { leadId?: string; leadName: string; mobile?: string }, lead: CrmLead) {
  if (a.leadId && a.leadId === lead.id) return true;
  return a.leadName === lead.name && (!a.mobile || a.mobile === lead.mobile);
}

function syncedNextFollowUp(lead: CrmLead, activities: { leadId?: string; leadName: string; mobile?: string; dueAt: string; done: boolean }[]) {
  const pending = activities
    .filter((a) => !a.done && activityMatchesLead(a, lead))
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0];
  return pending?.dueAt || lead.nextFollowUp;
}

function syncedLastFollowUp(
  lead: CrmLead,
  activities: {
    leadId?: string;
    leadName: string;
    mobile?: string;
    done: boolean;
    completedAt?: string;
    history?: { at: string }[];
  }[],
) {
  const stamps: string[] = [];
  for (const a of activities) {
    if (!activityMatchesLead(a, lead)) continue;
    if (a.done && a.completedAt) stamps.push(a.completedAt);
    for (const h of a.history || []) stamps.push(h.at);
  }
  if (lead.history?.[0]?.at) stamps.push(lead.history[0].at);
  if (lead.updatedAt) stamps.push(lead.updatedAt);
  stamps.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return stamps[0] || lead.createdAt;
}

function isSoon(iso?: string) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  const now = Date.now();
  return t >= now - 3600000 && t <= now + 36 * 3600000;
}

export function LeadsPage() {
  const crm = useCrm();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [wing, setWing] = useState<WingId | 'all'>(crm.wingFilter);
  const [owner, setOwner] = useState('all');
  const [time, setTime] = useState<TimeFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [editing, setEditing] = useState<CrmLead | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferLeadIds, setTransferLeadIds] = useState<string[] | undefined>(undefined);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduleActivity, setScheduleActivity] = useState<CrmActivity | null>(null);
  const [assignReachMode, setAssignReachMode] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [lostReason, setLostReason] = useState<LostReason | ''>('');
  const [lostNote, setLostNote] = useState('');

  const owners = useMemo(() => {
    const set = new Set(crm.leads.map((l) => l.owner).filter(Boolean));
    return Array.from(set).sort();
  }, [crm.leads]);

  const resetFilters = () => {
    setQ('');
    setStatus('all');
    setWing('all');
    setOwner('all');
    setTime('all');
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const now = Date.now();
    return crm.leads.filter((l) => {
      if (wing !== 'all' && l.wing !== wing) return false;
      if (status !== 'all' && l.status !== status) return false;
      if (owner !== 'all' && l.owner !== owner) return false;
      if (time !== 'all') {
        const ts = new Date(l.updatedAt || l.createdAt).getTime();
        const windowMs = time === 'today' ? 86400000 : time === '7d' ? 7 * 86400000 : 30 * 86400000;
        if (now - ts > windowMs) return false;
      }
      if (!needle) return true;
      return `${l.name} ${l.mobile} ${l.email} ${l.city} ${l.id} ${l.notes || ''} ${l.owner}`
        .toLowerCase()
        .includes(needle);
    });
  }, [crm.leads, q, status, wing, owner, time]);

  const stats = useMemo(() => {
    const total = rows.length;
    const open = rows.filter((l) => l.status !== 'Won' && l.status !== 'Lost').length;
    const inProgress = rows.filter((l) =>
      ['Contacted', 'Connected', 'Interested', 'Qualified', 'Proposal Required', 'Discussion Ongoing', 'Ready to Proceed'].includes(
        l.status,
      ),
    ).length;
    const won = rows.filter((l) => l.status === 'Won').length;
    const lost = rows.filter((l) => l.status === 'Lost' || l.status === 'Not Interested').length;
    const wonPct = total ? Math.round((won / total) * 1000) / 10 : 0;
    return { total, open, inProgress, won, lost, wonPct };
  }, [rows]);

  const pipeline = useMemo(
    () =>
      LEAD_PIPELINE.map((stage) => ({
        stage,
        count: rows.filter((l) => l.status === stage).length,
      })),
    [rows],
  );

  const selected = useMemo(
    () => (selectedId ? crm.leads.find((l) => l.id === selectedId) || null : null),
    [crm.leads, selectedId],
  );

  const openLead = (lead: CrmLead, tab: DetailTab = 'overview') => {
    setSelectedId(lead.id);
    setDetailTab(tab);
    setScheduleMode(false);
    setScheduleActivity(null);
    setAssignReachMode(false);
    setDetailOpen(true);
  };

  const openSchedule = (lead: CrmLead, activity?: CrmActivity | null) => {
    setSelectedId(lead.id);
    setDetailOpen(true);
    setAssignReachMode(false);
    setScheduleMode(true);
    setScheduleActivity(activity || null);
  };

  const closeSchedule = () => {
    setScheduleMode(false);
    setScheduleActivity(null);
    setDetailTab('followups');
  };

  const openAssignReach = (lead: CrmLead) => {
    setSelectedId(lead.id);
    setDetailOpen(true);
    setScheduleMode(false);
    setScheduleActivity(null);
    setAssignReachMode(true);
  };

  const closeAssignReach = () => {
    setAssignReachMode(false);
    setDetailTab('overview');
  };

  const closeDetail = () => {
    setDetailOpen(false);
    setSelectedId(null);
    setScheduleMode(false);
    setScheduleActivity(null);
    setAssignReachMode(false);
    setNoteDraft('');
  };

  const nextPendingActivity = (lead: CrmLead) =>
    crm.activities
      .filter(
        (a) =>
          !a.done &&
          (a.leadId === lead.id || (a.leadName === lead.name && (!a.mobile || a.mobile === lead.mobile))),
      )
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0] || null;

  const leadFollowUps = useMemo(() => {
    if (!selected) return [];
    return crm.activities
      .filter(
        (a) =>
          a.leadId === selected.id ||
          (a.leadName === selected.name && (!a.mobile || a.mobile === selected.mobile)),
      )
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  }, [crm.activities, selected]);

  const nextFu = selected
    ? syncedNextFollowUp(selected, crm.activities) || leadFollowUps.find((a) => !a.done)?.dueAt
    : undefined;

  const quickStatus = (lead: CrmLead, next: LeadStatus, e?: ChangeEvent<HTMLSelectElement>) => {
    e?.stopPropagation();
    if (next === lead.status) return;
    if (next === 'Lost') {
      setSelectedId(lead.id);
      setDetailOpen(true);
      setDetailTab('overview');
      setLostReason('');
      setLostNote('');
      crm.pushToast('Select a lost reason to close this lead');
      return;
    }
    crm.updateLead(lead.id, { status: next }, `Status ${lead.status} → ${next}`);
    crm.pushToast(`${lead.id} → ${next}`);
    if (lead.reachLeadId || lead.reachAssignedAt) {
      void syncCrmLeadStatusToReach(lead.id, next).catch(() => {
        /* soft — REACH may be offline */
      });
    }
  };

  const confirmLost = () => {
    if (!selected) return;
    if (!lostReason) {
      crm.pushToast('Lost reason is mandatory', 'err');
      return;
    }
    crm.closeLeadLost(selected.id, lostReason, lostNote);
    crm.pushToast(`${selected.id} marked Lost · ${lostReason}`);
    setLostReason('');
    setLostNote('');
  };

  const saveNote = () => {
    if (!selected || !noteDraft.trim()) return;
    const prev = selected.notes ? `${selected.notes}\n` : '';
    crm.updateLead(selected.id, { notes: `${prev}${noteDraft.trim()}` }, `Note: ${noteDraft.trim()}`);
    setNoteDraft('');
    crm.pushToast('Note saved');
  };

  return (
    <div className="lm-page">
      <header className="page-head">
        <div>
          <h1>Lead Management</h1>
          <p>Capture, qualify and convert leads across Lab, Aesthetic, Care, NexiLab and Franchise.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {crm.isManager ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setTransferLeadIds(checkedIds.length ? checkedIds : undefined);
                setTransferOpen(true);
              }}
            >
              Transfer
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={() => setImportOpen(true)}>
            Import Lead
          </button>
        </div>
      </header>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <div className="kpi">
          <span>Total Leads</span>
          <strong>{formatNumber(stats.total)}</strong>
        </div>
        <div className="kpi">
          <span>Open Pipeline</span>
          <strong>{formatNumber(stats.open)}</strong>
        </div>
        <div className="kpi">
          <span>In Progress</span>
          <strong>{formatNumber(stats.inProgress)}</strong>
        </div>
        <div className="kpi">
          <span>Won / Converted</span>
          <strong>
            {formatNumber(stats.won)} <em style={{ fontStyle: 'normal', fontSize: '0.75rem' }}>({stats.wonPct}%)</em>
          </strong>
        </div>
        <div className="kpi">
          <span>Lost / Closed</span>
          <strong style={{ color: stats.lost ? '#b91c1c' : undefined }}>{formatNumber(stats.lost)}</strong>
        </div>
      </div>

      <div className="card lm-pipeline">
        <div className="card-head">
          <h3>Lead pipeline</h3>
          <span className="badge-pill">Live funnel</span>
        </div>
        <div className="pipeline">
          {pipeline.map((p, i) => (
            <button
              key={p.stage}
              type="button"
              className={`pipe-step${status === p.stage ? ' on' : ''}`}
              onClick={() => setStatus(status === p.stage ? 'all' : p.stage)}
              style={{ zIndex: pipeline.length - i }}
            >
              <span>{p.stage}</span>
              <b>{formatNumber(p.count)}</b>
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar">
        <div className="search" style={{ maxWidth: 280, flex: 1 }}>
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads…" />
        </div>
        <select value={wing} onChange={(e) => setWing(e.target.value as WingId | 'all')}>
          <option value="all">All wings</option>
          {WINGS.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="all">All owners</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <select value={time} onChange={(e) => setTime(e.target.value as TimeFilter)}>
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
        <button type="button" className="btn btn-ghost" onClick={resetFilters}>
          Reset
        </button>
      </div>

      <div className="card lm-main">
        <table className="table">
          <thead>
            <tr>
              {crm.isManager ? <th style={{ width: 36 }} /> : null}
              <th>ID</th>
              <th>Name</th>
              <th>Wing</th>
              <th>Source</th>
              <th>Status</th>
              <th>Owner</th>
              <th>Last follow-up</th>
              <th>Next follow-up</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((lead) => {
              const next = syncedNextFollowUp(lead, crm.activities);
              const last = syncedLastFollowUp(lead, crm.activities);
              const soon = isSoon(next);
              return (
                <tr
                  key={lead.id}
                  className={`row-click${detailOpen && selected?.id === lead.id ? ' selected' : ''}`}
                  onClick={() => openLead(lead)}
                >
                  {crm.isManager ? (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checkedIds.includes(lead.id)}
                        aria-label={`Select ${lead.id}`}
                        onChange={() =>
                          setCheckedIds((ids) =>
                            ids.includes(lead.id) ? ids.filter((id) => id !== lead.id) : [...ids, lead.id],
                          )
                        }
                      />
                    </td>
                  ) : null}
                  <td>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        openLead(lead);
                      }}
                    >
                      {lead.id}
                    </button>
                  </td>
                  <td>
                    <strong>{lead.name}</strong>
                    <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
                      {lead.city || lead.mobile}
                    </div>
                  </td>
                  <td>
                    <WingPill wing={lead.wing} />
                  </td>
                  <td>{lead.source}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select
                      className="inline-select"
                      value={lead.status}
                      aria-label={`Status for ${lead.name}`}
                      onChange={(e) => quickStatus(lead, e.target.value as LeadStatus, e)}
                    >
                      {LEAD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="owner-cell">
                      <span className="avatar">{lead.ownerInitials || initials(lead.owner)}</span>
                      {lead.owner.split(' ')[0]}
                    </div>
                  </td>
                    <td style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>{fmtWhen(last)}</td>
                  <td style={{ color: soon ? '#b91c1c' : undefined, fontWeight: soon ? 700 : 500, fontSize: '0.8rem' }}>
                    {fmtWhen(next)}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="fu-actions">
                      {lead.mobile ? (
                        <a className="icon-btn" href={`tel:${lead.mobile}`} title="Call" aria-label="Call">
                          <Icon name="phone" size={15} />
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className="icon-btn"
                        title="Edit"
                        aria-label="Edit"
                        onClick={() => setEditing(lead)}
                      >
                        <Icon name="edit" size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Schedule follow-up"
                        aria-label="Schedule"
                        onClick={() => openSchedule(lead, nextPendingActivity(lead))}
                      >
                        <Icon name="calendar" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <Empty text="No leads match your filters." /> : null}
      </div>

      {detailOpen && selected ? (
        <div className="detail-slider" role="dialog" aria-modal="true" aria-label={`${selected.name} overview`}>
          <button type="button" className="detail-slider-backdrop" aria-label="Close overview" onClick={closeDetail} />
          <aside className="detail-slider-panel lm-detail">
            <div className="fu-detail-head">
              <div>
                <h2>{selected.name}</h2>
                <p>
                  {selected.mobile}
                  {selected.city ? ` · ${selected.city}` : ''}
                  {` · ${selected.id}`}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                  <WingPill wing={selected.wing} />
                  <select
                    className="inline-select"
                    value={selected.status}
                    onChange={(e) => quickStatus(selected, e.target.value as LeadStatus)}
                  >
                    {LEAD_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  title={selected.reachLeadId ? 'Re-assign / sync REACH' : 'Assign to REACH'}
                  aria-label="Assign to REACH"
                  onClick={() => openAssignReach(selected)}
                >
                  <Icon name="users" size={16} />
                </button>
                {crm.isManager ? (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Transfer lead"
                    aria-label="Transfer"
                    onClick={() => {
                      setTransferLeadIds([selected.id]);
                      setTransferOpen(true);
                    }}
                  >
                    <Icon name="accounts" size={16} />
                  </button>
                ) : null}
                <button type="button" className="icon-btn" title="Close" aria-label="Close" onClick={closeDetail}>
                  <Icon name="close" size={16} />
                </button>
              </div>
            </div>

            {scheduleMode || assignReachMode ? (
              <div className="fu-tabs" style={{ borderBottom: '1px solid var(--line)', marginBottom: 12 }}>
                <button
                  type="button"
                  className="fu-tab"
                  onClick={scheduleMode ? closeSchedule : closeAssignReach}
                >
                  ← Back
                </button>
                <button type="button" className="fu-tab active">
                  {assignReachMode
                    ? selected.reachLeadId
                      ? 'Re-assign REACH'
                      : 'Assign to REACH'
                    : scheduleActivity?.id
                      ? 'Edit follow-up'
                      : 'Schedule follow-up'}
                </button>
              </div>
            ) : (
              <div className="fu-tabs" style={{ borderBottom: '1px solid var(--line)', marginBottom: 12 }}>
                {(
                  [
                    ['overview', 'Overview'],
                    ['followups', 'Follow-ups'],
                    ['activity', 'Activity'],
                    ['notes', 'Notes'],
                    ['documents', 'Documents'],
                  ] as [DetailTab, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`fu-tab${detailTab === id ? ' active' : ''}`}
                    onClick={() => setDetailTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <div className="detail-slider-body">
              {scheduleMode ? (
                <ScheduleFollowUpForm
                  key={`inline-${selected.id}-${scheduleActivity?.id || 'new'}-${selected.nextFollowUp || ''}`}
                  formId="lead-slider-fu-form"
                  compact
                  lockedLead={selected}
                  initial={
                    scheduleActivity || {
                      id: '',
                      type: 'Call',
                      title: `Call — ${selected.name}`,
                      leadName: selected.name,
                      leadId: selected.id,
                      mobile: selected.mobile,
                      wing: selected.wing,
                      branch: selected.city,
                      dueAt: selected.nextFollowUp || new Date(Date.now() + 3600000).toISOString(),
                      done: false,
                      owner: crm.userName,
                      leadStage: selected.status,
                      notes: '',
                    }
                  }
                  onClose={closeSchedule}
                />
              ) : null}

              {assignReachMode ? (
                <AssignReachForm
                  key={`reach-${selected.id}-${selected.reachLeadId || 'new'}`}
                  formId="lead-slider-reach-form"
                  compact
                  lead={selected}
                  onClose={closeAssignReach}
                />
              ) : null}

              {!scheduleMode && !assignReachMode && detailTab === 'overview' ? (
                <>
                  <div className="meta-stats" style={{ marginBottom: 12 }}>
                    <div>
                      <span>Source</span>
                      <strong>{selected.source}</strong>
                    </div>
                    <div>
                      <span>Owner</span>
                      <strong>{selected.owner}</strong>
                    </div>
                    <div>
                      <span>Created</span>
                      <strong>{fmtWhen(selected.createdAt)}</strong>
                    </div>
                    <div>
                      <span>Updated</span>
                      <strong>{fmtWhen(selected.updatedAt || selected.createdAt)}</strong>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gap: 8,
                      marginBottom: 14,
                      padding: 12,
                      border: '1px solid var(--line)',
                      borderRadius: 12,
                    }}
                  >
                    <strong style={{ fontSize: '0.85rem' }}>REACH / Sales &amp; Marketing</strong>
                    {selected.reachLeadId || selected.reachAssignedAt ? (
                      <div style={{ fontSize: '0.85rem' }}>
                        Synced · {selected.reachRepName || selected.reachRepId || 'REACH user'}
                        {selected.reachLeadId ? ` · ${selected.reachLeadId}` : ''}
                        {selected.reachAssignedAt ? ` · ${fmtWhen(selected.reachAssignedAt)}` : ''}
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                        Not sent to REACH yet. Assign a REACH manager or portal user to hand off this lead with
                        follow-ups.
                      </div>
                    )}
                    <button type="button" className="btn btn-primary" onClick={() => openAssignReach(selected)}>
                      {selected.reachLeadId ? 'Re-assign / sync REACH' : 'Assign to REACH'}
                    </button>
                  </div>

                  <div className="lm-score">
                    <div>
                      <span>Lead score</span>
                      <strong>{leadScore(selected)}/100</strong>
                    </div>
                    <div className="lm-score-bar">
                      <i style={{ width: `${leadScore(selected)}%` }} />
                    </div>
                  </div>

                  <div className="lm-next">
                    <div>
                      <span>Next follow-up</span>
                      <strong>
                        {nextFu ? `${fmtWhen(nextFu)} — Call` : 'Not scheduled'}
                      </strong>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: '6px 10px' }}
                      onClick={() => openSchedule(selected, nextPendingActivity(selected))}
                    >
                      Edit
                    </button>
                  </div>

                  {selected.status === 'Won' && selected.conversionId ? (
                    <div className="status Won" style={{ marginBottom: 12, justifyContent: 'flex-start', padding: '8px 10px' }}>
                      Converted · {selected.conversionType} · {selected.conversionId}
                    </div>
                  ) : null}

                  {selected.status === 'Lost' ? (
                    <div className="status Lost" style={{ marginBottom: 12, justifyContent: 'flex-start', padding: '8px 10px' }}>
                      Lost · {selected.lostReason || 'Reason not set'}
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 8, marginBottom: 14, padding: 12, border: '1px solid var(--line)', borderRadius: 12 }}>
                      <strong style={{ fontSize: '0.85rem' }}>Close as Lost</strong>
                      <select value={lostReason} onChange={(e) => setLostReason(e.target.value as LostReason | '')}>
                        <option value="">Lost reason *</option>
                        {LOST_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <input
                        value={lostNote}
                        onChange={(e) => setLostNote(e.target.value)}
                        placeholder="Optional note"
                      />
                      <button type="button" className="btn btn-ghost" onClick={confirmLost} disabled={!lostReason}>
                        Mark Lost / Closed
                      </button>
                    </div>
                  )}

                  <h3 style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>Recent activity</h3>
                  <div className="timeline" style={{ marginBottom: 14 }}>
                    {(selected.history || []).length === 0 ? (
                      <div className="tl-item">
                        <span>{fmtWhen(selected.createdAt)}</span>
                        <strong>Lead created</strong>
                        <p>Source: {selected.source}</p>
                      </div>
                    ) : (
                      (selected.history || []).slice(0, 6).map((h, i) => (
                        <div key={`${h.at}-${i}`} className="tl-item">
                          <span>
                            {fmtWhen(h.at)} · {h.actor}
                          </span>
                          <strong>{h.message}</strong>
                        </div>
                      ))
                    )}
                    {nextFu ? (
                      <div className="tl-item">
                        <span>{fmtWhen(nextFu)} · Upcoming</span>
                        <strong>Follow-up (Call)</strong>
                        <p>Confirm next step with {selected.name}</p>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}

              {!scheduleMode && !assignReachMode && detailTab === 'followups' ? (
                <div className="follow-list" style={{ marginBottom: 12 }}>
                  {leadFollowUps.length === 0 ? (
                    <div className="empty">No follow-ups linked yet.</div>
                  ) : (
                    leadFollowUps.map((a) => (
                      <div key={a.id} className={`follow-item${a.done ? ' done' : ''}`}>
                        <span>
                          <strong>
                            [{a.type}] {a.title}
                          </strong>
                          <span>
                            {fmtWhen(a.dueAt)} · {a.owner}
                          </span>
                        </span>
                        <div className="fu-actions">
                          {!a.done ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ padding: '4px 8px' }}
                                onClick={() => openSchedule(selected, a)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ padding: '4px 8px' }}
                                onClick={() => {
                                  crm.completeActivity(a.id);
                                  crm.pushToast('Follow-up completed');
                                }}
                              >
                                Done
                              </button>
                            </>
                          ) : (
                            <span className="status Completed">Done</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={() => openSchedule(selected)}>
                    + Schedule follow-up
                  </button>
                </div>
              ) : null}

              {!scheduleMode && !assignReachMode && detailTab === 'activity' ? (
                <div className="timeline" style={{ marginBottom: 12 }}>
                  {(selected.history || []).length === 0 ? (
                    <div className="empty">No activity logged.</div>
                  ) : (
                    (selected.history || []).map((h, i) => (
                      <div key={`${h.at}-${i}`} className="tl-item">
                        <span>
                          {fmtWhen(h.at)} · {h.actor}
                        </span>
                        <strong>{h.message}</strong>
                      </div>
                    ))
                  )}
                </div>
              ) : null}

              {!scheduleMode && !assignReachMode && detailTab === 'notes' ? (
                <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
                  <label className="field">
                    <span>Existing notes</span>
                    <textarea rows={4} value={selected.notes || ''} readOnly placeholder="No notes yet" />
                  </label>
                  <label className="field">
                    <span>Add note</span>
                    <textarea rows={2} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Call outcome, interest, objections…" />
                  </label>
                  <button type="button" className="btn btn-primary" onClick={saveNote} disabled={!noteDraft.trim()}>
                    Save note
                  </button>
                </div>
              ) : null}

              {!scheduleMode && !assignReachMode && detailTab === 'documents' ? (
                <div className="empty" style={{ marginBottom: 12 }}>
                  Documents attach in a later release. Use Notes for now.
                </div>
              ) : null}
            </div>

            {scheduleMode ? (
              <div className="detail-slider-actions" style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={closeSchedule}>
                  Cancel
                </button>
                <button type="submit" form="lead-slider-fu-form" className="btn btn-primary" style={{ flex: 1 }}>
                  {scheduleActivity?.id ? 'Save changes' : 'Schedule'}
                </button>
              </div>
            ) : assignReachMode ? (
              <div className="detail-slider-actions" style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={closeAssignReach}>
                  Cancel
                </button>
                <button type="submit" form="lead-slider-reach-form" className="btn btn-primary" style={{ flex: 1 }}>
                  {selected.reachLeadId ? 'Re-assign' : 'Send to REACH'}
                </button>
              </div>
            ) : (
              <div className="lm-quick detail-slider-actions">
                {selected.mobile ? (
                  <a className="btn btn-primary" href={`tel:${selected.mobile}`}>
                    <Icon name="phone" size={15} /> Call
                  </a>
                ) : (
                  <button type="button" className="btn btn-primary" disabled>
                    Call
                  </button>
                )}
                {selected.mobile ? (
                  <a
                    className="btn lm-wa"
                    href={`https://wa.me/91${selected.mobile.replace(/\D/g, '').slice(-10)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Icon name="whatsapp" size={15} /> WhatsApp
                  </a>
                ) : (
                  <button type="button" className="btn lm-wa" disabled>
                    WhatsApp
                  </button>
                )}
                <button type="button" className="btn lm-sched" onClick={() => openSchedule(selected)}>
                  <Icon name="calendar" size={15} /> Schedule
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(selected)}>
                  <Icon name="edit" size={15} /> Update
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => openAssignReach(selected)}>
                  <Icon name="users" size={15} /> REACH
                </button>
              </div>
            )}
          </aside>
        </div>
      ) : null}

      {editing ? (
        <EditLeadModal lead={crm.leads.find((l) => l.id === editing.id) || editing} onClose={() => setEditing(null)} />
      ) : null}
      {importOpen ? <ImportLeadsModal onClose={() => setImportOpen(false)} /> : null}
      {transferOpen ? (
        <TransferOwnershipModal
          presetLeadIds={transferLeadIds}
          defaultScope="both"
          onClose={() => {
            setTransferOpen(false);
            setTransferLeadIds(undefined);
            setCheckedIds([]);
          }}
        />
      ) : null}
    </div>
  );
}
