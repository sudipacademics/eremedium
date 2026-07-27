import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dataFile = path.resolve(process.env.RFMS_LOCAL_DATA_FILE ?? path.join(process.cwd(), 'work', 'isolated', 'rfms-local-api-data.json'));
const db = JSON.parse(readFileSync(dataFile, 'utf8'));
const app = db.applications?.find((item) => item.application_number === 'RFMS-2026-0001');

if (!app?.agreement_workflow) {
  console.error('RFMS-2026-0001 agreement workflow not found in', dataFile);
  process.exit(1);
}

const workflow = app.agreement_workflow;
const aadhaarVersion = Array.isArray(workflow.versions)
  ? workflow.versions.find((entry) => entry.type === 'aadhaar_esign')
  : null;

workflow.status = 'applicant_esign_completed';
workflow.execution_method = '';
delete workflow.company;
delete workflow.executed;
workflow.document = workflow.document && typeof workflow.document === 'object' ? workflow.document : {};
delete workflow.document.executed_file;
delete workflow.document.pending_executed_file;
if (aadhaarVersion) {
  workflow.document.aadhaar_signed_file = {
    id: aadhaarVersion.id,
    name: aadhaarVersion.name,
    url: aadhaarVersion.url,
    mime: aadhaarVersion.mime || 'application/pdf',
    uploaded_at: aadhaarVersion.created_at,
  };
}
workflow.applicant = workflow.applicant && typeof workflow.applicant === 'object' ? workflow.applicant : {};
workflow.applicant.terms_accepted_at = workflow.applicant.terms_accepted_at || aadhaarVersion?.created_at || new Date().toISOString();
workflow.applicant.esign_completed_at = aadhaarVersion?.created_at || workflow.applicant.esign_completed_at || new Date().toISOString();
workflow.applicant.esign_reference = aadhaarVersion?.reference || workflow.applicant.esign_reference || 'AADHAAR-ESIGN-RESTORED';
workflow.applicant.correction_request = '';
workflow.applicant.correction_requested_at = '';
workflow.applicant.correction_decision = '';
workflow.applicant.correction_decision_at = '';
workflow.applicant.correction_decision_by = '';
workflow.applicant.correction_response = '';

if (Array.isArray(workflow.history)) {
  workflow.history = workflow.history.filter((entry) => ![
    'company_dsc_completed',
    'agreement_executed',
    'agreement_manual_uploaded',
    'agreement_delivered_to_applicant',
    'agreement_correction_approved',
    'agreement_correction_denied',
  ].includes(entry.type));
}
if (Array.isArray(workflow.versions)) {
  workflow.versions = workflow.versions.filter((entry) => !['dsc_executed', 'manual_executed', 'manual_executed_pending'].includes(entry.type));
}
app.stage = 'agreement_in_process';
app.updated_at = new Date().toISOString();

writeFileSync(dataFile, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
console.log(`Reset ${app.application_number} to ${workflow.status} (${app.stage}) in ${dataFile}`);
console.log('Restart RFMS Isolated Services, or POST /api/v1/admin/system/reload-data as super admin.');
