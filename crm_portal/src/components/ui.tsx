import type { ReactNode } from 'react';
import { wingById, type WingId } from '../data';

export function WingPill({ wing }: { wing: WingId | string }) {
  const w = wingById(wing);
  return (
    <span className={`wing-pill ${w.tone}`}>
      <span className="dot" style={{ background: w.color }} />
      {w.short}
    </span>
  );
}

export function StatusPill({ value }: { value: string }) {
  const tone = value.replace(/\s+/g, '-');
  return <span className={`status ${tone}`}>{value}</span>;
}

export function Field({ label, children, span }: { label: string; children: ReactNode; span?: 2 }) {
  return (
    <label className={`field${span === 2 ? ' span-2' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

export function Modal({
  title,
  children,
  onClose,
  actions,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="card-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
        {actions ? <div className="modal-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
