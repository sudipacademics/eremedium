import { useEffect, type ReactNode } from 'react';
import { unitById, type UnitId } from '../data';
import { Icon, type IconName } from '../icons';

export function PageHead({
  title,
  lede,
  actions,
}: {
  title: string;
  lede?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {lede ? <p>{lede}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function UnitPill({ id }: { id: UnitId }) {
  return <span className={`pill ${id}`}>{unitById(id).name}</span>;
}

export function StatusTag({ value }: { value: string }) {
  const tone =
    value === 'Pending'
      ? 'hot'
      : value === 'Completed' ||
          value === 'Delivered' ||
          value === 'Approved' ||
          value === 'Active' ||
          value === 'In Service' ||
          value === 'On time' ||
          value === 'Done'
        ? 'ok'
        : value === 'Delayed' || value === 'Rejected' || value === 'High' || value === 'Inactive'
          ? 'bad'
          : value === 'In Review' ||
              value === 'In transit' ||
              value === 'Under Service' ||
              value === 'Medium' ||
              value === 'Assigned' ||
              value === 'Queued' ||
              value === 'On hold'
            ? 'warn'
            : value === 'Scheduled' || value === 'Low'
              ? 'info'
              : 'mute';
  return <span className={`tag ${tone}`}>{value}</span>;
}

export function Sla({ value }: { value: number }) {
  const tone = value >= 95 ? 'ok' : value >= 93 ? 'warn' : 'bad';
  return <span className={`sla ${tone}`}>{value.toFixed(1)}%</span>;
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-root">
      <button type="button" className="modal-backdrop" aria-label="Close dialog" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header>
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="icon-btn small" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function AlertBubble({ tone }: { tone: string }) {
  const icon: IconName =
    tone === 'stock' ? 'box' : tone === 'dispatch' ? 'calendar' : tone === 'delay' ? 'calendar' : tone === 'equip' ? 'info' : tone === 'issue' ? 'flag' : 'alert';
  return (
    <span className={`bubble ${tone}`}>
      <Icon name={icon} size={15} />
    </span>
  );
}
