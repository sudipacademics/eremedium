import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { passwordDetails, seedLegacyOfficerAccounts } from '../apps/local-api/admin-users-workflow.mjs';

const dataFile = path.resolve(process.env.RFMS_LOCAL_DATA_FILE ?? path.join(process.cwd(), 'work', 'rfms-local-api-data.json'));
const officerAccounts = [
  { email: 'admin@remediumlab.local', password: 'Admin@12345', name: 'RFMS Super Admin', role: 'super_admin', mobile: '9000000000' },
  { email: 'manager@remediumlab.local', password: 'Manager@12345', name: 'CRM Manager', role: 'franchise_manager', mobile: '9000000002' },
  { email: 'officer@remediumlab.local', password: 'Demo@12345', name: 'Demo Officer', role: 'franchise_officer', mobile: '9000000001' },
  { email: 'crm2@remediumlab.local', password: 'Crm2@12345', name: 'CRM Executive Two', role: 'franchise_officer', mobile: '9000000003' },
  { email: 'consultant@remediumlab.local', password: 'Consult@12345', name: 'Business Consultant', role: 'business_consultant', mobile: '9000000004', employee_id: 'RFMS-0005' },
  { email: 'advocate@remediumlab.local', password: 'Advocate@12345', name: 'Legal Advocate', role: 'advocate', mobile: '9000000005', employee_id: 'RFMS-0006' },
  { email: 'accountant@remediumlab.local', password: 'Account@12345', name: 'Finance Accountant', role: 'accountant', mobile: '9000000006', employee_id: 'RFMS-0007' },
];

const database = JSON.parse(await readFile(dataFile, 'utf8'));
if (!Array.isArray(database.officers) || !database.officers.length) {
  database.officers = seedLegacyOfficerAccounts(officerAccounts, passwordDetails);
  if (!Array.isArray(database.admin_audit_log)) database.admin_audit_log = [];
  await writeFile(dataFile, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
  console.log(`Seeded ${database.officers.length} admin users into ${dataFile}`);
} else {
  console.log(`Officers already present (${database.officers.length}) in ${dataFile}`);
}
