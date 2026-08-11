/**
 * Renders docs/blood-collection-to-report-workflow.png
 * Uniform model: many inputs → one ERP barcode → single chain; SPA for staff; ERP for data.
 */
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', '..', 'docs', 'blood-collection-to-report-workflow.png');

const W = 3200;
const H = 2180;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

const COLORS = {
  bg: '#F7F5F0',
  ink: '#1A2332',
  muted: '#5A6577',
  line: '#D5D0C6',
  laneAlt: '#EFEBE3',
  header: '#1F3A5F',
  accent: '#0F766E',
  policyBg: '#E8F3F1',
  policyBorder: '#0F766E',
  policyInk: '#134E4A',
  gapBg: '#FFF4E5',
  gapBorder: '#C2410C',
  gapInk: '#7C2D12',
  white: '#FFFFFF',
  patient: '#E8F3F1',
  hub: '#EEF2F8',
  phlebo: '#F3EFE6',
  recept: '#E9EEF6',
  lis: '#F6EDEA',
  tech: '#EAF3EA',
  path: '#F1ECF6',
  acct: '#F5F0E8',
};

const stages = [
  '1. Book',
  '2. Pay',
  '3. Collect',
  '4. Accession',
  '5. Test',
  '6. Verify',
  '7. Authorize',
  '8. Deliver',
];

const lanes = [
  {
    role: 'Patient / Customer',
    portal: 'SPA www · Flutter\nInput source',
    fill: COLORS.patient,
    cells: [
      'Book lab tests\n(diagnostics / app)',
      'Razorpay / COD /\nHub payment',
      'Track booking &\nphlebo visit',
      '—',
      '—',
      '—',
      'Notify: report\nready',
      'Download PDF\n(/bookings)',
    ],
  },
  {
    role: 'Franchisee Hub',
    portal: 'SPA partners\nInput source (optional)',
    fill: COLORS.hub,
    cells: [
      'Walk-in / B2B\norder',
      'Wallet debit /\noffline settle',
      'Centre handoff\nif needed',
      '—',
      '—',
      '—',
      '—',
      'Hub branding\non PDF',
    ],
  },
  {
    role: 'Phlebotomist',
    portal: 'SPA collect\n/dashboard/phlebotomist',
    fill: COLORS.phlebo,
    cells: [
      'Receives assigned\nqueue',
      'Collect COD if\nneeded',
      'Draw · mark\nSample Collected',
      'Tubes Drawn /\nhandover',
      '—',
      '—',
      '—',
      '—',
    ],
  },
  {
    role: 'Lab Reception',
    portal: 'SPA www staff\nPhase 89 accession',
    fill: COLORS.recept,
    cells: [
      '—',
      '—',
      'Await sample',
      'Receive / Reject\ntubes',
      'Barcode ready\nfor LIS',
      '—',
      '—',
      '—',
    ],
  },
  {
    role: 'LIS / Analyzers',
    portal: 'Lab Gateway → HEC APIs\n(data into ERP only)',
    fill: COLORS.lis,
    cells: [
      '—',
      'Optional unpaid\ngate (402)',
      '—',
      'Query TRF\nunique_barcode',
      'Run → log_machine\n→ Lab Test Result',
      'LTR ready for\nimport',
      '—',
      '—',
    ],
  },
  {
    role: 'Lab Technician',
    portal: 'SPA www\n/dashboard/lab-reports',
    fill: COLORS.tech,
    cells: [
      'Sees queue after\ncollection',
      '—',
      '—',
      'Open / create\nLab Report',
      'Import LTR /\nmanual grid',
      'Finalize →\nVerified',
      '—',
      '—',
    ],
  },
  {
    role: 'Pathologist',
    portal: 'SPA www\nsame report UI · authorize',
    fill: COLORS.path,
    cells: [
      '—',
      '—',
      '—',
      '—',
      'Review values',
      'Check Verified\nreport',
      'Authorize → PDF\n+ notify',
      'Report released',
    ],
  },
  {
    role: 'Accounts',
    portal: 'ERP Accounts + SPA status\nDesk for SI / PE',
    fill: COLORS.acct,
    cells: [
      'Sales Order at\nbooking (ERP)',
      'Razorpay PE /\noffline PE',
      '—',
      '—',
      '—',
      '—',
      'SI from TRF SO\n(after delivery)',
      'Allocate payment\nto invoice',
    ],
  },
];

function fillRect(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function roundRect(x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function text(str, x, y, opts = {}) {
  const {
    size = 14,
    color = COLORS.ink,
    align = 'left',
    bold = false,
    maxWidth,
  } = opts;
  ctx.font = `${bold ? '600' : '400'} ${size}px "Segoe UI", "Arial", sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  if (maxWidth) ctx.fillText(str, x, y, maxWidth);
  else ctx.fillText(str, x, y);
}

function multiLine(str, x, y, lineH, opts = {}) {
  String(str).split('\n').forEach((line, i) => text(line, x, y + i * lineH, opts));
}

function wrap(s, width) {
  const words = s.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > width) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

fillRect(0, 0, W, H, COLORS.bg);

// Title band
fillRect(0, 0, W, 128, COLORS.header);
text('Remedium Lab — Uniform blood collection → report workflow', 48, 22, {
  size: 34,
  color: COLORS.white,
  bold: true,
});
text(
  'Multiple inputs → ERPNext mints unique_barcode once → single chain to PDF  ·  SPA = employee front end  ·  ERP = data receiver',
  48,
  70,
  { size: 16, color: '#C9D6E8' },
);
text('Architecture: docs/UNIFORM_LAB_WORKFLOW.md', 48, 96, {
  size: 14,
  color: '#A8B8CC',
});

const marginX = 36;
const marginTop = 152;
const laneLabelW = 340;
const stageW = (W - marginX * 2 - laneLabelW) / stages.length;
const laneH = 160;
const tableTop = marginTop + 56;

stages.forEach((stage, i) => {
  const x = marginX + laneLabelW + i * stageW;
  roundRect(x + 4, marginTop, stageW - 8, 44, 8, COLORS.accent, null);
  text(stage, x + stageW / 2, marginTop + 12, {
    size: 16,
    color: COLORS.white,
    align: 'center',
    bold: true,
  });
});

roundRect(marginX, marginTop, laneLabelW - 8, 44, 8, COLORS.header, null);
text('Role  /  SPA portal', marginX + laneLabelW / 2 - 4, marginTop + 12, {
  size: 15,
  color: COLORS.white,
  align: 'center',
  bold: true,
});

lanes.forEach((lane, row) => {
  const y = tableTop + row * laneH;
  fillRect(marginX, y, W - marginX * 2, laneH, row % 2 ? COLORS.laneAlt : COLORS.bg);

  roundRect(marginX, y + 10, laneLabelW - 12, laneH - 20, 10, lane.fill, COLORS.line);
  text(lane.role, marginX + 16, y + 24, { size: 16, bold: true });
  multiLine(lane.portal, marginX + 16, y + 52, 18, {
    size: 12,
    color: COLORS.muted,
    maxWidth: laneLabelW - 44,
  });

  lane.cells.forEach((cell, col) => {
    const x = marginX + laneLabelW + col * stageW;
    if (cell === '—') {
      text('·', x + stageW / 2, y + laneH / 2 - 8, {
        size: 18,
        color: COLORS.line,
        align: 'center',
      });
      return;
    }
    roundRect(x + 6, y + 12, stageW - 12, laneH - 24, 10, COLORS.white, COLORS.line);
    multiLine(cell, x + 16, y + 32, 18, { size: 13, color: COLORS.ink, maxWidth: stageW - 36 });
  });

  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(marginX, y + laneH);
  ctx.lineTo(W - marginX, y + laneH);
  ctx.stroke();
});

const policyY = tableTop + lanes.length * laneH + 20;
roundRect(marginX, policyY, W - marginX * 2, 168, 14, COLORS.policyBg, COLORS.policyBorder);
text('CONTRACT — how parallel “ERP vs lab-tech” becomes one workflow', marginX + 28, policyY + 16, {
  size: 17,
  color: COLORS.policyInk,
  bold: true,
});

const policies = [
  ['Barcode', 'Only ERPNext mints Customer TRF.unique_barcode. All inputs leave it blank; collision → retry.'],
  ['Chain', 'One barcode → tubes {barcode}-{TUBE} → LIS → one Lab Report → one authorized PDF.'],
  ['SPA vs Desk', 'SPA role dashboards for daily ops. Desk = masters / admin / exceptions only.'],
  ['Results', 'LIS writes Lab Test Result; humans edit Lab Report Parameter after import; finalize syncs.'],
  ['Status', 'Patient-visible truth = TRF order_status + Lab Report report_status (no third language).'],
  ['FFMS', '/ffms is franchise ops — not LIS. Does not mint clinical barcodes.'],
];

policies.forEach((pair, i) => {
  const col = i % 3;
  const row = Math.floor(i / 3);
  const rx = marginX + 28 + col * 1020;
  const ry = policyY + 48 + row * 52;
  text(pair[0], rx, ry, { size: 13, color: COLORS.policyInk, bold: true });
  text(pair[1], rx + 90, ry, { size: 13, color: COLORS.policyInk, maxWidth: 900 });
});

const gapY = policyY + 184;
roundRect(marginX, gapY, W - marginX * 2, 88, 12, COLORS.gapBg, COLORS.gapBorder);
text('Until live deploy (SPA + HEC barcode are in local repo)', marginX + 28, gapY + 16, {
  size: 15,
  color: COLORS.gapInk,
  bold: true,
});
text(
  'LabReports* routes wired in App.tsx · lab-tech home → /dashboard/lab-reports · Bill Entry uses DocType barcode mint · Desk Lab Report remains exception path until production parity prove-out.',
  marginX + 28,
  gapY + 44,
  { size: 14, color: COLORS.gapInk, maxWidth: W - marginX * 2 - 56 },
);

text(
  'Source of truth: ERPNext health_ecosystem_core (Customer TRF → Lab Report). Employee UI: health_web_app.',
  marginX,
  H - 40,
  { size: 13, color: COLORS.muted },
);
text('docs/blood-collection-to-report-workflow.png · docs/UNIFORM_LAB_WORKFLOW.md', W - marginX, H - 40, {
  size: 13,
  color: COLORS.muted,
  align: 'right',
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, canvas.toBuffer('image/png'));
console.log('Wrote', OUT);
