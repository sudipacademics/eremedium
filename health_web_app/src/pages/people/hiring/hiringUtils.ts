import type { HireStage } from '../../../api';

export const HIRE_SOURCES = ['Naukri', 'WorkIndia', 'Careers', 'Referral', 'Walk-in', 'Other'] as const;
export const MANUAL_SOURCES = ['Naukri', 'WorkIndia', 'Referral', 'Walk-in', 'Other'] as const;
export const HIRE_STAGES: HireStage[] = ['New', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected', 'Withdrawn'];

export const STAGE_TONE: Record<HireStage, string> = {
  New: 'new',
  Screening: 'screening',
  Interview: 'interview',
  Offer: 'offer',
  Hired: 'hired',
  Rejected: 'closed',
  Withdrawn: 'closed',
};

export function errMsg(e: unknown, fallback = 'Something went wrong') {
  return e instanceof Error && e.message ? e.message : fallback;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

function toDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(value?: string | null) {
  const d = toDate(value);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

export function fmtDateTime(value?: string | null) {
  const d = toDate(value);
  return d
    ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';
}

export function fmtAgo(value?: string | null) {
  const d = toDate(value);
  if (!d) return '';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function inr(value?: number | null) {
  if (!value) return '—';
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

export function todayIso() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function localDateTimeToServer(value: string) {
  if (!value) return '';
  const [date, time = '00:00'] = value.split('T');
  return `${date} ${time.length === 5 ? `${time}:00` : time}`;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}
