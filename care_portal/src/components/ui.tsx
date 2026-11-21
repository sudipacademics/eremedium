import { useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { TYPE_LABEL } from '../format';

const STATUS_TONE: Record<string, string> = {
  Scheduled: 'indigo',
  'Checked In': 'green',
  'In Session': 'blue',
  Waiting: 'orange',
  'Sample Collected': 'purple',
  'Report Pending': 'purple',
  Completed: 'teal',
  Reported: 'teal',
  Cancelled: 'red',
  'No Show': 'red',
  Paid: 'green',
  'Partially Paid': 'orange',
  Unpaid: 'red',
  Active: 'green',
  'On Hold': 'orange',
  Discontinued: 'red',
  Working: 'green',
  'Under Maintenance': 'orange',
  'Out of Order': 'red',
  Retired: 'grey',
};

const TYPE_TONE: Record<string, string> = {
  consultation: 'green',
  physiotherapy: 'purple',
  lab: 'blue',
  diagnostic: 'teal',
  pharmacy: 'orange',
  other: 'grey',
};

export function Pill({ status, tone, children }: { status?: string; tone?: string; children?: ReactNode }) {
  return <span className={`pill pill-${tone || (status && STATUS_TONE[status]) || 'grey'}`}>{children ?? status}</span>;
}

export function TypePill({ type }: { type: string }) {
  return <span className={`pill pill-soft pill-${TYPE_TONE[type] || 'grey'}`}>{TYPE_LABEL[type] || type}</span>;
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, icon, actions }: { title: string; subtitle?: string; icon?: IconName; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-title">
        {icon && (
          <span className="page-icon">
            <Icon name={icon} size={22} />
          </span>
        )}
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          className={tab.value === value ? 'tab active' : 'tab'}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined && ` (${tab.count})`}
        </button>
      ))}
    </div>
  );
}

export function Empty({ text, icon = 'clipboard' }: { text: string; icon?: IconName }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <p>{text}</p>
    </div>
  );
}

export function Loading() {
  return <div className="loading">Loading…</div>;
}

export function ErrorNote({ text }: { text: string }) {
  return (
    <div className="error-note">
      <Icon name="alert" size={16} /> {text}
    </div>
  );
}

/* `group` renders a <div role="group"> instead of a <label>: a label forwards every click inside it to its first
   control, which breaks fields that contain several buttons (chips, toggles, pickers). */
export function Field({ label, children, hint, span, group }: { label: string; children: ReactNode; hint?: string; span?: 2; group?: boolean }) {
  const className = `field ${span === 2 ? 'span-2' : ''}`;
  if (group) {
    return (
      <div className={className} role="group" aria-label={label}>
        <span>{label}</span>
        {children}
        {hint && <small>{hint}</small>}
      </div>
    );
  }
  return (
    <label className={className}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="searchbox">
      <Icon name="search" size={16} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {value && (
        <button type="button" className="icon-btn sm" onClick={() => onChange('')} aria-label="Clear search">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

export function StatCard({ label, value, icon, tone, foot }: { label: string; value: ReactNode; icon: IconName; tone: string; foot?: ReactNode }) {
  return (
    <div className={`stat stat-${tone}`}>
      <span className="stat-icon">
        <Icon name={icon} size={22} />
      </span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        {foot && <small>{foot}</small>}
      </div>
    </div>
  );
}

export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  return (
    <div className="pager">
      <span>
        {offset + 1}–{Math.min(offset + limit, total)} of {total}
      </span>
      <button type="button" className="btn btn-ghost sm" disabled={offset === 0} onClick={() => onChange(Math.max(offset - limit, 0))}>
        <Icon name="chevronLeft" size={16} /> Prev
      </button>
      <button type="button" className="btn btn-ghost sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
        Next <Icon name="chevronRight" size={16} />
      </button>
    </div>
  );
}

export type DiscountType = 'flat' | 'percent';

/* Rupee amount of a flat or percentage discount, same rounding as the server. */
export function discountAmount(subtotal: number, value: string | number, type: DiscountType) {
  const v = Math.max(Number(value) || 0, 0);
  const amount = type === 'percent' ? (subtotal * Math.min(v, 100)) / 100 : Math.min(v, subtotal);
  return Math.round(amount * 100) / 100;
}

export function DiscountInput({
  value,
  type,
  subtotal,
  onChange,
}: {
  value: string;
  type: DiscountType;
  subtotal: number;
  onChange: (value: string, type: DiscountType) => void;
}) {
  const amount = discountAmount(subtotal, value, type);
  return (
    <div className="discount-input">
      <div className="discount-row">
        <input
          type="number"
          min={0}
          max={type === 'percent' ? 100 : subtotal || undefined}
          step="any"
          value={value}
          aria-label={type === 'percent' ? 'Discount percent' : 'Discount amount'}
          onChange={(e) => onChange(e.target.value, type)}
        />
        <div className="seg seg-sm" role="group" aria-label="Discount type">
          <button type="button" className={type === 'flat' ? 'on' : ''} onClick={() => onChange(value, 'flat')} title="Flat amount in rupees">
            ₹
          </button>
          <button type="button" className={type === 'percent' ? 'on' : ''} onClick={() => onChange(value, 'percent')} title="Percentage of the bill">
            %
          </button>
        </div>
      </div>
      {type === 'percent' && Number(value) > 0 && <small className="muted">= ₹{amount.toLocaleString('en-IN')} off</small>}
    </div>
  );
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}
