import type { CollectionTubeRow } from '../api';
import { formatPatientAge } from './patientAge';

function money(n: number) {
  return `₹${(Number(n) || 0).toFixed(2)}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type WorkOrderLine = {
  item?: string;
  item_name?: string;
  sample_type?: string;
  sample_requirement_label?: string;
  collection_tubes?: CollectionTubeRow[];
};

function tubeLabel(tube: CollectionTubeRow) {
  const bits = [
    tube.tube_code || '',
    tube.cap_color ? `${tube.cap_color} cap` : '',
    tube.volume_ml ? `${tube.volume_ml} ml` : '',
    tube.specimen || '',
  ].filter(Boolean);
  return bits.join(' · ');
}

export function printWorkOrderSlip(
  bill: Record<string, unknown>,
  title = 'Work Order Slip',
) {
  const tests = (Array.isArray(bill.tests) ? bill.tests : []) as WorkOrderLine[];
  const planTubes = (Array.isArray(bill.collection_tubes) ? bill.collection_tubes : []) as CollectionTubeRow[];
  const testRows = tests
    .map((row, idx) => {
      const inlineTubes = (Array.isArray(row.collection_tubes) ? row.collection_tubes : []) as CollectionTubeRow[];
      const requirements = inlineTubes.length
        ? inlineTubes.map(tubeLabel).join('<br/>')
        : escapeHtml(row.sample_requirement_label || '—');
      return `<tr>
        <td>${idx + 1}</td>
        <td>
          <strong>${escapeHtml(row.item_name || row.item || '')}</strong><br/>
          <span class="muted">${escapeHtml(row.item || '')}</span>
        </td>
        <td>${escapeHtml(row.sample_type || '—')}</td>
        <td>${requirements}</td>
      </tr>`;
    })
    .join('');

  const drawPlanRows = planTubes
    .map(
      (tube) => `<tr>
        <td>${escapeHtml(tube.draw_order ?? '—')}</td>
        <td>${escapeHtml(tubeLabel(tube) || '—')}</td>
        <td>${escapeHtml(tube.destination || '—')}</td>
        <td>${escapeHtml(tube.linked_tests || '—')}</td>
      </tr>`,
    )
    .join('');

  const centre = String(
    bill.hub_label || bill.mother_lab_label || bill.franchisee_id || 'Remedium Lab',
  );
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)} ${escapeHtml(bill.name)}</title>
<style>
body{font:12px/1.45 'Segoe UI',Arial,sans-serif;color:#111;margin:24px}
h1{margin:0 0 4px;font-size:18px}
h2{margin:18px 0 8px;font-size:14px}
.muted{color:#555}
table{width:100%;border-collapse:collapse;margin-top:10px}
th,td{border:1px solid #d1d5db;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f3f4f6}
.meta{margin:10px 0 0}
.meta strong{display:inline-block;min-width:90px}
@media print{body{margin:0}}
</style></head><body>
  <h1>REMEDIUM LAB — ${escapeHtml(title)}</h1>
  <p class="muted">${escapeHtml(centre)} · ${escapeHtml(String(bill.sample_intake_channel || 'Hub Walk-in'))}</p>
  <div class="meta">
    <div><strong>TRF:</strong> ${escapeHtml(bill.name)}</div>
    <div><strong>Barcode:</strong> ${escapeHtml(bill.unique_barcode)}</div>
    <div><strong>Date:</strong> ${escapeHtml(String(bill.hec_bill_datetime || bill.creation || ''))}</div>
    <div><strong>Patient:</strong> ${escapeHtml(bill.patient_name)} (${escapeHtml([bill.gender, formatPatientAge(bill as Record<string, unknown>)].filter(Boolean).join(', '))})</div>
    <div><strong>Phone:</strong> ${escapeHtml(bill.patient_phone || '')}</div>
    <div><strong>Refr. By:</strong> ${escapeHtml(bill.referred_doctor || 'Self')}</div>
    <div><strong>Collected by:</strong> ${escapeHtml(String(bill.phlebotomist_name || bill.phlebotomist || 'Sample Collector'))}</div>
    <div><strong>Net Amount:</strong> ${money(Number(bill.hec_net_amount || bill.amount || 0))}</div>
  </div>

  <h2>Ordered tests</h2>
  <table>
    <thead><tr><th>#</th><th>Test</th><th>Sample type</th><th>Tube / minimum volume</th></tr></thead>
    <tbody>${testRows || '<tr><td colspan="4">No tests</td></tr>'}</tbody>
  </table>

  <h2>Collection plan</h2>
  <table>
    <thead><tr><th>Draw order</th><th>Tube</th><th>Destination</th><th>Linked tests</th></tr></thead>
    <tbody>${drawPlanRows || '<tr><td colspan="4">Draw plan will appear after save.</td></tr>'}</tbody>
  </table>
</body></html>`;

  const existing = document.getElementById('work-order-slip-print');
  if (existing) existing.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'work-order-slip-print';
  iframe.title = 'Work order slip print';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    iframe.remove();
    window.alert('Unable to open print dialog in this browser.');
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      window.alert('Print dialog could not be opened.');
    } finally {
      window.setTimeout(() => {
        try {
          iframe.remove();
        } catch {
          /* ignore */
        }
      }, 800);
    }
  }, 120);
}
