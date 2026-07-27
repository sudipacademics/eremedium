#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_FILE = path.resolve('work/isolated/rfms-local-api-data.json');
const APPLICATION_ID = process.argv[2] ?? 'fdf05dc7-8e72-4a62-8d7b-a2913e4a30d4';

const db = JSON.parse(await readFile(DATA_FILE, 'utf8'));
const application = db.applications.find((item) => item.id === APPLICATION_ID);
if (!application) throw new Error(`Application ${APPLICATION_ID} not found.`);

application.training = {
  unlocked: false,
  unlocked_at: '',
  unlocked_by: '',
  business_name: '',
  franchise_address: '',
  videos: [],
  completed_at: '',
  certificate: null,
  history: [],
};
application.updated_at = new Date().toISOString();
await writeFile(DATA_FILE, `${JSON.stringify(db, null, 2)}\n`);
console.log(`Training reset for ${application.application_number}. Restart isolated services or refresh after API reload.`);
