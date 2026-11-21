import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  SAMPLE_ACCOUNTS,
  SAMPLE_ACTIVITIES,
  DEMO_PORTAL_BOOKING_IDS,
  SAMPLE_BOOKINGS,
  SAMPLE_CAMPAIGNS,
  SAMPLE_CONTACTS,
  SAMPLE_DEALS,
  SAMPLE_LEADS,
  SAMPLE_TEAM,
  dealStageToLeadStatus,
  executiveCodeFromName,
  formatCrmTagNote,
  initials,
  makeTrackingTag,
  nextId,
  normalizeDealStage,
  normalizeLeadStatus,
  outcomeToLeadStatus,
  type CrmAccount,
  type CrmActivity,
  type CrmBooking,
  type CrmCampaign,
  type CrmContact,
  type CrmDeal,
  type CrmLead,
  type CrmTeamMember,
  type CrmTeamRole,
  type DealStage,
  type FollowUpOutcome,
  type LeadHistoryEntry,
  type LeadStatus,
  type LostReason,
  type WingId,
} from './data';
import { listCrmOwnership, transferCrmOwnership, type CrmOwnershipMap } from './crmApi';

const LEADS_KEY = 'crm_leads_v1';
const CONTACTS_KEY = 'crm_contacts_v1';
const DEALS_KEY = 'crm_deals_v1';
const TEAM_KEY = 'crm_team_v1';
const BOOKINGS_KEY = 'crm_bookings_v1';

function ensureBookingTracking(b: CrmBooking): CrmBooking {
  const executive = b.executive || b.owner || 'CRM';
  const executiveCode = b.executiveCode || executiveCodeFromName(executive);
  const trackingTag = b.trackingTag || makeTrackingTag(executive, b.id);
  return {
    ...b,
    executive,
    executiveCode,
    trackingTag,
    salesStatus: b.salesStatus || (b.billedAmount && b.billedAmount > 0 ? 'Closed' : 'Open'),
  };
}

function isOrphanDemoBooking(b: CrmBooking) {
  /* Old seed Care/Aesthetic rows never received a portal AP- ref — drop them so CRM matches live portals. */
  if (!DEMO_PORTAL_BOOKING_IDS.has(b.id)) return false;
  if (b.externalId) return false;
  if (b.wing !== 'care' && b.wing !== 'aesthetic') return false;
  return b.salesStatus === 'Open' || !b.salesStatus;
}

function loadBookings(): CrmBooking[] {
  try {
    const raw = localStorage.getItem(BOOKINGS_KEY);
    if (!raw) return SAMPLE_BOOKINGS.map(ensureBookingTracking);
    const parsed = JSON.parse(raw) as CrmBooking[];
    if (!Array.isArray(parsed) || !parsed.length) return SAMPLE_BOOKINGS.map(ensureBookingTracking);
    const cleaned = parsed.map(ensureBookingTracking).filter((b) => !isOrphanDemoBooking(b));
    if (cleaned.length !== parsed.length) {
      try {
        localStorage.setItem(BOOKINGS_KEY, JSON.stringify(cleaned));
      } catch {
        /* ignore quota */
      }
    }
    return cleaned;
  } catch {
    return SAMPLE_BOOKINGS.map(ensureBookingTracking);
  }
}

type Toast = { id: number; text: string; tone?: 'ok' | 'err' };

type CrmState = {
  leads: CrmLead[];
  contacts: CrmContact[];
  accounts: CrmAccount[];
  deals: CrmDeal[];
  activities: CrmActivity[];
  bookings: CrmBooking[];
  campaigns: CrmCampaign[];
  wingFilter: WingId | 'all';
  setWingFilter: (w: WingId | 'all') => void;
  toasts: Toast[];
  pushToast: (text: string, tone?: 'ok' | 'err') => void;
  addLead: (lead: Omit<CrmLead, 'id' | 'ownerInitials' | 'createdAt'> & { id?: string; createdAt?: string }) => CrmLead;
  updateLead: (id: string, patch: Partial<CrmLead>, note?: string) => CrmLead | null;
  importLeads: (
    rows: Array<{
      name: string;
      mobile: string;
      email?: string;
      wing?: WingId;
      source?: string;
      status?: LeadStatus;
      city?: string;
      owner?: string;
      notes?: string;
      value?: number;
    }>,
  ) => { added: number; skipped: number };
  addContact: (contact: Omit<CrmContact, 'id'> & { id?: string }) => CrmContact;
  importContacts: (rows: Array<Omit<CrmContact, 'id' | 'owner'> & { owner?: string }>) => { added: number; skipped: number };
  addBooking: (
    booking: Omit<CrmBooking, 'id' | 'createdAt' | 'trackingTag' | 'executive' | 'executiveCode'> & {
      id?: string;
      trackingTag?: string;
      executive?: string;
      executiveCode?: string;
    },
  ) => CrmBooking;
  updateBooking: (id: string, patch: Partial<CrmBooking>) => CrmBooking | null;
  /** Apply closes synced from Care / Aesthetic / lab bill generation only. */
  applySalesCloses: (
    rows: Array<{
      tracking_tag?: string;
      booking_id?: string;
      amount?: number;
      bill_ref?: string;
      portal?: string;
      closed_at?: string;
      executive?: string;
      mobile?: string;
      patient_name?: string;
    }>,
  ) => number;
  toggleActivity: (id: string) => void;
  updateActivity: (id: string, patch: Partial<CrmActivity>) => CrmActivity | null;
  logActivityUpdate: (
    id: string,
    input: {
      message: string;
      nextDueAt?: string;
      type?: CrmActivity['type'];
      outcome?: FollowUpOutcome | string;
      expectedOutcome?: string;
    },
  ) => CrmActivity | null;
  completeActivity: (id: string, note?: string) => CrmActivity | null;
  addActivity: (activity: Omit<CrmActivity, 'id'> & { id?: string }) => CrmActivity;
  addDeal: (deal: Omit<CrmDeal, 'id'> & { id?: string }) => CrmDeal;
  updateDeal: (id: string, patch: Partial<CrmDeal>) => CrmDeal | null;
  createDealFromFollowUp: (
    activityId: string,
    input: {
      title: string;
      stage: DealStage;
      value: number;
      closeDate: string;
      product?: string;
      probability?: number;
    },
  ) => CrmDeal | null;
  closeLeadLost: (leadId: string, reason: LostReason | string, note?: string) => CrmLead | null;
  convertDealWon: (
    dealId: string,
    input: {
      conversionType: 'aesthetic' | 'care' | 'lab' | 'franchise' | 'partner';
      conversionId: string;
      service?: string;
      branch?: string;
    },
  ) => CrmDeal | null;
  team: CrmTeamMember[];
  isManager: boolean;
  userRoleLabel: string;
  addTeamMember: (input: { name: string; email?: string; role: CrmTeamRole }) => CrmTeamMember;
  updateTeamMember: (id: string, patch: Partial<CrmTeamMember>) => CrmTeamMember | null;
  transferOwnership: (input: {
    fromOwner: string;
    toOwner: string;
    scope: 'leads' | 'followups' | 'both';
    leadIds?: string[];
    activityIds?: string[];
    note?: string;
  }) => Promise<{ leads: number; followups: number; deals: number } | null>;
  applyOwnershipMap: (map: CrmOwnershipMap) => void;
  userName: string;
};

const ACTIVITIES_KEY = 'crm_activities_v2';

function loadActivities(): CrmActivity[] {
  try {
    const raw = localStorage.getItem(ACTIVITIES_KEY);
    if (!raw) return SAMPLE_ACTIVITIES;
    const parsed = JSON.parse(raw) as CrmActivity[];
    return Array.isArray(parsed) && parsed.length ? parsed : SAMPLE_ACTIVITIES;
  } catch {
    return SAMPLE_ACTIVITIES;
  }
}

function loadLeads(): CrmLead[] {
  try {
    const raw = localStorage.getItem(LEADS_KEY);
    if (!raw) return SAMPLE_LEADS;
    const parsed = JSON.parse(raw) as CrmLead[];
    if (!Array.isArray(parsed) || !parsed.length) return SAMPLE_LEADS;
    return parsed.map((l) => ({ ...l, status: normalizeLeadStatus(String(l.status || 'New')) }));
  } catch {
    return SAMPLE_LEADS;
  }
}

function loadContacts(): CrmContact[] {
  try {
    const raw = localStorage.getItem(CONTACTS_KEY);
    if (!raw) return SAMPLE_CONTACTS;
    const parsed = JSON.parse(raw) as CrmContact[];
    return Array.isArray(parsed) && parsed.length ? parsed : SAMPLE_CONTACTS;
  } catch {
    return SAMPLE_CONTACTS;
  }
}

function loadDeals(): CrmDeal[] {
  try {
    const raw = localStorage.getItem(DEALS_KEY);
    if (!raw) return SAMPLE_DEALS;
    const parsed = JSON.parse(raw) as CrmDeal[];
    if (!Array.isArray(parsed) || !parsed.length) return SAMPLE_DEALS;
    return parsed.map((d) => ({ ...d, stage: normalizeDealStage(String(d.stage || 'Opportunity Created')) }));
  } catch {
    return SAMPLE_DEALS;
  }
}

function historyLine(actor: string, message: string): LeadHistoryEntry {
  return { at: new Date().toISOString(), actor, message };
}

function activityMatchesLead(a: CrmActivity, lead: CrmLead) {
  if (a.leadId && a.leadId === lead.id) return true;
  if (a.leadName === lead.name && (!a.mobile || a.mobile === lead.mobile)) return true;
  return false;
}

function nextOpenFollowUp(activities: CrmActivity[], lead: CrmLead) {
  return activities
    .filter((a) => !a.done && activityMatchesLead(a, lead))
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0]?.dueAt;
}

function applyLeadFollowUpSync(
  leads: CrmLead[],
  activities: CrmActivity[],
  hint: { leadId?: string; leadName?: string; mobile?: string },
  actor: string,
  message: string,
) {
  return leads.map((l) => {
    const match =
      (hint.leadId && l.id === hint.leadId) ||
      (hint.leadName && l.name === hint.leadName && (!hint.mobile || l.mobile === hint.mobile));
    if (!match) return l;
    const nextFollowUp = nextOpenFollowUp(activities, l);
    return {
      ...l,
      nextFollowUp,
      updatedAt: new Date().toISOString(),
      history: [historyLine(actor, message), ...(l.history || [])].slice(0, 40),
    };
  });
}

const Ctx = createContext<CrmState | null>(null);

function readSession() {
  try {
    return JSON.parse(localStorage.getItem('crm_session') || 'null') as {
      full_name?: string;
      user?: string;
      roles?: string[];
    } | null;
  } catch {
    return null;
  }
}

function readUserName() {
  const s = readSession();
  return (s && (s.full_name || s.user)) || 'CRM Telecaller';
}

function loadTeam(): CrmTeamMember[] {
  try {
    const raw = localStorage.getItem(TEAM_KEY);
    if (!raw) return SAMPLE_TEAM;
    const parsed = JSON.parse(raw) as CrmTeamMember[];
    return Array.isArray(parsed) && parsed.length ? parsed : SAMPLE_TEAM;
  } catch {
    return SAMPLE_TEAM;
  }
}

function detectManager(userName: string, team: CrmTeamMember[]) {
  const s = readSession();
  const roles = (s?.roles || []).map((r) => String(r).toLowerCase());
  if (
    roles.some(
      (r) =>
        r.includes('crm manager') ||
        r.includes('system manager') ||
        r === 'administrator' ||
        r.includes('sales manager'),
    )
  ) {
    return true;
  }
  const me = team.find((t) => t.active && t.name.toLowerCase() === userName.toLowerCase());
  return me?.role === 'manager';
}

export function CrmProvider({ children }: { children: ReactNode }) {
  const [leads, setLeads] = useState(loadLeads);
  const [contacts, setContacts] = useState(loadContacts);
  const [accounts] = useState(SAMPLE_ACCOUNTS);
  const [deals, setDeals] = useState(loadDeals);
  const [activities, setActivities] = useState(loadActivities);
  const [bookings, setBookings] = useState(loadBookings);
  const [campaigns] = useState(SAMPLE_CAMPAIGNS);
  const [wingFilter, setWingFilter] = useState<WingId | 'all'>('all');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [team, setTeam] = useState(loadTeam);
  const [userName] = useState(readUserName);
  const isManager = detectManager(userName, team);
  const userRoleLabel = isManager ? 'CRM Manager' : 'CRM Telecaller';

  useEffect(() => {
    try {
      localStorage.setItem(LEADS_KEY, JSON.stringify(leads));
    } catch {
      /* ignore quota */
    }
  }, [leads]);

  useEffect(() => {
    try {
      localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
    } catch {
      /* ignore quota */
    }
  }, [contacts]);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVITIES_KEY, JSON.stringify(activities));
    } catch {
      /* ignore quota */
    }
  }, [activities]);

  useEffect(() => {
    try {
      localStorage.setItem(DEALS_KEY, JSON.stringify(deals));
    } catch {
      /* ignore quota */
    }
  }, [deals]);

  useEffect(() => {
    try {
      localStorage.setItem(TEAM_KEY, JSON.stringify(team));
    } catch {
      /* ignore quota */
    }
  }, [team]);

  useEffect(() => {
    try {
      localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings));
    } catch {
      /* ignore quota */
    }
  }, [bookings]);

  const applyOwnershipMap = (map: CrmOwnershipMap) => {
    const leadMap = map.leads || {};
    const actMap = map.activities || {};
    const dealMap = map.deals || {};
    const contactMap = map.contacts || {};
    if (Object.keys(leadMap).length) {
      setLeads((list) =>
        list.map((l) => {
          const hit = leadMap[l.id];
          if (!hit?.owner || hit.owner === l.owner) return l;
          return { ...l, owner: hit.owner, ownerInitials: initials(hit.owner), updatedAt: hit.transferred_at || l.updatedAt };
        }),
      );
    }
    if (Object.keys(actMap).length) {
      setActivities((list) =>
        list.map((a) => {
          const hit = actMap[a.id];
          if (!hit?.owner || hit.owner === a.owner) return a;
          return { ...a, owner: hit.owner };
        }),
      );
    }
    if (Object.keys(dealMap).length) {
      setDeals((list) =>
        list.map((d) => {
          const hit = dealMap[d.id];
          if (!hit?.owner || hit.owner === d.owner) return d;
          return { ...d, owner: hit.owner };
        }),
      );
    }
    if (Object.keys(contactMap).length) {
      setContacts((list) =>
        list.map((c) => {
          const hit = contactMap[c.id];
          if (!hit?.owner || hit.owner === c.owner) return c;
          return { ...c, owner: hit.owner };
        }),
      );
    }
  };

  useEffect(() => {
    let cancelled = false;
    listCrmOwnership()
      .then((map) => {
        if (!cancelled) applyOwnershipMap(map);
      })
      .catch(() => {
        /* offline soft */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushToast = (text: string, tone: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  };

  const value = useMemo<CrmState>(
    () => ({
      leads,
      contacts,
      accounts,
      deals,
      activities,
      bookings,
      campaigns,
      wingFilter,
      setWingFilter,
      toasts,
      pushToast,
      team,
      isManager,
      userRoleLabel,
      userName,
      addLead: (input) => {
        const now = new Date().toISOString();
        const lead: CrmLead = {
          ...input,
          id: input.id || nextId('LD', leads),
          ownerInitials: initials(input.owner || userName),
          createdAt: input.createdAt || now,
          updatedAt: now,
          history: [
            historyLine(input.owner || userName, `Lead created · ${input.status || 'New'} · ${input.wing}`),
            ...(input.history || []),
          ],
        };
        setLeads((list) => [lead, ...list]);
        setContacts((list) => [
          {
            id: nextId('CT', list),
            name: lead.name,
            mobile: lead.mobile,
            email: lead.email,
            wing: lead.wing,
            owner: lead.owner,
            role: lead.wing === 'franchise' ? 'Franchise Applicant' : 'Lead',
          },
          ...list,
        ]);
        return lead;
      },
      importLeads: (rows) => {
        let added = 0;
        let skipped = 0;
        const now = new Date().toISOString();
        const created: CrmLead[] = [];
        setLeads((list) => {
          const next = [...list];
          let seq = list.length;
          for (const row of rows) {
            const mobile = (row.mobile || '').replace(/\D/g, '').slice(-10);
            const name = (row.name || '').trim();
            if (!name || !/^\d{10}$/.test(mobile)) {
              skipped += 1;
              continue;
            }
            if (next.some((l) => l.mobile === mobile && l.name.toLowerCase() === name.toLowerCase())) {
              skipped += 1;
              continue;
            }
            seq += 1;
            const owner = row.owner?.trim() || userName;
            const lead: CrmLead = {
              id: `LD-${String(seq).padStart(4, '0')}`,
              name,
              mobile,
              email: (row.email || '').trim(),
              wing: row.wing || 'lab',
              source: row.source || 'Telecaller',
              status: row.status || 'New',
              owner,
              ownerInitials: initials(owner),
              city: row.city?.trim() || undefined,
              notes: row.notes?.trim() || undefined,
              value: row.value,
              createdAt: now,
              updatedAt: now,
              history: [historyLine(owner, `Lead imported · ${row.status || 'New'} · ${row.wing || 'lab'}`)],
            };
            next.unshift(lead);
            created.push(lead);
            added += 1;
          }
          return next;
        });
        if (created.length) {
          setContacts((list) => {
            const next = [...list];
            let seq = list.length;
            for (const lead of created) {
              if (next.some((c) => c.mobile === lead.mobile && c.name.toLowerCase() === lead.name.toLowerCase())) continue;
              seq += 1;
              next.unshift({
                id: `CT-${String(seq).padStart(4, '0')}`,
                name: lead.name,
                mobile: lead.mobile,
                email: lead.email,
                wing: lead.wing,
                owner: lead.owner,
                role: lead.wing === 'franchise' ? 'Franchise Applicant' : 'Lead',
              });
            }
            return next;
          });
        }
        return { added, skipped };
      },
      addContact: (input) => {
        const contact: CrmContact = {
          ...input,
          id: input.id || nextId('CT', contacts),
          owner: input.owner || userName,
        };
        setContacts((list) => [contact, ...list]);
        return contact;
      },
      importContacts: (rows) => {
        let added = 0;
        let skipped = 0;
        setContacts((list) => {
          const next = [...list];
          let seq = list.length;
          for (const row of rows) {
            const mobile = (row.mobile || '').replace(/\D/g, '').slice(-10);
            const name = (row.name || '').trim();
            if (!name || !/^\d{10}$/.test(mobile)) {
              skipped += 1;
              continue;
            }
            if (next.some((c) => c.mobile === mobile && c.name.toLowerCase() === name.toLowerCase())) {
              skipped += 1;
              continue;
            }
            seq += 1;
            next.unshift({
              id: `CT-${String(seq).padStart(4, '0')}`,
              name,
              mobile,
              email: (row.email || '').trim(),
              wing: row.wing || 'lab',
              role: row.role?.trim() || 'Contact',
              account: row.account?.trim() || undefined,
              owner: row.owner?.trim() || userName,
            });
            added += 1;
          }
          return next;
        });
        return { added, skipped };
      },
      updateLead: (id, patch, note) => {
        let updated: CrmLead | null = null;
        setLeads((list) =>
          list.map((l) => {
            if (l.id !== id) return l;
            const nextOwner = patch.owner ?? l.owner;
            const changes: string[] = [];
            if (patch.status && patch.status !== l.status) changes.push(`Status ${l.status} → ${patch.status}`);
            if (patch.owner && patch.owner !== l.owner) changes.push(`Owner → ${patch.owner}`);
            if (patch.wing && patch.wing !== l.wing) changes.push(`Wing → ${patch.wing}`);
            if (patch.source && patch.source !== l.source) changes.push(`Source → ${patch.source}`);
            if (patch.nextFollowUp && patch.nextFollowUp !== l.nextFollowUp) changes.push('Follow-up updated');
            if (note?.trim()) changes.push(note.trim());
            if (!changes.length && (patch.name || patch.mobile || patch.email || patch.city || patch.notes || patch.value !== undefined)) {
              changes.push('Lead details updated');
            }
            const entry = changes.length ? historyLine(userName, changes.join(' · ')) : null;
            updated = {
              ...l,
              ...patch,
              owner: nextOwner,
              ownerInitials: initials(nextOwner),
              updatedAt: new Date().toISOString(),
              history: entry ? [entry, ...(l.history || [])].slice(0, 40) : l.history,
            };
            return updated;
          }),
        );
        return updated;
      },
      addBooking: (input) => {
        const id = input.id || nextId('BK', bookings);
        const executive = input.executive || input.owner || userName;
        const executiveCode = input.executiveCode || executiveCodeFromName(executive);
        const trackingTag = input.trackingTag || makeTrackingTag(executive, id);
        const booking = ensureBookingTracking({
          ...input,
          id,
          owner: input.owner || userName,
          executive,
          executiveCode,
          trackingTag,
          salesStatus: input.salesStatus || 'Open',
          createdAt: new Date().toISOString(),
        } as CrmBooking);
        setBookings((list) => [booking, ...list]);
        return booking;
      },
      updateBooking: (id, patch) => {
        let updated: CrmBooking | null = null;
        setBookings((list) =>
          list.map((b) => {
            if (b.id !== id) return b;
            updated = ensureBookingTracking({ ...b, ...patch });
            return updated;
          }),
        );
        return updated;
      },
      applySalesCloses: (rows) => {
        let matched = 0;
        setBookings((list) =>
          list.map((b) => {
            const mobile = (b.mobile || '').replace(/\D/g, '').slice(-10);
            const hits = rows.filter((r) => {
              const tag = (r.tracking_tag || '').toUpperCase();
              const bookingId = (r.booking_id || '').toUpperCase();
              const closeMobile = (r.mobile || '').replace(/\D/g, '').slice(-10);
              if (tag && tag === b.trackingTag.toUpperCase()) return true;
              if (bookingId && bookingId === b.id.toUpperCase()) return true;
              /* Fallback: same patient mobile + portal wing when tag was mangled on older bills. */
              if (mobile && closeMobile === mobile && Number(r.amount) > 0) {
                const portal = (r.portal || '').toLowerCase();
                if (!portal || portal === b.wing) return true;
              }
              return false;
            });
            if (!hits.length) return b;
            matched += 1;
            const hit = [...hits].sort((a, c) => Number(c.amount || 0) - Number(a.amount || 0))[0];
            const amount = hits.reduce((sum, r) => sum + (Number(r.amount) || 0), 0) || b.billedAmount || 0;
            return ensureBookingTracking({
              ...b,
              billedAmount: amount,
              billRef: hits.map((r) => r.bill_ref).filter(Boolean).join(', ') || b.billRef,
              billPortal: (hit.portal as CrmBooking['billPortal']) || b.billPortal,
              closedAt: hit.closed_at || b.closedAt || new Date().toISOString(),
              salesStatus: amount > 0 ? 'Closed' : 'Billed',
              status: b.status === 'Cancelled' ? b.status : 'Completed',
              executive: hit.executive || b.executive,
            });
          }),
        );
        return matched;
      },
      toggleActivity: (id) => {
        const hint: { leadId?: string; leadName: string; mobile?: string; done: boolean; type: string } = {
          leadName: '',
          done: false,
          type: 'Call',
        };
        let found = false;
        let nextList: CrmActivity[] = [];
        setActivities((list) => {
          nextList = list.map((a) => {
            if (a.id !== id) return a;
            const next = {
              ...a,
              done: !a.done,
              completedAt: !a.done ? new Date().toISOString() : undefined,
            };
            found = true;
            hint.leadId = next.leadId;
            hint.leadName = next.leadName;
            hint.mobile = next.mobile;
            hint.done = next.done;
            hint.type = next.type;
            return next;
          });
          return nextList;
        });
        if (found) {
          setLeads((list) =>
            applyLeadFollowUpSync(
              list,
              nextList,
              { leadId: hint.leadId, leadName: hint.leadName, mobile: hint.mobile },
              userName,
              hint.done ? `Follow-up completed (${hint.type})` : `Follow-up reopened (${hint.type})`,
            ),
          );
        }
      },
      updateActivity: (id, patch) => {
        const hint: { leadId?: string; leadName: string; mobile?: string } = { leadName: '' };
        let nextList: CrmActivity[] = [];
        let result: CrmActivity | null = null;
        setActivities((list) => {
          nextList = list.map((a) => {
            if (a.id !== id) return a;
            const next = { ...a, ...patch };
            result = next;
            hint.leadId = next.leadId;
            hint.leadName = next.leadName;
            hint.mobile = next.mobile;
            return next;
          });
          return nextList;
        });
        if (result && (patch.dueAt !== undefined || patch.done !== undefined || patch.leadStage)) {
          setLeads((list) => {
            let next = applyLeadFollowUpSync(
              list,
              nextList,
              { leadId: hint.leadId, leadName: hint.leadName, mobile: hint.mobile },
              userName,
              'Follow-up details synced',
            );
            if (patch.leadStage) {
              next = next.map((l) =>
                (hint.leadId && l.id === hint.leadId) ||
                (l.name === hint.leadName && (!hint.mobile || l.mobile === hint.mobile))
                  ? { ...l, status: patch.leadStage as CrmLead['status'] }
                  : l,
              );
            }
            return next;
          });
        }
        return result;
      },
      logActivityUpdate: (id, input) => {
        const now = new Date().toISOString();
        const message = input.message.trim();
        if (!message) return null;
        const hint: { leadId?: string; leadName: string; mobile?: string } = { leadName: '' };
        let nextList: CrmActivity[] = [];
        let result: CrmActivity | null = null;
        const outcome = input.outcome;
        const mappedStatus = outcome ? outcomeToLeadStatus(outcome) : null;
        setActivities((list) => {
          nextList = list.map((a) => {
            if (a.id !== id) return a;
            const nextType = input.type || a.type;
            const histMsg = outcome ? `${outcome} · ${message}` : message;
            const next: CrmActivity = {
              ...a,
              type: nextType,
              title: `${nextType} — ${a.leadName}`,
              dueAt: input.nextDueAt || a.dueAt,
              notes: message,
              outcome: outcome || a.outcome,
              expectedOutcome: input.expectedOutcome || a.expectedOutcome,
              leadStage: mappedStatus || a.leadStage,
              history: [
                { at: now, type: nextType, message: histMsg, actor: userName },
                ...(a.history || []),
              ].slice(0, 40),
            };
            result = next;
            hint.leadId = next.leadId;
            hint.leadName = next.leadName;
            hint.mobile = next.mobile;
            return next;
          });
          return nextList;
        });
        if (result) {
          setLeads((list) =>
            applyLeadFollowUpSync(
              list,
              nextList,
              { leadId: hint.leadId, leadName: hint.leadName, mobile: hint.mobile },
              userName,
              outcome ? `Follow-up outcome · ${outcome} · ${message}` : `Follow-up update · ${message}`,
            ).map((l) => {
              if (!mappedStatus) return l;
              const match =
                (hint.leadId && l.id === hint.leadId) ||
                (l.name === hint.leadName && (!hint.mobile || l.mobile === hint.mobile));
              return match ? { ...l, status: mappedStatus } : l;
            }),
          );
        }
        return result;
      },
      completeActivity: (id, note) => {
        const now = new Date().toISOString();
        const hint: { leadId?: string; leadName: string; mobile?: string; type: string } = {
          leadName: '',
          type: 'Call',
        };
        let nextList: CrmActivity[] = [];
        let result: CrmActivity | null = null;
        setActivities((list) => {
          nextList = list.map((a) => {
            if (a.id !== id) return a;
            const entry = {
              at: now,
              type: a.type,
              message: note?.trim() || 'Marked as completed',
              actor: userName,
            };
            const next: CrmActivity = {
              ...a,
              done: true,
              completedAt: now,
              notes: note?.trim() || a.notes,
              history: [entry, ...(a.history || [])].slice(0, 40),
            };
            result = next;
            hint.leadId = next.leadId;
            hint.leadName = next.leadName;
            hint.mobile = next.mobile;
            hint.type = next.type;
            return next;
          });
          return nextList;
        });
        if (result) {
          setLeads((list) =>
            applyLeadFollowUpSync(
              list,
              nextList,
              { leadId: hint.leadId, leadName: hint.leadName, mobile: hint.mobile },
              userName,
              `Follow-up completed (${hint.type})${note?.trim() ? ` · ${note.trim()}` : ''}`,
            ),
          );
        }
        return result;
      },
      addActivity: (input) => {
        const activity: CrmActivity = {
          ...input,
          id: input.id || nextId('ACT', activities),
          history: input.history || [
            {
              at: new Date().toISOString(),
              type: input.type,
              message: `Scheduled ${input.type} follow-up`,
              actor: input.owner || userName,
            },
          ],
        };
        const nextList = [activity, ...activities];
        setActivities(nextList);
        setLeads((list) =>
          applyLeadFollowUpSync(
            list,
            nextList,
            { leadId: activity.leadId, leadName: activity.leadName, mobile: activity.mobile },
            userName,
            `Follow-up scheduled (${activity.type}) · ${new Date(activity.dueAt).toLocaleString('en-IN')}`,
          ),
        );
        return activity;
      },
      addDeal: (input) => {
        const deal: CrmDeal = {
          ...input,
          id: input.id || nextId('DL', deals),
          createdAt: input.createdAt || new Date().toISOString(),
        };
        setDeals((list) => [deal, ...list]);
        return deal;
      },
      updateDeal: (id, patch) => {
        let updated: CrmDeal | null = null;
        setDeals((list) =>
          list.map((d) => {
            if (d.id !== id) return d;
            updated = { ...d, ...patch };
            return updated;
          }),
        );
        if (updated && patch.stage) {
          const deal = updated as CrmDeal;
          const leadStatus = dealStageToLeadStatus(patch.stage);
          if (deal.leadId) {
            setLeads((list) =>
              list.map((l) =>
                l.id === deal.leadId
                  ? {
                      ...l,
                      status: leadStatus,
                      lostReason: patch.lostReason || l.lostReason,
                      updatedAt: new Date().toISOString(),
                      history: [
                        historyLine(userName, `Deal ${deal.id} → ${patch.stage}`),
                        ...(l.history || []),
                      ].slice(0, 40),
                    }
                  : l,
              ),
            );
          }
        }
        return updated;
      },
      closeLeadLost: (leadId, reason, note) => {
        let updated: CrmLead | null = null;
        const now = new Date().toISOString();
        setLeads((list) =>
          list.map((l) => {
            if (l.id !== leadId) return l;
            updated = {
              ...l,
              status: 'Lost',
              lostReason: reason,
              updatedAt: now,
              history: [
                historyLine(userName, `Lost / Closed · ${reason}${note?.trim() ? ` · ${note.trim()}` : ''}`),
                ...(l.history || []),
              ].slice(0, 40),
            };
            return updated;
          }),
        );
        setDeals((list) =>
          list.map((d) =>
            d.leadId === leadId && d.stage !== 'Won'
              ? { ...d, stage: 'Lost', lostReason: reason }
              : d,
          ),
        );
        return updated;
      },
      convertDealWon: (dealId, input) => {
        const deal = deals.find((d) => d.id === dealId);
        if (!deal) return null;
        const now = new Date().toISOString();
        const conversionId = input.conversionId.trim();
        if (!conversionId) return null;
        const updated: CrmDeal = {
          ...deal,
          stage: 'Won',
          conversionId,
          conversionType: input.conversionType,
        };
        setDeals((list) => list.map((d) => (d.id === dealId ? updated : d)));
        if (deal.leadId) {
          setLeads((list) =>
            list.map((l) =>
              l.id === deal.leadId
                ? {
                    ...l,
                    status: 'Won',
                    conversionId,
                    conversionType: input.conversionType,
                    convertedAt: now,
                    updatedAt: now,
                    history: [
                      historyLine(
                        userName,
                        `Won / Converted · ${input.conversionType} · ${conversionId}`,
                      ),
                      ...(l.history || []),
                    ].slice(0, 40),
                  }
                : l,
            ),
          );
        }
        const bookingWing =
          input.conversionType === 'partner' || input.conversionType === 'lab'
            ? 'lab'
            : input.conversionType === 'franchise'
              ? 'franchise'
              : input.conversionType;
        if (bookingWing === 'aesthetic' || bookingWing === 'care' || bookingWing === 'lab' || bookingWing === 'franchise') {
          setBookings((list) => {
            const id = nextId('BK', list);
            const owner = deal.owner || userName;
            return [
              ensureBookingTracking({
                id,
                patient: deal.leadName || deal.title,
                mobile: leads.find((l) => l.id === deal.leadId)?.mobile || '',
                wing: bookingWing,
                service: input.service || deal.product || deal.title,
                branch: input.branch || 'Central Hub',
                date: now.slice(0, 10),
                time: '10:00',
                status: 'Scheduled',
                channel: input.conversionType === 'partner' ? 'Partner Portal' : 'CRM Telecaller',
                notes: formatCrmTagNote(makeTrackingTag(owner, id), `Converted from deal ${deal.id}`),
                externalId: conversionId,
                createdAt: now,
                owner,
                trackingTag: makeTrackingTag(owner, id),
                executive: owner,
                executiveCode: executiveCodeFromName(owner),
                salesStatus: 'Open',
              }),
              ...list,
            ];
          });
        }
        return updated;
      },
      createDealFromFollowUp: (activityId, input) => {
        const activity = activities.find((a) => a.id === activityId);
        if (!activity) return null;
        const title = input.title.trim();
        if (!title) return null;
        if (activity.dealId) {
          const existing = deals.find((d) => d.id === activity.dealId);
          if (existing) return existing;
        }
        const now = new Date().toISOString();
        const deal: CrmDeal = {
          id: nextId('DL', deals),
          title,
          leadId: activity.leadId,
          leadName: activity.leadName,
          activityId: activity.id,
          wing: activity.wing,
          stage: input.stage || 'Opportunity Created',
          value: Number.isFinite(input.value) ? Math.max(0, input.value) : 0,
          owner: activity.owner || userName,
          closeDate: input.closeDate || now.slice(0, 10),
          createdAt: now,
          product: input.product,
          probability: input.probability,
        };
        setDeals((list) => [deal, ...list]);
        setActivities((list) =>
          list.map((a) =>
            a.id !== activityId
              ? a
              : {
                  ...a,
                  dealId: deal.id,
                  leadStage: input.stage,
                  history: [
                    {
                      at: now,
                      type: a.type,
                      message: `Marked as Deal & Opportunity · ${deal.id} · ${input.stage} · ₹${deal.value.toLocaleString('en-IN')}`,
                      actor: userName,
                    },
                    ...(a.history || []),
                  ].slice(0, 40),
                },
          ),
        );
        const leadStatus = dealStageToLeadStatus(input.stage);
        if (activity.leadId) {
          setLeads((list) =>
            list.map((l) =>
              l.id !== activity.leadId
                ? l
                : {
                    ...l,
                    status: leadStatus,
                    value: deal.value || l.value,
                    updatedAt: now,
                    history: [
                      historyLine(userName, `Converted to deal ${deal.id} · ${input.stage}`),
                      ...(l.history || []),
                    ].slice(0, 40),
                  },
            ),
          );
        } else {
          setLeads((list) =>
            applyLeadFollowUpSync(
              list,
              activities,
              { leadName: activity.leadName, mobile: activity.mobile },
              userName,
              `Converted to deal ${deal.id} · ${input.stage}`,
            ).map((l) =>
              l.name === activity.leadName && (!activity.mobile || l.mobile === activity.mobile)
                ? { ...l, status: leadStatus, value: deal.value || l.value }
                : l,
            ),
          );
        }
        return deal;
      },
      addTeamMember: (input) => {
        const member: CrmTeamMember = {
          id: nextId('TM', team),
          name: input.name.trim(),
          email: input.email?.trim() || undefined,
          role: input.role,
          active: true,
        };
        setTeam((list) => [member, ...list]);
        return member;
      },
      updateTeamMember: (id, patch) => {
        let updated: CrmTeamMember | null = null;
        setTeam((list) =>
          list.map((m) => {
            if (m.id !== id) return m;
            updated = { ...m, ...patch };
            return updated;
          }),
        );
        return updated;
      },
      applyOwnershipMap,
      transferOwnership: async (input) => {
        if (!detectManager(userName, team)) return null;
        const fromOwner = input.fromOwner.trim();
        const toOwner = input.toOwner.trim();
        if (!fromOwner || !toOwner || fromOwner === toOwner) return null;
        const now = new Date().toISOString();
        const note = input.note?.trim();
        const msg = `Transferred ${fromOwner} → ${toOwner}${note ? ` · ${note}` : ''}`;

        const moveLeads = input.scope === 'leads' || input.scope === 'both';
        const moveFollowups = input.scope === 'followups' || input.scope === 'both';

        const leadIdSet = new Set(
          moveLeads
            ? input.leadIds?.length
              ? input.leadIds
              : leads.filter((l) => l.owner === fromOwner).map((l) => l.id)
            : [],
        );

        const activityIdSet = new Set<string>();
        if (moveFollowups) {
          if (input.activityIds?.length) {
            for (const id of input.activityIds) activityIdSet.add(id);
          } else {
            for (const a of activities) {
              if (a.owner === fromOwner) activityIdSet.add(a.id);
              if (moveLeads && a.leadId && leadIdSet.has(a.leadId)) activityIdSet.add(a.id);
            }
          }
        } else if (moveLeads) {
          for (const a of activities) {
            if (a.leadId && leadIdSet.has(a.leadId)) activityIdSet.add(a.id);
          }
        }

        const dealIds: string[] = [];
        const contactIds: string[] = [];
        if (moveLeads && leadIdSet.size) {
          for (const d of deals) {
            if (d.leadId && leadIdSet.has(d.leadId)) dealIds.push(d.id);
            else if (!d.leadId && d.owner === fromOwner && !input.leadIds?.length) dealIds.push(d.id);
          }
          for (const c of contacts) {
            const linked = leads.find((l) => leadIdSet.has(l.id) && l.name === c.name && l.mobile === c.mobile);
            if (linked) contactIds.push(c.id);
          }
        }

        /* Persist first so every CRM login (Avik, etc.) sees the new owner. */
        try {
          const remote = await transferCrmOwnership({
            fromOwner,
            toOwner,
            leadIds: [...leadIdSet],
            activityIds: [...activityIdSet],
            dealIds,
            contactIds,
            note,
          });
          if (remote?.ownership) applyOwnershipMap(remote.ownership);
        } catch (err) {
          pushToast(err instanceof Error ? err.message : 'Could not sync ownership to server', 'err');
          return null;
        }

        const leadsMoved = moveLeads ? leadIdSet.size : 0;
        const followupsMoved = activityIdSet.size;
        let dealsMoved = 0;

        if (moveLeads && leadIdSet.size) {
          setLeads((list) =>
            list.map((l) =>
              leadIdSet.has(l.id)
                ? {
                    ...l,
                    owner: toOwner,
                    ownerInitials: initials(toOwner),
                    updatedAt: now,
                    history: [historyLine(userName, msg), ...(l.history || [])].slice(0, 40),
                  }
                : l,
            ),
          );
          setContacts((list) =>
            list.map((c) => {
              const linked = leads.find((l) => leadIdSet.has(l.id) && l.name === c.name && l.mobile === c.mobile);
              return linked ? { ...c, owner: toOwner } : c;
            }),
          );
          setDeals((list) =>
            list.map((d) => {
              if (d.leadId && leadIdSet.has(d.leadId)) {
                dealsMoved += 1;
                return { ...d, owner: toOwner };
              }
              if (!d.leadId && d.owner === fromOwner && !input.leadIds?.length) {
                dealsMoved += 1;
                return { ...d, owner: toOwner };
              }
              return d;
            }),
          );
        }

        if (activityIdSet.size) {
          setActivities((list) =>
            list.map((a) =>
              activityIdSet.has(a.id)
                ? {
                    ...a,
                    owner: toOwner,
                    history: [
                      { at: now, type: a.type, message: msg, actor: userName },
                      ...(a.history || []),
                    ].slice(0, 40),
                  }
                : a,
            ),
          );
        }

        return { leads: leadsMoved, followups: followupsMoved, deals: dealsMoved };
      },
    }),
    [leads, contacts, accounts, deals, activities, bookings, campaigns, wingFilter, toasts, userName, team, isManager, userRoleLabel],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCrm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCrm outside provider');
  return ctx;
}
