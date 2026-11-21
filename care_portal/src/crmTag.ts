/** Shared CRM tracking-tag helpers for Care / Aesthetic UI. */

const CRM_TAG_RE = /(?:\[CRM_TAG:)?(CRM-[A-Z0-9]{2,6}-[A-Z0-9-]{3,24})\]?/i;

export function extractCrmTag(...parts: Array<string | null | undefined>): string {
  for (const part of parts) {
    const m = CRM_TAG_RE.exec(String(part || ''));
    if (m) return m[1].toUpperCase();
  }
  return '';
}

/** Remove CRM tag / executive crumbs so Concern / Ref stay human-readable. */
export function stripCrmMeta(text: string | null | undefined): string {
  return String(text || '')
    .replace(/\[CRM_TAG:[^\]]+\]/gi, '')
    .replace(/\bExecutive:\s*[^·|]+/gi, '')
    .replace(/\s*[·|]\s*/g, ' · ')
    .replace(/^(?:\s*·\s*)+|(?:\s*·\s*)+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
