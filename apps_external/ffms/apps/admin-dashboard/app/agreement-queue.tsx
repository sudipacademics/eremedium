'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { RFMS_API_BASE, adminCanHardDelete } from '@rfms/utils';
import { AgreementChangeRequestBox, correctionWorkflowActive } from './agreement-change-request';
import { HardDeleteButton } from './hard-delete-button';

const API_BASE = RFMS_API_BASE;

type AgreementQueueItem = {
  application_id: string;
  application_number: string;
  applicant_name: string;
  franchise_model: 'FOFO' | 'FOCO';
  preferred_location: string;
  status: string;
  status_label: string;
  reference_number: string;
  correction_request?: string;
  correction_requested_at?: string;
  updated_at: string;
};

type AgreementWorkflow = {
  status: string;
  status_label: string;
  reference_number: string;
  estamp?: {
    state: string;
    stamp_duty_value: number;
    purpose: string;
    execution_date: string;
    certificate_number: string;
    uin: string;
    vendor: string;
    certificate?: { name: string; url: string } | null;
    verified_at?: string;
    verified_by?: string;
  } | null;
  document?: {
    template_key: string;
    version: number;
    body: string;
    draft_body: string;
    generated_at?: string;
    sent_to_applicant_at?: string;
    uploaded_file?: { name: string; url: string; mime?: string } | null;
    aadhaar_signed_file?: { name: string; url: string; mime?: string } | null;
    pending_executed_file?: { name: string; url: string; mime?: string } | null;
    executed_file?: { name: string; url: string; mime?: string } | null;
  } | null;
  view_document?: { name: string; url: string; mime?: string } | null;
  manager_permissions?: {
    can_download_aadhaar_signed?: boolean;
    can_apply_dsc?: boolean;
    can_upload_manual_executed?: boolean;
    can_save_executed_agreement?: boolean;
    can_download_executed?: boolean;
    can_respond_to_correction?: boolean;
    correction_pending?: boolean;
  };
  execution_method?: string;
  versions?: { id: string; type: string; name: string; url: string; actor: string; reference: string; created_at: string; message: string }[];
  applicant?: {
    terms_accepted_at?: string;
    correction_request?: string;
    correction_requested_at?: string;
    correction_decision?: string;
    correction_decision_at?: string;
    correction_decision_by?: string;
    correction_response?: string;
    esign_completed_at?: string;
    esign_reference?: string;
  } | null;
  company?: {
    dsc_signed_at?: string;
    dsc_signed_by?: string;
    dsc_reference?: string;
  } | null;
  executed?: {
    agreement_url?: string;
    executed_at?: string;
    delivered_to_applicant_at?: string;
    qr_reference?: string;
  } | null;
  history?: { id: string; type: string; message: string; actor: string; created_at: string }[];
};

type ApplicationRecord = {
  id: string;
  application_number: string;
  full_name: string;
  franchise_model: 'FOFO' | 'FOCO';
  preferred_location: string;
  agreement_workflow?: AgreementWorkflow | null;
};

function displayDate(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function networkErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    const port = Number(window.location.port);
    if (port >= 4000 && port <= 4002) return 'Unable to reach the RFMS API at http://localhost:9080. Keep the RFMS Isolated Services window open and hard-refresh this page.';
    return 'The local RFMS API is not running. Close this window and start run-admin.cmd again.';
  }
  if (error instanceof Error) {
    if (error.message.includes('(404)')) return 'The RFMS API is running an older version. Close the RFMS Isolated Services window and run start-isolated.cmd again, then hard-refresh this page.';
    return error.message;
  }
  return fallback;
}

function canUploadManualExecuted(workflow: AgreementWorkflow | null | undefined) {
  if (workflow?.manager_permissions?.can_upload_manual_executed) return true;
  if (workflow?.manager_permissions?.can_download_aadhaar_signed) return true;
  return ['applicant_esign_completed', 'company_execution_pending', 'executed'].includes(workflow?.status ?? '');
}

function canSaveExecutedAgreement(workflow: AgreementWorkflow | null | undefined) {
  if (workflow?.manager_permissions?.can_save_executed_agreement) return true;
  return workflow?.status === 'company_execution_pending' && Boolean(workflow?.document?.pending_executed_file?.url);
}

function stepFourBlockedReason(workflow: AgreementWorkflow | null | undefined, manualFileSelected: boolean) {
  const status = workflow?.status ?? '';
  if (workflow?.manager_permissions?.can_download_aadhaar_signed) {
    if (status === 'executed' && workflow?.executed?.delivered_to_applicant_at) {
      return 'Final agreement already delivered to the applicant portal.';
    }
    if (status === 'company_execution_pending' && !workflow?.document?.pending_executed_file?.url) {
      return 'Upload the manually signed PDF first, then click Save agreement.';
    }
    if (!manualFileSelected && status !== 'company_execution_pending') {
      return 'Choose the manually signed PDF above, then click Upload signed copy.';
    }
    return '';
  }
  if (status === 'correction_requested') {
    if (workflow?.manager_permissions?.correction_pending) return 'Review the applicant change request in Step 3 first.';
    if (workflow?.applicant?.correction_decision === 'approved') {
      return 'Change request approved. Upload the corrected agreement in Step 2, send it to the applicant, and wait for Aadhaar eSign before Step 4.';
    }
    return 'Complete the applicant correction cycle in Steps 2–3 before company execution.';
  }
  if (status === 'sent_to_applicant' || status === 'draft_ready') {
    return 'Step 4 unlocks after the applicant accepts the agreement and completes Aadhaar eSign.';
  }
  if (!['applicant_esign_completed', 'company_execution_pending', 'executed'].includes(status)) {
    return 'Step 4 unlocks after applicant Aadhaar eSign is completed.';
  }
  if (status === 'applicant_esign_completed' && !manualFileSelected) {
    return 'Choose the manually signed PDF above, then click Upload signed copy.';
  }
  if (status === 'company_execution_pending' && !workflow?.document?.pending_executed_file?.url) {
    return 'Upload the manually signed PDF first, then click Save agreement.';
  }
  if (status === 'executed' && workflow?.executed?.delivered_to_applicant_at) {
    return 'Final agreement already delivered to the applicant portal.';
  }
  return '';
}

function stepFourWorkflowLocked(workflow: AgreementWorkflow | null | undefined) {
  if (workflow?.manager_permissions?.can_download_aadhaar_signed) return false;
  const status = workflow?.status ?? '';
  return !['applicant_esign_completed', 'company_execution_pending', 'executed'].includes(status);
}

function applicantEsignIsComplete(workflow: AgreementWorkflow | null | undefined) {
  if (workflow?.manager_permissions?.can_download_aadhaar_signed) return true;
  const status = workflow?.status ?? '';
  return Boolean(workflow?.document?.aadhaar_signed_file?.url)
    && ['applicant_esign_completed', 'company_dsc_completed', 'company_execution_pending', 'executed'].includes(status);
}

function stepFourUploadDisabledReason(workflow: AgreementWorkflow | null | undefined, manualFileSelected: boolean, apiNeedsRestart: boolean) {
  if (apiNeedsRestart) return 'Restart RFMS Isolated Services (start-isolated.cmd), then hard-refresh this page.';
  if (!manualFileSelected) return 'Choose the manually signed PDF in step 2 of this section first.';
  if (canUploadManualExecuted(workflow)) return '';
  return stepFourBlockedReason(workflow, manualFileSelected) || 'Manual execution upload is not available at the current agreement stage.';
}

function stepFourSaveDisabledReason(workflow: AgreementWorkflow | null | undefined, apiNeedsRestart: boolean) {
  if (apiNeedsRestart) return 'Restart RFMS Isolated Services (start-isolated.cmd), then hard-refresh this page.';
  if (canSaveExecutedAgreement(workflow)) return '';
  if (workflow?.status === 'company_execution_pending' && !workflow?.document?.pending_executed_file?.url) {
    return 'Upload the manually signed PDF first, then click Save agreement.';
  }
  return stepFourBlockedReason(workflow, true) || 'Upload the manually signed agreement before saving it for the applicant.';
}

function resolveUploadUrl(url?: string | null) {
  const value = (url ?? '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `${new URL(API_BASE).origin}${value.startsWith('/') ? value : `/${value}`}`;
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read this file.'));
    reader.onerror = () => reject(new Error('Unable to read this file.'));
    reader.readAsDataURL(file);
  });
}

function AgreementDocumentViewer({ url, title = 'Agreement document' }: { url?: string | null; title?: string }) {
  const [zoom, setZoom] = useState(100);
  if (!url) return <p className="agreement-viewer-empty">Upload the final agreement PDF to preview it here.</p>;
  const viewerUrl = `${url}${url.includes('#') ? '' : '#toolbar=0&navpanes=0&view=FitH'}`;
  const adjustZoom = (delta: number) => setZoom((current) => Math.min(200, Math.max(50, current + delta)));
  return <div className="agreement-document-viewer">
    <div className="agreement-viewer-toolbar">
      <button type="button" aria-label="Zoom out" onClick={() => adjustZoom(-10)}>−</button>
      <span>{zoom}%</span>
      <button type="button" aria-label="Zoom in" onClick={() => adjustZoom(10)}>+</button>
      <button type="button" onClick={() => setZoom(100)}>Reset</button>
    </div>
    <div className="agreement-document-scroll">
      <div className="agreement-document-zoom" style={{ width: `${zoom}%` }}>
        <iframe className="agreement-document-frame" src={viewerUrl} title={title} style={{ height: `${Math.round(420 * zoom / 100)}px` }} />
      </div>
    </div>
  </div>;
}

export function AgreementQueueModule({ token, search, notify, viewerRole }: { token: string; search: string; notify: (message: string) => void; viewerRole: string }) {
  const [queue, setQueue] = useState<AgreementQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [application, setApplication] = useState<ApplicationRecord | null>(null);
  const [workspaceError, setWorkspaceError] = useState('');
  const [busy, setBusy] = useState('');
  const [estamp, setEstamp] = useState({ state: '', stamp_duty_value: '', purpose: '', execution_date: '', certificate_number: '', uin: '', vendor: '' });
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [agreementFile, setAgreementFile] = useState<File | null>(null);
  const [manualExecutedFile, setManualExecutedFile] = useState<File | null>(null);
  const [manualFileInputKey, setManualFileInputKey] = useState(0);
  const [stepFourMessage, setStepFourMessage] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [manualPreviewUrl, setManualPreviewUrl] = useState('');
  const [apiNeedsRestart, setApiNeedsRestart] = useState(false);

  const visibleQueue = useMemo(() => queue
    .filter((item) => `${item.applicant_name} ${item.application_number} ${item.status_label} ${item.franchise_model} ${item.correction_request ?? ''}`.toLowerCase().includes(search.toLowerCase()))
    .sort((first, second) => {
      if (first.status === 'correction_requested' && second.status !== 'correction_requested') return -1;
      if (second.status === 'correction_requested' && first.status !== 'correction_requested') return 1;
      return second.updated_at.localeCompare(first.updated_at);
    }), [queue, search]);
  const workflow = application?.agreement_workflow ?? null;
  const correctionDecision = workflow?.applicant?.correction_decision ?? '';
  const stepFourBlocked = stepFourBlockedReason(workflow, Boolean(manualExecutedFile));
  const stepFourLocked = stepFourWorkflowLocked(workflow);
  const applicantEsignComplete = applicantEsignIsComplete(workflow);
  const stepFourUploadBlocked = stepFourUploadDisabledReason(workflow, Boolean(manualExecutedFile), apiNeedsRestart);
  const stepFourSaveBlocked = stepFourSaveDisabledReason(workflow, apiNeedsRestart);
  const correctionActive = correctionWorkflowActive(workflow);

  const loadQueue = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/agreements/queue`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: AgreementQueueItem[]; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !Array.isArray(payload.data)) throw new Error(payload?.error?.message ?? 'Unable to load the Agreement queue.');
      setQueue(payload.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load the Agreement queue.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadApplication = useCallback(async (applicationId: string) => {
    setWorkspaceError('');
    try {
      const response = await fetch(`${API_BASE}/applications`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: ApplicationRecord[]; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !Array.isArray(payload.data)) throw new Error(payload?.error?.message ?? 'Unable to load agreement details.');
      const record = payload.data.find((item) => item.id === applicationId) ?? null;
      setApplication(record);
      setDraftBody(record?.agreement_workflow?.document?.draft_body ?? record?.agreement_workflow?.document?.body ?? '');
    } catch (requestError) {
      setWorkspaceError(requestError instanceof Error ? requestError.message : 'Unable to load agreement details.');
    }
  }, [token]);

  useEffect(() => { void loadQueue(); }, [loadQueue, reload]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function probeApiRoutes() {
      try {
        const healthResponse = await fetch(`${API_BASE}/health`);
        const healthPayload = await healthResponse.json().catch(() => null) as { agreement_execution_routes?: { save_executed?: boolean } } | null;
        if (cancelled) return;
        if (healthResponse.ok && healthPayload?.agreement_execution_routes?.save_executed) {
          setApiNeedsRestart(false);
          return;
        }
        const probeResponse = await fetch(`${API_BASE}/admin/applications/00000000-0000-0000-0000-000000000001/agreement/save-executed`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        const probePayload = await probeResponse.json().catch(() => null) as { error?: { message?: string } } | null;
        if (cancelled) return;
        setApiNeedsRestart(probeResponse.status === 404 && probePayload?.error?.message === 'Route not found.');
      } catch {
        if (!cancelled) setApiNeedsRestart(true);
      }
    }
    void probeApiRoutes();
    return () => { cancelled = true; };
  }, [token, reload]);
  useEffect(() => {
    if (!selectedId) { setApplication(null); return; }
    void loadApplication(selectedId);
  }, [selectedId, loadApplication, reload]);

  useEffect(() => {
    if (!selectedId) return;
    const status = application?.agreement_workflow?.status ?? '';
    if (!['sent_to_applicant', 'applicant_accepted', 'draft_ready', 'correction_requested'].includes(status)) return;
    const timer = window.setInterval(() => { void loadApplication(selectedId); }, 12000);
    return () => window.clearInterval(timer);
  }, [selectedId, application?.agreement_workflow?.status, loadApplication]);

  useEffect(() => {
    setWorkspaceError('');
    setStepFourMessage('');
    setManualExecutedFile(null);
    setManualFileInputKey((value) => value + 1);
  }, [selectedId]);

  useEffect(() => {
    if (!manualExecutedFile) {
      setManualPreviewUrl('');
      return;
    }
    const previewUrl = URL.createObjectURL(manualExecutedFile);
    setManualPreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [manualExecutedFile]);

  async function refreshCurrentApplication() {
    if (!application) return null;
    const response = await fetch(`${API_BASE}/applications`, { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json().catch(() => null) as { success?: boolean; data?: ApplicationRecord[]; error?: { message?: string } } | null;
    if (!response.ok || !payload?.success || !Array.isArray(payload.data)) throw new Error(payload?.error?.message ?? 'Unable to refresh agreement details.');
    const record = payload.data.find((item) => item.id === application.id) ?? null;
    if (!record) throw new Error('Agreement application not found.');
    setApplication(record);
    setDraftBody(record.agreement_workflow?.document?.draft_body ?? record.agreement_workflow?.document?.body ?? '');
    setReload((value) => value + 1);
    return record;
  }

  function ensureStepFourReady(record: ApplicationRecord | null) {
    const latestWorkflow = record?.agreement_workflow ?? null;
    if (canUploadManualExecuted(latestWorkflow)) return;
    const reason = stepFourBlockedReason(latestWorkflow, Boolean(manualExecutedFile));
    throw new Error(reason || 'Manual execution upload is not available at the current agreement stage. Click Refresh queue, then try again.');
  }

  function ensureApplicantSignedDownloadReady(record: ApplicationRecord | null) {
    if (record?.agreement_workflow?.manager_permissions?.can_download_aadhaar_signed) return;
    throw new Error('The applicant-signed agreement is not available to download yet.');
  }

  async function request(path: string, method = 'POST', body?: unknown) {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => null) as { success?: boolean; data?: ApplicationRecord; error?: { message?: string; code?: string } } | null;
    if (!response.ok || !payload?.success || !payload.data) {
      if (response.status === 404 && payload?.error?.message === 'Route not found.') {
        setApiNeedsRestart(true);
        throw new Error('The RFMS API is running an older version. Close the RFMS Isolated Services window and run start-isolated.cmd again, then hard-refresh this page.');
      }
      throw new Error(payload?.error?.message ?? (response.ok ? 'Agreement request failed.' : `Agreement request failed (${response.status}).`));
    }
    setApplication(payload.data);
    setDraftBody(payload.data.agreement_workflow?.document?.draft_body ?? payload.data.agreement_workflow?.document?.body ?? '');
    setReload((value) => value + 1);
    return payload.data;
  }

  async function uploadEstamp(event: FormEvent) {
    event.preventDefault();
    if (!application || !certificateFile) return;
    setBusy('estamp'); setWorkspaceError('');
    try {
      const data_url = await readFileAsDataUrl(certificateFile);
      await request(`/admin/applications/${application.id}/agreement/estamp`, 'POST', {
        ...estamp,
        stamp_duty_value: Number(estamp.stamp_duty_value),
        certificate: { name: certificateFile.name, data_url },
      });
      notify('e-Stamp certificate verified and linked to the application.');
    } catch (requestError) {
      setWorkspaceError(requestError instanceof Error ? requestError.message : 'Unable to verify the e-Stamp certificate.');
    } finally {
      setBusy('');
    }
  }

  async function uploadAgreement() {
    if (!application || !agreementFile) return;
    setBusy('upload'); setWorkspaceError('');
    try {
      const data_url = await readFileAsDataUrl(agreementFile);
      await request(`/admin/applications/${application.id}/agreement/upload`, 'POST', { file: { name: agreementFile.name, data_url } });
      notify('Final agreement document uploaded and ready for preview.');
      setAgreementFile(null);
    } catch (requestError) {
      setWorkspaceError(requestError instanceof Error ? requestError.message : 'Unable to upload the agreement document.');
    } finally {
      setBusy('');
    }
  }

  async function uploadManualExecuted() {
    if (!application || !manualExecutedFile) return;
    if (manualExecutedFile.size > 32 * 1024 * 1024) {
      const message = 'Upload a signed PDF up to 32 MB.';
      setWorkspaceError(message);
      notify(message);
      return;
    }
    if (manualExecutedFile.type && !['application/pdf', 'application/x-pdf', 'application/octet-stream'].includes(manualExecutedFile.type)) {
      const message = 'Upload the executed agreement as a PDF file.';
      setWorkspaceError(message);
      notify(message);
      return;
    }
    setBusy('manual'); setWorkspaceError(''); setStepFourMessage('');
    try {
      const latest = await refreshCurrentApplication();
      ensureStepFourReady(latest);
      const data_url = await readFileAsDataUrl(manualExecutedFile);
      await request(`/admin/applications/${latest!.id}/agreement/manual-execute`, 'POST', {
        file: { name: manualExecutedFile.name, data_url },
      });
      notify('Signed copy uploaded. Review the preview, then click Save agreement to deliver it to the applicant portal.');
      setStepFourMessage('Signed copy uploaded and held for manager review. Click Save agreement to publish the final executed copy to the applicant portal.');
      setManualExecutedFile(null);
      setManualFileInputKey((value) => value + 1);
    } catch (requestError) {
      const message = networkErrorMessage(requestError, 'Unable to upload the signed agreement.');
      setWorkspaceError(message);
      notify(message);
    } finally {
      setBusy('');
    }
  }

  async function saveExecutedAgreement() {
    if (!application) return;
    setBusy('save'); setWorkspaceError(''); setStepFourMessage('');
    try {
      const latest = await refreshCurrentApplication();
      if (!latest?.agreement_workflow || !canSaveExecutedAgreement(latest.agreement_workflow)) {
        throw new Error('Upload the manually signed agreement before saving it for the applicant.');
      }
      await request(`/admin/applications/${latest.id}/agreement/save-executed`, 'POST');
      notify('Agreement saved. The final executed copy is now available on the applicant portal.');
      setStepFourMessage('Final executed agreement saved and delivered to the applicant portal.');
    } catch (requestError) {
      const message = networkErrorMessage(requestError, 'Unable to save the executed agreement.');
      setWorkspaceError(message);
      notify(message);
    } finally {
      setBusy('');
    }
  }

  async function downloadApplicantSignedCopy() {
    if (!application) return;
    setWorkspaceError(''); setStepFourMessage('');
    try {
      const latest = await refreshCurrentApplication();
      ensureApplicantSignedDownloadReady(latest);
      await downloadAgreement('aadhaar');
      setStepFourMessage('Applicant-signed agreement downloaded. Sign and stamp it manually, then upload the executed copy below.');
      notify('Sign and stamp the downloaded agreement, then upload the executed copy.');
    } catch (requestError) {
      const message = networkErrorMessage(requestError, 'Unable to download the applicant-signed agreement.');
      setWorkspaceError(message);
      notify(message);
    }
  }

  async function generateAgreement() {
    if (!application) return;
    setBusy('generate'); setWorkspaceError('');
    try {
      await request(`/admin/applications/${application.id}/agreement/generate`);
      notify('Final franchise agreement generated from verified application data.');
    } catch (requestError) {
      setWorkspaceError(requestError instanceof Error ? requestError.message : 'Unable to generate the agreement.');
    } finally {
      setBusy('');
    }
  }

  async function saveDraft() {
    if (!application) return;
    setBusy('draft'); setWorkspaceError('');
    try {
      await request(`/admin/applications/${application.id}/agreement/draft`, 'PATCH', { draft_body: draftBody });
      notify('Agreement draft saved.');
    } catch (requestError) {
      setWorkspaceError(requestError instanceof Error ? requestError.message : 'Unable to save the agreement draft.');
    } finally {
      setBusy('');
    }
  }

  async function sendToApplicant() {
    if (!application) return;
    setBusy('send'); setWorkspaceError('');
    try {
      await request(`/admin/applications/${application.id}/agreement/send`);
      notify('Agreement sent to the applicant for review.');
    } catch (requestError) {
      setWorkspaceError(requestError instanceof Error ? requestError.message : 'Unable to send the agreement.');
    } finally {
      setBusy('');
    }
  }

  async function downloadAgreement(kind?: 'aadhaar' | 'executed') {
    if (!application) return;
    setBusy('download'); setWorkspaceError('');
    try {
      const query = kind === 'aadhaar' ? '?kind=aadhaar' : '';
      const response = await fetch(`${API_BASE}/admin/applications/${application.id}/agreement/download${query}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Unable to download the agreement.');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Remedium-Lab-Agreement-${application.application_number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1_000);
    } catch (downloadError) {
      setWorkspaceError(downloadError instanceof Error ? downloadError.message : 'Unable to download the agreement.');
    } finally {
      setBusy('');
    }
  }

  function onCertificateChange(event: ChangeEvent<HTMLInputElement>) {
    setCertificateFile(event.target.files?.[0] ?? null);
  }

  async function hardDeleteSelectedApplication() {
    if (!application || !adminCanHardDelete(viewerRole)) throw new Error('Only a Super Admin can permanently delete applications.');
    const response = await fetch(`${API_BASE}/admin/applications/${application.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await response.json().catch(() => null) as { success?: boolean; error?: { message?: string } } | null;
    if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? 'Unable to permanently delete this application.');
    const deletedId = application.id;
    setQueue((current) => current.filter((item) => item.application_id !== deletedId));
    setSelectedId('');
    setApplication(null);
    notify('Application and agreement permanently deleted from FFMS and linked portals.');
  }

  return <section className="agreement-dashboard">
    <div className="title-row"><div><h1>Agreement queue</h1><p>Manage e-Stamp verification, agreement generation, applicant review, Aadhaar eSign and manual company execution.</p></div><button className="date" type="button" onClick={() => setReload((value) => value + 1)}>Refresh queue</button></div>
    <div className="module-summary"><section><span>Active agreements</span><b>{queue.length}</b><small>Started from Manual Application Review</small></section><section><span>Corrections pending</span><b>{queue.filter((item) => item.status === 'correction_requested').length}</b><small>Applicant change requests awaiting re-upload</small></section><section><span>Awaiting e-Stamp</span><b>{queue.filter((item) => ['in_process', 'estamp_pending'].includes(item.status)).length}</b><small>First mandatory Agreement Module step</small></section><section><span>Executed</span><b>{queue.filter((item) => item.status === 'executed').length}</b><small>Archived with full audit trail</small></section></div>
    <section className="panel data-panel"><div className="panel-head"><div><h2>Agreement work queue</h2><p>{loading ? 'Loading agreement work items…' : `${visibleQueue.length} agreement record${visibleQueue.length === 1 ? '' : 's'}`}</p></div><button type="button" onClick={() => setReload((value) => value + 1)}>Refresh</button></div><div className="table-wrap"><table><thead><tr><th>Applicant</th><th>Application</th><th>Model</th><th>Status</th><th>Applicant request</th><th>Reference</th><th>Updated</th><th /></tr></thead><tbody>{error ? <tr><td colSpan={8} className="empty">{error}</td></tr> : visibleQueue.map((item) => <tr key={item.application_id} className={item.status === 'correction_requested' ? 'agreement-row-correction' : ''}><td><b>{item.applicant_name}</b></td><td><b>{item.application_number}</b><br /><small>{item.preferred_location}</small></td><td>{item.franchise_model}</td><td>{item.status === 'correction_requested' ? <span className="agreement-status-pill correction">{item.status_label}</span> : item.status_label}</td><td>{item.correction_request ? <span className="agreement-correction-snippet" title={item.correction_request}>{item.correction_request}</span> : '—'}</td><td>{item.reference_number || '—'}</td><td>{displayDate(item.updated_at)}</td><td><button className="row-action" type="button" onClick={() => setSelectedId(item.application_id)}>{item.status === 'correction_requested' ? 'Review correction' : 'Open workspace'}</button></td></tr>)}{!loading && !error && visibleQueue.length === 0 ? <tr><td colSpan={8} className="empty">No agreement work items yet. Proceed to final agreement from Manual Application Review after the final payment or branding stage is verified.</td></tr> : null}</tbody></table></div></section>
    {selectedId && application ? <section className="panel agreement-workspace"><div className="panel-head"><div><h2>{application.full_name}</h2><p>{application.application_number} · {application.franchise_model} · {workflow?.status_label ?? 'Agreement in process'} · API {new URL(API_BASE).origin}</p></div><div className="agreement-workspace-head-actions">{adminCanHardDelete(viewerRole) ? <HardDeleteButton onConfirm={hardDeleteSelectedApplication} /> : null}<button type="button" onClick={() => setSelectedId('')}>Close workspace</button></div></div>
      {apiNeedsRestart ? <p className="application-review-error" role="alert">Restart <b>RFMS Isolated Services</b> (run start-isolated.cmd) before using Upload / Save agreement.</p> : null}
      <div className="agreement-workspace-grid">
        <article className="agreement-step-card"><h3>Step 1 · e-Stamp module</h3><p>Upload and verify the official e-Stamp certificate before generating the final agreement.</p>{workflow?.estamp?.verified_at ? <div className="agreement-complete-box"><b>e-Stamp verified</b><span>{workflow.estamp.state} · {workflow.estamp.certificate_number}{workflow.estamp.uin ? ` · UIN ${workflow.estamp.uin}` : ''}</span>{workflow.estamp.certificate?.url ? <a href={resolveUploadUrl(workflow.estamp.certificate.url)} target="_blank" rel="noreferrer">View certificate</a> : null}</div> : <form className="agreement-estamp-form" onSubmit={(event) => void uploadEstamp(event)}><label>State<input required value={estamp.state} onChange={(event) => setEstamp((current) => ({ ...current, state: event.target.value }))} /></label><label>Stamp duty value<input required inputMode="decimal" value={estamp.stamp_duty_value} onChange={(event) => setEstamp((current) => ({ ...current, stamp_duty_value: event.target.value }))} /></label><label>Purpose of stamp<input required value={estamp.purpose} onChange={(event) => setEstamp((current) => ({ ...current, purpose: event.target.value }))} /></label><label>Execution date<input required type="date" value={estamp.execution_date} onChange={(event) => setEstamp((current) => ({ ...current, execution_date: event.target.value }))} /></label><label>e-Stamp certificate number<input required value={estamp.certificate_number} onChange={(event) => setEstamp((current) => ({ ...current, certificate_number: event.target.value }))} /></label><label>UIN (if applicable)<input value={estamp.uin} onChange={(event) => setEstamp((current) => ({ ...current, uin: event.target.value }))} /></label><label>Vendor / issuing authority<input required value={estamp.vendor} onChange={(event) => setEstamp((current) => ({ ...current, vendor: event.target.value }))} /></label><label className="span-two">e-Stamp certificate PDF<input required type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={onCertificateChange} /></label><button type="submit" disabled={busy === 'estamp' || !certificateFile}>{busy === 'estamp' ? 'Verifying…' : 'Verify e-Stamp certificate'}</button></form>}</article>
        <article className="agreement-step-card agreement-step-wide"><h3>Step 2 · Generate &amp; upload agreement</h3><p>Generate the template reference, merge it with the verified e-Stamp offline, upload the final PDF, preview it, then send it to the applicant.</p><div className="agreement-actions"><button type="button" disabled={!workflow?.estamp?.verified_at || busy === 'generate' || workflow.status === 'executed'} onClick={() => void generateAgreement()}>{busy === 'generate' ? 'Generating…' : 'Generate template reference'}</button><label className="agreement-upload-field">Upload final agreement PDF<input type="file" accept="application/pdf" onChange={(event) => setAgreementFile(event.target.files?.[0] ?? null)} /></label><button type="button" disabled={!agreementFile || !workflow?.estamp?.verified_at || busy === 'upload' || workflow.status === 'executed'} onClick={() => void uploadAgreement()}>{busy === 'upload' ? 'Uploading…' : correctionDecision === 'approved' ? 'Upload corrected agreement' : 'Upload agreement'}</button><button type="button" disabled={!workflow?.document?.uploaded_file?.url || !['draft_ready', 'correction_requested'].includes(workflow.status) || busy === 'send'} onClick={() => void sendToApplicant()}>{busy === 'send' ? 'Sending…' : correctionDecision === 'approved' ? 'Send corrected agreement' : 'Send to applicant'}</button></div>{workflow?.document?.uploaded_file?.url ? <AgreementDocumentViewer url={resolveUploadUrl(workflow.document.uploaded_file.url)} title={`Agreement preview · ${application.application_number}`} /> : null}{workflow?.document?.draft_body ? <details className="agreement-template-reference"><summary>Template reference text</summary><textarea value={draftBody} onChange={(event) => setDraftBody(event.target.value)} rows={10} readOnly={workflow.status === 'executed'} /></details> : null}</article>
        <article className="agreement-step-card agreement-step-correction">{correctionActive ? <>
          <h3>Step 3 · Applicant change request</h3>
          <p>{correctionDecision === 'approved' ? 'Change request approved. Upload the corrected agreement in Step 2 and send it back to the applicant.' : workflow?.manager_permissions?.correction_pending ? 'Review the applicant change request and choose Approve or Deny.' : 'Applicant change request recorded. Continue in Step 2 after approval.'}</p>
          <AgreementChangeRequestBox token={token} applicationId={application.id} workflow={workflow} onApplicationUpdated={(record) => { const updated = record as ApplicationRecord; setApplication(updated); setDraftBody(updated.agreement_workflow?.document?.draft_body ?? updated.agreement_workflow?.document?.body ?? ''); setReload((value) => value + 1); }} notify={notify} displayDate={displayDate} />
        </> : <>
          <h3>Step 3 · Applicant review &amp; eSign</h3>
          <p>{applicantEsignComplete ? `Applicant Aadhaar eSign completed · ${workflow?.applicant?.esign_reference || 'Reference recorded'}. Continue in Step 4 for company execution.` : workflow?.document?.sent_to_applicant_at && workflow.status === 'sent_to_applicant' ? 'Agreement sent to applicant in view-only mode for acceptance and Aadhaar eSign.' : 'Send the uploaded agreement to the applicant to begin review.'}</p>
          {applicantEsignComplete ? <div className="agreement-complete-box"><b>Aadhaar eSign complete</b><span>{workflow?.applicant?.esign_reference}{workflow?.applicant?.terms_accepted_at ? ` · Terms accepted ${displayDate(workflow.applicant.terms_accepted_at)}` : ''}</span></div> : workflow?.applicant?.terms_accepted_at ? <small>Terms accepted {displayDate(workflow.applicant.terms_accepted_at)}</small> : null}
        </>}</article>
        <article className="agreement-step-card agreement-step-wide"><h3>Step 4 · Company execution</h3><p>After applicant Aadhaar eSign, download the applicant-signed copy, sign and stamp it manually, upload the signed PDF, then save the agreement to deliver the final copy to the applicant portal.</p><p className="agreement-step-status"><b>Current status:</b> {workflow?.status_label ?? 'Agreement in process'}{workflow?.status === 'company_execution_pending' ? ' · Signed copy uploaded — click Save agreement to deliver to applicant' : workflow?.status === 'executed' ? ' · Final agreement delivered to applicant portal' : applicantEsignComplete ? ' · Ready for company execution' : ''}</p>{stepFourLocked && stepFourBlocked ? <p className="agreement-step-gate" role="status"><b>Step 4 is waiting on the agreement workflow</b>{stepFourBlocked}</p> : null}{!stepFourLocked && stepFourBlocked ? <p className="application-review-error" role="status">{stepFourBlocked}</p> : null}{workspaceError ? <p className="application-review-error" role="alert">{workspaceError}</p> : null}{stepFourMessage ? <div className="agreement-complete-box" role="status"><b>Step 4 update</b><span>{stepFourMessage}</span></div> : null}<div className="agreement-step-guide"><b>Manual execution</b><ol><li>Download the applicant-signed agreement</li><li>Sign and stamp it manually as the company</li><li>Upload the signed PDF</li><li>Save agreement to deliver the final copy to the applicant portal</li></ol></div><div className="agreement-actions"><button type="button" className="agreement-primary" disabled={!workflow?.manager_permissions?.can_download_aadhaar_signed || busy === 'download'} title={!workflow?.manager_permissions?.can_download_aadhaar_signed ? stepFourBlocked || 'The applicant-signed agreement is not available to download yet.' : undefined} onClick={() => void downloadApplicantSignedCopy()}>{busy === 'download' ? 'Downloading…' : '1. Download applicant-signed copy'}</button><label className="agreement-upload-field">2. Upload signed PDF<input key={manualFileInputKey} type="file" accept="application/pdf,.pdf" onChange={(event) => { setManualExecutedFile(event.target.files?.[0] ?? null); setWorkspaceError(''); setStepFourMessage(''); }} /></label><button type="button" disabled={!manualExecutedFile || !canUploadManualExecuted(workflow) || busy === 'manual' || apiNeedsRestart} title={stepFourUploadBlocked || undefined} onClick={() => void uploadManualExecuted()}>{busy === 'manual' ? 'Uploading…' : '3. Upload signed copy'}</button><button type="button" className="agreement-primary" disabled={!canSaveExecutedAgreement(workflow) || busy === 'save' || apiNeedsRestart} title={stepFourSaveBlocked || undefined} onClick={() => void saveExecutedAgreement()}>{busy === 'save' ? 'Saving…' : '4. Save agreement & deliver to applicant'}</button>{workflow?.manager_permissions?.can_download_executed ? <button type="button" disabled={busy === 'download'} onClick={() => void downloadAgreement('executed')}>{busy === 'download' ? 'Downloading…' : 'Download delivered agreement'}</button> : null}</div>{manualPreviewUrl ? <AgreementDocumentViewer url={manualPreviewUrl} title={`Selected signed PDF · ${application.application_number}`} /> : null}{workflow?.document?.pending_executed_file?.url ? <AgreementDocumentViewer url={resolveUploadUrl(workflow.document.pending_executed_file.url)} title={`Pending save · ${application.application_number}`} /> : null}{workflow?.document?.executed_file?.url && workflow?.manager_permissions?.can_download_executed ? <AgreementDocumentViewer url={`${resolveUploadUrl(workflow.document.executed_file.url)}${workflow.executed?.executed_at ? `?v=${encodeURIComponent(workflow.executed.executed_at)}` : ''}`} title={`Delivered agreement · ${application.application_number}`} /> : null}{workflow?.executed?.delivered_to_applicant_at ? <div className="agreement-complete-box"><b>Delivered to applicant portal</b><span>{displayDate(workflow.executed.delivered_to_applicant_at)} · Manual signature and stamp · QR {workflow.executed.qr_reference}</span></div> : workflow?.status === 'company_execution_pending' ? <div className="agreement-complete-box"><b>Waiting for save</b><span>Review the uploaded signed copy above, then click Save agreement to publish it on the applicant portal.</span></div> : null}</article>
      </div>
      {workflow?.history?.length ? <div className="agreement-history"><h3>Agreement audit trail</h3>{[...(workflow.history)].reverse().slice(0, 8).map((entry) => <article key={entry.id}><b>{entry.type.replaceAll('_', ' ')}</b><p>{entry.message}</p><small>{entry.actor} · {displayDate(entry.created_at)}</small></article>)}</div> : null}
    </section> : null}
  </section>;
}
