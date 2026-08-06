import { randomUUID } from 'node:crypto';
import { releaseApplicationTerritory } from './hard-delete-workflow.mjs';
import {
  appendFranchiseeDirectoryVersion,
  buildDirectorySnapshot,
  franchiseeOperationalStatus,
  onboardingCompletedAt,
} from './franchisee-directory-workflow.mjs';

const LEGAL_COST = 1000;
const IT_SOFTWARE_COST = 2000;
const HR_COST_PER_EMPLOYEE = 13000;
const MARKETING_COST_PER_DAY = 100;

function text(value, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function numberFrom(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function employeeCount(application) {
  const hr = application?.hr && typeof application.hr === 'object' ? application.hr : {};
  const staff = Array.isArray(hr.staff) ? hr.staff
    : Array.isArray(hr.employees) ? hr.employees
      : Array.isArray(application?.employees) ? application.employees
        : [];
  if (staff.length) return staff.length;
  return Math.max(0, Math.floor(numberFrom(hr.employee_count || hr.headcount || 0)));
}

function brandingExpense(application) {
  const branding = application?.branding_signage && typeof application.branding_signage === 'object'
    ? application.branding_signage
    : application?.branding && typeof application.branding === 'object'
      ? application.branding
      : {};
  return numberFrom(
    branding.installation_cost
    ?? branding.total_expense
    ?? branding.branding_expense
    ?? branding.total_cost
    ?? 0,
  );
}

function activeFranchiseDays(application, deboardedAt = new Date()) {
  const startRaw = onboardingCompletedAt(application) || application?.created_at || '';
  const start = new Date(startRaw);
  if (Number.isNaN(start.getTime())) return 0;
  const end = deboardedAt instanceof Date ? deboardedAt : new Date(deboardedAt);
  const ms = Math.max(0, end.getTime() - start.getTime());
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export function buildDeboardingCostReport(application, deboardedAt = new Date()) {
  const days = activeFranchiseDays(application, deboardedAt);
  const employees = employeeCount(application);
  const branding = brandingExpense(application);
  const hr = employees * HR_COST_PER_EMPLOYEE;
  const digital = days * MARKETING_COST_PER_DAY;
  const physical = days * MARKETING_COST_PER_DAY;
  const legal = LEGAL_COST;
  const it = IT_SOFTWARE_COST;
  const total = branding + hr + legal + it + digital + physical;
  const franchiseName = text(application?.business_name || application?.full_name || application?.application_number || 'Franchise', 200);
  const franchiseeId = text(application?.franchisee_id || application?.id || '', 80);
  const lines = [
    'FRANCHISE DEBOARDING COST REPORT',
    '================================',
    `Franchise: ${franchiseName}`,
    `Franchisee ID: ${franchiseeId || '—'}`,
    `Application: ${text(application?.application_number || '', 80) || '—'}`,
    `Deboarded at: ${deboardedAt.toISOString()}`,
    `Active franchise days: ${days}`,
    `Employee count: ${employees}`,
    '',
    'COST BREAKDOWN',
    '--------------',
    `Branding Signage Cost: ₹${branding.toLocaleString('en-IN')} (total branding expense during onboarding)`,
    `HR Cost: ₹${hr.toLocaleString('en-IN')} (${employees} × ₹${HR_COST_PER_EMPLOYEE.toLocaleString('en-IN')})`,
    `Legal Cost: ₹${legal.toLocaleString('en-IN')}`,
    `IT Software Cost: ₹${it.toLocaleString('en-IN')}`,
    `Digital Marketing Cost: ₹${digital.toLocaleString('en-IN')} (${days} × ₹${MARKETING_COST_PER_DAY})`,
    `Physical Marketing Cost: ₹${physical.toLocaleString('en-IN')} (${days} × ₹${MARKETING_COST_PER_DAY})`,
    '',
    `TOTAL EXPENSE: ₹${total.toLocaleString('en-IN')}`,
    '',
    'This report is permanently stored in the Franchise Directory and linked to the franchise record.',
  ];
  return {
    report_text: lines.join('\n'),
    generated_at: deboardedAt.toISOString(),
    branding_signage_cost: branding,
    hr_cost: hr,
    legal_cost: legal,
    it_software_cost: it,
    digital_marketing_cost: digital,
    physical_marketing_cost: physical,
    total_expense: total,
    active_franchise_days: days,
    employee_count: employees,
  };
}

export function deboardFranchiseApplication(database, application, actor, helpers) {
  const now = new Date();
  const nowIso = now.toISOString();
  const costReport = buildDeboardingCostReport(application, now);

  application.deboarded = true;
  application.deboarded_at = nowIso;
  application.deboarded_by = text(actor?.name || 'System', 120);
  application.stage = 'deboarded';
  application.current_status = 'deboarded';
  application.deboarding_report = costReport;
  application.updated_at = nowIso;

  if (application.partner_portal && typeof application.partner_portal === 'object') {
    application.partner_portal = {
      ...application.partner_portal,
      enabled: false,
      disabled_at: nowIso,
      disabled_reason: 'Franchise deboarded',
    };
  }

  releaseApplicationTerritory(database, application);

  const webpageIds = [];
  for (const page of database.franchise_webpages ?? []) {
    const linked = page.application_id === application.id
      || (application.franchisee_id && page.franchisee_id === application.franchisee_id)
      || (application.email && page.applicant_email === application.email);
    if (linked) {
      page.enabled = false;
      page.updated_at = nowIso;
      webpageIds.push(page.id);
    }
  }

  if (Array.isArray(database.franchisees)) {
    database.franchisees = database.franchisees.map((item) => {
      if (item.application_id === application.id || (application.franchisee_id && item.franchisee_id === application.franchisee_id)) {
        return { ...item, is_featured: false, enabled: false, deboarded: true };
      }
      return item;
    });
  }

  const snapshotHelpers = helpers || {
    resolveUploadUrl: (url) => url,
    findWebpage: () => null,
  };
  let snapshot = null;
  try {
    snapshot = typeof buildDirectorySnapshot === 'function'
      ? buildDirectorySnapshot(application, snapshotHelpers)
      : null;
  } catch {
    snapshot = {
      current_status: 'deboarded',
      deboarding_report: costReport,
    };
  }
  appendFranchiseeDirectoryVersion(
    application,
    actor?.name || 'System',
    'Franchise deboarded with cost report',
    { ...(snapshot || {}), deboarding_report: costReport, current_status: 'deboarded' },
  );

  return {
    cost_report: costReport,
    webpage_ids: webpageIds,
    operational_status: franchiseeOperationalStatus(application),
    cascade: {
      hec_franchisee_profile: application.hec_franchisee_profile || '',
      franchisee_id: application.franchisee_id || '',
      partner_portal_user_id: application.partner_portal?.user_id || application.partner_portal?.email || '',
    },
  };
}

export function isDeboardedFranchise(application) {
  return Boolean(application?.deboarded) || application?.stage === 'deboarded' || application?.current_status === 'deboarded';
}
