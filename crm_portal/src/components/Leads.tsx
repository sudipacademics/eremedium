import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  LEAD_PIPELINE,
  LEAD_PIPELINE_GROUPS,
  LOST_REASONS,
  WINGS,
  franchiseVerticalLabel,
  formatNumber,
  initials,
  wingById,
  type CrmActivity,
  type CrmLead,
  type LeadPipelineStage,
  type LeadStatus,
  type LostReason,
  type WingId,
} from '../data';
import {
  leadMatchesModule,
  moduleTitle,
  parseModuleParams,
  type CrmDomain,
  type CrmModuleWing,
} from '../crmModules';
import { downloadCsv, exportPdfTable, stampFile } from '../exportData';
import { Icon, type IconName } from '../icons';
import { safeHttpUrl, safeTelHref } from '../security';
import { useCrm } from '../store';
import { ExportMenu } from './ExportMenu';
import {
  AssignReachForm,
  EditLeadModal,
  ImportLeadsModal,
  ScheduleFollowUpForm,
  ServiceWhatsAppModal,
  TransferOwnershipModal,
} from './Forms';
import { whatsappCentrePathForLead } from './WhatsAppCentre';
import {
  countActiveFranchiseFilters,
  EMPTY_FRANCHISE_FILTERS,
  FranchiseFilterButton,
  FranchiseFilterModal,
  type FranchiseFilterValues,
} from './FranchiseFilterModal';
import { Empty, StatusPill, WingPill } from './ui';

type DetailTab = 'overview' | 'followups' | 'activity' | 'notes' | 'documents' | 'transfers';
type OverviewFocus = 'all' | 'open' | 'progress' | 'won' | 'lost';

function isReachAssigned(lead: CrmLead) {
  return Boolean(lead.reachLeadId || lead.reachAssignedAt || lead.reachRepId || lead.reachRepName);
}

function reachTrackingTag(lead: CrmLead) {
  if (!isReachAssigned(lead)) return '';
  if (lead.reachLeadId) return lead.reachLeadId;
  if (lead.reachRepName) return `REACH · ${lead.reachRepName.split(' ')[0]}`;
  return 'REACH';
}

const IN_PROGRESS_STATUSES: LeadStatus[] = [
  'Contacted',
  'Connected',
  'Interested',
  'Qualified',
  'Proposal Required',
  'Discussion Ongoing',
  'Ready to Proceed',
];

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
    return { key: monthKey(d), from: startOfMonth(d), to: endOfMonth(d) };
  });
}
function inRange(iso: string | undefined, from: Date, to: Date) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t <= to.getTime();
}

const OVERVIEW_CARDS: Array<{ id: OverviewFocus; label: string; tone: string; icon: IconName }> = [
  { id: 'all', label: 'Total Leads', tone: 'total', icon: 'users' },
  { id: 'open', label: 'Open Pipeline', tone: 'open', icon: 'layers' },
  { id: 'progress', label: 'In Progress', tone: 'progress', icon: 'refresh' },
  { id: 'won', label: 'Won / Converted', tone: 'won', icon: 'trophy' },
  { id: 'lost', label: 'Lost / Closed', tone: 'lost', icon: 'xcircle' },
];

const PIPE_META: Record<LeadPipelineStage, { tone: string; icon: IconName }> = {
  New: { tone: 'new', icon: 'sparkle' },
  Contacted: { tone: 'contacted', icon: 'phone' },
  Interested: { tone: 'interested', icon: 'users' },
  Qualified: { tone: 'qualified', icon: 'badge' },
  'Proposal Required': { tone: 'proposal', icon: 'file' },
  'Ready to Proceed': { tone: 'ready', icon: 'handshake' },
  Won: { tone: 'won', icon: 'trophy' },
};

function formatPipePct(count: number, total: number) {
  if (!total) return '0%';
  const pct = (count / total) * 100;
  const rounded = Math.round(pct * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

function fmtEntryDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

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

function mobile10(v?: string) {
  const d = String(v || '').replace(/\D/g, '').slice(-10);
  return /^\d{10}$/.test(d) ? d : '';
}

export function LeadsPage() {
  const crm = useCrm();
  const navigate = useNavigate();
  const params = useParams<{ domain?: string; wing?: string }>();
  const parsedModule = parseModuleParams(params.domain, params.wing);
  const domain: CrmDomain = parsedModule?.domain ?? 'service';
  const moduleWing: CrmModuleWing = parsedModule?.wing ?? 'aesthetic';

  const [q, setQ] = useState('');
  const [wing, setWing] = useState<WingId | 'all'>('all');
  const [filters, setFilters] = useState<FranchiseFilterValues>(EMPTY_FRANCHISE_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
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
  const [serviceWaLead, setServiceWaLead] = useState<CrmLead | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [lostReason, setLostReason] = useState<LostReason | ''>('');
  const [lostNote, setLostNote] = useState('');
  const [pipeMenu, setPipeMenu] = useState<LeadPipelineStage | null>(null);
  const [month, setMonth] = useState('all');
  const [overviewFocus, setOverviewFocus] = useState<OverviewFocus>('all');
  const pipelineRef = useRef<HTMLDivElement>(null);
  const status = filters.status;
  const setStatus = (next: string) => setFilters((f) => ({ ...f, status: next }));
  const months = useMemo(() => monthOptions(12), []);
  const range = useMemo(() => {
    if (month === 'all') {
      return { from: new Date(0), to: endOfDay(new Date(8640000000000000)), label: 'All entry dates', all: true as const };
    }
    const hit = months.find((m) => m.key === month) || months[0];
    return { from: hit.from, to: hit.to, label: fmtRangeLabel(hit.from, hit.to), all: false as const };
  }, [month, months]);

  useEffect(() => {
    setWing('all');
    setSelectedId(null);
    setDetailOpen(false);
    setFilters(EMPTY_FRANCHISE_FILTERS);
    setFilterOpen(false);
  }, [domain, moduleWing]);

  useEffect(() => {
    if (!pipeMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (!pipelineRef.current?.contains(e.target as Node)) setPipeMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [pipeMenu]);

  const owners = useMemo(() => {
    const set = new Set(crm.leads.map((l) => l.owner).filter(Boolean));
    return Array.from(set).sort();
  }, [crm.leads]);

  const reachReps = useMemo(() => {
    const set = new Set(
      crm.leads
        .map((l) => String(l.reachRepName || '').trim())
        .filter(Boolean),
    );
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [crm.leads]);

  const isFranchise = domain === 'franchise';

  const resetFilters = () => {
    setQ('');
    setWing('all');
    setFilters(EMPTY_FRANCHISE_FILTERS);
    setOverviewFocus('all');
    setMonth('all');
  };

  const effectiveStatus = filters.status;
  const effectiveOwner = filters.owner;
  const effectiveEntryMonth = filters.entryMonth;
  const effectiveEntryFrom = filters.entryFrom;
  const effectiveEntryTo = filters.entryTo;
  const effectiveReach = filters.reachFilter;

  const entryFilterRange = useMemo(() => {
    if (effectiveEntryFrom || effectiveEntryTo) {
      const from = effectiveEntryFrom ? startOfDay(new Date(`${effectiveEntryFrom}T00:00:00`)) : new Date(0);
      const to = effectiveEntryTo ? endOfDay(new Date(`${effectiveEntryTo}T00:00:00`)) : endOfDay(new Date());
      return { from, to, active: true as const };
    }
    if (effectiveEntryMonth !== 'all') {
      const hit = months.find((m) => m.key === effectiveEntryMonth);
      if (hit) return { from: hit.from, to: hit.to, active: true as const };
    }
    return null;
  }, [effectiveEntryFrom, effectiveEntryTo, effectiveEntryMonth, months]);

  const matchesCommon = (l: CrmLead, needle: string) => {
    if (!leadMatchesModule(l, domain, moduleWing)) return false;
    if (wing !== 'all' && l.wing !== wing) return false;
    if (effectiveOwner !== 'all' && l.owner !== effectiveOwner) return false;
    const onReach = isReachAssigned(l);
    if (effectiveReach === 'reach' && !onReach) return false;
    if (effectiveReach === 'crm_only' && onReach) return false;
    if (effectiveReach !== 'all' && effectiveReach !== 'reach' && effectiveReach !== 'crm_only') {
      if (String(l.reachRepName || '') !== effectiveReach) return false;
    }
    if (isFranchise) {
      if (filters.model !== 'all' && (l.franchiseModel || '') !== filters.model) return false;
      if (
        filters.propertyOwnership !== 'all'
        && (l.propertyOwnership || '') !== filters.propertyOwnership
      ) {
        return false;
      }
      if (
        filters.investmentCapacity !== 'all'
        && !(l.investmentCapacity || '').includes(filters.investmentCapacity)
      ) {
        return false;
      }
      if (filters.timeline !== 'all' && (l.timeline || '') !== filters.timeline) return false;
      if (filters.state && l.state !== filters.state) return false;
      if (filters.district && l.district !== filters.district) return false;
      if (
        filters.subdivision.trim() &&
        !(l.subdivision || '').toLowerCase().includes(filters.subdivision.trim().toLowerCase())
      ) {
        return false;
      }
      if (
        filters.village.trim() &&
        !`${l.village || ''} ${l.city || ''}`.toLowerCase().includes(filters.village.trim().toLowerCase())
      ) {
        return false;
      }
      if (filters.pinCode.trim() && (l.pinCode || '') !== filters.pinCode.trim()) return false;
    }
    if (!needle) return true;
    return `${l.name} ${l.mobile} ${l.email} ${l.city} ${l.id} ${l.notes || ''} ${l.owner} ${l.reachLeadId || ''} ${l.reachRepName || ''} ${l.reachRepId || ''} ${l.state || ''} ${l.district || ''} ${l.village || ''} ${l.pinCode || ''}`
      .toLowerCase()
      .includes(needle);
  };

  /**
   * Single source for KPIs + table + pipeline.
   * Date scope: franchise entry filter if set, else the overview month picker (incl. All).
   */
  const baseRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return crm.leads.filter((l) => {
      if (entryFilterRange) {
        if (!inRange(l.createdAt, entryFilterRange.from, entryFilterRange.to)) return false;
      } else if (!range.all && !inRange(l.createdAt, range.from, range.to)) {
        return false;
      }
      return matchesCommon(l, needle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    crm.leads,
    q,
    wing,
    effectiveOwner,
    effectiveReach,
    filters,
    entryFilterRange,
    range.from,
    range.to,
    range.all,
    domain,
    moduleWing,
    isFranchise,
  ]);

  const stats = useMemo(() => {
    const total = baseRows.length;
    const open = baseRows.filter((l) => l.status !== 'Won' && l.status !== 'Lost').length;
    const inProgress = baseRows.filter((l) => IN_PROGRESS_STATUSES.includes(l.status)).length;
    const won = baseRows.filter((l) => l.status === 'Won').length;
    const lost = baseRows.filter((l) => l.status === 'Lost' || l.status === 'Not Interested').length;
    const wonPct = total ? Math.round((won / total) * 1000) / 10 : 0;
    return { total, open, inProgress, won, lost, wonPct };
  }, [baseRows]);

  const rows = useMemo(() => {
    return baseRows.filter((l) => {
      if (effectiveStatus !== 'all' && l.status !== effectiveStatus) return false;
      if (overviewFocus === 'open') return l.status !== 'Won' && l.status !== 'Lost';
      if (overviewFocus === 'progress') return IN_PROGRESS_STATUSES.includes(l.status);
      if (overviewFocus === 'won') return l.status === 'Won';
      if (overviewFocus === 'lost') return l.status === 'Lost' || l.status === 'Not Interested';
      return true;
    });
  }, [baseRows, effectiveStatus, overviewFocus]);

  const overviewValue = (id: OverviewFocus) => {
    if (id === 'all') return formatNumber(stats.total);
    if (id === 'open') return formatNumber(stats.open);
    if (id === 'progress') return formatNumber(stats.inProgress);
    if (id === 'won') return formatNumber(stats.won);
    return formatNumber(stats.lost);
  };

  const onOverviewCard = (id: OverviewFocus) => {
    setStatus('all');
    setOverviewFocus((cur) => (cur === id ? 'all' : id));
  };

  const pipeline = useMemo(() => {
    const total = rows.length;
    return LEAD_PIPELINE.map((stage) => {
      const group = LEAD_PIPELINE_GROUPS[stage];
      const count = rows.filter((l) => l.status === stage).length;
      return {
        stage,
        count,
        pct: formatPipePct(count, total),
        meta: PIPE_META[stage],
        options: group,
      };
    });
  }, [rows]);

  const selected = useMemo(
    () => (selectedId ? crm.leads.find((l) => l.id === selectedId) || null : null),
    [crm.leads, selectedId],
  );

  const openLead = (lead: CrmLead, tab: DetailTab = 'overview') => {
    setSelectedId(lead.id);
    setDetailTab(tab);
    crm.refreshTransferHistory(lead.id).catch(() => undefined);
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

  const saveLeadAsContact = (lead: CrmLead) => {
    const mobile = mobile10(lead.mobile);
    if (!lead.name?.trim()) {
      crm.pushToast('Lead name is required to save as contact', 'err');
      return;
    }
    if (!mobile) {
      crm.pushToast('Lead needs a valid 10-digit mobile to save as contact', 'err');
      return;
    }
    const exists = (crm.contacts || []).some(
      (c) => mobile10(c.mobile) === mobile || (c.name.trim().toLowerCase() === lead.name.trim().toLowerCase() && mobile10(c.mobile) === mobile),
    );
    if (exists) {
      crm.pushToast(`${lead.name} is already in Contacts`, 'err');
      return;
    }
    const contact = crm.addContact({
      name: lead.name.trim(),
      mobile,
      email: (lead.email || '').trim(),
      wing: lead.wing,
      owner: lead.owner || crm.userName,
      role: lead.wing === 'franchise' ? 'Franchise Applicant' : 'Lead',
      account: lead.city || lead.territory || undefined,
    });
    crm.pushToast(`Saved to Contacts · ${contact.id}`);
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

  const pageHeading = moduleTitle(domain, 'lead', moduleWing);
  const wingOptions =
    domain === 'service'
      ? WINGS.filter((w) => w.id === moduleWing)
      : WINGS.filter((w) => (moduleWing === 'nexilab' ? w.id === 'nexilab' : w.id === 'franchise'));

  const exportLeads = (kind: 'csv' | 'pdf') => {
    const header = isFranchise
      ? ['ID', 'Applicant', 'Mobile', 'Entry date', 'Business', 'Model', 'State', 'District', 'PIN', 'Status', 'Owner', 'Last follow-up', 'Next follow-up']
      : ['ID', 'Name', 'Mobile', 'City', 'Entry date', 'Wing', 'Source', 'REACH tag', 'Status', 'Owner', 'Last follow-up', 'Next follow-up'];
    const data = rows.map((lead) => {
      const next = syncedNextFollowUp(lead, crm.activities);
      const last = syncedLastFollowUp(lead, crm.activities);
      const biz = franchiseVerticalLabel(lead.franchiseVertical);
      if (isFranchise) {
        return [
          lead.id,
          lead.name,
          lead.mobile,
          fmtEntryDate(lead.createdAt),
          biz,
          lead.franchiseModel || '',
          lead.state || '',
          lead.district || '',
          lead.pinCode || '',
          lead.status,
          lead.owner,
          fmtWhen(last),
          fmtWhen(next),
        ];
      }
      return [
        lead.id,
        lead.name,
        lead.mobile,
        lead.city || '',
        fmtEntryDate(lead.createdAt),
        wingById(lead.wing).short,
        lead.source,
        reachTrackingTag(lead) || '',
        lead.status,
        lead.owner,
        fmtWhen(last),
        fmtWhen(next),
      ];
    });
    const file = stampFile(`crm-leads-${domain}-${moduleWing}`);
    if (kind === 'csv') {
      downloadCsv(file, header, data);
      crm.pushToast(`Exported ${data.length} lead(s) to CSV`);
      return;
    }
    exportPdfTable({
      title: pageHeading,
      subtitle: 'Smilecure CRM · filtered leads directory',
      header,
      rows: data,
      fileHint: file,
    });
  };

  if (!parsedModule) {
    return <Navigate to="/leads/service/aesthetic" replace />;
  }

  return (
    <div className="lm-page">
      <header className="page-head page-head-compact">
        <div>
          <h1>{pageHeading}</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: '0.82rem' }}>
            {domain === 'service' ? 'Service' : 'Franchise'} lead directory · {moduleWing} submodule
          </p>
        </div>
      </header>

      <section className="fu-check lo-overview" aria-label="Lead Overview">
        <div className="fu-check-head">
          <div className="fu-check-title">
            <span className="fu-check-mark" aria-hidden="true">
              <Icon name="funnel" size={20} />
            </span>
            <div>
              <strong>Lead Overview</strong>
              <p>Real-time status of your leads and sales pipeline.</p>
            </div>
          </div>
          <label className="fu-check-range">
            <Icon name="calendar" size={15} />
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label="Lead entry date range"
              title={`Filters overview, pipeline, and table · ${range.label}`}
            >
              <option value="all">All entry dates</option>
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
          {OVERVIEW_CARDS.map((card) => (
            <button
              key={card.id}
              type="button"
              className={`fu-check-card${overviewFocus === card.id && card.id !== 'all' ? ' on' : ''}`}
              data-tone={card.tone}
              onClick={() => onOverviewCard(card.id)}
            >
              <span className="fu-check-ico">
                <Icon name={card.icon} size={16} />
              </span>
              <div>
                <span>{card.label}</span>
                <strong>
                  {overviewValue(card.id)}
                  {card.id === 'won' ? <span className="pipe-pct">{stats.wonPct}%</span> : null}
                </strong>
              </div>
            </button>
          ))}
        </div>
      </section>

      <div className="card lm-pipeline">
        <div className="card-head">
          <h3>Lead pipeline</h3>
          <span className="badge-pill">Live funnel</span>
        </div>
        <div className="pipeline" ref={pipelineRef}>
          {pipeline.map((p, i) => {
            const active = p.options.includes(status as LeadStatus) || status === p.stage;
            return (
              <div
                key={p.stage}
                className={`pipe-step${active ? ' on' : ''}`}
                data-tone={p.meta.tone}
                style={{ zIndex: pipeMenu === p.stage ? 40 : pipeline.length - i }}
              >
                <div className="pipe-step-top">
                  <Icon className="pipe-ico" name={p.meta.icon} size={15} />
                  <button
                    type="button"
                    className="pipe-step-label"
                    style={{
                      border: 0,
                      background: 'transparent',
                      color: 'inherit',
                      padding: 0,
                      font: 'inherit',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      setPipeMenu(null);
                      setStatus(status === p.stage ? 'all' : p.stage);
                    }}
                    title={`Filter ${p.stage}`}
                  >
                    {p.stage}
                  </button>
                  <button
                    type="button"
                    className={`pipe-step-caret${pipeMenu === p.stage ? ' open' : ''}`}
                    aria-label={`${p.stage} statuses`}
                    aria-expanded={pipeMenu === p.stage}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPipeMenu((cur) => (cur === p.stage ? null : p.stage));
                    }}
                  >
                    <Icon name="chevron" size={14} />
                  </button>
                </div>
                <button
                  type="button"
                  className="pipe-step-stats"
                  style={{
                    border: 0,
                    background: 'transparent',
                    color: 'inherit',
                    padding: 0,
                    font: 'inherit',
                    width: '100%',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setPipeMenu(null);
                    setStatus(status === p.stage ? 'all' : p.stage);
                  }}
                >
                  <b>{formatNumber(p.count)}</b>
                  <span className="pipe-pct">{p.pct}</span>
                </button>
                {pipeMenu === p.stage ? (
                  <div className="pipe-menu" role="menu">
                    {p.options.map((opt) => {
                      const n = rows.filter((l) => l.status === opt).length;
                      return (
                        <button
                          key={opt}
                          type="button"
                          role="menuitem"
                          className={status === opt ? 'active' : ''}
                          onClick={() => {
                            setStatus(status === opt ? 'all' : opt);
                            setPipeMenu(null);
                          }}
                        >
                          {opt} · {formatNumber(n)}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card lm-main">
        <div className="fu-table-tools lm-table-tools">
          {crm.isManager ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setTransferLeadIds(checkedIds.length ? checkedIds : undefined);
                setTransferOpen(true);
              }}
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
                    `Delete ${n} selected lead${n === 1 ? '' : 's'}? This cannot be undone.`,
                  )
                ) {
                  return;
                }
                const { deleted } = crm.deleteLeads(checkedIds);
                if (selectedId && checkedIds.includes(selectedId)) {
                  setSelectedId(null);
                  setDetailOpen(false);
                }
                setCheckedIds([]);
                crm.pushToast(
                  deleted ? `Deleted ${deleted} lead${deleted === 1 ? '' : 's'}` : 'No leads deleted',
                  deleted ? 'ok' : 'err',
                );
              }}
            >
              Delete ({checkedIds.length})
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={() => setImportOpen(true)}>
            Import Lead
          </button>
          <div className="search fu-table-search">
            <Icon name="search" size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads…" aria-label="Search leads" />
          </div>
          {!isFranchise ? (
            wingOptions.length > 1 ? (
              <select value={wing} onChange={(e) => setWing(e.target.value as WingId | 'all')} aria-label="Wing filter">
                <option value="all">All in module</option>
                {wingOptions.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="badge-pill">{wingOptions[0]?.short || moduleWing}</span>
            )
          ) : null}
          {!crm.isManager ? (
            <span className="badge-pill" title="You only see leads assigned to you">
              My leads · {crm.userName}
            </span>
          ) : null}
          <FranchiseFilterButton
            activeCount={countActiveFranchiseFilters(filters, {
              includeModel: isFranchise,
              includeGeo: isFranchise,
            })}
            onClick={() => setFilterOpen(true)}
          />
          <button type="button" className="btn btn-ghost" onClick={resetFilters}>
            Reset
          </button>
          <ExportMenu onCsv={() => exportLeads('csv')} onPdf={() => exportLeads('pdf')} disabled={rows.length === 0} />
        </div>
        <table className="table">
          <thead>
            <tr>
              {crm.isManager ? (
                <th style={{ width: 36 }} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label="Select all visible leads"
                    checked={rows.length > 0 && rows.every((l) => checkedIds.includes(l.id))}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate =
                          checkedIds.length > 0 && !rows.every((l) => checkedIds.includes(l.id));
                      }
                    }}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setCheckedIds((ids) => Array.from(new Set([...ids, ...rows.map((l) => l.id)])));
                      } else {
                        const visible = new Set(rows.map((l) => l.id));
                        setCheckedIds((ids) => ids.filter((id) => !visible.has(id)));
                      }
                    }}
                  />
                </th>
              ) : null}
              <th>ID</th>
              <th>{domain === 'franchise' ? 'Applicant' : 'Name'}</th>
              <th>Entry date</th>
              {domain === 'franchise' ? (
                <>
                  <th>Business</th>
                  <th>Model</th>
                  <th>District</th>
                  <th>PIN</th>
                </>
              ) : (
                <>
                  <th>Wing</th>
                  <th>Source</th>
                  <th>REACH tag</th>
                </>
              )}
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
              const reachTag = reachTrackingTag(lead);
              const biz = franchiseVerticalLabel(lead.franchiseVertical) || '—';
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
                      {domain === 'franchise'
                        ? [lead.mobile, lead.alternateMobile].filter(Boolean).join(' · ')
                        : lead.city || lead.mobile}
                    </div>
                  </td>
                  <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{fmtEntryDate(lead.createdAt)}</td>
                  {domain === 'franchise' ? (
                    <>
                      <td>{biz}</td>
                      <td>{lead.franchiseModel || '—'}</td>
                      <td style={{ fontSize: '0.78rem' }}>
                        <strong>{lead.district || '—'}</strong>
                        <div style={{ color: 'var(--muted)' }}>{lead.state || ''}</div>
                      </td>
                      <td>{lead.pinCode || '—'}</td>
                    </>
                  ) : (
                    <>
                      <td>
                        <WingPill wing={lead.wing} />
                      </td>
                      <td>{lead.source}</td>
                      <td>
                        {reachTag ? (
                          <span
                            className="reach-tag"
                            title={`Assigned to ${lead.reachRepName || lead.reachRepId || 'REACH'}${lead.reachAssignedAt ? ` · ${fmtWhen(lead.reachAssignedAt)}` : ''}`}
                          >
                            {reachTag}
                            {lead.reachRepName ? (
                              <em> · {lead.reachRepName.split(' ')[0]}</em>
                            ) : null}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>—</span>
                        )}
                      </td>
                    </>
                  )}
                  <td>
                    <StatusPill value={lead.status} />
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
                        <a className="icon-btn" href={safeTelHref(lead.mobile) || undefined} title="Call" aria-label="Call">
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
                        title="Add to Contacts"
                        aria-label="Add to Contacts"
                        onClick={() => saveLeadAsContact(lead)}
                      >
                        <Icon name="leads" size={15} />
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
                  <StatusPill value={selected.status} />
                  <span style={{ color: 'var(--muted)', fontSize: '0.68rem', textAlign: 'right', maxWidth: 140 }}>
                    Change status from Follow-up Check
                  </span>
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
                    className="btn btn-ghost"
                    style={{ padding: '6px 10px' }}
                    title="Transfer Lead"
                    onClick={() => {
                      setTransferLeadIds([selected.id]);
                      setTransferOpen(true);
                    }}
                  >
                    Transfer Lead
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
                    ['transfers', 'Transfers'],
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

                  {selected.wing === 'franchise' ? (
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
                      <strong style={{ fontSize: '0.85rem' }}>Franchise applicant</strong>
                      <div className="meta-stats" style={{ margin: 0 }}>
                        <div>
                          <span>Mobile</span>
                          <strong>{selected.mobile}</strong>
                        </div>
                        <div>
                          <span>Alternate</span>
                          <strong>{selected.alternateMobile || '—'}</strong>
                        </div>
                        <div>
                          <span>Which franchise</span>
                          <strong>{franchiseVerticalLabel(selected.franchiseVertical) || '—'}</strong>
                        </div>
                        <div>
                          <span>Model</span>
                          <strong>{selected.franchiseModel || '—'}</strong>
                        </div>
                        <div>
                          <span>Property ownership</span>
                          <strong>
                            {selected.propertyOwnership === 'own_shop'
                              ? 'Own shop'
                              : selected.propertyOwnership === 'rental_shop'
                                ? 'Rental shop'
                                : selected.propertyOwnership || '—'}
                          </strong>
                        </div>
                        <div>
                          <span>Investment capacity</span>
                          <strong>{selected.investmentCapacity || '—'}</strong>
                        </div>
                        <div>
                          <span>Timeline</span>
                          <strong>
                            {selected.timeline === '7_days'
                              ? '7 days'
                              : selected.timeline === '15_days'
                                ? '15 days'
                                : selected.timeline === '30_days'
                                  ? '30 days'
                                  : selected.timeline === '6_month'
                                    ? '6 months'
                                    : selected.timeline || '—'}
                          </strong>
                        </div>
                        <div>
                          <span>State</span>
                          <strong>{selected.state || '—'}</strong>
                        </div>
                        <div>
                          <span>District</span>
                          <strong>{selected.district || '—'}</strong>
                        </div>
                        <div>
                          <span>Subdivision</span>
                          <strong>{selected.subdivision || '—'}</strong>
                        </div>
                        <div>
                          <span>City / Village</span>
                          <strong>{selected.village || selected.city || '—'}</strong>
                        </div>
                        <div>
                          <span>PIN</span>
                          <strong>{selected.pinCode || '—'}</strong>
                        </div>
                        <div>
                          <span>Preferred location</span>
                          <strong>{selected.preferredLocation || selected.territory || '—'}</strong>
                        </div>
                      </div>
                      {safeHttpUrl(selected.googleMapUrl) ? (
                        <a
                          href={safeHttpUrl(selected.googleMapUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="link-btn"
                        >
                          Open Google Map
                        </a>
                      ) : null}
                    </div>
                  ) : null}

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

              {!scheduleMode && !assignReachMode && detailTab === 'transfers' ? (
                <div className="timeline" style={{ marginBottom: 12 }}>
                  <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: '0.8rem' }}>
                    Ownership history for {selected.id}. One active owner at a time — transfers do not duplicate the lead.
                  </p>
                  <div style={{ marginBottom: 12, padding: 10, border: '1px solid var(--line)', borderRadius: 10 }}>
                    <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>Current owner</span>
                    <strong style={{ display: 'block' }}>{selected.owner}</strong>
                  </div>
                  {(selected.transferHistory || []).length === 0 ? (
                    <div className="empty">No transfers recorded for this lead.</div>
                  ) : (
                    (selected.transferHistory || []).map((t) => (
                      <div key={t.id} className="tl-item">
                        <span>
                          {fmtWhen(t.transferredAt)} · by {t.transferredBy}
                        </span>
                        <strong>
                          {t.previousOwner || '—'} → {t.newOwner}
                        </strong>
                        <p>
                          {t.remarks || 'No remarks'}
                          {t.followupsMoved ? ` · ${t.followupsMoved} pending follow-up(s) moved` : ''}
                        </p>
                      </div>
                    ))
                  )}
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
                {safeTelHref(selected.mobile) ? (
                  <a className="btn btn-primary" href={safeTelHref(selected.mobile)}>
                    <Icon name="phone" size={15} /> Call
                  </a>
                ) : (
                  <button type="button" className="btn btn-primary" disabled>
                    Call
                  </button>
                )}
                {selected.mobile ? (
                  <button
                    type="button"
                    className="btn lm-wa"
                    title={
                      isFranchise
                        ? 'Franchise WhatsApp (shared Meta number)'
                        : 'Service WhatsApp (Settings → Service channel)'
                    }
                    onClick={() =>
                      isFranchise
                        ? navigate(whatsappCentrePathForLead(selected))
                        : setServiceWaLead(selected)
                    }
                  >
                    <Icon name="whatsapp" size={15} /> WhatsApp
                  </button>
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
                <button type="button" className="btn btn-ghost" onClick={() => saveLeadAsContact(selected)}>
                  <Icon name="leads" size={15} /> Add to Contact
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
      {serviceWaLead ? (
        <ServiceWhatsAppModal
          lead={crm.leads.find((l) => l.id === serviceWaLead.id) || serviceWaLead}
          onClose={() => setServiceWaLead(null)}
        />
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
      <FranchiseFilterModal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        value={filters}
        onApply={setFilters}
        owners={owners}
        reachReps={reachReps}
        months={months.map((m) => ({
          key: m.key,
          label: m.from.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
        }))}
        showOwner={crm.isManager}
        showModel={isFranchise}
        showGeo={isFranchise}
      />
    </div>
  );
}
