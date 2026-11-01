import { useState } from 'react';

type Props = {
  open: boolean;
  title?: string;
  subtitle?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (notes: string) => void;
};

export function AuthorizeReportDialog({
  open,
  title = 'Authorize lab report',
  subtitle,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const [notes, setNotes] = useState('');

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
      }}
    >
      <div className="card" style={{ maxWidth: 480, width: '90%', margin: '10vh auto' }}>
        <h2>{title}</h2>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
        <label>
          Pathologist notes (optional)
          <textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Clinical interpretation, comments for the patient record…"
          />
        </label>
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          Authorizing locks results. After sign-off, use Send to WhatsApp (secure Patient Portal link) or Download Report. No public PDF is shared.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn" disabled={busy} onClick={() => onConfirm(notes.trim())}>
            {busy ? 'Authorizing…' : 'Authorize report'}
          </button>
          <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
