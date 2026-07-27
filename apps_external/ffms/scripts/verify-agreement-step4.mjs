const API = process.env.RFMS_API_URL ?? 'http://localhost:9080/api/v1';
const APP_ID = 'fdf05dc7-8e72-4a62-8d7b-a2913e4a30d4';
const tinyPdf = 'data:application/pdf;base64,JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDYxMiA3OTJdL1BhcmVudCAyIDAgUi9SZXNvdXJjZXM8PD4+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAp0cmFpbGVyCjw8L1Jvb3QgMSAwIFIvU2l6ZSA0Pj4Kc3RhcnR4cmVmCjIwNQolJUVPRgo=';

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function main() {
  const health = await json(`${API}/health`);
  const healthOk = health.response.ok && health.payload?.agreement_execution_routes?.save_executed;
  if (!healthOk) {
    const probe = await json(`${API}/admin/applications/${APP_ID}/agreement/save-executed`, { method: 'POST' });
    if (probe.response.status === 404 && probe.payload?.error?.message === 'Route not found') {
      throw new Error('save-executed route missing. Restart start-isolated.cmd.');
    }
  }

  const otpRequest = await json(`${API}/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@remediumlab.local', password: 'Admin@12345', role_type: 'officer' }),
  });
  const challengeId = otpRequest.payload?.data?.challenge_id;
  if (!challengeId) throw new Error('Unable to request OTP.');

  const otpVerify = await json(`${API}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge_id: challengeId, otp: '123456' }),
  });
  const token = otpVerify.payload?.data?.token;
  if (!token) throw new Error('Unable to verify OTP.');

  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const apps = await json(`${API}/applications`, { headers: auth });
  const app = apps.payload?.data?.find((item) => item.id === APP_ID);
  if (!app) throw new Error('RFMS-2026-0001 not found.');
  const workflow = app.agreement_workflow;
  if (workflow?.status !== 'applicant_esign_completed') {
    throw new Error(`Expected applicant_esign_completed, got ${workflow?.status ?? 'unknown'}. Run node scripts/reset-agreement-step4.mjs`);
  }
  if (!workflow?.manager_permissions?.can_upload_manual_executed) {
    throw new Error('can_upload_manual_executed is false while status is applicant_esign_completed.');
  }

  const upload = await json(`${API}/admin/applications/${APP_ID}/agreement/manual-execute`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ file: { name: 'verify-step4.pdf', data_url: tinyPdf } }),
  });
  if (!upload.response.ok || !upload.payload?.success) {
    throw new Error(upload.payload?.error?.message ?? `manual-execute failed (${upload.response.status}).`);
  }
  if (upload.payload.data?.agreement_workflow?.status !== 'company_execution_pending') {
    throw new Error('manual-execute did not move workflow to company_execution_pending.');
  }

  const save = await json(`${API}/admin/applications/${APP_ID}/agreement/save-executed`, {
    method: 'POST',
    headers: auth,
  });
  if (!save.response.ok || !save.payload?.success) {
    throw new Error(save.payload?.error?.message ?? `save-executed failed (${save.response.status}).`);
  }
  if (save.payload.data?.agreement_workflow?.status !== 'executed') {
    throw new Error('save-executed did not move workflow to executed.');
  }
  if (!save.payload.data?.agreement_workflow?.executed?.delivered_to_applicant_at) {
    throw new Error('save-executed did not set delivered_to_applicant_at.');
  }

  console.log('Step 4 verification passed: manual-execute and save-executed succeeded end-to-end.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
