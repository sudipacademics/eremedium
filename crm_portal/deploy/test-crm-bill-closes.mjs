import Database from 'better-sqlite3';
import { createRequire } from 'module';
import path from 'path';
import { pathToFileURL } from 'url';

const careRoot = '/opt/health-ecosystem/care_portal';
process.chdir(careRoot);
process.env.CARE_FLAVOR = 'aesthetic';

const api = await import(pathToFileURL(path.join(careRoot, 'server/api.mjs')).href);
const db = new Database('/opt/health-ecosystem/care_portal/data-aesthetic/aesthetic.db');
db.function?.(); // no-op guard
const out = api.listCrmBillCloses({ db, q: { limit: 20 } });
console.log(JSON.stringify(out, null, 2));
