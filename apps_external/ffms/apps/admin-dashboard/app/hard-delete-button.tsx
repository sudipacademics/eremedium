'use client';

import { useState } from 'react';

export const HARD_DELETE_CONFIRM_TEXT =
  'This action is permanent and cannot be undone. The selected record and all linked data will be deleted from FFMS, and matching entries will be removed from the REACH Portal and Partner Portal where applicable.';

type HardDeleteButtonProps = {
  label?: string;
  busyLabel?: string;
  disabled?: boolean;
  onConfirm: () => Promise<void> | void;
  className?: string;
  confirmTitle?: string;
  confirmText?: string;
};

export function HardDeleteButton({
  label = 'Delete permanently',
  busyLabel = 'Deleting…',
  disabled = false,
  onConfirm,
  className = 'danger',
  confirmTitle = 'Confirm permanent delete',
  confirmText = HARD_DELETE_CONFIRM_TEXT,
}: HardDeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      setOpen(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to delete this record.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} disabled={disabled || busy} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? (
        <div className="hard-delete-backdrop" role="presentation" onMouseDown={() => !busy && setOpen(false)}>
          <section
            className="hard-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hard-delete-heading"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h3 id="hard-delete-heading">{confirmTitle}</h3>
            <p>{confirmText}</p>
            {error ? <p className="error">{error}</p> : null}
            <div className="hard-delete-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="danger" disabled={busy} onClick={() => void handleConfirm()}>
                {busy ? busyLabel : label}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
