/** Shared patient age (Years / Months / Days) formatting. */

export type PatientAgeParts = {
  age?: number | string | null;
  age_years?: number | string | null;
  age_months?: number | string | null;
  age_days?: number | string | null;
  ageMonths?: number | string | null;
  ageDays?: number | string | null;
};

function agePart(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

export function parseAgeInput(raw: string): string | null {
  if (raw === '') return '';
  if (!/^\d+$/.test(raw)) return null;
  return raw;
}

export function formatPatientAge(parts: PatientAgeParts | string | number | null | undefined): string {
  if (parts == null || parts === '') return '';
  if (typeof parts === 'string' || typeof parts === 'number') {
    const years = agePart(parts);
    return years ? `${years} Year${years === 1 ? '' : 's'}` : '';
  }
  const years = agePart(parts.age_years ?? parts.age);
  const months = agePart(parts.age_months ?? parts.ageMonths);
  const days = agePart(parts.age_days ?? parts.ageDays);
  const out: string[] = [];
  if (years) out.push(`${years} Year${years === 1 ? '' : 's'}`);
  if (months) out.push(`${months} Month${months === 1 ? '' : 's'}`);
  if (days) out.push(`${days} Day${days === 1 ? '' : 's'}`);
  return out.join(' ');
}
