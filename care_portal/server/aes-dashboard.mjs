/* Clinic console dashboard for the aesthetic flavour: every number comes from recorded data. */
import { addDays, row, rows, todayStr } from './db.mjs';

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* No comparison when the previous period had nothing; "+100%" from zero is not meaningful. */
function pct(now, before) {
  if (!before) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

function branchOf(q, col) {
  const id = Number.parseInt(q.branch, 10);
  return id > 0 ? { sql: ` AND ${col} = ?`, args: [id] } : { sql: '', args: [] };
}

function spanDays(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/* Day, week or month buckets so a short range is not one dot and a long range is not hundreds. */
function buckets(from, to) {
  const days = spanDays(from, to);
  const out = [];
  if (days <= 14) {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push({ from: d, to: d, label: short(d) });
  } else if (days <= 92) {
    for (let d = from; d <= to; d = addDays(d, 7)) {
      const end = addDays(d, 6) < to ? addDays(d, 6) : to;
      out.push({ from: d, to: end, label: short(d) });
    }
  } else {
    let d = from;
    while (d <= to) {
      const next = `${d.slice(0, 7)}-01`;
      const y = Number(next.slice(0, 4));
      const m = Number(next.slice(5, 7));
      const first = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const end = addDays(first, -1) < to ? addDays(first, -1) : to;
      out.push({ from: d, to: end, label: `${MONTHS[m - 1]} ${String(y).slice(2)}` });
      d = first;
    }
  }
  return out;
}

const STATUS_GROUP = {
  Completed: 'Completed',
  Reported: 'Completed',
  Cancelled: 'Cancelled',
  'No Show': 'No Show',
};

export function dashboard({ db, q }) {
  const today = todayStr();
  let from = isDate(q.from) ? q.from : `${today.slice(0, 8)}01`;
  let to = isDate(q.to) ? q.to : today;
  if (from > to) [from, to] = [to, from];
  const days = Math.min(spanDays(from, to), 366);
  if (days === 366) from = addDays(to, -365);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const end = addDays(to, 1);
  const prevEnd = from;

  const ab = branchOf(q, 'a.branch_id');
  const ib = branchOf(q, 'i.branch_id');

  const bookings = (a, z) => row(db, `SELECT COUNT(*) AS n FROM appointments a WHERE a.date >= ? AND a.date <= ?${ab.sql}`, a, z, ...ab.args).n;
  const completed = (a, z) => row(db, `SELECT COUNT(*) AS n FROM appointments a WHERE a.date >= ? AND a.date <= ? AND a.status IN ('Completed','Reported')${ab.sql}`, a, z, ...ab.args).n;
  const collected = (a, z, product) => row(
    db,
    `SELECT COALESCE(SUM(p.amount),0) AS amount FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE i.status != 'Cancelled' AND p.at >= ? AND p.at < ?
        AND ${product ? "i.service_type = 'pharmacy'" : "i.service_type != 'pharmacy'"}${ib.sql}`,
    a, z, ...ib.args,
  ).amount;

  const serviceNow = collected(from, end, false);
  const productNow = collected(from, end, true);
  const servicePrev = collected(prevFrom, prevEnd, false);
  const productPrev = collected(prevFrom, prevEnd, true);
  const bookNow = bookings(from, to);
  const doneNow = completed(from, to);

  const rb = branchOf(q, 'r.branch_id');
  const rating = row(
    db,
    `SELECT COUNT(*) AS n, AVG(r.rating) AS avg FROM reviews r WHERE substr(r.submitted_at,1,10) >= ? AND substr(r.submitted_at,1,10) <= ?${rb.sql}`,
    from, to, ...rb.args,
  );

  const series = buckets(from, to).map((b) => ({
    label: b.label,
    from: b.from,
    to: b.to,
    service: money(collected(b.from, addDays(b.to, 1), false)),
    product: money(collected(b.from, addDays(b.to, 1), true)),
  }));

  const status = { Scheduled: 0, Completed: 0, Cancelled: 0, 'No Show': 0 };
  for (const r of rows(db, `SELECT a.status, COUNT(*) AS n FROM appointments a WHERE a.date >= ? AND a.date <= ?${ab.sql} GROUP BY a.status`, from, to, ...ab.args)) {
    status[STATUS_GROUP[r.status] || 'Scheduled'] += r.n;
  }

  const activity = recent(db, q);

  return {
    from,
    to,
    kpis: {
      bookings: { value: bookNow, delta: pct(bookNow, bookings(prevFrom, prevTo)) },
      revenue: { value: money(serviceNow + productNow), delta: pct(serviceNow + productNow, servicePrev + productPrev) },
      completed: { value: doneNow, delta: pct(doneNow, completed(prevFrom, prevTo)) },
      products: { value: money(productNow), delta: pct(productNow, productPrev) },
      rating: { value: rating.n ? Math.round(rating.avg * 10) / 10 : null, count: rating.n },
    },
    series,
    status: Object.entries(status).map(([key, value]) => ({ key, value })),
    activity,
  };
}

function recent(db, q) {
  const ab = branchOf(q, 'a.branch_id');
  const ib = branchOf(q, 'i.branch_id');
  const vb = branchOf(q, 'v.branch_id');
  const rb = branchOf(q, 'r.branch_id');
  const list = [];
  for (const a of rows(
    db,
    `SELECT a.code, a.service, a.created_at, a.date, a.time, p.name AS patient, b.name AS branch
       FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN branches b ON b.id = a.branch_id
      WHERE a.created_at IS NOT NULL${ab.sql} ORDER BY a.created_at DESC, a.id DESC LIMIT 6`,
    ...ab.args,
  )) {
    list.push({ kind: 'booking', title: 'Booking created', detail: [a.patient, a.service, a.branch].filter(Boolean).join(' · '), at: a.created_at });
  }
  for (const p of rows(
    db,
    `SELECT p.amount, p.mode, p.at, i.number, COALESCE(pt.name, i.customer, 'Walk-in') AS patient
       FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN patients pt ON pt.id = i.patient_id
      WHERE p.at IS NOT NULL${ib.sql} ORDER BY p.at DESC, p.id DESC LIMIT 6`,
    ...ib.args,
  )) {
    const refund = Number(p.amount) < 0;
    list.push({
      kind: refund ? 'refund' : 'payment',
      title: refund ? 'Refund issued' : 'Payment received',
      detail: `₹${Math.abs(Math.round(p.amount)).toLocaleString('en-IN')} · ${p.number} · ${p.patient}${p.mode ? ` · ${p.mode}` : ''}`,
      at: p.at,
    });
  }
  let vouchers = [];
  try {
    vouchers = rows(
      db,
      `SELECT e.action, e.at, e.user, v.number, v.payee, v.amount FROM voucher_events e JOIN vouchers v ON v.id = e.voucher_id
        WHERE 1=1${vb.sql} ORDER BY e.at DESC, e.id DESC LIMIT 6`,
      ...vb.args,
    );
  } catch {
    vouchers = [];
  }
  for (const v of vouchers) {
    const verb = { submitted: 'Voucher submitted', resubmitted: 'Voucher resubmitted', approved: 'Voucher approved', rejected: 'Voucher rejected', paid: 'Voucher paid', cancelled: 'Voucher cancelled' }[v.action] || 'Voucher updated';
    list.push({ kind: 'voucher', title: verb, detail: `${v.number} · ${v.payee} · ₹${Math.round(v.amount).toLocaleString('en-IN')}${v.user ? ` · ${v.user}` : ''}`, at: v.at });
  }
  for (const r of rows(
    db,
    `SELECT r.rating, r.service, r.submitted_at, p.name AS patient FROM reviews r LEFT JOIN patients p ON p.id = r.patient_id
      WHERE r.submitted_at IS NOT NULL${rb.sql} ORDER BY r.submitted_at DESC LIMIT 4`,
    ...rb.args,
  )) {
    list.push({ kind: 'review', title: `${r.rating}★ review received`, detail: [r.patient, r.service].filter(Boolean).join(' · '), at: r.submitted_at });
  }
  return list.sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 6);
}
