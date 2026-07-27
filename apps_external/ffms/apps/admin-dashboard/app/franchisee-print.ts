import { RFMS_API_BASE, RFMS_MARKETING_ORIGIN } from '@rfms/utils';

const API_ORIGIN = RFMS_API_BASE.replace(/\/api\/v1\/?$/, '');

type JourneyStage = {
  stage_name: string;
  completed_by: string;
  status: string;
  completion_date_time: string;
  remarks: string;
};

type PrintBranding = {
  companyName: string;
  logoDataUrl: string;
  logoUrl: string;
  legacyCanvasLogo: boolean;
};

function resolveLogoUrl(logoUrl?: string) {
  const value = (logoUrl ?? '').trim();
  if (!value) return `${RFMS_MARKETING_ORIGIN}/remedium-lab-logo.png`;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/uploads/')) return `${API_ORIGIN}${value}`;
  return `${RFMS_MARKETING_ORIGIN}${value.startsWith('/') ? value : `/${value}`}`;
}

function isLegacyCanvasLogo(logoUrl: string) {
  const value = logoUrl.trim().toLowerCase();
  return value.endsWith('/remedium-lab-logo.png') || value.endsWith('remedium-lab-logo.png');
}

async function fetchImageDataUrl(url: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) return '';
    const blob = await response.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

async function loadPrintBranding(): Promise<PrintBranding> {
  let companyName = 'Remedium Lab';
  let logoUrl = `${RFMS_MARKETING_ORIGIN}/remedium-lab-logo.png`;
  try {
    const response = await fetch(`${RFMS_API_BASE}/content/settings`);
    const payload = await response.json().catch(() => null) as { success?: boolean; data?: { company_name?: string; logo_url?: string } } | null;
    if (response.ok && payload?.success && payload.data) {
      companyName = payload.data.company_name?.trim() || companyName;
      logoUrl = resolveLogoUrl(payload.data.logo_url);
    }
  } catch {
    /* Use default branding below. */
  }
  let logoDataUrl = await fetchImageDataUrl(logoUrl);
  if (!logoDataUrl && logoUrl !== `${RFMS_MARKETING_ORIGIN}/remedium-lab-logo.png`) {
    logoUrl = `${RFMS_MARKETING_ORIGIN}/remedium-lab-logo.png`;
    logoDataUrl = await fetchImageDataUrl(logoUrl);
  }
  return {
    companyName,
    logoDataUrl,
    logoUrl,
    legacyCanvasLogo: isLegacyCanvasLogo(logoUrl),
  };
}

type PrintRecord = {
  identifiers: { franchisee_id: string; application_id: string; application_number: string; business_id: string; webpage_id: string };
  basic_details: Record<string, string>;
  territory: Record<string, unknown> | null;
  payments: { items: { label: string; amount: number; status: string; paid_at?: string; receipt_number?: string }[] };
  agreement: Record<string, unknown> | null;
  field_visit: Record<string, unknown> | null;
  branding: Record<string, unknown> | null;
  hr: { staff?: { name: string; designation: string; phone: string }[] } | null;
  training: Record<string, unknown> | null;
  certificates: { training_completion?: { certificate_number?: string } | null; onboarding_welcome?: { certificate_number?: string } | null };
  webpage: { public_url?: string } | null;
  onboarding_journey: {
    application_submitted_at?: string;
    onboarding_completed_at?: string;
    stages?: JourneyStage[];
  };
};

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

function formatPrintDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function readable(value?: string) {
  return (value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || '—';
}

function fallbackJourneyStages(record: PrintRecord): JourneyStage[] {
  const basic = record.basic_details;
  const territory = record.territory as Record<string, string> | null;
  const agreement = record.agreement as Record<string, string> | null;
  const fieldVisit = record.field_visit as Record<string, string> | null;
  const branding = record.branding as Record<string, string | number> | null;
  const training = record.training as Record<string, string> | null;
  const paidPayments = (record.payments?.items ?? []).filter((item) => item.status === 'paid');
  const stages: JourneyStage[] = [
    { stage_name: 'Application Submitted', completed_by: basic.applicant_name, status: 'Completed', completion_date_time: record.onboarding_journey.application_submitted_at ?? '', remarks: `Application ${record.identifiers.application_number} submitted.` },
    { stage_name: 'Payments', completed_by: 'Applicant', status: paidPayments.length ? 'Completed' : 'Pending', completion_date_time: paidPayments.map((item) => item.paid_at).filter(Boolean).sort().at(-1) ?? '', remarks: paidPayments.map((item) => item.label).join('; ') || 'Payments pending.' },
    { stage_name: 'KYC Verification', completed_by: 'Franchise manager', status: 'Completed', completion_date_time: record.onboarding_journey.application_submitted_at ?? '', remarks: 'KYC documents verified during application review.' },
    { stage_name: 'Video KYC', completed_by: 'Video KYC officer', status: 'Completed', completion_date_time: '', remarks: 'Video KYC completed as part of onboarding workflow.' },
    { stage_name: 'Field Visit', completed_by: String(fieldVisit?.approved_by ?? fieldVisit?.field_officer_name ?? 'Field officer'), status: fieldVisit?.approved_at ? 'Completed' : 'Pending', completion_date_time: String(fieldVisit?.approved_at ?? ''), remarks: String((fieldVisit?.report as Record<string, string> | undefined)?.recommendation ?? 'Field visit report on file.') },
    { stage_name: 'Territory Allocation', completed_by: String(territory?.issued_by ?? 'Territory manager'), status: territory?.letter_number ? 'Completed' : 'Pending', completion_date_time: String(territory?.issued_at ?? territory?.effective_date ?? ''), remarks: String(territory?.final_territory ?? territory?.registered_territory_label ?? 'Territory allotted.') },
    { stage_name: 'Branding Signage', completed_by: String(branding?.approved_by ?? branding?.vendor_name ?? 'Branding vendor'), status: branding?.approved_at ? 'Completed' : 'Pending', completion_date_time: String(branding?.approved_at ?? ''), remarks: String(branding?.completion_details ?? 'Branding signage completed.') },
  ];
  if (basic.franchise_model === 'FOCO') {
    stages.push({ stage_name: 'HR Process', completed_by: String((record.hr as Record<string, string> | null)?.approved_by ?? 'HR manager'), status: (record.hr as Record<string, string> | null)?.approved_at ? 'Completed' : 'Pending', completion_date_time: String((record.hr as Record<string, string> | null)?.approved_at ?? ''), remarks: record.hr?.staff?.length ? `${record.hr.staff.length} staff member(s) onboarded.` : 'HR process completed.' });
  }
  stages.push(
    { stage_name: 'Agreement', completed_by: String(agreement?.company_dsc_signed_by ?? 'Legal / Manager'), status: agreement?.executed_at ? 'Completed' : 'Pending', completion_date_time: String(agreement?.executed_at ?? ''), remarks: String(agreement?.reference_number ? `Agreement reference ${agreement.reference_number}.` : 'Agreement executed.') },
    { stage_name: 'Training', completed_by: String(training?.unlocked_by ?? 'Training manager'), status: training?.completed_at ? 'Completed' : 'Pending', completion_date_time: String(training?.completed_at ?? ''), remarks: 'Training modules completed and certificate issued.' },
    { stage_name: 'Certificate Generation', completed_by: 'RFMS Admin', status: 'Completed', completion_date_time: record.onboarding_journey.onboarding_completed_at ?? '', remarks: [record.certificates.training_completion?.certificate_number, record.certificates.onboarding_welcome?.certificate_number].filter(Boolean).join(' · ') || 'Certificates generated.' },
    { stage_name: 'Onboarded', completed_by: 'RFMS Admin', status: 'Completed', completion_date_time: record.onboarding_journey.onboarding_completed_at ?? basic.onboarding_completed_at ?? '', remarks: 'Franchise onboarding completed and archived in the directory.' },
  );
  return stages;
}

function journeyRows(record: PrintRecord) {
  return (record.onboarding_journey.stages?.length ? record.onboarding_journey.stages : fallbackJourneyStages(record))
    .map((stage) => `<tr>
      <td>${escapeHtml(stage.stage_name)}</td>
      <td>${escapeHtml(stage.completed_by)}</td>
      <td><span class="status ${escapeHtml(stage.status).toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(stage.status)}</span></td>
      <td>${escapeHtml(formatPrintDate(stage.completion_date_time))}</td>
      <td>${escapeHtml(stage.remarks)}</td>
    </tr>`)
    .join('');
}

function summaryRows(record: PrintRecord) {
  const basic = record.basic_details;
  const territory = record.territory as Record<string, string | number> | null;
  return [
    ['Franchisee / Business name', basic.business_name || basic.franchisee_name],
    ['Applicant name', basic.applicant_name],
    ['Application number', record.identifiers.application_number],
    ['Franchisee ID', record.identifiers.franchisee_id],
    ['Business ID', record.identifiers.business_id],
    ['Franchise model', readable(basic.franchise_model)],
    ['Registered address', basic.registered_address],
    ['Contact number', basic.contact_number],
    ['Email address', basic.email_address],
    ['District / PIN code', `${basic.district || '—'} · ${basic.pincode || '—'}`],
    ['Allotted territory', String(territory?.final_territory ?? territory?.registered_territory_label ?? '—')],
    ['Territory letter', String(territory?.letter_number ?? '—')],
    ['Onboarding completed', formatPrintDate(basic.onboarding_completed_at || record.onboarding_journey.onboarding_completed_at)],
    ['Franchise webpage', record.webpage?.public_url || '—'],
  ].map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('');
}

export function buildFranchiseePrintHtml(record: PrintRecord, branding: PrintBranding) {
  const basic = record.basic_details;
  const printedAt = formatPrintDate(new Date().toISOString());
  const logoSrc = branding.logoDataUrl || branding.logoUrl;
  const logoClass = branding.legacyCanvasLogo ? 'brand-logo legacy-canvas' : 'brand-logo';
  const logoMarkup = logoSrc
    ? `<div class="brand-logo-wrap"><img class="${logoClass}" src="${escapeHtml(logoSrc)}" alt="${escapeHtml(branding.companyName)} logo" /></div>`
    : `<span class="brand-mark">R</span>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Franchisee Record — ${escapeHtml(basic.business_name || basic.franchisee_name)}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm 12mm 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17324d; font: 12px/1.45 "Segoe UI", Arial, sans-serif; }
    .print-shell { width: 100%; }
    .print-header, .print-footer { display: flex; justify-content: space-between; gap: 20px; align-items: center; }
    .print-header { border-bottom: 2px solid #0b3c6e; padding-bottom: 14px; margin-bottom: 18px; }
    .print-header-brand { flex: 1 1 520px; max-width: 560px; min-width: 280px; }
    .brand-mark { display: inline-grid; place-items: center; width: 48px; height: 48px; border-radius: 8px; background: #0f8f78; color: #fff; font-weight: 800; }
    .brand-logo-wrap { position: relative; width: 100%; max-width: 520px; height: 118px; overflow: hidden; flex: none; }
    .brand-logo { width: 100%; height: 100%; object-fit: contain; object-position: left center; display: block; }
    .brand-logo.legacy-canvas { object-fit: contain; object-position: left center; width: 100%; max-width: none; height: 100%; position: static; }
    .report-meta { flex: 0 0 auto; text-align: right; color: #607b98; font-size: 11px; min-width: 190px; }
    .report-meta b { display: block; color: #0b3c6e; font-size: 14px; margin-bottom: 4px; }
    h1 { margin: 0 0 4px; color: #0b3c6e; font-size: 22px; }
    .subtitle { margin: 0 0 16px; color: #607b98; font-size: 12px; }
    h2 { margin: 18px 0 8px; color: #0b3c6e; font-size: 15px; page-break-after: avoid; }
    .summary-table, .journey-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .summary-table th, .summary-table td, .journey-table th, .journey-table td { border: 1px solid #cfddea; padding: 8px 10px; vertical-align: top; text-align: left; }
    .summary-table th { width: 32%; background: #f4f9fc; color: #47627d; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .journey-table thead th { background: #0b3c6e; color: #fff; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .journey-table tbody tr:nth-child(even) td { background: #f8fbfd; }
    .status { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .status.completed { background: #dff7eb; color: #087354; }
    .status.pending { background: #eef2f6; color: #66788f; }
    .status.in-progress, .status.in-progress { background: #fff3df; color: #a26309; }
    .section-note { margin: 0 0 8px; color: #607b98; font-size: 11px; }
    .print-footer { margin-top: 18px; padding-top: 10px; border-top: 1px solid #d6e5ee; color: #71869c; font-size: 10px; }
    .page-break { break-before: page; page-break-before: always; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-shell { page-break-inside: avoid; }
      .brand-logo-wrap { max-width: 540px; height: 124px; }
      .journey-table { page-break-inside: auto; }
      .journey-table tr { page-break-inside: avoid; page-break-after: auto; }
    }
  </style>
</head>
<body>
  <div class="print-shell">
    <header class="print-header">
      <div class="print-header-brand">${logoMarkup}</div>
      <div class="report-meta"><b>Franchisee Directory Report</b><span>Printed: ${escapeHtml(printedAt)}</span><br><span>${escapeHtml(record.identifiers.application_number)} · ${escapeHtml(readable(basic.franchise_model))}</span></div>
    </header>

    <h1>${escapeHtml(basic.business_name || basic.franchisee_name)}</h1>
    <p class="subtitle">Official onboarded franchisee record for ${escapeHtml(basic.applicant_name)} · Status: ${escapeHtml(readable(basic.current_status))}</p>

    <h2>Franchise profile summary</h2>
    <p class="section-note">Core identity, contact and territory details for the selected franchisee only.</p>
    <table class="summary-table">${summaryRows(record)}</table>

    <h2 class="page-break">Franchise Application to Onboarding Journey</h2>
    <p class="section-note">Complete onboarding workflow from application submission through final onboarded status.</p>
    <table class="journey-table">
      <thead>
        <tr>
          <th>Stage Name</th>
          <th>Completed By</th>
          <th>Status</th>
          <th>Completion Date &amp; Time</th>
          <th>Remarks</th>
        </tr>
      </thead>
      <tbody>${journeyRows(record)}</tbody>
    </table>

    <footer class="print-footer">
      <span>Confidential franchise record generated from Remedium Lab Franchisee Directory.</span>
      <span>Franchisee ID: ${escapeHtml(record.identifiers.franchisee_id)}</span>
    </footer>
  </div>
</body>
</html>`;
}

function printHtmlInHiddenFrame(html: string) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'Franchisee record print preview');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);
  const frameWindow = iframe.contentWindow;
  const frameDocument = frameWindow?.document;
  if (!frameWindow || !frameDocument) {
    iframe.remove();
    throw new Error('Unable to prepare the print preview.');
  }
  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();
  const cleanup = () => {
    window.setTimeout(() => iframe.remove(), 1000);
  };
  frameWindow.focus();
  frameWindow.addEventListener('afterprint', cleanup, { once: true });
  window.setTimeout(() => {
    frameWindow.print();
    window.setTimeout(cleanup, 1500);
  }, 150);
}

export async function printFranchiseeRecord(record: PrintRecord) {
  let html = '';
  try {
    const branding = await loadPrintBranding();
    html = buildFranchiseePrintHtml(record, branding);
  } catch (error) {
    window.alert(error instanceof Error ? error.message : 'Unable to prepare this franchisee record for printing.');
    return;
  }

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, '_blank', 'width=980,height=720');
  if (!printWindow) {
    URL.revokeObjectURL(url);
    try {
      printHtmlInHiddenFrame(html);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Allow pop-ups to print this franchisee record.');
    }
    return;
  }

  const cleanup = () => URL.revokeObjectURL(url);
  const triggerPrint = () => {
    printWindow.focus();
    window.setTimeout(() => {
      printWindow.print();
      cleanup();
    }, 300);
  };
  if (printWindow.document.readyState === 'complete') triggerPrint();
  else printWindow.addEventListener('load', triggerPrint, { once: true });
  printWindow.addEventListener('beforeunload', cleanup, { once: true });
}
