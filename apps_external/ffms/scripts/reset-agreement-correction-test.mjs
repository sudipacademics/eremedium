import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const confirmed = process.argv.includes('--confirm');
if (!confirmed) {
  console.error('This script resets RFMS-2026-0001 into correction_requested and clears applicant eSign / Step 4 state.');
  console.error('Re-run with --confirm if you intentionally want to test the correction workflow.');
  process.exit(1);
}

const dataFile = path.resolve(process.env.RFMS_LOCAL_DATA_FILE ?? path.join(process.cwd(), 'work', 'isolated', 'rfms-local-api-data.json'));
const db = JSON.parse(readFileSync(dataFile, 'utf8'));
const app = db.applications?.find((item) => item.application_number === 'RFMS-2026-0001');

if (!app?.agreement_workflow) {
  console.error('RFMS-2026-0001 agreement workflow not found in', dataFile);
  process.exit(1);
}

const workflow = app.agreement_workflow;
const now = new Date().toISOString();
workflow.status = 'correction_requested';
workflow.applicant = workflow.applicant && typeof workflow.applicant === 'object' ? workflow.applicant : {};
workflow.applicant.correction_request = 'Please update the allotted territory name to match the Territory Allotment Letter.';
workflow.applicant.correction_requested_at = now;
workflow.applicant.correction_decision = '';
workflow.applicant.correction_decision_at = '';
workflow.applicant.correction_decision_by = '';
workflow.applicant.correction_response = '';
workflow.applicant.terms_accepted_at = '';
workflow.applicant.esign_completed_at = '';
workflow.applicant.esign_reference = '';
delete workflow.executed;
delete workflow.company;
workflow.execution_method = '';
if (workflow.document) {
  delete workflow.document.executed_file;
  delete workflow.document.pending_executed_file;
  delete workflow.document.aadhaar_signed_file;
}
app.stage = 'agreement_in_process';
app.updated_at = now;

writeFileSync(dataFile, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
console.log(`Seeded ${app.application_number} with a pending applicant change request (${workflow.status}) in ${dataFile}`);
console.log('Step 4 is intentionally blocked until the correction cycle completes.');
console.log('To restore Step 4 testing instead, run: node scripts/reset-agreement-step4.mjs');
console.log('Restart RFMS Isolated Services, then open Manual Application Review or Agreements → Step 3.');
