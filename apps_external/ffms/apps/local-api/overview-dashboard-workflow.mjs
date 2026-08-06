/**
 * FFMS Admin Overview — live metrics from the RFMS database (no placeholders).
 */

function text(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function stageOf(value) {
  return text(value, 60).toLowerCase().replace(/[\s-]+/g, '_');
}

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function inMonth(iso, key) {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return monthKey(date) === key;
}

function previousMonthKey(date = new Date()) {
  const prior = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return monthKey(prior);
}

function readableStage(stage) {
  return text(stage, 80).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || '—';
}

function formatInrCompact(amount) {
  const value = Number(amount) || 0;
  if (value >= 10_000_000) return `INR ${(value / 10_000_000).toFixed(value % 10_000_000 === 0 ? 0 : 1)}Cr`;
  if (value >= 100_000) return `INR ${(value / 100_000).toFixed(value % 100_000 === 0 ? 0 : 1)}L`;
  if (value >= 1_000) return `INR ${Math.round(value).toLocaleString('en-IN')}`;
  return `INR ${Math.round(value)}`;
}

function percentChange(current, previous) {
  if (!previous && !current) return { label: 'No change vs last month', tone: 'flat' };
  if (!previous) return { label: 'New vs last month', tone: 'up' };
  const delta = ((current - previous) / previous) * 100;
  const rounded = Math.abs(delta) >= 10 ? Math.round(delta) : Number(delta.toFixed(1));
  if (rounded === 0) return { label: 'Flat vs last month', tone: 'flat' };
  return {
    label: `${rounded > 0 ? '+' : ''}${rounded}% vs last month`,
    tone: rounded > 0 ? 'up' : 'down',
  };
}

function applicationNeedsReview(application) {
  const stage = stageOf(application?.stage);
  if (!application?.visible_to_admin) return false;
  if (['onboarding_completed', 'deboarded', 'go_live', 'active'].includes(stage)) return false;
  return true;
}

function isApprovedApplication(application) {
  const stage = stageOf(application?.stage);
  return ['onboarding_completed', 'go_live', 'active'].includes(stage);
}

function territoryHasAvailability(territory) {
  const fofo = Number(territory?.fofo?.available ?? 0);
  const foco = Number(territory?.foco?.available ?? 0);
  if (fofo > 0 || foco > 0) return true;
  const pins = Array.isArray(territory?.pin_capacities) ? territory.pin_capacities : [];
  return pins.some((pin) => Number(pin?.fofo?.available ?? 0) > 0 || Number(pin?.foco?.available ?? 0) > 0);
}

function collectionsInMonth(applications, key) {
  let total = 0;
  let count = 0;
  for (const application of applications) {
    for (const payment of Array.isArray(application.payments) ? application.payments : []) {
      if (stageOf(payment.status) !== 'paid') continue;
      if (!inMonth(payment.paid_at, key)) continue;
      total += Number(payment.amount) || 0;
      count += 1;
    }
  }
  return { total, count };
}

function managerName(application) {
  return (
    text(application?.assigned_manager, 120)
    || text(application?.manager_name, 120)
    || text(application?.review_officer, 120)
    || text(application?.field_visit?.officer_name, 120)
    || 'Unassigned'
  );
}

/**
 * @param {{ leads?: any[]; applications?: any[]; territories?: any[] }} database
 * @param {{ territoryMetrics?: (territories?: any[]) => any }} helpers
 */
export function buildAdminOverview(database, helpers = {}) {
  const now = new Date();
  const thisMonth = monthKey(now);
  const lastMonth = previousMonthKey(now);
  const leads = Array.isArray(database.leads) ? database.leads : [];
  const applications = Array.isArray(database.applications) ? database.applications : [];
  const territories = Array.isArray(database.territories) ? database.territories : [];
  const visibleApps = applications.filter((item) => item.visible_to_admin);

  const terminalLead = new Set(['lost', 'disqualified', 'completed']);
  const openLeads = leads.filter((lead) => !terminalLead.has(stageOf(lead.stage)));
  const newLeads = leads.filter((lead) => stageOf(lead.stage) === 'new');
  const newLeadsThisMonth = leads.filter((lead) => inMonth(lead.created_at, thisMonth));
  const newLeadsLastMonth = leads.filter((lead) => inMonth(lead.created_at, lastMonth));

  const qualifiedLeads = openLeads.filter((lead) =>
    ['qualified', 'follow_up', 'negotiation', 'application_started', 'won'].includes(stageOf(lead.stage)));
  // Funnel top: use qualified when any exist; otherwise all open leads so the chart mirrors the pipeline.
  const funnelQualified = qualifiedLeads.length ? qualifiedLeads.length : openLeads.length;
  const applicationsStarted = visibleApps.length;
  const underReview = visibleApps.filter(applicationNeedsReview);
  const approved = visibleApps.filter(isApprovedApplication);

  const availableTerritories = territories.filter((territory) => {
    const summary = typeof helpers.territorySummary === 'function'
      ? helpers.territorySummary(territory)
      : territory;
    return territoryHasAvailability(summary);
  });
  const metrics = typeof helpers.territoryMetrics === 'function'
    ? helpers.territoryMetrics(territories)
    : {
      fofo_available: availableTerritories.reduce((sum, item) => {
        const summary = typeof helpers.territorySummary === 'function' ? helpers.territorySummary(item) : item;
        return sum + (Number(summary?.fofo?.available) || 0);
      }, 0),
      foco_available: availableTerritories.reduce((sum, item) => {
        const summary = typeof helpers.territorySummary === 'function' ? helpers.territorySummary(item) : item;
        return sum + (Number(summary?.foco?.available) || 0);
      }, 0),
      territories: territories.length,
    };

  const collectionsThis = collectionsInMonth(visibleApps, thisMonth);
  const collectionsLast = collectionsInMonth(visibleApps, lastMonth);
  const leadDelta = percentChange(newLeadsThisMonth.length, newLeadsLastMonth.length);
  const collectionDelta = percentChange(collectionsThis.total, collectionsLast.total);
  const conversionRate = funnelQualified
    ? Math.round((approved.length / funnelQualified) * 1000) / 10
    : 0;

  const approvedThisMonth = approved.filter((item) =>
    inMonth(item.onboarding_completed_at || item.updated_at || item.created_at, thisMonth)).length;
  const approvedLastMonth = approved.filter((item) =>
    inMonth(item.onboarding_completed_at || item.updated_at || item.created_at, lastMonth)).length;
  const conversionDelta = percentChange(approvedThisMonth, approvedLastMonth);

  const maxFunnel = Math.max(funnelQualified, applicationsStarted, underReview.length, approved.length, 1);
  const funnel = [
    { key: 'qualified', label: 'Qualified leads', value: funnelQualified },
    { key: 'started', label: 'Applications started', value: applicationsStarted },
    { key: 'review', label: 'Under review', value: underReview.length },
    { key: 'approved', label: 'Approved', value: approved.length },
  ].map((row) => ({
    ...row,
    width_pct: Math.max(12, Math.round((row.value / maxFunnel) * 100)),
  }));

  const priorityApprovals = [...underReview]
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
    .slice(0, 8)
    .map((application) => ({
      id: application.id,
      applicant_name: text(application.full_name, 120) || 'Applicant',
      application_number: text(application.application_number, 40) || application.id,
      franchise_model: text(application.franchise_model, 10) || '—',
      stage: stageOf(application.stage),
      stage_label: readableStage(application.stage),
      manager: managerName(application),
      updated_at: application.updated_at || application.created_at || '',
    }));

  const periodLabel = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return {
    generated_at: now.toISOString(),
    period_label: periodLabel,
    period_key: thisMonth,
    cards: {
      new_leads: {
        value: newLeads.length,
        display: String(newLeads.length),
        delta: `${newLeadsThisMonth.length} created · ${leadDelta.label}`,
        tone: leadDelta.tone,
        detail: `${openLeads.length} open in pipeline`,
      },
      applications_in_review: {
        value: underReview.length,
        display: String(underReview.length),
        delta: underReview.length ? `${underReview.length} pending action` : 'None pending',
        tone: underReview.length ? 'up' : 'flat',
        detail: `${applicationsStarted} total applications`,
      },
      territories_available: {
        value: availableTerritories.length,
        display: String(availableTerritories.length),
        delta: `FOFO ${metrics.fofo_available || 0} · FOCO ${metrics.foco_available || 0} slots`,
        tone: availableTerritories.length ? 'up' : 'flat',
        detail: `${territories.length} registered territories`,
      },
      collections_this_month: {
        value: collectionsThis.total,
        display: formatInrCompact(collectionsThis.total),
        delta: `${collectionsThis.count} verified · ${collectionDelta.label}`,
        tone: collectionDelta.tone,
        detail: periodLabel,
      },
    },
    pipeline: {
      conversion_rate: conversionRate,
      conversion_label: `${conversionRate}% conversion`,
      growth_label: conversionDelta.label,
      growth_tone: conversionDelta.tone,
      funnel,
    },
    priority_approvals: priorityApprovals,
    counts: {
      leads_total: leads.length,
      leads_open: openLeads.length,
      leads_new: newLeads.length,
      applications_total: applicationsStarted,
      applications_in_review: underReview.length,
      applications_approved: approved.length,
      territories_total: territories.length,
      territories_available: availableTerritories.length,
      fofo_available: metrics.fofo_available || 0,
      foco_available: metrics.foco_available || 0,
      collections_this_month: collectionsThis.total,
    },
  };
}
