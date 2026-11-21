import { F } from './flavor';

const inrFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inrExact = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const inr = (value: number | null | undefined, exact = false) =>
  `₹${(exact ? inrExact : inrFormat).format(Number(value) || 0)}`;

export const num = (value: number | null | undefined) => inrFormat.format(Number(value) || 0);

export function lakh(value: number) {
  if (Math.abs(value) >= 100000) return `${(value / 100000).toFixed(value >= 1000000 ? 0 : 1).replace(/\.0$/, '')}L`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(0)}K`;
  return String(Math.round(value));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtDate(value: string | null | undefined, withYear = true) {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return value;
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`;
}

export function fmtDay(value: string) {
  const [y, m, d] = value.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[wd]}, ${d} ${MONTHS[m - 1]}`;
}

export function fmtTime(value: string | null | undefined) {
  if (!value) return '—';
  const [h, m] = value.slice(0, 5).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function fmtStamp(value: string | null | undefined) {
  if (!value) return '—';
  return `${fmtDate(value)}, ${fmtTime(value.slice(11, 16))}`;
}

export function initials(name: string) {
  return name
    .replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/* Today in India Standard Time as YYYY-MM-DD. */
export function todayIst() {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function nowTimeIst() {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(11, 16);
}

export const TYPE_LABEL: Record<string, string> = {
  consultation: 'Consultation',
  physiotherapy: F.service,
  lab: 'Lab Test',
  diagnostic: 'Diagnostics',
  pharmacy: 'Pharmacy',
  other: 'Other',
};

export function apptLabel(a: { type: string; service: string; session_no: number | null; total_sessions: number | null }) {
  if (a.type === 'physiotherapy' && a.session_no) return `${F.service} (Session ${a.session_no}/${a.total_sessions ?? '?'})`;
  if (a.type === 'lab') return `Lab Test (${a.service})`;
  if (a.type === 'diagnostic') return `Diagnostic (${a.service})`;
  return a.service;
}

export function downloadCsv(name: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
