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

function billRateHtml(rate: number, mrp?: number, showSlash?: boolean) {
  const r = Number(rate) || 0;
  const m = Number(mrp) || 0;
  if (showSlash && m > r) {
    return `<span class="rate-slash-wrap"><span class="rate-mrp">${money(m)}</span><span>${money(r)}</span></span>`;
  }
  return money(r);
}

function openPrintHtml(title: string, html: string) {
  const existing = document.getElementById('hub-bill-print');
  if (existing) existing.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'hub-bill-print';
  iframe.title = title;
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

export type PaymentReceiptInfo = {
  bill_total?: number;
  previous_payment?: number;
  new_payment?: number;
  total_received?: number;
  remaining_due?: number;
  payment_mode?: string;
  payment_date?: string;
  status?: string;
};

/** Updated Bill / Payment Receipt after a due collection. */
export function printHubPaymentReceipt(
  bill: Record<string, unknown>,
  receipt: PaymentReceiptInfo,
) {
  const centre = String(
    bill.hub_label || bill.mother_lab_label || bill.franchisee_id || 'Remedium Lab',
  );
  const total = Number(receipt.bill_total ?? bill.hec_net_amount ?? bill.amount ?? 0);
  const previous = Number(receipt.previous_payment ?? 0);
  const neu = Number(receipt.new_payment ?? 0);
  const received = Number(receipt.total_received ?? bill.hec_amount_paid ?? previous + neu);
  const due = Number(receipt.remaining_due ?? bill.hec_due_amount ?? Math.max(total - received, 0));
  const status = String(
    receipt.status ||
      bill.hec_patient_payment_status ||
      (due <= 0 ? 'Paid' : previous > 0 || neu > 0 ? 'Partially Paid' : 'Unpaid'),
  );
  const mode = String(receipt.payment_mode || bill.hec_receipt_mode || '');
  const payDate = String(receipt.payment_date || new Date().toLocaleString());
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Payment Receipt ${escapeHtml(bill.name)}</title>
<style>
  body{font:12px/1.45 'Segoe UI',Arial,sans-serif;color:#111;margin:24px}
  h1{margin:0 0 4px;font-size:18px}
  .muted{color:#555}
  table{width:100%;border-collapse:collapse;margin-top:14px;max-width:420px}
  th,td{border:1px solid #ccc;padding:8px 10px;text-align:left}
  th{background:#f3f4f6;width:55%}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .emph td{font-weight:700;background:#fef9c3}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;background:#e7f5f2;font-weight:700;font-size:11px}
  @media print{body{margin:0}}
</style></head><body>
  <h1>REMEDIUM LAB — Updated Bill / Payment Receipt</h1>
  <p class="muted">${escapeHtml(centre)} · ${escapeHtml(String(bill.sample_intake_channel || 'Hub Walk-in'))}</p>
  <p>
    <strong>Bill No:</strong> ${escapeHtml(bill.name)} &nbsp;
    <strong>Barcode:</strong> ${escapeHtml(bill.unique_barcode)}<br/>
    <strong>Patient:</strong> ${escapeHtml(bill.patient_name)}
    (${escapeHtml(bill.gender)}${formatPatientAge(bill as Record<string, unknown>) ? `, ${escapeHtml(formatPatientAge(bill as Record<string, unknown>))}` : ''}) &nbsp;
    <strong>Phone:</strong> ${escapeHtml(bill.patient_phone || '')}<br/>
    <strong>Payment date:</strong> ${escapeHtml(payDate)} &nbsp;
    <strong>Payment mode:</strong> ${escapeHtml(mode)} &nbsp;
    <span class="badge">${escapeHtml(status)}</span>
  </p>
  <table>
    <tr><th>Total bill amount</th><td class="num">${money(total)}</td></tr>
    <tr><th>Previous payment</th><td class="num">${money(previous)}</td></tr>
    <tr><th>New payment</th><td class="num">${money(neu)}</td></tr>
    <tr class="emph"><th>Total received</th><td class="num">${money(received)}</td></tr>
    <tr class="emph"><th>Remaining due</th><td class="num">${money(due)}</td></tr>
    <tr><th>Payment mode</th><td>${escapeHtml(mode || '—')}</td></tr>
    <tr><th>Payment date</th><td>${escapeHtml(payDate)}</td></tr>
  </table>
  <p class="muted" style="margin-top:16px">This receipt updates the patient payment against the original lab bill. Platform wallet fees are separate.</p>
</body></html>`;
  openPrintHtml(`Payment receipt ${String(bill.name || '')}`, html);
}

export function printHubBill(bill: Record<string, unknown>) {
  const tests = (Array.isArray(bill.tests) ? bill.tests : []) as Array<Record<string, unknown>>;
  const lines = tests
    .map((row, idx) => {
      const qty = Number(row.qty || 1) || 1;
      const rate = Number(row.rate || 0) || 0;
      const rAmt = Number(row.hec_r_amount != null ? row.hec_r_amount : qty * rate) || 0;
      const rateCell = billRateHtml(
        rate,
        Number(row.mrp || 0) || undefined,
        Boolean(row.show_mrp_slash),
      );
      return `<tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(row.item_name || row.item)}</td>
        <td>${escapeHtml(row.item)}</td>
        <td class="num">${qty}</td>
        <td class="num">${rateCell}</td>
        <td class="num">${money(rAmt)}</td>
      </tr>`;
    })
    .join('');
  const net = Number(bill.hec_net_amount || bill.amount || 0);
  const paid = Number(bill.hec_amount_paid || bill.hec_receipt_amount || bill.hec_received || 0);
  const due = Number(
    bill.hec_due_amount != null && bill.hec_due_amount !== ''
      ? bill.hec_due_amount
      : Math.max(net - paid, 0),
  );
  const payStatus = String(
    bill.hec_patient_payment_status ||
      (due <= 0.009 ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Unpaid'),
  );
  const history = Array.isArray(bill.payment_history)
    ? (bill.payment_history as Array<Record<string, unknown>>)
    : [];
  const historyRows = history
    .map(
      (h) => `<tr>
      <td>${escapeHtml(h.at || '')}</td>
      <td>${escapeHtml(h.event || 'payment')}</td>
      <td class="num">${money(Number(h.amount || 0))}</td>
      <td>${escapeHtml(h.mode || '')}</td>
      <td class="num">${money(Number(h.running_paid || 0))} / ${money(Number(h.running_due || 0))}</td>
      <td>${escapeHtml(h.status_after || '')}</td>
    </tr>`,
    )
    .join('');
  const centre = String(
    bill.hub_label || bill.mother_lab_label || bill.franchisee_id || 'Remedium Lab',
  );
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Bill ${escapeHtml(bill.name)}</title>
<style>
  body{font:12px/1.4 'Segoe UI',Arial,sans-serif;color:#111;margin:24px}
  h1{margin:0 0 4px;font-size:18px}
  .muted{color:#555}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
  th{background:#f3f4f6}
  .num{text-align:right}
  .rate-slash-wrap{display:inline-flex;align-items:center;gap:4px}
  .rate-mrp{text-decoration:line-through;color:#888;font-size:11px}
  .totals{margin-top:12px;width:280px;margin-left:auto}
  .totals td{border:0;padding:3px 0}
  .totals .emph td{font-weight:700;background:#fef9c3;padding:4px 6px}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;background:#e7f5f2;font-weight:700;font-size:11px}
  @media print{body{margin:0}}
</style></head><body>
  <h1>REMEDIUM LAB — Patient Bill${payStatus === 'Paid' ? ' / Receipt' : ''}</h1>
  <p class="muted">${escapeHtml(centre)} · ${escapeHtml(String(bill.sample_intake_channel || 'Hub Walk-in'))}</p>
  <p>
    <strong>Bill No:</strong> ${escapeHtml(bill.name)} &nbsp;
    <strong>Barcode:</strong> ${escapeHtml(bill.unique_barcode)}<br/>
    <strong>Date:</strong> ${escapeHtml(String(bill.hec_bill_datetime || ''))}<br/>
    <strong>Patient:</strong> ${escapeHtml(bill.patient_name)}
    (${escapeHtml(bill.gender)}${formatPatientAge(bill as Record<string, unknown>) ? `, ${escapeHtml(formatPatientAge(bill as Record<string, unknown>))}` : ''}) &nbsp;
    <strong>Phone:</strong> ${escapeHtml(bill.patient_phone || '')}<br/>
    <strong>Refr. By:</strong> ${escapeHtml(bill.referred_doctor || 'Self')} &nbsp;
    <strong>Receipt mode:</strong> ${escapeHtml(bill.hec_receipt_mode || '')} &nbsp;
    <span class="badge">${escapeHtml(payStatus)}</span>
  </p>
  <table>
    <thead><tr><th>#</th><th>Test</th><th>Code</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>${lines || '<tr><td colspan="6">No tests</td></tr>'}</tbody>
  </table>
  <table class="totals">
    <tr><td>Coll. Charge</td><td class="num">${money(Number(bill.hec_coll_charge || 0))}</td></tr>
    <tr class="emph"><td>Total Bill Amount</td><td class="num">${money(net)}</td></tr>
    <tr><td>Amount Received</td><td class="num">${money(paid)}</td></tr>
    <tr class="emph"><td>Due Amount</td><td class="num">${money(due)}</td></tr>
  </table>
  ${
    historyRows
      ? `<h2 style="font-size:14px;margin:18px 0 6px">Payment history</h2>
  <table>
    <thead><tr><th>When</th><th>Event</th><th class="num">Amount</th><th>Mode</th><th class="num">Paid / Due</th><th>Status</th></tr></thead>
    <tbody>${historyRows}</tbody>
  </table>`
      : ''
  }
</body></html>`;

  openPrintHtml(`Hub bill ${String(bill.name || '')}`, html);
}
