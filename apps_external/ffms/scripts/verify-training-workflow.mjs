#!/usr/bin/env node
/**
 * End-to-end verification for franchise training workflow.
 * Usage: node scripts/verify-training-workflow.mjs [applicationId]
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const API = process.env.RFMS_API_URL ?? 'http://localhost:9080/api/v1';
const DATA_FILE = path.resolve('work/isolated/rfms-local-api-data.json');
const ADMIN_EMAIL = 'admin@remediumlab.local';
const ADMIN_PASSWORD = 'Admin@12345';
const OTP = '123456';
const APPLICATION_ID = process.argv[2] ?? 'fdf05dc7-8e72-4a62-8d7b-a2913e4a30d4';
const BUSINESS_NAME = 'Santosh Art Diagnostics';

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function adminToken() {
  const login = await json(`${API}/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role_type: 'officer' }),
  });
  if (!login.response.ok || !login.payload?.success) throw new Error(login.payload?.error?.message ?? 'Admin OTP request failed.');
  const verify = await json(`${API}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge_id: login.payload.data.challenge_id, otp: OTP }),
  });
  if (!verify.response.ok || !verify.payload?.success) throw new Error(verify.payload?.error?.message ?? 'Admin OTP failed.');
  return verify.payload.data.token;
}

async function applicantToken(application) {
  const requestOtp = await json(`${API}/applicant/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: application.application_number }),
  });
  if (!requestOtp.response.ok || !requestOtp.payload?.success) throw new Error(requestOtp.payload?.error?.message ?? 'Applicant OTP request failed.');
  const verify = await json(`${API}/applicant/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge_id: requestOtp.payload.data.challenge_id, otp: OTP }),
  });
  if (!verify.response.ok || !verify.payload?.success) throw new Error(verify.payload?.error?.message ?? 'Applicant OTP verify failed.');
  return verify.payload.data.token;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const db = JSON.parse(await readFile(DATA_FILE, 'utf8'));
  const application = db.applications.find((item) => item.id === APPLICATION_ID);
  assert(application, `Application ${APPLICATION_ID} not found in ${DATA_FILE}`);
  assert(application.agreement_workflow?.status === 'executed', 'Agreement must be executed before training unlock test.');

  const token = await adminToken();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const catalog = await json(`${API}/admin/training/videos`, { headers: auth });
  assert(catalog.response.ok && catalog.payload?.success && catalog.payload.data?.length >= 3, 'Training catalog must contain at least 3 published videos.');

  const unlock = await json(`${API}/admin/applications/${APPLICATION_ID}/training/unlock`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ business_name: BUSINESS_NAME }),
  });
  assert(unlock.response.ok && unlock.payload?.success, unlock.payload?.error?.message ?? 'Training unlock failed.');
  const training = unlock.payload.data.training;
  assert(training?.unlocked, 'Training should be unlocked.');
  assert(training.business_name === BUSINESS_NAME, 'Business name should be saved at unlock.');
  assert(training.franchise_address, 'Franchise address should be fetched at unlock.');
  assert(training.videos.length >= 3, 'Applicant should have assigned training videos.');
  assert(!training.certificate, 'Certificate must not exist before manager issue.');

  const applicantAuth = { Authorization: `Bearer ${await applicantToken(application)}` };
  let current = unlock.payload.data;
  for (const video of training.videos) {
    const complete = await json(`${API}/applicant/training/videos/${video.id}/complete`, { method: 'POST', headers: applicantAuth });
    assert(complete.response.ok && complete.payload?.success, complete.payload?.error?.message ?? `Unable to complete video ${video.id}`);
    current = complete.payload.data;
    assert(!current.training?.certificate, 'Certificate must not auto-generate after video completion.');
  }

  assert(current.training?.can_issue_certificate, 'Manager should be able to issue the certificate now.');
  const blockedDownload = await fetch(`${API}/applicant/training/certificate`, { headers: applicantAuth });
  assert(blockedDownload.status === 403, 'Applicant download should stay blocked until manager issue.');

  const issue = await json(`${API}/admin/applications/${APPLICATION_ID}/training/certificate/issue`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ business_name: BUSINESS_NAME }),
  });
  assert(issue.response.ok && issue.payload?.success, issue.payload?.error?.message ?? 'Certificate issue failed.');
  current = issue.payload.data;
  assert(current.training?.certificate?.certificate_number, 'Training completion certificate should be issued by manager.');
  const certificateNumber = current.training.certificate.certificate_number;

  const verifyJson = await json(`${API}/training-certificates/verify/${encodeURIComponent(certificateNumber)}`);
  assert(verifyJson.response.ok && verifyJson.payload?.success && verifyJson.payload.data?.valid, 'Certificate JSON verification failed.');

  const applicantPdf = await fetch(`${API}/applicant/training/certificate`, { headers: applicantAuth });
  assert(applicantPdf.ok, 'Applicant certificate download failed.');
  assert((await applicantPdf.blob()).size > 500, 'Applicant certificate PDF looks empty.');

  const adminPdf = await fetch(`${API}/admin/applications/${APPLICATION_ID}/training/certificate`, { headers: { Authorization: `Bearer ${token}` } });
  assert(adminPdf.ok, 'Manager certificate download failed.');

  console.log('Training workflow verification passed.');
  console.log(`Application: ${application.application_number}`);
  console.log(`Business name: ${BUSINESS_NAME}`);
  console.log(`Certificate: ${certificateNumber}`);
  console.log(`Videos completed: ${current.training.progress.completed}/${current.training.progress.total}`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
