import type { Branch, Invoice, InvoiceLine, PackageUsage, Payment, SessionBill, Settings } from './types';
import { fmtDate, fmtStamp, fmtTime, TYPE_LABEL } from './format';
import { AES, F } from './flavor';

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` ${ONES[r % 10]}` : ''}`;
  return [h ? `${ONES[h]} Hundred` : '', rest].filter(Boolean).join(' ');
}

/* Indian numbering: crore, lakh, thousand. */
export function rupeesInWords(amount: number) {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  const parts: string[] = [];
  let n = rupees;
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  const words = parts.join(' ') || 'Zero';
  return `Rupees ${words}${paise ? ` and ${belowThousand(paise)} Paise` : ''} Only`;
}

export const LOGO_URL = AES
  ? `${import.meta.env.BASE_URL === '/' ? '/aes-sessions/' : import.meta.env.BASE_URL}aesthetic-logo.png`
  : '/care-logo.png';
/* Print windows are written with document.write, so the logo needs an absolute URL on this origin. */
const logoSrc = () => new URL(LOGO_URL, window.location.origin).href;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const money = (v: number) => `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0)}`;

const PRINT_CSS = `
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f2a2c; font-size: 9.5pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { width: 210mm; min-height: 148.5mm; padding: 7mm 8mm; margin: 0; display: flex; flex-direction: column; border-bottom: 0.3mm dashed #cbd5e1; }
@media screen { body { background: #e5ecee; padding: 16px; } .sheet { background: #fff; box-shadow: 0 4px 18px rgba(0,0,0,.15); margin: 0 auto; border-bottom: 0; } }
.head { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1.5px solid #17a37a; padding-bottom: 5px; }
.head h1 { margin: 0; font-size: 14pt; color: #0b3a3b; }
.head .logo { display: block; height: 22mm; width: auto; margin: 0 0 1.5mm -1mm; }
.head .br { font-weight: 700; font-size: 9.5pt; color: #0b3a3b; }
.head p { margin: 1px 0; color: #334155; font-size: 8.5pt; }
.meta { text-align: right; }
.meta h2 { margin: 0 0 2px; font-size: 11pt; letter-spacing: .14em; color: #0f7f5e; }
.meta .no { font-family: Consolas, monospace; font-weight: 700; font-size: 9.5pt; }
.tag { display: inline-block; border: 1px solid #94a3b8; border-radius: 3px; padding: 0 5px; font-size: 7.5pt; font-weight: 700; margin-left: 4px; }
.tag.due { border-color: #dc2626; color: #dc2626; } .tag.ok { border-color: #15803d; color: #15803d; }
.to { display: flex; justify-content: space-between; margin: 5px 0; font-size: 9pt; }
.to b { font-size: 10pt; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 8pt; color: #475569; background: #f1f6f7; padding: 3px 5px; border-top: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1; }
td { padding: 3px 5px; border-bottom: 1px solid #e3ecee; vertical-align: top; }
.n { text-align: right; white-space: nowrap; }
th:first-child, td:first-child { width: 6mm; }
.bottom { display: flex; justify-content: space-between; gap: 8mm; margin-top: 4px; }
.left { flex: 1; font-size: 8.5pt; }
.words { font-weight: 600; margin-bottom: 3px; }
.tot { width: 66mm; }
.tot td { border: 0; padding: 1px 5px; }
.tot tr.g td { font-weight: 800; font-size: 10.5pt; border-top: 1px solid #0f2a2c; padding-top: 3px; }
.tot tr.d td { color: #dc2626; font-weight: 700; }
.hist { margin-top: 3px; }
.hist td, .hist th { font-size: 8pt; padding: 2px 5px; }
.hist th:first-child, .hist td:first-child { width: auto; }
.box-title { font-weight: 700; font-size: 8.5pt; margin: 4px 0 2px; color: #0f7f5e; }
.foot { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; padding-top: 6px; }
.note { font-size: 8pt; color: #475569; max-width: 110mm; }
.sign { text-align: center; min-width: 56mm; font-size: 8.5pt; }
.sign img { max-height: 16mm; max-width: 52mm; display: block; margin: 0 auto 1mm; }
.sign .line { border-top: 1px solid #334155; padding-top: 2px; font-weight: 700; }
.sign .space { height: 14mm; }
.cancel { position: fixed; top: 55mm; left: 0; right: 0; text-align: center; font-size: 40pt; font-weight: 800; color: rgba(220,38,38,.18); transform: rotate(-14deg); pointer-events: none; }
`;

function clinicHead(s: Settings, branch: Partial<Branch> | null) {
  const gstin = branch?.gst_registered && branch.gstin ? branch.gstin : s.gstin || '';
  const address = [branch?.address, branch?.city].filter(Boolean).join(', ') || s.address || '';
  const phone = branch?.phone || s.phone || '';
  const email = branch?.email || s.support_email || '';
  const state = branch?.state ? `${branch.state}${branch.state_code ? ` (${branch.state_code})` : ''}` : '';
  const html = `<div>
    ${LOGO_URL ? `<img class="logo" src="${esc(logoSrc())}" alt="${esc(s.clinic_name || F.brand)}">${AES && s.tagline ? `<p>${esc(s.tagline)}</p>` : ''}` : `<h1>${esc(s.clinic_name || F.brand)}</h1>${s.tagline ? `<p>${esc(s.tagline)}</p>` : ''}`}
    ${branch?.name ? `<div class="br">${esc(branch.name)}</div>` : ''}
    ${address ? `<p>${esc(address)}</p>` : ''}
    <p>${[phone && `Phone: ${esc(phone)}`, email && esc(email)].filter(Boolean).join(' · ')}</p>
    ${gstin ? `<p><b>GSTIN: ${esc(gstin)}</b>${state ? ` · State: ${esc(state)}` : ''}</p>` : ''}
  </div>`;
  return { html, gstin };
}

function footer(s: Settings, note: string) {
  const signatory = s.signatory_name || '';
  return `<div class="foot">
  <div class="note">${esc(s.invoice_footer || '')}<br><span style="color:#94a3b8">${esc(note)}</span></div>
  <div class="sign">
    <div>For ${esc(s.clinic_name || 'Remedium Care')}</div>
    ${s.invoice_signature ? `<img src="${esc(s.invoice_signature)}" alt="Signature">` : '<div class="space"></div>'}
    <div class="line">${esc(signatory || 'Authorised Signatory')}</div>
    <div>${esc(signatory ? s.signatory_title || 'Authorised Signatory' : '')}</div>
  </div>
</div>`;
}

function page(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body><div class="sheet">${body}</div></body></html>`;
}

/* Writes the document into a new window and starts printing. The invoice fills the top half of an upright A4 sheet
   (A5 size, never rotated by the printer); "Save as PDF" gives a PDF. */
function openAndPrint(html: string) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  let printed = false;
  const go = () => {
    if (printed) return;
    printed = true;
    try {
      w.focus();
      w.print();
    } catch {
      /* window closed */
    }
  };
  const imgs = Array.from(w.document.images);
  const pending = imgs.filter((img) => !img.complete);
  if (!pending.length) {
    setTimeout(go, 50);
  } else {
    pending.forEach((img) => {
      img.addEventListener('load', go);
      img.addEventListener('error', go);
    });
    setTimeout(go, 2500);
  }
  return true;
}

export function printInvoice(inv: Invoice & { items: InvoiceLine[] }, payments: Payment[], s: Settings, branch: Partial<Branch> | null, usage: PackageUsage | null = null) {
  return openAndPrint(invoiceHtml(inv, payments, s, branch, usage));
}

function usageHtml(u: PackageUsage) {
  const status = u.due_for_used > 0 ? `<b style="color:#dc2626">Due for sessions taken ${money(u.due_for_used)}</b>` : u.advance > 0 ? `Paid in advance ${money(u.advance)}` : 'Up to date';
  const list = u.sessions
    .map((x) => `${x.session_no}: ${esc(fmtDate(x.date, false))} ${x.status === 'Completed' ? '✓' : x.status === 'Scheduled' ? '–' : esc(x.status)}`)
    .join(' · ');
  return `<div class="box-title">Package usage · Plan ${esc(u.plan_code)}</div>
  <div>Sessions completed <b>${u.completed} of ${u.total_sessions}</b> · Value used <b>${money(u.value_used)}</b> (${money(u.per_session)} × ${u.completed}) · Paid ${money(u.paid)} · ${status}</div>
  <div style="color:#475569">${list}</div>`;
}

export function printSessionBill(bill: SessionBill, s: Settings, branch: Partial<Branch> | null) {
  return openAndPrint(sessionBillHtml(bill, s, branch));
}

export type VoucherPrint = {
  number: string;
  voucher_date: string;
  branch_name?: string;
  category: string;
  payee: string;
  amount: number;
  paid?: number;
  balance?: number;
  payment_mode?: string;
  purpose: string;
  notes?: string;
  status: string;
  wing?: string;
  doctor_name?: string | null;
  payments?: { amount: number; mode: string; paid_on: string; reference?: string }[];
};

const VOUCHER_PRINT_CSS = `
@page { size: A5 landscape; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f2a2c; font-size: 9pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { width: 210mm; height: 148mm; padding: 6mm 7mm; margin: 0; display: flex; flex-direction: column; overflow: hidden; }
@media screen { body { background: #e5ecee; padding: 16px; } .sheet { background: #fff; box-shadow: 0 4px 18px rgba(0,0,0,.15); margin: 0 auto; } }
.head { display: flex; justify-content: space-between; gap: 10px; border-bottom: 1.5px solid #17a37a; padding-bottom: 4px; }
.head h1 { margin: 0; font-size: 13pt; color: #0b3a3b; }
.head .logo { display: block; height: 18mm; width: auto; margin: 0 0 1mm -1mm; }
.head .br { font-weight: 700; font-size: 9pt; color: #0b3a3b; }
.head p { margin: 1px 0; color: #334155; font-size: 8pt; }
.meta { text-align: right; }
.meta h2 { margin: 0 0 2px; font-size: 11pt; letter-spacing: .12em; color: #0f7f5e; }
.meta .no { font-family: Consolas, monospace; font-weight: 700; font-size: 10pt; }
.tag { display: inline-block; border: 1px solid #94a3b8; border-radius: 3px; padding: 0 5px; font-size: 7.5pt; font-weight: 700; margin-left: 4px; }
.tag.ok { border-color: #15803d; color: #15803d; }
.tag.due { border-color: #b45309; color: #b45309; }
.grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3mm 6mm; margin: 5mm 0 3mm; font-size: 9pt; }
.grid .lbl { display: block; font-size: 7.5pt; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
.grid .val { font-weight: 700; font-size: 10pt; color: #0b3a3b; }
.purpose { margin: 2mm 0; font-size: 9pt; }
.purpose .lbl { font-size: 7.5pt; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
.words { font-weight: 600; font-size: 8.5pt; margin: 2mm 0 4mm; }
.foot { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; padding-top: 4mm; gap: 8mm; }
.note { font-size: 7.5pt; color: #64748b; max-width: 95mm; }
.sign { text-align: center; min-width: 58mm; font-size: 8pt; }
.sign img { max-height: 14mm; max-width: 52mm; display: block; margin: 0 auto 1mm; }
.sign .line { border-top: 1px solid #334155; padding-top: 2px; font-weight: 700; }
.sign .space { height: 12mm; }
`;

function voucherPage(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${VOUCHER_PRINT_CSS}</style></head><body><div class="sheet">${body}</div></body></html>`;
}

function voucherHtml(v: VoucherPrint, s: Settings, branch: Partial<Branch> | null) {
  const head = clinicHead(s, branch);
  const managerName = s.signatory_name || branch?.manager || '';
  const statusClass = v.status === 'Paid' || v.status === 'Approved' ? 'ok' : v.status === 'Pending' ? 'due' : '';
  const paidLines = (v.payments || [])
    .map((p) => `${esc(fmtDate(p.paid_on, false))} · ${esc(p.mode)}${p.reference ? ` · Ref ${esc(p.reference)}` : ''} · ${money(p.amount)}`)
    .join('<br>');
  return voucherPage(
    v.number,
    `<div class="head">
  ${head.html}
  <div class="meta">
    <h2>PAYMENT VOUCHER</h2>
    <div class="no">${esc(v.number)}</div>
    <p>${esc(fmtDate(v.voucher_date))}</p>
    <p><span class="tag">${esc(v.wing || 'Care')}</span><span class="tag ${statusClass}">${esc(v.status)}</span></p>
  </div>
</div>
<div class="grid">
  <div><span class="lbl">Category</span><span class="val">${esc(v.category)}</span></div>
  <div><span class="lbl">Paid to</span><span class="val">${esc(v.payee)}</span></div>
  <div><span class="lbl">Amount</span><span class="val">${money(v.amount)}</span></div>
  ${v.doctor_name ? `<div><span class="lbl">Doctor</span><span class="val">${esc(v.doctor_name)}</span></div>` : ''}
  <div><span class="lbl">Mode</span><span class="val">${esc(v.payment_mode || '—')}</span></div>
  <div><span class="lbl">Branch</span><span class="val">${esc(v.branch_name || branch?.name || '—')}</span></div>
  ${v.balance != null ? `<div><span class="lbl">Balance</span><span class="val">${money(v.balance)}</span></div>` : ''}
</div>
<div class="purpose"><div class="lbl">Purpose</div>${esc(v.purpose || '—')}</div>
${v.notes ? `<div class="purpose"><div class="lbl">Notes</div>${esc(v.notes)}</div>` : ''}
<div class="words">${esc(rupeesInWords(v.amount))}</div>
${paidLines ? `<div class="purpose"><div class="lbl">Payments</div>${paidLines}</div>` : ''}
<div class="foot">
  <div class="note">${esc(s.invoice_footer || '')}<br><span style="color:#94a3b8">Computer-generated payment voucher · A5 landscape</span></div>
  <div class="sign">
    <div>For ${esc(s.clinic_name || F.brand)}</div>
    ${s.invoice_signature ? `<img src="${esc(s.invoice_signature)}" alt="Branch Manager signature">` : '<div class="space"></div>'}
    <div class="line">${esc(managerName || 'Branch Manager')}</div>
    <div>${esc(managerName ? s.signatory_title || 'Branch Manager' : 'Branch Manager')}</div>
  </div>
</div>`,
  );
}

/** A5 landscape voucher with Care billing letterhead and branch manager signature. Save as PDF from the print dialog. */
export function printVoucher(v: VoucherPrint, s: Settings, branch: Partial<Branch> | null = null) {
  return openAndPrint(voucherHtml(v, s, branch));
}

export function invoiceHtml(inv: Invoice & { items: InvoiceLine[] }, payments: Payment[], s: Settings, branch: Partial<Branch> | null, usage: PackageUsage | null = null) {
  const due = Math.max(inv.total - inv.paid, 0);
  const head = clinicHead(s, branch);
  const rows = inv.items
    .map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.name)}${it.batches ? `<br><span style="font-size:7.5pt;color:#475569">Batch ${esc(it.batches)}</span>` : ''}</td><td class="n">${esc(it.qty)}</td><td class="n">${money(it.rate)}</td><td class="n">${money(it.amount)}</td></tr>`)
    .join('');
  const paidLines = payments.map((p) => `${esc(fmtStamp(p.at))} · ${esc(p.mode)}${p.reference ? ` · Ref ${esc(p.reference)}` : ''} · ${money(p.amount)}`).join('<br>');

  return page(
    inv.number,
    `${inv.status === 'Cancelled' ? '<div class="cancel">CANCELLED</div>' : ''}
<div class="head">
  ${head.html}
  <div class="meta">
    <h2>${head.gstin ? 'TAX INVOICE' : 'INVOICE'}</h2>
    <div class="no">${esc(inv.number)}</div>
    <p>${esc(fmtStamp(inv.created_at))}</p>
    <p><span class="tag">${esc(TYPE_LABEL[inv.service_type] || inv.service_type)}</span><span class="tag ${inv.status === 'Paid' ? 'ok' : inv.status === 'Cancelled' ? '' : 'due'}">${esc(inv.status)}</span></p>
  </div>
</div>
<div class="to">
  <div>Billed to: <b>${esc(inv.patient)}</b>${inv.patient_code ? ` · ${esc(inv.patient_code)}` : ''}${inv.mobile ? ` · ${esc(inv.mobile)}` : ''}${
    inv.patient_address ? `<br>${esc(inv.patient_address)}` : ''
  }${
    inv.doctor
      ? `<br>Consultant: <b>${esc(inv.doctor)}</b>${[inv.doctor_specialty, inv.doctor_qualification].filter(Boolean).length ? ` (${esc([inv.doctor_specialty, inv.doctor_qualification].filter(Boolean).join(', '))})` : ''}${inv.doctor_registration ? ` · Reg. ${esc(inv.doctor_registration)}` : ''}`
      : ''
  }${inv.referred_by ? `<br>Ref. by: <b>${esc(inv.referred_by)}</b>` : ''}</div>
  <div>Payment: ${esc(inv.payment_mode || '—')}</div>
</div>
<table><thead><tr><th>#</th><th>Description</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div class="bottom">
  <div class="left">
    <div class="words">${esc(rupeesInWords(inv.total))}</div>
    ${paidLines ? `<div>Payments: ${paidLines}</div>` : ''}
    ${usage ? usageHtml(usage) : ''}
    ${inv.notes ? `<div>Note: ${esc(inv.notes)}</div>` : ''}
  </div>
  <table class="tot">
    <tr><td>Subtotal</td><td class="n">${money(inv.subtotal)}</td></tr>
    ${inv.discount > 0 ? `<tr><td>Discount${inv.discount_type === 'percent' && inv.discount_value ? ` (${esc(inv.discount_value)}%)` : ''}</td><td class="n">− ${money(inv.discount)}</td></tr>` : ''}
    ${Number(inv.gst_amount) > 0 ? `<tr><td>Taxable value</td><td class="n">${money(inv.total - Number(inv.gst_amount))}</td></tr><tr><td>GST ${esc(inv.gst_rate || 5)}% (included)</td><td class="n">${money(Number(inv.gst_amount))}</td></tr>` : ''}
    <tr class="g"><td>Total</td><td class="n">${money(inv.total)}</td></tr>
    <tr><td>Paid</td><td class="n">${money(inv.paid)}</td></tr>
    ${due > 0 && inv.status !== 'Cancelled' ? `<tr class="d"><td>Balance due</td><td class="n">${money(due)}</td></tr>` : ''}
  </table>
</div>
${footer(s, 'This is a computer-generated invoice.')}`,
  );
}

export function sessionBillHtml(bill: SessionBill, s: Settings, branch: Partial<Branch> | null) {
  const snap = bill.snapshot;
  const pkg = snap.package;
  const head = clinicHead(s, branch);
  const history = snap.payments.length
    ? snap.payments
        .map((p, i) => `<tr><td>${i + 1}</td><td>${esc(fmtStamp(p.at))}</td><td>${esc(p.mode || '—')}</td><td>${esc(p.reference || '')}</td><td class="n">${money(p.amount)}</td></tr>`)
        .join('')
    : '<tr><td colspan="5" style="color:#64748b">No payment received yet</td></tr>';
  return page(
    bill.number,
    `<div class="head">
  ${head.html}
  <div class="meta">
    <h2>SESSION INVOICE</h2>
    <div class="no">${esc(bill.number)}</div>
    <p>${esc(fmtStamp(bill.updated_at || bill.created_at))}</p>
    <p><span class="tag">${esc(F.service)}</span><span class="tag ${snap.balance > 0 ? 'due' : 'ok'}">${snap.balance > 0 ? 'Package balance due' : 'Package paid'}</span></p>
  </div>
</div>
<div class="to">
  <div>Billed to: <b>${esc(bill.patient)}</b>${bill.patient_code ? ` · ${esc(bill.patient_code)}` : ''}${bill.mobile ? ` · ${esc(bill.mobile)}` : ''}${
    bill.patient_address ? `<br>${esc(bill.patient_address)}` : ''
  }${
    bill.snapshot.package.referred_by ? `<br>Ref. by: <b>${esc(bill.snapshot.package.referred_by)}</b>` : ''
  }</div>
  <div>Package invoice: <b>${esc(pkg.invoice_number)}</b> · Plan ${esc(pkg.code)}</div>
</div>
<table><thead><tr><th>#</th><th>Session</th><th>Date &amp; time</th><th>${esc(F.therapist)}</th><th class="n">Session value</th></tr></thead>
<tbody><tr><td>1</td><td>${esc(snap.session.service)} — Session ${esc(snap.session.no)} of ${esc(snap.session.of)}</td><td>${esc(fmtDate(snap.session.date))}, ${esc(fmtTime(snap.session.time))}</td><td>${esc(snap.session.therapist || '—')}</td><td class="n">${money(snap.session.value)}</td></tr></tbody></table>
<div class="bottom">
  <div class="left">
    <div class="box-title">Package payment history (up to this session)</div>
    <table class="hist"><thead><tr><th>#</th><th>Date</th><th>Mode</th><th>Reference</th><th class="n">Amount</th></tr></thead><tbody>${history}</tbody></table>
  </div>
  <table class="tot">
    <tr><td colspan="2" class="box-title">${esc(pkg.name)} — ${esc(pkg.sessions)} sessions</td></tr>
    <tr><td>Package amount</td><td class="n">${money(pkg.subtotal)}</td></tr>
    ${pkg.discount > 0 ? `<tr><td>Discount${pkg.discount_type === 'percent' && pkg.discount_value ? ` (${esc(pkg.discount_value)}%)` : ''}</td><td class="n">− ${money(pkg.discount)}</td></tr>` : ''}
    ${Number(pkg.gst_amount) > 0 ? `<tr><td>Taxable value</td><td class="n">${money(pkg.total - Number(pkg.gst_amount))}</td></tr><tr><td>GST ${esc(pkg.gst_rate || 5)}% (included)</td><td class="n">${money(Number(pkg.gst_amount))}</td></tr>` : ''}
    <tr class="g"><td>Package total</td><td class="n">${money(pkg.total)}</td></tr>
    <tr><td>Paid to date</td><td class="n">${money(snap.paid_to_date)}</td></tr>
    ${snap.balance > 0 ? `<tr class="d"><td>Balance due</td><td class="n">${money(snap.balance)}</td></tr>` : ''}
    <tr><td>Sessions completed</td><td class="n">${esc(snap.sessions_completed)} of ${esc(pkg.sessions)}</td></tr>
    <tr><td>Value used</td><td class="n">${money(snap.value_used)}</td></tr>
  </table>
</div>
${footer(s, `This session is covered by package invoice ${pkg.invoice_number}; it is not a separate charge.`)}`,
  );
}
