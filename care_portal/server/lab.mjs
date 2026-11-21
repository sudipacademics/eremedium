/* Lab bookings: Remedium Care is a collection centre of Remedium Labs. Bookings, sample status, payments and
   reports live on the ERP booking (Customer TRF) and are processed by the lab in the Lab Tech portal.
   This module keeps a local index of those bookings (for patient history, branch views and dashboards) and a
   mirror Care invoice per booking, refreshed whenever staff open the lab screens. */
import { audit, row, rows, run, stamp, tx, update } from './db.mjs';
import { HttpError, applyInvoiceRevision, createInvoiceRow, getInvoice, invoiceStatus, readBillItems, shrinkPayments } from './api.mjs';
import { careLab, careLabReport } from './erp.mjs';

const bad = (message) => {
  throw new HttpError(400, message);
};
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const int = (v) => Math.trunc(num(v));
const money = (v) => Math.round(num(v) * 100) / 100;
const str = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));
const parse = (json, fallback) => {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
};

const ERP_TO_CARE_MODE = { CASH: 'Cash', CARD: 'Card', UPI: 'UPI', NEFT: 'Bank Transfer' };
const ACTIVE = ['Booked', 'Sample Collected', 'In Lab', 'Processing', 'Result Ready'];

async function erp(ctx, method, data) {
  try {
    return await careLab(ctx.cfg, ctx.sid, method, data);
  } catch (err) {
    throw new HttpError(err.status || 502, err.message);
  }
}

function branchFor(db, value) {
  const id = int(value);
  if (id && row(db, 'SELECT id FROM branches WHERE id = ?', id)) return id;
  return row(db, 'SELECT id FROM branches WHERE active = 1 ORDER BY id LIMIT 1')?.id ?? null;
}

function patientByMobile(db, mobile) {
  const digits = String(mobile || '').replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return null;
  return row(db, "SELECT id, branch_id FROM patients WHERE substr(replace(replace(mobile, ' ', ''), '-', ''), -10) = ? ORDER BY id LIMIT 1", digits);
}

/* Keep the mirror Care invoice in step with the ERP booking: created once, payments taken anywhere are added. */
function reconcileInvoice(db, lb, user, mode, syncItems = false) {
  const by = { user: user?.user || 'lab-sync' };
  const lines = parse(lb.tests, []).filter((t) => t.rate != null);
  const invoice = lb.invoice_id ? row(db, 'SELECT * FROM invoices WHERE id = ?', lb.invoice_id) : null;
  if (!invoice) {
    if (lb.net <= 0 && !lines.length) return;
    const subtotal = money(lines.reduce((s, t) => s + num(t.rate) * (num(t.qty) || 1), 0));
    const itemised = lines.length && subtotal >= lb.net - 0.01;
    const items = itemised
      ? lines.map((t) => {
          const qty = num(t.qty) || 1;
          const rate = money(t.rate);
          const line = { name: str(t.item_name || t.item, 160), qty, rate, amount: money(rate * qty) };
          if (t.item) line.item = t.item;
          return line;
        })
      : [{ name: `Lab tests (${lb.trf_id})`, qty: 1, rate: lb.net, amount: lb.net }];
    const id = createInvoiceRow(db, by, {
      items,
      service_type: 'lab',
      patient_id: lb.patient_id,
      customer: lb.patient_id ? null : lb.patient_name,
      branch_id: lb.branch_id,
      discount: itemised ? money(subtotal - lb.net) : 0,
      discount_type: 'flat',
      paid: lb.paid,
      mode: mode || ERP_TO_CARE_MODE[(parse(lb.detail, {}).payment_history || []).at(-1)?.mode] || 'Cash',
      reference: lb.trf_id,
      notes: `Lab booking ${lb.trf_id}${lb.barcode ? ` · barcode ${lb.barcode}` : ''}`,
      referred_by: lb.referred_by && lb.referred_by !== 'Self' ? lb.referred_by : null,
    });
    update(db, 'invoices', id, { trf_id: lb.trf_id });
    update(db, 'lab_bookings', lb.id, { invoice_id: id });
    return;
  }
  if (invoice.status === 'Cancelled') return;
  const patch = {};
  const subtotal = money(lines.reduce((s, t) => s + num(t.rate) * (num(t.qty) || 1), 0));
  const itemised = syncItems && lines.length > 0 && subtotal + 0.01 >= lb.net && lb.net + 0.01 >= lb.paid;
  if (itemised) {
    const items = lines.map((t) => {
      const qty = num(t.qty) || 1;
      const rate = money(t.rate);
      const line = { name: str(t.item_name || t.item, 160), qty, rate, amount: money(rate * qty) };
      if (t.item) line.item = t.item;
      return line;
    });
    const discount = money(Math.max(subtotal - lb.net, 0));
    const percentFits = invoice.discount_type === 'percent' && invoice.discount_value && Math.abs(money((subtotal * invoice.discount_value) / 100) - discount) < 0.02;
    const changed = JSON.stringify(parse(invoice.items, [])) !== JSON.stringify(items) || Math.abs(invoice.total - lb.net) > 0.009 || Math.abs(invoice.discount - discount) > 0.009;
    if (changed) {
      patch.items = JSON.stringify(items);
      patch.subtotal = subtotal;
      patch.discount = discount;
      patch.discount_type = discount > 0 ? (percentFits ? 'percent' : 'flat') : null;
      patch.discount_value = discount > 0 ? (percentFits ? invoice.discount_value : discount) : null;
      patch.total = lb.net;
      if (invoice.gst_rate) patch.gst_amount = money((lb.net * invoice.gst_rate) / (100 + invoice.gst_rate));
    }
  } else if (Math.abs(invoice.total - lb.net) > 0.009 && lb.net + 0.01 >= lb.paid && lb.net + 0.01 >= invoice.paid) {
    patch.total = lb.net;
    patch.discount = money(Math.max(invoice.subtotal - lb.net, 0));
  }
  const extra = money(lb.paid - invoice.paid);
  if (extra > 0.009) {
    const payMode = mode || 'Cash';
    run(db, 'INSERT INTO payments (invoice_id, amount, mode, reference, at, by) VALUES (?, ?, ?, ?, ?, ?)', invoice.id, extra, payMode, lb.trf_id, stamp(), by.user);
    patch.paid = money(invoice.paid + extra);
    patch.payment_mode = payMode;
  } else if (extra < -0.009 && (lb.paid > 0.009 || lb.net <= 0.009) && lb.net + 0.01 >= lb.paid) {
    shrinkPayments(db, invoice.id, lb.paid);
    patch.paid = lb.paid;
  }
  if (Object.keys(patch).length) {
    patch.status = invoiceStatus(patch.total ?? invoice.total, patch.paid ?? invoice.paid);
    update(db, 'invoices', invoice.id, patch);
  }
}

/* Store one ERP booking (list row or full detail) locally. Returns the local id. */
function upsert(db, b, { patientId, branchId, user, mode } = {}) {
  const existing = row(db, 'SELECT * FROM lab_bookings WHERE trf_id = ?', b.trf_id);
  const fields = {
    barcode: b.barcode || null,
    patient_name: b.patient_name || null,
    mobile: b.patient_phone || null,
    referred_by: b.referred_doctor || null,
    net: money(b.net_amount),
    paid: money(b.paid_amount),
    due: money(b.due_amount),
    payment_status: b.payment_status || null,
    status: b.lifecycle_status || b.order_status || null,
    order_status: b.order_status || null,
    stage_index: int(b.stage_index),
    report_ready: b.report_ready ? 1 : 0,
    report_status: b.report_status || null,
    journey_id: b.journey_id || null,
    authorized_on: b.authorized_on || null,
    booked_at: b.booking_date || null,
    synced_at: stamp(),
  };
  if (Array.isArray(b.lines)) {
    fields.tests = JSON.stringify(b.lines);
    fields.detail = JSON.stringify(b);
  } else if (!existing || existing.tests === '[]') {
    fields.tests = JSON.stringify((b.tests || []).map((t) => ({ item: t.item_code, item_name: t.item_name })));
  }
  let id = existing?.id;
  if (existing) {
    update(db, 'lab_bookings', id, fields);
  } else {
    const match = patientId ? { id: patientId, branch_id: branchId } : patientByMobile(db, b.patient_phone);
    id = Number(
      db
        .prepare(
          `INSERT INTO lab_bookings (trf_id, patient_id, branch_id, created_at, created_by, ${Object.keys(fields).join(', ')})
           VALUES (?, ?, ?, ?, ?, ${Object.keys(fields).map(() => '?').join(', ')})`,
        )
        .run(b.trf_id, match?.id ?? null, branchId ?? match?.branch_id ?? branchFor(db, null), stamp(), user?.user || 'lab-sync', ...Object.values(fields)).lastInsertRowid,
    );
  }
  reconcileInvoice(db, row(db, 'SELECT * FROM lab_bookings WHERE id = ?', id), user, mode, Array.isArray(b.lines));
  return id;
}

const LOCAL_SELECT = `
  SELECT lb.*, p.code AS patient_code, p.name AS patient, br.name AS branch, i.number AS invoice_number, i.status AS invoice_status
    FROM lab_bookings lb LEFT JOIN patients p ON p.id = lb.patient_id LEFT JOIN branches br ON br.id = lb.branch_id
    LEFT JOIN invoices i ON i.id = lb.invoice_id`;

function present(r) {
  if (!r) return null;
  const detail = parse(r.detail, {});
  return {
    id: r.id,
    trf_id: r.trf_id,
    barcode: r.barcode,
    patient_id: r.patient_id,
    patient: r.patient || r.patient_name,
    patient_code: r.patient_code,
    mobile: r.mobile,
    branch: r.branch,
    tests: parse(r.tests, []),
    referred_by: r.referred_by,
    net: r.net,
    paid: r.paid,
    due: r.due,
    payment_status: r.payment_status,
    status: r.status,
    order_status: r.order_status,
    stage_index: r.stage_index,
    report_ready: Boolean(r.report_ready),
    report_status: r.report_status,
    authorized_on: r.authorized_on,
    booked_at: r.booked_at,
    created_by: r.created_by,
    synced_at: r.synced_at,
    invoice_id: r.invoice_id,
    invoice_number: r.invoice_number,
    invoice_status: r.invoice_status,
    timeline: detail.timeline || null,
    tubes: detail.tubes || null,
    reports: detail.reports || null,
    payment_history: detail.payment_history || null,
    subtotal: detail.subtotal ?? null,
    discount: detail.discount ?? null,
    terminal_reason: detail.terminal_reason || null,
    remarks: detail.remarks || null,
  };
}

function counts(db, branch) {
  const b = int(branch);
  const where = b ? ' WHERE branch_id = ?' : '';
  const args = b ? [b] : [];
  const out = { All: 0, Active: 0, 'Report Ready': 0, Due: 0 };
  for (const r of rows(db, `SELECT status, COUNT(*) AS n FROM lab_bookings${where} GROUP BY status`, ...args)) {
    out[r.status || 'Booked'] = r.n;
    out.All += r.n;
    if (ACTIVE.includes(r.status)) out.Active += r.n;
  }
  out['Report Ready'] = row(db, `SELECT COUNT(*) AS n FROM lab_bookings WHERE report_ready = 1${b ? ' AND branch_id = ?' : ''}`, ...args).n;
  out.Due = row(db, `SELECT COUNT(*) AS n FROM lab_bookings WHERE due > 0.009 AND status NOT IN ('Cancelled')${b ? ' AND branch_id = ?' : ''}`, ...args).n;
  return out;
}

/* ---------------------------------------------------------------- handlers */

export async function quoteLab(ctx) {
  const codes = [...new Set((Array.isArray(ctx.body.tests) ? ctx.body.tests : []).map((c) => str(c, 140)).filter(Boolean))];
  if (!codes.length) bad('Choose at least one test');
  return erp(ctx, 'care_lab_quote', { tests: codes });
}

export async function bookLab(ctx) {
  const { db, body, user } = ctx;
  const patient = row(db, 'SELECT * FROM patients WHERE id = ?', int(body.patient_id));
  if (!patient) bad('Choose a patient');
  const codes = [...new Set((Array.isArray(body.tests) ? body.tests : []).map((c) => str(c, 140)).filter(Boolean))];
  if (!codes.length) bad('Choose at least one test');
  const quote = await erp(ctx, 'care_lab_quote', { tests: codes });
  const subtotal = money(quote.subtotal);
  const discountValue = num(body.discount);
  if (discountValue < 0) bad('Discount cannot be negative');
  const percent = body.discount_type === 'percent';
  if (percent && discountValue > 100) bad('Percentage discount cannot be more than 100%');
  const discount = money(percent ? (subtotal * discountValue) / 100 : discountValue);
  if (discount > subtotal + 0.001) bad(`Discount cannot be more than the bill amount (₹${subtotal})`);
  const net = money(subtotal - discount);
  const paid = money(body.paid);
  if (paid < 0) bad('Paid amount cannot be negative');
  if (paid > net + 0.001) bad(`Amount received cannot be more than the bill (₹${net})`);
  const branchId = branchFor(db, body.branch_id || patient.branch_id);
  const branch = branchId ? row(db, 'SELECT name FROM branches WHERE id = ?', branchId) : null;
  const booking = await erp(ctx, 'care_lab_book', {
    patient_name: patient.name,
    age: patient.age,
    gender: patient.gender,
    patient_phone: patient.mobile,
    email: patient.email,
    address: patient.address,
    referred_by: str(body.referred_by, 140) || 'Self',
    tests: codes,
    discount,
    paid,
    mode: body.mode || 'Cash',
    branch: branch?.name,
    care_ref: patient.code,
    remarks: str(body.notes, 300),
  });
  const id = tx(db, () => {
    const localId = upsert(db, booking, { patientId: patient.id, branchId, user, mode: body.mode });
    audit(db, user.user, 'book', 'lab booking', booking.trf_id);
    return localId;
  });
  return present(row(db, `${LOCAL_SELECT} WHERE lb.id = ?`, id));
}

export async function listLab(ctx) {
  const { db, q, user } = ctx;
  let remote = null;
  let offline = null;
  try {
    remote = await erp(ctx, 'care_lab_bookings', { q: str(q.q, 80), status: str(q.status, 40), page: int(q.page) || 1, page_size: Math.min(Math.max(int(q.limit) || 30, 1), 100) });
  } catch (err) {
    if (err.status === 403) throw err;
    offline = err.message;
  }
  let items;
  if (remote) {
    const ids = tx(db, () => remote.bookings.map((b) => upsert(db, b, { user })));
    const branch = int(q.branch);
    items = ids
      .map((id) => row(db, `${LOCAL_SELECT} WHERE lb.id = ?`, id))
      .filter((r) => !branch || r.branch_id === branch)
      .map(present);
  } else {
    const where = ['1=1'];
    const args = [];
    if (int(q.branch)) {
      where.push('lb.branch_id = ?');
      args.push(int(q.branch));
    }
    if (q.status === 'Active') where.push(`lb.status IN (${ACTIVE.map(() => '?').join(',')})`), args.push(...ACTIVE);
    else if (q.status === 'Report Ready') where.push('lb.report_ready = 1');
    else if (q.status) where.push('lb.status = ?'), args.push(str(q.status, 40));
    if (q.q) {
      where.push('(lb.trf_id LIKE ? OR lb.barcode LIKE ? OR lb.patient_name LIKE ? OR lb.mobile LIKE ?)');
      const term = `%${str(q.q, 80).replace(/[%_]/g, '')}%`;
      args.push(term, term, term, term);
    }
    const limit = Math.min(Math.max(int(q.limit) || 30, 1), 100);
    const offset = (Math.max(int(q.page) || 1, 1) - 1) * limit;
    items = rows(db, `${LOCAL_SELECT} WHERE ${where.join(' AND ')} ORDER BY lb.booked_at DESC, lb.id DESC LIMIT ? OFFSET ?`, ...args, limit, offset).map(present);
  }
  return {
    items,
    counts: counts(db, q.branch),
    centre: remote ? { name: remote.centre_name, type: remote.franchisee_type, pricing_rule: remote.pricing_rule, active: remote.active } : null,
    offline,
    synced_by: user.user,
  };
}

export async function getLab(ctx) {
  const { db, params, user } = ctx;
  const lb = row(db, 'SELECT * FROM lab_bookings WHERE id = ?', int(params.id));
  if (!lb) throw new HttpError(404, 'Lab booking not found');
  let offline = null;
  try {
    const b = await erp(ctx, 'care_lab_booking', { trf_id: lb.trf_id });
    tx(db, () => upsert(db, b, { user }));
  } catch (err) {
    if (err.status === 403 || err.status === 404) throw err;
    offline = err.message;
  }
  return { ...present(row(db, `${LOCAL_SELECT} WHERE lb.id = ?`, lb.id)), offline };
}

export async function payLab(ctx, labId = ctx.params.id) {
  const { db, body, user } = ctx;
  const lb = row(db, 'SELECT * FROM lab_bookings WHERE id = ?', int(labId));
  if (!lb) throw new HttpError(404, 'Lab booking not found');
  const amount = money(body.amount);
  if (amount <= 0) bad('Enter the amount received');
  const mode = str(body.mode, 20) || 'Cash';
  const b = await erp(ctx, 'care_lab_payment', { trf_id: lb.trf_id, amount, mode, notes: str(body.reference, 80) ? `Ref ${str(body.reference, 80)}` : '' });
  tx(db, () => {
    upsert(db, b, { user, mode });
    audit(db, user.user, `payment:${amount}`, 'lab booking', lb.trf_id);
  });
  return present(row(db, `${LOCAL_SELECT} WHERE lb.id = ?`, lb.id));
}

function labTestCode(db, invoice, line, known) {
  const sent = str(line.item, 140);
  if (sent) return sent;
  const name = String(line.name || '').trim().toLowerCase();
  const hit = known.find((t) => t.item && String(t.item_name || t.item || '').trim().toLowerCase() === name);
  if (hit?.item) return hit.item;
  const svc = name ? row(db, "SELECT code FROM services WHERE category = 'lab' AND lower(name) = ? AND code IS NOT NULL AND code != '' LIMIT 1", name) : null;
  return svc?.code || '';
}

/* A manager changes the tests on a lab bill. The lab booking is updated first, then the Care invoice follows it.
   Paid money is capped at the new total; anything still unpaid shows as due. */
export async function reviseLabInvoice(ctx) {
  const { db, body, params, user } = ctx;
  const invoice = row(db, 'SELECT * FROM invoices WHERE id = ?', int(params.id));
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  if (!invoice.trf_id) bad('This is not a lab booking bill');
  if (invoice.status === 'Cancelled') bad('This invoice is cancelled');
  const draft = readBillItems(body, invoice);
  const lb = row(db, 'SELECT * FROM lab_bookings WHERE trf_id = ?', invoice.trf_id);
  const known = parse(lb?.tests, []);
  const tests = draft.map((line) => {
    const item = labTestCode(db, invoice, line, known);
    if (!item) bad(`“${line.name}” has to be chosen from the lab catalogue so the lab booking stays in step`);
    return { item, item_name: line.name, qty: line.qty, rate: line.rate };
  });
  const subtotal = money(tests.reduce((s, t) => s + t.qty * t.rate, 0));
  const percent = body.discount_type === 'percent';
  const discountValue = num(body.discount);
  if (discountValue < 0) bad('Discount cannot be negative');
  if (percent && discountValue > 100) bad('Percentage discount cannot be more than 100%');
  const discount = money(percent ? (subtotal * discountValue) / 100 : discountValue);
  if (discount > subtotal + 0.001) bad(`Discount cannot be more than the bill amount (₹${subtotal})`);
  const booking = await erp(ctx, 'care_lab_revise', { trf_id: invoice.trf_id, tests, discount });
  const lines = (booking.lines || tests).map((t) => {
    const qty = num(t.qty) || 1;
    const rate = money(t.rate);
    return { name: str(t.item_name || t.item, 160), item: t.item, qty, rate, amount: money(rate * qty) };
  });
  const net = money(booking.net_amount);
  const lineSubtotal = money(lines.reduce((s, t) => s + t.amount, 0));
  const appliedDiscount = Math.abs(lineSubtotal - discount - net) < 0.05 ? discount : money(Math.max(lineSubtotal - net, 0));
  const discountBody = Math.abs(appliedDiscount - discount) < 0.02
    ? { discount_type: body.discount_type, discount: body.discount }
    : { discount_type: 'flat', discount: appliedDiscount };
  tx(db, () => {
    applyInvoiceRevision(db, user, invoice, lines, discountBody);
    if (lb) {
      update(db, 'lab_bookings', lb.id, {
        tests: JSON.stringify(booking.lines || tests),
        net,
        paid: money(booking.paid_amount),
        due: money(booking.due_amount),
        payment_status: booking.payment_status || null,
        detail: JSON.stringify(booking),
        synced_at: stamp(),
      });
    }
  });
  return getInvoice({ db, params: { id: invoice.id } });
}

/* Payments recorded from Billing on a lab booking's invoice go to the lab booking first. */
export async function payLabInvoice(ctx, invoice) {
  const lb = row(ctx.db, 'SELECT id FROM lab_bookings WHERE trf_id = ?', invoice.trf_id);
  if (!lb) bad('The lab booking for this bill was not found; open Test & Lab to refresh it');
  await payLab(ctx, lb.id);
  return getInvoice({ db: ctx.db, params: { id: invoice.id } });
}

export async function labReport(ctx) {
  const lb = row(ctx.db, 'SELECT trf_id FROM lab_bookings WHERE id = ?', int(ctx.params.id));
  if (!lb) throw new HttpError(404, 'Lab booking not found');
  const res = await careLabReport(ctx.cfg, ctx.sid, lb.trf_id).catch((err) => ({ status: 502, error: err.message }));
  if (res.status !== 200) throw new HttpError(res.status === 401 || res.status === 403 || res.status === 404 ? res.status : 409, res.error || 'Report is not available');
  return { raw: { type: res.type, filename: res.filename, body: res.body } };
}

export function patientLabBookings(db, patientId) {
  return rows(db, `${LOCAL_SELECT} WHERE lb.patient_id = ? ORDER BY lb.booked_at DESC, lb.id DESC LIMIT 100`, patientId).map(present);
}

export function labCount(db, from, end, branch) {
  const b = int(branch);
  return row(
    db,
    `SELECT COUNT(*) AS n FROM lab_bookings WHERE substr(booked_at, 1, 10) >= ? AND substr(booked_at, 1, 10) < ? AND status != 'Cancelled'${b ? ' AND branch_id = ?' : ''}`,
    from, end, ...(b ? [b] : []),
  ).n;
}
