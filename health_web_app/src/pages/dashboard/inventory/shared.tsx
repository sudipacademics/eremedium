import { createContext, ReactNode, useContext, useEffect, useRef } from 'react';
import type { InvExportFile, InvItem, InvItemStatus, InvMeta } from '../../../types/labInventory';

export type InvContextValue = {
  meta: InvMeta | null;
  canManage: boolean;
  catalog: InvItem[];
  version: number;
  refreshAll: () => void;
  notify: (msg: string) => void;
  fail: (err: unknown) => void;
};

export const InvContext = createContext<InvContextValue | null>(null);

export function useInv() {
  const ctx = useContext(InvContext);
  if (!ctx) throw new Error('InvContext missing');
  return ctx;
}

export function errMsg(err: unknown, fallback = 'Something went wrong') {
  return err instanceof Error ? err.message : fallback;
}

export function fmtQty(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

export function fmtDate(raw?: string | null) {
  if (!raw) return '—';
  const d = new Date(String(raw).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? String(raw) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(raw?: string | null) {
  if (!raw) return '—';
  const d = new Date(String(raw).replace(' ', 'T'));
  return Number.isNaN(d.getTime())
    ? String(raw)
    : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

export function isoDate(d: Date) {
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayIso() {
  return isoDate(new Date());
}

export function addDaysIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function monthStartIso() {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function downloadExport(file: InvExportFile) {
  const bytes = Uint8Array.from(atob(file.content_base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimetype }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const ITEM_TONES: Record<InvItemStatus, string> = {
  'In Stock': 'green',
  'Low Stock': 'amber',
  'Expiring Soon': 'orange',
  'Out of Stock': 'red',
  Expired: 'muted-red',
};

export function StockPill({ status }: { status: InvItemStatus }) {
  return <span className={`inv-pill tone-${ITEM_TONES[status] || 'muted'}`}>{status}</span>;
}

const REQ_TONES: Record<string, string> = {
  Submitted: 'blue',
  Approved: 'green',
  'Partially Approved': 'teal',
  Rejected: 'red',
  Preparing: 'purple',
  'Partially Dispatched': 'orange',
  Dispatched: 'amber',
  Received: 'green',
  Cancelled: 'muted',
};

export function ReqPill({ status }: { status: string }) {
  return <span className={`inv-pill tone-${REQ_TONES[status] || 'muted'}`}>{status}</span>;
}

export function DispatchPill({ status }: { status: string }) {
  const tone = status === 'Received' ? 'green' : status === 'Cancelled' ? 'muted' : 'amber';
  return <span className={`inv-pill tone-${tone}`}>{status === 'Dispatched' ? 'In transit' : status}</span>;
}

export function TxnQty({ value, unit }: { value: number; unit?: string }) {
  return (
    <span className={value >= 0 ? 'inv-pos' : 'inv-neg'}>
      {value > 0 ? '+' : ''}
      {fmtQty(value)}
      {unit ? <small> {unit}</small> : null}
    </span>
  );
}

export function Modal({
  title,
  sub,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="inv-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`inv-modal${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="inv-modal-head">
          <div>
            <h3>{title}</h3>
            {sub ? <p className="inv-modal-sub">{sub}</p> : null}
          </div>
          <button type="button" className="inv-icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="inv-modal-body">{children}</div>
        {footer ? <div className="inv-modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function RowMenu({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onToggle();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onToggle]);
  return (
    <div className="lt-row-menu" ref={ref}>
      <button type="button" className="lt-kebab" aria-label="More actions" aria-expanded={open} onClick={onToggle}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
      {open ? (
        <div className="lt-row-menu-pop" role="menu" onClick={onToggle}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function pageWindow(page: number, pages: number): Array<number | '…'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: Array<number | '…'> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i += 1) out.push(i);
  if (end < pages - 1) out.push('…');
  out.push(pages);
  return out;
}

export function Pager({
  page,
  pageSize,
  total,
  noun,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  onPage: (p: number) => void;
  onPageSize?: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="lt-table-foot">
      <span>
        Showing {from} to {to} of {total.toLocaleString('en-IN')} {noun}
      </span>
      <div className="lt-foot-right">
        <div className="lt-pager">
          <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
            ‹
          </button>
          {pageWindow(page, pages).map((p, i) =>
            p === '…' ? (
              <button type="button" key={`gap-${i}`} disabled>
                …
              </button>
            ) : (
              <button type="button" key={p} className={p === page ? 'is-active' : ''} onClick={() => onPage(p)}>
                {p}
              </button>
            ),
          )}
          <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
            ›
          </button>
        </div>
        {onPageSize ? (
          <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Rows per page">
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}

export function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export const INV_ICONS = {
  box: (
    <>
      <path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </>
  ),
  stack: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.8" />
      <path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6" />
    </>
  ),
  warn: (
    <>
      <path d="M12 3.5 2.8 19.5h18.4z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4M10 14l4 3M14 14l-4 3" />
    </>
  ),
  doc: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  truck: (
    <>
      <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" />
      <circle cx="7" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </>
  ),
  list: (
    <>
      <path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9z" />
      <path d="M3.5 7.5 12 12l8.5-4.5" />
    </>
  ),
  stockIn: (
    <>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 17v3h16v-3" />
    </>
  ),
  adjust: (
    <>
      <path d="M4 8h12M13 5l3 3-3 3M20 16H8M11 13l-3 3 3 3" />
    </>
  ),
  requisition: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4M12 8v4l3 2" />
    </>
  ),
  reports: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  download: (
    <>
      <path d="M12 4v11M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </>
  ),
};

const THUMB_TONES = ['#e0f2fe', '#fef3c7', '#ede9fe', '#dcfce7', '#fee2e2', '#e0e7ff'];

export function ItemThumb({ name, category }: { name: string; category?: string }) {
  const seed = (category || name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span className="inv-thumb" style={{ background: THUMB_TONES[seed % THUMB_TONES.length] }} aria-hidden>
      {initials}
    </span>
  );
}

export function ItemSelect({
  value,
  onChange,
  required,
  placeholder = 'Select item…',
}: {
  value: string;
  onChange: (item: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  const { catalog } = useInv();
  return (
    <select className="inv-input" value={value} required={required} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {catalog.map((it) => (
        <option key={it.name} value={it.name}>
          {it.item_name} · {it.sku} ({fmtQty(it.available_qty)} {it.unit})
        </option>
      ))}
    </select>
  );
}
