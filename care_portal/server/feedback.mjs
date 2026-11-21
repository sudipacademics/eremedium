/* Patient feedback for the Aesthetic instance. Every completed session gets one feedback request with a random link
   token (only its SHA-256 is stored), sent by WhatsApp/SMS through clinical_aesthetic_feedback in the main ERP.
   Patients open https://remediumaesthetics.in/feedback/<token> without signing in and can answer once before the
   link expires. Reviews are never deleted; every send, open, answer and moderation step is kept in review_events. */
import crypto from 'node:crypto';
import { audit, getSettings, insert, nextSeq, nowIst, row, rows, run, stamp, tx, update } from './db.mjs';
import { HttpError } from './api.mjs';
import { erpRequest } from './erp.mjs';

export const LINK_BASE = 'https://remediumaesthetics.in/feedback/';
export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const DONE = ['Completed', 'Reported'];
const REVIEW_STATUSES = ['To Review', 'Published', 'Hidden', 'Flagged'];
const CHANNELS = ['whatsapp_sms', 'whatsapp', 'sms'];
const REQUEST_STATES = ['awaiting', 'expired', 'failed', 'not_sent', 'submitted'];

const bad = (message) => {
  throw new HttpError(400, message);
};
const int = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const like = (q) => `%${String(q).replace(/[%_]/g, '')}%`;
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const newToken = () => crypto.randomBytes(24).toString('base64url');
const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const later = (ms) => new Date(nowIst().getTime() + ms).toISOString().slice(0, 19).replace('T', ' ');
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);

export const linkFor = (token) => `${LINK_BASE}${token}`;

function mobileOf(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(-10);
  return /^[6-9]\d{9}$/.test(digits) ? digits : '';
}

export function feedbackSettings(db) {
  const s = getSettings(db);
  return {
    link_days: Math.min(Math.max(int(s.feedback_link_days) || 7, 1), 30),
    channel: CHANNELS.includes(s.feedback_channel) ? s.feedback_channel : 'whatsapp_sms',
    auto_send: s.feedback_auto_send !== '0',
    auto_publish: s.feedback_auto_publish === '1',
  };
}

function event(db, data) {
  insert(db, 'review_events', { request_id: null, review_id: null, user: null, note: null, ...data, at: stamp() });
}

const SESSION_SELECT = `SELECT a.id, a.code, a.type, a.service, a.status, a.date, a.time, a.session_no, a.plan_id, a.branch_id,
       a.patient_id, COALESCE(a.practitioner_id, t.practitioner_id) AS practitioner_id, t.code AS plan_code,
       t.total_sessions, p.name AS patient, p.mobile, p.code AS patient_code, b.name AS branch, pr.name AS staff
  FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN therapy_plans t ON t.id = a.plan_id
  LEFT JOIN branches b ON b.id = a.branch_id LEFT JOIN practitioners pr ON pr.id = COALESCE(a.practitioner_id, t.practitioner_id)`;

const REQUEST_SELECT = `SELECT f.*, a.code AS appointment_code, a.date AS session_date, a.time AS session_time,
       t.code AS plan_code, t.total_sessions, p.name AS patient, p.code AS patient_code, b.name AS branch, pr.name AS staff,
       r.id AS review_id, r.rating
  FROM feedback_requests f JOIN patients p ON p.id = f.patient_id LEFT JOIN appointments a ON a.id = f.appointment_id
  LEFT JOIN therapy_plans t ON t.id = f.plan_id LEFT JOIN branches b ON b.id = f.branch_id
  LEFT JOIN practitioners pr ON pr.id = f.practitioner_id LEFT JOIN reviews r ON r.request_id = f.id`;

const REVIEW_SELECT = `SELECT r.*, p.name AS patient, p.code AS patient_code, p.mobile, a.code AS appointment_code,
       a.date AS session_date, a.time AS session_time, t.code AS plan_code, t.total_sessions, b.name AS branch,
       pr.name AS staff, f.channel, f.sent_at
  FROM reviews r JOIN patients p ON p.id = r.patient_id LEFT JOIN appointments a ON a.id = r.appointment_id
  LEFT JOIN therapy_plans t ON t.id = r.plan_id LEFT JOIN branches b ON b.id = r.branch_id
  LEFT JOIN practitioners pr ON pr.id = r.practitioner_id LEFT JOIN feedback_requests f ON f.id = r.request_id`;

function requestState(r, now = stamp()) {
  if (r.status === 'Submitted') return 'submitted';
  if (r.status === 'Failed') return 'failed';
  if (r.status === 'Not sent') return 'not_sent';
  if (r.status === 'Sending') return 'sending';
  return r.expires_at && r.expires_at < now ? 'expired' : 'awaiting';
}

const withState = (r) => (r ? { ...r, token_hash: undefined, state: requestState(r) } : r);

/* One request per completed session. Returns { id, token, send } when a new one is made. */
export function createRequest(db, appointmentId, user, { send = true, note = null } = {}) {
  const a = row(db, `${SESSION_SELECT} WHERE a.id = ?`, appointmentId);
  if (!a || a.type === 'lab' || !DONE.includes(a.status)) return null;
  if (row(db, 'SELECT id FROM feedback_requests WHERE appointment_id = ?', a.id)) return null;
  const settings = feedbackSettings(db);
  const mobile = mobileOf(a.mobile);
  const sending = Boolean(mobile && send && settings.auto_send);
  const token = newToken();
  const id = insert(db, 'feedback_requests', {
    token_hash: hash(token), appointment_id: a.id, patient_id: a.patient_id, plan_id: a.plan_id, session_no: a.session_no,
    service: a.service, branch_id: a.branch_id, practitioner_id: a.practitioner_id, mobile: mobile || null,
    status: sending ? 'Sending' : 'Not sent',
    send_error: !mobile ? 'No valid 10-digit mobile number on the patient' : sending ? null : note || 'Automatic sending is off',
    expires_at: sending ? later(settings.link_days * 86400000) : null,
    created_at: stamp(), created_by: user, updated_at: stamp(),
  });
  event(db, { request_id: id, user, action: 'requested', note: `${a.code}${a.session_no ? ` · session ${a.session_no}` : ''}` });
  return { id, token, send: sending };
}

/* Completed sessions that have no request yet (for example completed before this feature) get one marked Not sent;
   sends cut short by a restart are marked Failed so they can be resent. */
export function ensureRequests(db) {
  const missing = rows(
    db,
    `SELECT a.id FROM appointments a WHERE a.status IN ('Completed', 'Reported') AND a.type != 'lab'
        AND NOT EXISTS (SELECT 1 FROM feedback_requests f WHERE f.appointment_id = a.id)`,
  );
  for (const m of missing) createRequest(db, m.id, 'system', { send: false, note: 'Completed before feedback links were switched on' });
  run(
    db,
    "UPDATE feedback_requests SET status = 'Failed', send_error = 'Sending was interrupted', updated_at = ? WHERE status = 'Sending' AND updated_at < ?",
    stamp(),
    later(-10 * 60000),
  );
  return missing.length;
}

function renew(db, requestId, status) {
  const token = newToken();
  update(db, 'feedback_requests', requestId, {
    token_hash: hash(token), status, send_error: null, expires_at: later(feedbackSettings(db).link_days * 86400000), updated_at: stamp(),
  });
  return token;
}

const plain = (text) => String(text || '').replace(/<[^>]+>/g, '').trim();

/* Sends the link through the ERP as the signed-in staff member and records the outcome. */
export async function dispatch({ db, cfg, sid }, requestId, token) {
  const r = row(db, `${REQUEST_SELECT} WHERE f.id = ?`, requestId);
  const settings = feedbackSettings(db);
  const payload = {
    mobile: r.mobile, name: r.patient, service: r.service, branch: r.branch, session_no: r.session_no,
    link: linkFor(token), valid_days: settings.link_days, channel: settings.channel,
  };
  let outcome;
  try {
    const res = await erpRequest(cfg, 'clinical_aesthetic_feedback.aesthetic_feedback_send', {
      form: { sid, data: JSON.stringify(payload) }, sid, timeout: 30000,
    });
    outcome = res.status === 200 && res.message && res.message.status === 'success'
      ? { ok: true, data: res.data || {} }
      : { ok: false, error: plain(res.message && res.message.message) || `Messaging service returned ${res.status}` };
  } catch {
    outcome = { ok: false, error: 'Messaging service is not reachable' };
  }
  const attempts = (r.send_attempts || 0) + 1;
  if (outcome.ok) {
    const channel = outcome.data.test_mode ? 'whatsapp-test' : outcome.data.channel || 'whatsapp';
    update(db, 'feedback_requests', requestId, { status: 'Sent', channel, sent_at: stamp(), send_error: null, send_attempts: attempts, updated_at: stamp() });
    event(db, { request_id: requestId, user: 'system', action: 'sent', note: channel === 'whatsapp-test' ? 'WhatsApp (test mode, not delivered)' : channel === 'sms' ? 'SMS' : 'WhatsApp' });
  } else {
    update(db, 'feedback_requests', requestId, { status: 'Failed', send_error: outcome.error.slice(0, 300), send_attempts: attempts, updated_at: stamp() });
    event(db, { request_id: requestId, user: 'system', action: 'send failed', note: outcome.error.slice(0, 300) });
  }
  return withState(row(db, `${REQUEST_SELECT} WHERE f.id = ?`, requestId));
}

/* Called after PATCH /appointments/:id. Never lets a feedback problem undo the completed session. */
export function afterAppointment(ctx, appointment) {
  if (!appointment || !DONE.includes(appointment.status)) return;
  try {
    const made = createRequest(ctx.db, appointment.id, ctx.user.user);
    if (made && made.send) {
      dispatch(ctx, made.id, made.token).catch((err) => console.error(new Date().toISOString(), 'feedback send failed', err.message));
    }
  } catch (err) {
    console.error(new Date().toISOString(), 'feedback request failed', err.message);
  }
}

/* ---------------------------------------------------------------- public link (no sign-in) */

const hits = new Map();
export function throttle(ip, kind, max, windowMs = 15 * 60000) {
  const key = `${kind}:${ip}`;
  const now = Date.now();
  const hit = hits.get(key);
  if (!hit || hit.reset < now) hits.set(key, { count: 1, reset: now + windowMs });
  else if (++hit.count > max) throw new HttpError(429, 'Too many attempts. Please try again in a few minutes.');
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
}

function byToken(db, token) {
  if (!TOKEN_RE.test(String(token || ''))) throw new HttpError(404, 'This feedback link is not valid.');
  const r = row(db, `${REQUEST_SELECT} WHERE f.token_hash = ?`, hash(token));
  if (!r || r.status === 'Not sent' || (r.status === 'Failed' && !r.sent_at)) throw new HttpError(404, 'This feedback link is not valid.');
  return r;
}

function publicShape(r) {
  const state = requestState(r) === 'submitted' ? 'submitted' : r.expires_at && r.expires_at < stamp() ? 'expired' : 'open';
  return {
    state,
    clinic: 'Remedium Aesthetic',
    branch: r.branch || null,
    service: r.service || null,
    session_no: r.session_no || null,
    total_sessions: r.total_sessions || null,
    date: r.session_date || null,
    staff: first(r.staff) || null,
    patient: first(r.patient) || null,
    expires_at: r.expires_at,
    rating: state === 'submitted' ? r.rating : null,
  };
}

export function publicView(db, token) {
  const r = byToken(db, token);
  if (!r.opened_at) {
    update(db, 'feedback_requests', r.id, { opened_at: stamp() });
    event(db, { request_id: r.id, user: 'patient', action: 'opened' });
  }
  return publicShape(r);
}

export function publicSubmit(db, token, body) {
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) bad('Choose a rating from 1 to 5 stars');
  const feedback = clean(body.feedback, 1500);
  if (feedback.length < 3) bad('Please write a few words about your visit');
  const suggestions = clean(body.suggestions, 1500) || null;
  return tx(db, () => {
    const r = byToken(db, token);
    if (r.status === 'Submitted' || r.review_id) throw new HttpError(409, 'Feedback for this session has already been received. Thank you!');
    if (r.expires_at && r.expires_at < stamp()) throw new HttpError(410, 'This feedback link has expired.');
    const status = feedbackSettings(db).auto_publish && rating >= 4 ? 'Published' : 'To Review';
    const code = `RV-${String(nextSeq(db, 'review')).padStart(5, '0')}`;
    const id = insert(db, 'reviews', {
      code, request_id: r.id, appointment_id: r.appointment_id, patient_id: r.patient_id, plan_id: r.plan_id,
      session_no: r.session_no, service: r.service, branch_id: r.branch_id, practitioner_id: r.practitioner_id,
      rating, feedback, suggestions, status, submitted_at: stamp(),
    });
    update(db, 'feedback_requests', r.id, { status: 'Submitted', submitted_at: stamp(), updated_at: stamp() });
    event(db, { request_id: r.id, review_id: id, user: 'patient', action: 'submitted', note: `${rating} star${rating === 1 ? '' : 's'}` });
    if (status === 'Published') event(db, { request_id: r.id, review_id: id, user: 'system', action: 'published', note: 'Published automatically (4–5 stars)' });
    return publicShape({ ...r, status: 'Submitted', rating });
  });
}

/* ---------------------------------------------------------------- admin */

function range(q, col, where, args) {
  if (isDate(q.from)) {
    where.push(`substr(${col}, 1, 10) >= ?`);
    args.push(q.from);
  }
  if (isDate(q.to)) {
    where.push(`substr(${col}, 1, 10) <= ?`);
    args.push(q.to);
  }
}

function reviewFilter(q) {
  const where = ['1=1'];
  const args = [];
  if (int(q.branch)) {
    where.push('r.branch_id = ?');
    args.push(int(q.branch));
  }
  if (REVIEW_STATUSES.includes(q.status)) {
    where.push('r.status = ?');
    args.push(q.status);
  }
  if (q.rating === 'positive') where.push('r.rating >= 4');
  else if (q.rating === 'attention') where.push('r.rating <= 3');
  else if (int(q.rating) >= 1 && int(q.rating) <= 5) {
    where.push('r.rating = ?');
    args.push(int(q.rating));
  }
  if (q.service) {
    where.push('r.service = ?');
    args.push(String(q.service).slice(0, 200));
  }
  range(q, 'r.submitted_at', where, args);
  if (q.q && String(q.q).trim()) {
    const term = like(String(q.q).trim().slice(0, 80));
    where.push('(p.name LIKE ? OR p.code LIKE ? OR p.mobile LIKE ? OR a.code LIKE ? OR t.code LIKE ? OR r.code LIKE ? OR r.service LIKE ? OR r.feedback LIKE ?)');
    args.push(term, term, term, term, term, term, term, term);
  }
  return { sql: where.join(' AND '), args };
}

const masked = (m) => (m && m.length >= 10 ? `${m.slice(0, 2)}XXXX${m.slice(-4)}` : m || null);

export function listReviews({ db, q }) {
  ensureRequests(db);
  const f = reviewFilter(q);
  const limit = Math.min(Math.max(int(q.limit) || 10, 1), 500);
  const offset = Math.max(int(q.offset), 0);
  const from = `FROM reviews r JOIN patients p ON p.id = r.patient_id LEFT JOIN appointments a ON a.id = r.appointment_id LEFT JOIN therapy_plans t ON t.id = r.plan_id`;
  const total = row(db, `SELECT COUNT(*) AS n ${from} WHERE ${f.sql}`, ...f.args).n;
  const list = rows(db, `${REVIEW_SELECT} WHERE ${f.sql} ORDER BY r.submitted_at DESC, r.id DESC LIMIT ? OFFSET ?`, ...f.args, limit, offset);
  return {
    rows: list.map((r) => ({ ...r, mobile: masked(r.mobile) })),
    total,
    services: rows(db, "SELECT DISTINCT service FROM feedback_requests WHERE service IS NOT NULL AND service != '' ORDER BY service").map((s) => s.service),
  };
}

export function feedbackSummary({ db, q }) {
  ensureRequests(db);
  const branch = int(q.branch);
  const rw = ['1=1'];
  const ra = [];
  if (branch) {
    rw.push('r.branch_id = ?');
    ra.push(branch);
  }
  range(q, 'r.submitted_at', rw, ra);
  const rv = row(
    db,
    `SELECT COUNT(*) AS total, AVG(r.rating) AS average, SUM(CASE WHEN r.rating >= 4 THEN 1 ELSE 0 END) AS positive,
            SUM(CASE WHEN r.rating <= 3 THEN 1 ELSE 0 END) AS attention,
            SUM(CASE WHEN r.status = 'To Review' THEN 1 ELSE 0 END) AS to_review,
            SUM(CASE WHEN r.status = 'Published' THEN 1 ELSE 0 END) AS published,
            SUM(CASE WHEN r.status = 'Hidden' THEN 1 ELSE 0 END) AS hidden,
            SUM(CASE WHEN r.status = 'Flagged' THEN 1 ELSE 0 END) AS flagged
       FROM reviews r WHERE ${rw.join(' AND ')}`,
    ...ra,
  );
  const stars = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, 0]));
  for (const s of rows(db, `SELECT r.rating, COUNT(*) AS n FROM reviews r WHERE ${rw.join(' AND ')} GROUP BY r.rating`, ...ra)) stars[s.rating] = s.n;

  const fw = ['1=1'];
  const fa = [];
  if (branch) {
    fw.push('f.branch_id = ?');
    fa.push(branch);
  }
  range(q, 'f.created_at', fw, fa);
  const now = stamp();
  const fq = row(
    db,
    `SELECT COUNT(*) AS requested,
            SUM(CASE WHEN f.sent_at IS NOT NULL THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN f.status = 'Submitted' THEN 1 ELSE 0 END) AS submitted,
            SUM(CASE WHEN f.status = 'Sent' AND (f.expires_at IS NULL OR f.expires_at >= ?) THEN 1 ELSE 0 END) AS awaiting,
            SUM(CASE WHEN f.status = 'Sent' AND f.expires_at < ? THEN 1 ELSE 0 END) AS expired,
            SUM(CASE WHEN f.status = 'Failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN f.status = 'Not sent' THEN 1 ELSE 0 END) AS not_sent,
            SUM(CASE WHEN f.channel = 'whatsapp-test' AND f.status = 'Sent' THEN 1 ELSE 0 END) AS test_mode
       FROM feedback_requests f WHERE ${fw.join(' AND ')}`,
    now,
    now,
    ...fa,
  );
  const delivered = fq.delivered || 0;
  return {
    reviews: {
      total: rv.total || 0,
      average: rv.total ? Math.round(rv.average * 10) / 10 : 0,
      positive: rv.positive || 0,
      attention: rv.attention || 0,
      to_review: rv.to_review || 0,
      published: rv.published || 0,
      hidden: rv.hidden || 0,
      flagged: rv.flagged || 0,
      stars,
    },
    requests: {
      requested: fq.requested || 0,
      delivered,
      submitted: fq.submitted || 0,
      awaiting: fq.awaiting || 0,
      expired: fq.expired || 0,
      failed: fq.failed || 0,
      not_sent: fq.not_sent || 0,
      test_mode: fq.test_mode || 0,
      response_rate: delivered ? Math.round(((fq.submitted || 0) / delivered) * 1000) / 10 : 0,
    },
  };
}

export function listRequests({ db, q }) {
  ensureRequests(db);
  const where = ['1=1'];
  const args = [];
  const now = stamp();
  if (int(q.branch)) {
    where.push('f.branch_id = ?');
    args.push(int(q.branch));
  }
  if (REQUEST_STATES.includes(q.state)) {
    if (q.state === 'awaiting') {
      where.push("f.status = 'Sent' AND (f.expires_at IS NULL OR f.expires_at >= ?)");
      args.push(now);
    } else if (q.state === 'expired') {
      where.push("f.status = 'Sent' AND f.expires_at < ?");
      args.push(now);
    } else {
      where.push('f.status = ?');
      args.push({ failed: 'Failed', not_sent: 'Not sent', submitted: 'Submitted' }[q.state]);
    }
  }
  range(q, 'f.created_at', where, args);
  if (q.q && String(q.q).trim()) {
    const term = like(String(q.q).trim().slice(0, 80));
    where.push('(p.name LIKE ? OR p.code LIKE ? OR f.mobile LIKE ? OR a.code LIKE ? OR t.code LIKE ? OR f.service LIKE ?)');
    args.push(term, term, term, term, term, term);
  }
  const limit = Math.min(Math.max(int(q.limit) || 10, 1), 500);
  const offset = Math.max(int(q.offset), 0);
  const from = `FROM feedback_requests f JOIN patients p ON p.id = f.patient_id LEFT JOIN appointments a ON a.id = f.appointment_id LEFT JOIN therapy_plans t ON t.id = f.plan_id`;
  const total = row(db, `SELECT COUNT(*) AS n ${from} WHERE ${where.join(' AND ')}`, ...args).n;
  const list = rows(db, `${REQUEST_SELECT} WHERE ${where.join(' AND ')} ORDER BY f.id DESC LIMIT ? OFFSET ?`, ...args, limit, offset);
  return { rows: list.map((r) => ({ ...withState(r), mobile: masked(r.mobile) })), total };
}

export function getReview({ db, params }) {
  const r = row(db, `${REVIEW_SELECT} WHERE r.id = ?`, int(params.id));
  if (!r) throw new HttpError(404, 'Review not found');
  return {
    review: r,
    request: withState(row(db, `${REQUEST_SELECT} WHERE f.id = ?`, r.request_id)),
    events: rows(db, 'SELECT * FROM review_events WHERE review_id = ? OR request_id = ? ORDER BY id', r.id, r.request_id),
    history: rows(
      db,
      `SELECT r.id, r.code, r.rating, r.service, r.session_no, r.status, r.submitted_at, t.code AS plan_code
         FROM reviews r LEFT JOIN therapy_plans t ON t.id = r.plan_id WHERE r.patient_id = ? ORDER BY r.submitted_at DESC, r.id DESC LIMIT 50`,
      r.patient_id,
    ),
  };
}

const ACTIONS = { Published: 'published', Hidden: 'hidden', Flagged: 'flagged', 'To Review': 'moved back to review' };

export function moderateReview({ db, params, body, user }) {
  const r = row(db, 'SELECT * FROM reviews WHERE id = ?', int(params.id));
  if (!r) throw new HttpError(404, 'Review not found');
  const status = REVIEW_STATUSES.includes(body.status) ? body.status : bad(`Status must be one of: ${REVIEW_STATUSES.join(', ')}`);
  const note = clean(body.note, 300) || null;
  if (status === 'Flagged' && !note) bad('Say why this review is flagged');
  if (status === r.status && status !== 'Flagged') return getReview({ db, params });
  tx(db, () => {
    update(db, 'reviews', r.id, { status, flag_reason: status === 'Flagged' ? note : r.flag_reason, moderated_at: stamp(), moderated_by: user.user });
    event(db, { request_id: r.request_id, review_id: r.id, user: user.user, action: ACTIONS[status], note });
    audit(db, user.user, `review:${status}`, 'review', r.code);
  });
  return getReview({ db, params });
}

function openRequest(db, params) {
  const r = row(db, `${REQUEST_SELECT} WHERE f.id = ?`, int(params.id));
  if (!r) throw new HttpError(404, 'Feedback request not found');
  if (r.status === 'Submitted' || r.review_id) bad('Feedback for this session is already in');
  return r;
}

/* New link (the previous one stops working), sent now. */
export async function sendRequest(ctx) {
  const { db, params, user } = ctx;
  const r = openRequest(db, params);
  const patient = row(db, 'SELECT mobile FROM patients WHERE id = ?', r.patient_id);
  const mobile = mobileOf(patient && patient.mobile);
  if (!mobile) bad('Add a valid 10-digit mobile number to the patient first');
  if (r.status === 'Sending' && r.updated_at > later(-60000)) bad('This link is being sent right now');
  const token = tx(db, () => {
    if (mobile !== r.mobile) update(db, 'feedback_requests', r.id, { mobile });
    const t = renew(db, r.id, 'Sending');
    event(db, { request_id: r.id, user: user.user, action: r.sent_at ? 'resent' : 'send requested' });
    return t;
  });
  return dispatch(ctx, r.id, token);
}

/* New link for staff to share by hand (the previous one stops working). */
export function copyLink({ db, params, user }) {
  const r = openRequest(db, params);
  const token = tx(db, () => {
    const t = renew(db, r.id, 'Sent');
    update(db, 'feedback_requests', r.id, { channel: 'link', sent_at: stamp() });
    event(db, { request_id: r.id, user: user.user, action: 'link copied', note: 'Shared by staff' });
    return t;
  });
  const fresh = withState(row(db, `${REQUEST_SELECT} WHERE f.id = ?`, r.id));
  return { link: linkFor(token), request: { ...fresh, mobile: masked(fresh.mobile) } };
}

export function readSettings({ db }) {
  return { ...feedbackSettings(db), link_base: LINK_BASE };
}

export function saveSettings({ db, body, user, can }) {
  if (!can('Bookings', 'manage') && !can('Settings', 'edit')) throw new HttpError(403, 'You need manage access to Bookings or edit access to Settings');
  const days = int(body.link_days);
  if (days < 1 || days > 30) bad('Links can stay open for 1 to 30 days');
  if (!CHANNELS.includes(body.channel)) bad('Choose how the link is sent');
  const values = {
    feedback_link_days: String(days),
    feedback_channel: body.channel,
    feedback_auto_send: body.auto_send === false ? '0' : '1',
    feedback_auto_publish: body.auto_publish === true ? '1' : '0',
  };
  tx(db, () => {
    for (const [key, value] of Object.entries(values)) {
      run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
    }
    audit(db, user.user, 'update', 'feedback settings', JSON.stringify(values));
  });
  return readSettings({ db });
}

export async function deliveryStatus({ cfg, sid }) {
  try {
    const res = await erpRequest(cfg, 'clinical_aesthetic_feedback.aesthetic_feedback_status', { form: { sid, data: '{}' }, sid });
    if (res.status === 200 && res.message && res.message.status === 'success') return res.data;
    return { error: plain(res.message && res.message.message) || `Messaging service returned ${res.status}` };
  } catch {
    return { error: 'Messaging service is not reachable' };
  }
}
