'use client';

import { useState } from 'react';
import { RFMS_API_BASE } from '@rfms/utils';

const API_BASE = RFMS_API_BASE;

export type AgreementChangeRequestWorkflow = {
  status?: string;
  applicant?: {
    correction_request?: string;
    correction_requested_at?: string;
    correction_decision?: string;
    correction_response?: string;
  } | null;
  manager_permissions?: {
    correction_pending?: boolean;
  };
};

export function correctionWorkflowActive(workflow: AgreementChangeRequestWorkflow | null | undefined) {
  const status = workflow?.status ?? '';
  const request = workflow?.applicant?.correction_request?.trim() ?? '';
  return status === 'correction_requested' && Boolean(request);
}

export function AgreementChangeRequestBox({
  token,
  applicationId,
  workflow,
  onApplicationUpdated,
  notify,
  displayDate,
}: {
  token: string;
  applicationId: string;
  workflow: AgreementChangeRequestWorkflow | null | undefined;
  onApplicationUpdated: (application: unknown) => void;
  notify: (message: string) => void;
  displayDate: (value: string) => string;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const correctionMessage = workflow?.applicant?.correction_request?.trim() ?? '';
  const correctionPending = Boolean(workflow?.manager_permissions?.correction_pending);
  const correctionDecision = workflow?.applicant?.correction_decision ?? '';

  if (!correctionWorkflowActive(workflow)) return null;

  async function respond(decision: 'approve' | 'deny') {
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/admin/applications/${applicationId}/agreement/correction-response`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, message: note.trim() }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: unknown; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(payload?.error?.message ?? (decision === 'approve' ? 'Unable to approve the change request.' : 'Unable to deny the change request.'));
      }
      onApplicationUpdated(payload.data);
      setNote('');
      notify(decision === 'approve' ? 'Change request approved. Upload the corrected agreement in Step 2.' : 'Change request denied. The applicant has been notified.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to save the correction decision.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="agreement-change-request-box">
      <div>
        <b>Applicant change request</b>
        <p>{correctionMessage || 'Applicant submitted a change request. Refresh the queue if the request text is missing.'}</p>
        {workflow?.applicant?.correction_requested_at ? <small>Submitted {displayDate(workflow.applicant.correction_requested_at)}</small> : null}
      </div>
      {correctionPending ? (
        <div className="agreement-change-request-actions">
          <input type="text" value={note} placeholder="Note (optional)" onChange={(event) => setNote(event.target.value)} />
          <button type="button" disabled={busy} onClick={() => void respond('approve')}>{busy ? 'Saving…' : 'Approve'}</button>
          <button type="button" className="deny" disabled={busy} onClick={() => void respond('deny')}>Deny</button>
        </div>
      ) : correctionDecision === 'approved' ? (
        <small className="agreement-change-request-status approved">Approved · upload corrected PDF in Step 2</small>
      ) : correctionDecision === 'denied' ? (
        <small className="agreement-change-request-status denied">Denied{workflow?.applicant?.correction_response ? `: ${workflow.applicant.correction_response}` : ''}</small>
      ) : null}
    </div>
  );
}
