/* Branch pharmacy: the branch's medicine stock lives in the Operations pharmacy (ERP, batch-wise). Branch staff
   see their stock, raise requisitions to the central store, receive deliveries, return stock and record
   dispensed / damaged medicines here; the Operations Manager approves and dispatches in the Operations portal.
   Pharmacy bills take their medicines from the branch stock first-expiry-first-out. */
import { audit, row, run, tx } from './db.mjs';
import { HttpError, cancelInvoice, createInvoice, getInvoice } from './api.mjs';
import { carePharmacy } from './erp.mjs';

const str = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));
const parse = (json, fallback) => {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
};

async function erp(ctx, method, data = {}) {
  const branch = Number(ctx.body?.branch_id || ctx.q.branch);
  if (!branch) throw new HttpError(400, 'Choose a branch first');
  try {
    return await carePharmacy(ctx.cfg, ctx.sid, method, { ...data, branch_id: branch });
  } catch (err) {
    throw new HttpError(err.status || 502, err.message);
  }
}

export const board = (ctx) => erp(ctx, 'care_pharmacy_board');
export const sellable = (ctx) => erp(ctx, 'care_pharmacy_sellable');
export async function ledger(ctx) {
  const rows = await erp(ctx, 'care_pharmacy_ledger', {
    filters: { from: str(ctx.q.from, 10) || undefined, to: str(ctx.q.to, 10) || undefined, item: str(ctx.q.item, 140) || undefined, voucher_type: str(ctx.q.type, 40) || undefined },
  });
  return Array.isArray(rows) ? rows : [];
}

export const requisition = (ctx) =>
  erp(ctx, 'care_pharmacy_requisition', {
    lines: Array.isArray(ctx.body.lines) ? ctx.body.lines.map((l) => ({ item: str(l.item, 140), qty: Number(l.qty) })) : [],
    priority: str(ctx.body.priority, 20),
    required_by: str(ctx.body.required_by, 10) || undefined,
    note: str(ctx.body.note, 500),
  });
export const cancel = (ctx) => erp(ctx, 'care_pharmacy_cancel', { requisition: str(ctx.body.requisition, 40) });
export const receive = (ctx) =>
  erp(ctx, 'care_pharmacy_receive', { challan: str(ctx.body.challan, 40), note: str(ctx.body.note, 300), received_by: str(ctx.body.received_by, 140) || ctx.user.full_name || '' });
const batchLines = (lines, sign) =>
  (Array.isArray(lines) ? lines : []).map((l) => ({ batch: str(l.batch, 140), qty: sign * Math.abs(Math.trunc(Number(l.qty) || 0)), reason: str(l.reason, 60) }));
export const stockReturn = (ctx) => erp(ctx, 'care_pharmacy_return', { lines: batchLines(ctx.body.lines, 1), note: str(ctx.body.note, 500) });
export const adjustment = (ctx) => erp(ctx, 'care_pharmacy_adjustment', { lines: batchLines(ctx.body.lines, -1), note: str(ctx.body.note, 500) });

/* Buying from an outside vendor needs the Operations Manager's approval first; the bill can be entered only
   within the approved quantity, price and validity, and its batches then join the branch stock. */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const externalRequest = (ctx) =>
  erp(ctx, 'care_pharmacy_external_request', {
    item: str(ctx.body.item, 140),
    medicine_name: str(ctx.body.medicine_name, 140),
    qty: Math.trunc(num(ctx.body.qty)),
    unit_price: num(ctx.body.unit_price),
    vendor_name: str(ctx.body.vendor_name, 140),
    vendor_gstin: str(ctx.body.vendor_gstin, 20),
    vendor_phone: str(ctx.body.vendor_phone, 20),
    reason: str(ctx.body.reason, 1000),
    urgency: str(ctx.body.urgency, 20),
  });
export const externalCancel = (ctx) => erp(ctx, 'care_pharmacy_external_cancel', { ext_no: str(ctx.body.ext_no, 40) });
export const externalReceive = (ctx) =>
  erp(ctx, 'care_pharmacy_external_receive', {
    ext_no: str(ctx.body.ext_no, 40),
    invoice_no: str(ctx.body.invoice_no, 60),
    invoice_date: str(ctx.body.invoice_date, 10) || undefined,
    note: str(ctx.body.note, 300),
    lines: (Array.isArray(ctx.body.lines) ? ctx.body.lines : []).slice(0, 30).map((l) => ({
      batch_no: str(l.batch_no, 60),
      mfg_date: str(l.mfg_date, 10) || undefined,
      expiry_date: str(l.expiry_date, 10),
      qty: Math.trunc(num(l.qty)),
      free_qty: Math.trunc(num(l.free_qty)),
      rate: num(l.rate),
      mrp: num(l.mrp),
    })),
  });

export async function challan(ctx) {
  const res = await erp(ctx, 'care_pharmacy_challan', { challan: str(ctx.q.challan, 40) });
  return { raw: { type: 'application/pdf', filename: res.file_name, body: Buffer.from(res.data, 'base64') } };
}

/* ---------------------------------------------------------------- pharmacy bills */

const medLines = (items) => items.filter((it) => it.med);

/* A pharmacy bill with ERP medicines: the bill is saved first, then its medicines are taken from the branch
   stock under the bill number. If the stock cannot be taken the bill is removed again. */
export async function createPharmacyInvoice(ctx) {
  const result = createInvoice(ctx);
  const inv = result.invoice;
  const meds = medLines(inv.items);
  if (!meds.length) return result;
  let taken;
  try {
    taken = await carePharmacy(ctx.cfg, ctx.sid, 'care_pharmacy_dispense', {
      branch_id: inv.branch_id,
      invoice_no: inv.number,
      patient: inv.patient,
      lines: meds.map((m) => ({ item: m.med, name: m.name, qty: m.qty })),
    });
  } catch (err) {
    tx(ctx.db, () => {
      for (const it of inv.items) if (it.item_id) run(ctx.db, 'UPDATE items SET stock = stock + ? WHERE id = ?', it.qty, it.item_id);
      run(ctx.db, "DELETE FROM stock_moves WHERE ref = ? AND kind = 'Sale'", inv.number);
      run(ctx.db, 'DELETE FROM payments WHERE invoice_id = ?', inv.id);
      run(ctx.db, 'DELETE FROM invoices WHERE id = ?', inv.id);
      audit(ctx.db, ctx.user.user, 'void (stock not available)', 'invoice', inv.number);
    });
    throw new HttpError(err.status === 403 ? 403 : 400, err.message);
  }
  const byItem = {};
  for (const b of taken.batches) (byItem[b.item] ||= []).push(`${b.batch_no}${b.expiry ? ` exp ${b.expiry.slice(5, 7)}/${b.expiry.slice(2, 4)}` : ''}${b.qty !== undefined ? ` ×${b.qty}` : ''}`);
  const items = parse(row(ctx.db, 'SELECT items FROM invoices WHERE id = ?', inv.id).items, []).map((it) =>
    it.med && byItem[it.med] ? { ...it, batches: byItem[it.med].join(', ') } : it,
  );
  run(ctx.db, 'UPDATE invoices SET items = ? WHERE id = ?', JSON.stringify(items), inv.id);
  return getInvoice({ db: ctx.db, params: { id: inv.id } });
}

/* Cancelling a pharmacy bill puts its medicine batches back at the branch before the bill is cancelled. */
export async function cancelPharmacyInvoice(ctx) {
  const inv = row(ctx.db, 'SELECT id, number, branch_id, items, status FROM invoices WHERE id = ?', Number(ctx.params.id));
  if (inv && inv.status !== 'Cancelled' && medLines(parse(inv.items, [])).length) {
    try {
      await carePharmacy(ctx.cfg, ctx.sid, 'care_pharmacy_restock', { branch_id: inv.branch_id, invoice_no: inv.number, reason: str(ctx.body.reason, 200) });
    } catch (err) {
      throw new HttpError(err.status === 403 ? 403 : 400, `Stock could not be put back: ${err.message}`);
    }
  }
  return cancelInvoice(ctx);
}
