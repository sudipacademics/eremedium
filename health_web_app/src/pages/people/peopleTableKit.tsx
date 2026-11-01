import { useState } from 'react';
import { HrmsIcon } from '../../components/HrmsIcons';
import { assetUrl } from '../../config';

export const PER_PAGE_OPTIONS = [10, 25, 50, 100];
const AVATAR_TONES = ['#4f46e5', '#0d9488', '#d97706', '#db2777', '#2563eb', '#16a34a', '#7c3aed', '#0891b2'];

export function initialsOf(name?: string) {
  return (
    String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('') || '?'
  );
}

export function toneOf(seed?: string | null) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

export function Avatar({ id, name, photo }: { id?: string | null; name?: string | null; photo?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (photo && !broken) {
    return <img className="emp-avatar" src={assetUrl(photo)} alt="" onError={() => setBroken(true)} />;
  }
  const tone = toneOf(id || name);
  return (
    <span className="emp-avatar" style={{ background: `${tone}1f`, color: tone }}>
      {initialsOf(name || undefined)}
    </span>
  );
}

function pageList(page: number, pages: number): Array<number | '…'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: Array<number | '…'> = [1];
  const start = Math.max(2, Math.min(page - 1, pages - 4));
  const end = Math.min(pages - 1, Math.max(page + 1, 5));
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i += 1) out.push(i);
  if (end < pages - 1) out.push('…');
  out.push(pages);
  return out;
}

function csvCell(value: unknown) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(name: string, header: string[], lines: unknown[][]) {
  const text = [header, ...lines].map((r) => r.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${text}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function escapeHtml(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
}

export function FilterDropdown({
  value,
  allLabel,
  options,
  onChange,
  label,
}: {
  value: string;
  allLabel: string;
  options: string[];
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <label className={`dsg-select${value ? ' active' : ''}`}>
      <span>{value || allLabel}</span>
      <HrmsIcon name="chevronDown" size={16} />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Pager({
  page,
  pages,
  perPage,
  onPage,
  onPerPage,
  summary,
}: {
  page: number;
  pages: number;
  perPage: number;
  onPage: (p: number) => void;
  onPerPage: (n: number) => void;
  summary: string;
}) {
  return (
    <footer className="emp-pager">
      <span>{summary}</span>
      <div className="emp-pager-right">
        <select value={perPage} onChange={(e) => onPerPage(Number(e.target.value))} aria-label="Rows per page">
          {PER_PAGE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} per page
            </option>
          ))}
        </select>
        <nav className="emp-pages" aria-label="Pagination">
          <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
            <HrmsIcon name="chevronRight" size={16} style={{ transform: 'rotate(180deg)' }} />
          </button>
          {pageList(page, pages).map((p, idx) =>
            p === '…' ? (
              <span key={`gap-${idx}`} className="emp-gap">
                …
              </span>
            ) : (
              <button key={p} type="button" className={p === page ? 'on' : ''} aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)}>
                {p}
              </button>
            ),
          )}
          <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
            <HrmsIcon name="chevronRight" size={16} />
          </button>
        </nav>
      </div>
    </footer>
  );
}
