# Shared project context (read by all Cursor agents)

Each product has its own `PROJECT.md`. Start with `PROJECTS.md`, then read the sections below that name that product. This file stays the shared live-system record. Do not copy passwords or API keys into the project files.

## Live system — DO NOT destroy

- **Server:** root@167.233.108.90
- **ERPNext URL:** http://167.233.108.90:8080
- **Compose path on server:** `/root/My_Lab_System/docker` (or `/root/docker` if older layout — check first)
- **Site name:** `health.localhost` (verify with `bench --site all list-sites`)
- **Flutter app** points to production API in `health_flutter_app/lib/core/config/app_config.dart`

## What is already working (do not break)

- Lab TRF booking → payment → LIS → results pipeline
- Franchisee dashboard, pharmacy orders, mobile API (`api.py`)
- Docker stack: backend, frontend (nginx), mariadb, redis, workers, scheduler
- Existing users: system_admin, franchise_hub, lab_tech_core

## What was added recently (incremental)

- Operational workflows using **native ERPNext**: Department, Employee, ToDo, Communication, Email Template
- Scheduled tasks in `tasks.py` + `hooks.py` scheduler_events
- Seed data in `workflow_seed.py` + `task_catalog.py`
- Safe update script: `docker/safe-update-app.sh` — **use this instead of deploy-on-server.sh**

## Safe deploy rules

1. **Never** run `docker compose down -v` (deletes DB volumes)
2. **Never** run `deploy-on-server.sh` on a live server unless intentional full reset
3. **Always** SCP only changed folders, then run `safe-update-app.sh`
4. **Always** run bench inside container via `docker/ bench.sh` or `safe-update-app.sh`
5. `bench` on host VM will fail — only works in Docker backend container

## SCP commands (desktop → server)

```powershell
# App code only (most common)
scp -r "C:\Users\91801\OneDrive\Desktop\My_Lab_System\health_ecosystem_core" root@167.233.108.90:/root/My_Lab_System/

# Docker scripts only
scp -r "C:\Users\91801\OneDrive\Desktop\My_Lab_System\docker\scripts" root@167.233.108.90:/root/My_Lab_System/docker/
scp "C:\Users\91801\OneDrive\Desktop\My_Lab_System\docker\safe-update-app.sh" root@167.233.108.90:/root/My_Lab_System/docker/
scp "C:\Users\91801\OneDrive\Desktop\My_Lab_System\docker\bench.sh" root@167.233.108.90:/root/My_Lab_System/docker/
```

## Server commands after SCP

```bash
ssh root@167.233.108.90
cd /root/My_Lab_System/docker   # adjust if your compose lives elsewhere
chmod +x safe-update-app.sh bench.sh scripts/*.sh
./safe-update-app.sh
```

## Agent handoff notes

- **Backend agent:** owns `health_ecosystem_core/`, Docker, bench, ERPNext
- **Frontend agent:** owns `health_flutter_app/` — consumes API at `/api/method/health_ecosystem_core.health_ecosystem_core.api.*`
- New API endpoints: `get_my_operational_schedule`, `get_company_divisions`, `get_division_employees`, `get_operational_notification_log`
- Sub-agents cannot auto-share chat memory — both must read this file

## Phase 25 + 65

- Sales: https://reach.e-remedium.in/sales — `sales_rep1@health.local` / `SalesRepChangeMe@123`
- HR (careers / marketing / pipeline): https://www.e-remedium.in/hr/applications — `hr_manager@health.local` / `HrManagerChangeMe@123`
- Hiring ads sync (phase 73f): Health Ecosystem Settings → Hiring Ad Analytics (Meta + Google tokens). Daily job `run_daily_hiring_ads_sync`. CSV: `import_campaigns_csv` / `import_leads_csv`. Webhook: `clinical_phase73f_ad_sync.ingest_ad_lead` + header `X-Hiring-Ads-Secret`.
- Masked calls need Settings: telephony_enabled + exotel_sid + exotel_api_key + exotel_api_token + exotel_virtual_number; staff `mobile_no`
- Canonical code: `C:\develop\My_Lab_System`; compose on server: `/opt/health-ecosystem/docker`

## People HRMS add-on layer + portal access (2026-10-31 → 2026-11-01)

Live at https://people.e-remedium.in (same SPA also on `www.remediumlabs.in/people/*` and `aesthetics.e-remedium.in/people/*`). Owner: Snehasish Ganguly.

### How it is built and deployed (read before touching HRMS)

- **Main SPA bundle is built and deployed from another machine** (`/opt/health-ecosystem/health_web_app/dist/web-assets/index-*.js`, renamed copies such as `-fix2`, `-auth`). Those deploys have wiped HRMS files more than once. **Do not full-rebuild the SPA from this tree for HRMS work** (some CSS sources were missing); HRMS changes ship as plain add-on JS/CSS files loaded by `dist/index.html`.
- **Add-on store on the server:** `/opt/health-ecosystem/people-addons/` (web files) and `people-addons/backend/` (`clinical_*.py`). Repo sources: `health_web_app/public/{people-org,people-access,people-geofence,employee-id-card,people-user-menu,people-profile-align}.{js,css}`, `qrcode-generator.js`, `verify-id.html`; backend `health_ecosystem_core/.../clinical_people_*.py`; ops gate `ops_portal/public/ops-gate.js`.
- **Self-healing cron (root):** `*/2 * * * * /usr/bin/python3 /opt/health-ecosystem/people-addons/restore_people_addons.py >> /var/log/people-addons.log`. Source `.deploy/restore_people_addons.py`. Every run it:
  - copies add-on files into `dist/` and re-adds the versioned `<script>/<link>` tags (`TAGS`) to `dist/index.html`; bumps the `index.html` revision in `dist/sw.js` (md5 of the HTML) so browsers pick up new versions;
  - copies `backend/clinical_*.py` into the backend container's site-packages, re-adds the `before_request` hook `clinical_people_access.enforce_portal_permissions` to `hooks.py`, and re-applies three surgical patches (phase132 `pinned = {"hr_manager@health.local"}` so the demo HR password is not rotated; phase90 `include_inactive` employee filter; phase90 asset `geo_sites` locations). Restarts `docker-backend-1` only when something changed;
  - re-installs `ops-gate.js` + its tag in `/opt/health-ecosystem/ops_portal/dist/index.html`;
  - applies `BUNDLE_PATCHES` to the live main bundle when a redeploy dropped them (aesthetic console admits `Aesthetic Staff` / `Aesthetic Manager`; lab staff are not redirected away from `/people/*` inside an embedded frame). Bundles are cached as immutable, so the patched copy is saved as `<entry>-pa.js` and `index.html` is pointed at it.
- **Deploy flow:** bump the `?v=` in `TAGS` (and in `health_web_app/index.html`), `scp` files to `/tmp/addons/`, then `bash /tmp/addons/publish_addons.sh` (stages `clinical_*.py` into `people-addons/backend`, other files into `people-addons/`, runs the restore). Compile-check Python first in a separate dir (a `__pycache__` folder inside `/tmp/addons` stops the publish script).
- **Testing without passwords:** create a temporary Frappe session server-side (`frappe.sessions.Session` inside a werkzeug `EnvironBuilder` request context), put `{sid,user,fullName,roles}` in the browser's `localStorage.hec_web_session` (ops portal: `ops_session`), then delete the session with `delete_session`. Never print rotated passwords (`hec_rotated_admin_passwords`).

### Features (all live)

- **WDD module** (Wing → Division → Department → Designation → Unit/Centre → Position): tree page, add/edit/deactivate/delete (blocked when children or employees exist), `parent_master` link prevents cross-wing overlap. Inline WDD filters on Employees/Leave/Attendance/Payslips/etc. **for HR only** (`get_people_org.can_edit`). Backend `clinical_people_org.py`, `clinical_people_org_delete.py`.
- **Employees:** add/edit popup with full org chain, reporting manager, photo, geofence site; View panel shows the 7.5 × 11 cm ID card (Directory only); single + bulk delete with password check (`clinical_people_employee_delete.py`: permanent delete keeping history, or mark Left). The table pencil links to ERPNext `/app/employee/…`; `people-org.js` intercepts it once org data has loaded — keep `ensureData()` running on those pages.
- **ID card + secure QR:** `employee-id-card.js` renders a fixed-size card; QR opens `/api/method/…clinical_people_id_verify.card?t=<HMAC token>` which shows data only for Active employees.
- **Leave attachments** (`clinical_people_leave_attach.py`), **payroll edit** for HR (`clinical_people_payroll_edit.py`), **geofence editor popup + saved-site dropdowns** (`people-geofence.js`), asset location list from geofence sites.
- **Portal Access + module permissions** (`clinical_people_access.py`, `people-access.js`): DocType `People Portal Access` (employee, portal, login_user, permissions JSON, active). Levels none/view/create/edit/approve/manage. Portals: People HRMS, Lab Technician, Collection, Franchise Partners, Reach/Sales, Careers, **Aesthetic Backend** (`aesthetics.e-remedium.in`, roles Aesthetic Staff/Manager + Employee) and **Operations Backend** (`ops.e-remedium.in`, roles Operations Staff/Manager + Employee). Roles are created on first use; role sync only removes roles this screen granted. Enforcement: frontend nav/URL gating per portal + backend `before_request` hook (`METHOD_RULES`) for People APIs. `save_access` links the People login to `Employee.user_id` (never auto-creates a duplicate employee) and marks HR-issued logins email-verified.
- **Asset assignment PDF** on assign (no digital signature; blank signature lines for paper signing), stored as a private People Document.
- **Ops portal sign-in gate** (`ops-gate.js`): the ops portal had no login. It now requires an HRMS login with Operations Backend access (System Managers exempt) and hides/blocks modules set to none.
- **My HR Workspace inside other consoles (same for every employee):** aesthetic console (same origin), ops portal, and the lab/collection **My Profile** page (`.mp2-page` on labtech / collect / remediumlabs hosts) embed `people.e-remedium.in/people/profile` with HRMS chrome hidden and a workspace tab bar. Cross-origin parents pass their session via `postMessage`; the workspace only accepts origins in `EMBED_PARENTS` (`people-access.js`) and the parents only answer `https://people.e-remedium.in`. Shared session: signing out of one signs out the other.

### Gotchas

- Browsers keep old add-on versions until the service worker updates: always bump `?v=`; users may need one or two reloads.
- The main SPA redirects to `/login` before deferred add-ons run, so query markers can be lost; cross-origin embed detection uses the parent origin instead.
- `get_my_portal_permissions` only requires a valid session (not People roles) so aesthetic/ops-only staff can use it.

## Phase 84 — WB geo master (ERP) → RFMS map + Reach sales (2026-07-29)

- **Goal:** ERPNext holds the West Bengal Administrative & Postal Directory (V2) as geographic SoR; RFMS keeps operational FOFO/FOCO capacity (no auto-open of every PIN); Reach rolls up sales by district.
- **Data:** `docker/data/wb-postal-directory-v2.json` (~341 rows). DocType `HEC WB Postal Locality`.
- **HEC:** `clinical_phase84_wb_geo.py` — import + `get_wb_geo_hierarchy` / `resolve_wb_pincode` / `get_territorial_sales_summary`. Lead fields: `district`, `subdivision`, `pincode`.
- **RFMS:** `GET /api/v1/geo/wb-hierarchy` (1h cache), `GET /api/v1/geo/pincode/:pin`. Territory Setup picklists from ERP; PIN add warns if unknown. Google map default filter **Active** (capacity or allocation) + All/Available/Reserved/Occupied.
- **Reach:** leads/onboard geo pickers; Reports territorial table + bar; team map colours/labels by district.
- **Deploy:** hot-copy (skip full migrate while `hec_job_application_education` broken). Scripts: `hot-deploy-phase84-wb-geo.sh`, `import-wb-postal-directory.sh`, `smoke-phase84-wb-geo.sh`.
- **Operator:** Desk confirm row count on `HEC WB Postal Locality` (341); hard-refresh `/ffms` Territory → Active map; on Reach `/sales` create lead with district/PIN and open Reports territorial section. Smoke PIN sample: `700135` (Rajarhat).
- **Live 2026-07-29:** `PHASE84_OK` / `PHASE84_HOT_DEPLOY_DONE` — import 341 rows / 23 districts; RFMS hierarchy + PIN resolve OK; admin rebuilt with Active map filters; Reach dist deployed with geo pickers + territorial reports.

## Phase 83 — HEC secrets hub + RFMS↔ERPNext bridge (2026-07-29)

- **Goal:** Mother ERPNext holds Razorpay + MSG91 secrets and the Google Maps **browser** key. RFMS never stores Razorpay secret / MSG91 authkey; it fetches safe config and proxies OTP + Razorpay create/verify over the Phase 80 HMAC bridge.
- **HEC:** `google_maps_api_key` on Health Ecosystem Settings; `clinical_phase83_rfms_bridge.py` + API methods `get_rfms_integration_config`, `create_rfms_razorpay_order`, `verify_rfms_razorpay_payment`.
- **RFMS:** `hec-frappe-bridge.mjs` config/order/verify helpers; `GET /api/v1/integrations/public-config`; officer `GET /api/v1/admin/integrations/maps-key`; gateway `initiate`/`complete` via ERP (simulate only when `RFMS_GATEWAY_SIMULATE=1` or ERP test mode without key_id). Default `RFMS_CONTACT_OTP_VIA_ERP=1` (mobile + email).
- **UI:** Portal uses Razorpay Checkout.js when `key_id` + `razorpay_order_id` returned; admin Maps prefers runtime key from ERP over baked `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
- **Deploy:** hot-copy (skip full migrate while `hec_job_application_education` broken). Scripts: `docker/scripts/hot-deploy-phase83.sh`, `docker/scripts/smoke-phase83-erp-bridge.sh`.
- **Live 2026-07-29:** `PHASE83_OK` / `PHASE83_HOT_DEPLOY_DONE` — ERP config returns Razorpay key_id + MSG91 flags (no secrets); RFMS `public-config` 200; contact OTP live MSG91 path. Portal/admin rebuilt for Checkout.js + runtime Maps.
- **Operator verify 2026-07-29:** Desk Maps field had a `GOCSPX-…` OAuth client secret by mistake (was briefly on public-config) — replaced with browser `AIza…` key from RFMS env. **Rotate that Google OAuth client secret** in GCP. Maps geocode now **OK**. Live Razorpay `gateway/initiate` via ERP: `PHASE83_GATEWAY_INIT_OK`. Scripts: `verify-phase83-operator.sh`, `test-phase83-gateway-init.sh`.
- **Operator:** hard-refresh `/ffms` and `/onboard`. Manual Checkout pay still needed for full paid→officer path (cannot automate live card).

## Phase 82b — Real officer company IDs (2026-07-29)

- **Scope:** User Management issues permanent company IDs (`RFMS-NNNN`) for staff login instead of typing free-form IDs / relying only on seed `RFMS-0001…0007`.
- **API:** `nextOfficerEmployeeId()`; `POST /admin/users` auto-allocates from `RFMS-0008+`; `GET /admin/users/next-employee-id` preview; PATCH refuses ID changes; format `^RFMS-\d{4,}$`.
- **UI:** Company ID column; create shows next ID (read-only); edit locks ID; success toast includes issued ID.
- **Seed hygiene:** empty officers table still bootstraps demo accounts; missing-seed append only when `RFMS_SEED_OFFICERS=1`.
- **Smoke:** `docker/scripts/smoke-phase82b-officer-ids.sh`. **Live 2026-07-29:** `PHASE82B_OK` (issued `RFMS-0008`/`RFMS-0009`, login OK, ID immutable). Admin UI rebuilt (`PHASE82B_UI_DONE`).

## Phase 82 UI — receipt download + agreement PDF worker (2026-07-29)

- **Admin receipt download:** Payments panel was calling `origin + /api/v1/...` and missing live `/rfms-api/v1`. Fixed in `payment-operations.tsx` via `resolveReceiptApiUrl` against `RFMS_API_BASE`.
- **Agreement PDF viewer:** portal used `window.location.origin/pdf.worker.min.mjs` (hits www root HTML). Now `appPath('/pdf.worker.min.mjs')` → `/onboard/pdf.worker.min.mjs`.
- **Note:** `/rfms-api/v1/receipts/verify/RCP-…` returns JSON metadata for QR validation; PDF download is the admin/public `.../payments/{key}/receipt` route.
- **Deploy:** `docker/scripts/deploy-phase82-ui-fixes.sh` + `rebuild-rfms-with-maps-key.sh`. Live: `PHASE82_UI_DEPLOY_DONE`, `MAPS_KEY_BAKED_OK`.

## Phase 82a — Fresh FOFO/FOCO applicant path (2026-07-28)

- **Scope:** Reach mint → `/onboard/hec-session` lead-only handoff → applicant picks FOFO/FOCO → contact OTP + KYC docs → submit → first payment (simulated gateway) → officer sees app in `/ffms` Applicants (`visible_to_admin=true` only after payment).
- **Fixes:** public KYC contact OTP defaults via ERP when `RFMS_CONTACT_OTP_VIA_ERP=1` (Phase 83); `123456` when ERP `otp_test_mode` / flag off; ERP send failure still falls back when `RFMS_OTP_DEV_FALLBACK=1`; `territoryAllocation` no longer invents FOFO for blank model.
- **Smoke:** `docker/scripts/smoke-phase82a-fresh-applicant.sh` (API E2E). Deploy API: SCP `server.mjs` → `/tmp/phase82a-server.mjs`, SCP smoke + `hot-deploy-phase82a.sh`, then `bash docker/scripts/hot-deploy-phase82a.sh`. **Live 2026-07-28:** `PHASE82A_OK` — mint → OTP → FOFO app → gateway pay → officer `/applications` sees applicant; lead `franchise_model=FOFO`.
- **Superseded by Phase 83:** live Razorpay/MSG91 bridge + Maps key from HEC (see Phase 83). Officer company IDs: see Phase 82b.

## Phase 81 — Franchisee Hub sheet + wallet (2026-07-28)

- **Scope:** expand `Franchisee Profile` with commercials/GPS/bank/docs; import ops sheet into profiles; opening wallet = `max(0, deposit − ₹80,000 fee)` via Phase 23 `Franchisee Wallet Transaction` (`payment_reference=OPENING-RECHARGE`). No second wallet DocType.
- **Code:** `clinical_franchisee_import.py`; `get_franchisee_dashboard` returns wallet + hub fields; `search_franchisees` includes lat/lng/category/wallet.
- **Deploy:** SCP HEC + `docker/deploy-franchisee-hub.sh` + `docker/import-franchise-sheet.sh`; put CSV at `/tmp/franchise-sheet.csv` on server; `bash deploy-franchisee-hub.sh`. Prefer **`docker/scripts/hot-deploy-phase81-hub.sh`** until `hec_job_application_education` module is restored (full migrate still fails on that DocType). Users default password `HubChangeMe@123`.
- **Live 2026-07-28:** hot deploy OK; sheet import **21 updated / 0 errors**; `search_franchisees` HTTP 200 with wallet/category fields. Geocode skipped (`GEOCODE=0`); re-run import with `GEOCODE=1` for GPS.
- **Google Maps (FFMS admin):** prefer runtime key from HEC via RFMS `/admin/integrations/maps-key` (Phase 83). Bake `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` only as offline/dev fallback (`rebuild-rfms-with-maps-key.sh`). GCP project still needs **Billing enabled** or Maps returns `REQUEST_DENIED`.

## RFMS officer login (2026-07-28)

- Officer sign-in at `/ffms`: **company ID (`employee_id`) + password only**. No OTP.
- API: `POST /api/v1/auth/login` with `{ login_id, password }`. Legacy `/auth/otp/*` returns `OTP_DISABLED`.
- Company ID examples from seed: `RFMS-0001` (admin), `RFMS-0005` (consultant), etc. Email also accepted as alias for existing accounts.
- **Integrations:** Razorpay/MSG91/Maps hub is Phase 83 (ERP Settings). Officer IDs: see Phase 82b.
- **RFMS rebuilds:** use `docker/scripts/rebuild-rfms-with-maps-key.sh` when baking a Maps fallback key; runtime key from HEC is preferred after Phase 83.

## Phase 80 — FFMS ↔ Reach handoff (2026-07-27)

- **Flow:** Reach `submit_sales_onboarding` → `create_onboarding_session` (HMAC) → `https://www.e-remedium.in/onboard/hec-session?token=…` → FFMS creates a **CRM lead only** (no FOFO/FOCO auto-pick) → applicant lands on the portal form (prefilled contact/territory) → **user selects FOFO or FOCO** → KYC/payment → later `ingest_onboarding_result` updates Franchisee Profile.
- **Code:** `clinical_phase80_onboarding_bridge.py`; API wrappers in `api.py`; Reach CTA on `/sales/onboard` (`Start e-Aadhaar / e-agreement`); RFMS `ensureHecLinkedLead` + portal prefill query params (`hec_lead`, `hec_fp`, …).
- **Secrets:** `site_config.onboard_hmac_secret` must match RFMS `ONBOARD_HMAC_SECRET`; `onboard_base_url=https://www.e-remedium.in/onboard`.
- **Apply / smoke:** `docker/scripts/apply-phase80-bridge.sh`; `docker/smoke-ffms-reach.sh` (L1–L5). Live smoke 2026-07-27: **13/13 passed** (`FFMS_REACH_SMOKE_OK`).
- **Lead-only handoff smoke (2026-07-28):** `docker/scripts/smoke-reach-lead-handoff.sh` — mint → `/onboard/hec-session` 302 with `hec_lead`/`hec_fp` (no applicant token, no FOFO in URL) → CRM lead `source=reach_sales` + blank `franchise_model` → portal “Select FOFO or FOCO”. Live: **REACH_LEAD_HANDOFF_OK** (15/15).
- **Note:** full `safe-update-app.sh` migrate may still hit unrelated DocType import drift (`hec_job_application_education`); Phase 80 was hot-copied via apply script. Prefer apply script until that DocType module is reconciled.
- **Portal header:** applicant portal only (logo + chips). Marketing nav belongs on `/franchise/`, not `/onboard/`.
- **SW trap (2026-07-27):** www SPA `sw.js` `NavigationRoute` was serving `/index.html` for `/onboard/*`, so Reach “Start e-Aadhaar” looked like the marketing home. Fix: `navigateFallbackDenylist` in `health_web_app/vite.config.ts` + `docker/ffms-www-paths.sh` / `docker/scripts/patch-sw-ffms-denylist.sh`. After dist deploy, re-run the SW patch (or rebuild web so denylist is baked in). Verify anytime: `bash docker/scripts/verify-ffms-paths-sw.sh` on the server (or SCP then run). **Live check 2026-07-28:** denylist OK, nginx `^~ /franchise|/onboard|/ffms` OK, public `/franchise/` + `/onboard/` return FFMS HTML (not homepage), ports 3000–3002 up. If a browser still shows the patient home, hard-refresh / unregister SW for `www.e-remedium.in` — server truth is correct.

## Source of truth & apps↔site-packages reconciliation (2026-07-21)

- **Package nesting (important):** the repo root shares the app name, so there is one extra level.
  - `repo/health_ecosystem_core/health_ecosystem_core/`  == top package on sys.path == server `site-packages/health_ecosystem_core/`
  - `repo/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/` == the `health_ecosystem_core.health_ecosystem_core` subpackage (holds `clinical_phase*.py`, `doctype/`) == server `site-packages/health_ecosystem_core/health_ecosystem_core/`
  - When diffing apps vs site-packages, align **apps `.../health_ecosystem_core/health_ecosystem_core`** with **site-packages `.../health_ecosystem_core`** (off-by-one otherwise → false drift).
- **Drift fixed:** the `apps/` bind-mount was missing modules/DocTypes that the running `site-packages` had (`clinical_phase70_lab_bill_entry`, DocTypes `gst_*`, `mca_*`, `material_requirement_plan(_item)`, `resource_requirement_plan(_item)`, `sale_projection(_item)`, `ops_feedback_entry`, `erp_control_panel`, `hec_hsn_rule`, `workspace/`, `hec_company_ops.js`). Reconciled by extracting the authoritative site-packages tree into `apps/`.
- **Result:** `apps/` is now a **superset** of running `site-packages` → `docker/safe-update-app.sh` (pip force-reinstall from apps) can no longer drop a running module/DocType. Verified: all 59 `clinical_phase*` modules import; correctly-aligned diff shows only apps-only extras.
- **Backups (server):** `/opt/health-ecosystem/backups/apps-hec-<ts>.tgz` and `sp-hec-<ts>.tgz` (ts `20260721-080907`). Restore by extracting over the respective dir.
- **Known harmless cruft on server (NOT in repo):** a stray level-2 `clinical_phase70_lab_bill_entry.py` and a stray level-4 `.../health_ecosystem_core/clinical_phase69_pharma_bill.py` — unreferenced duplicates from past misplaced copies; left in place (safe to delete in a maintenance window).
- **Repo now == running app** (clean, minus the two strays). Helper scripts: `docker/reconcile-backup.sh`, `docker/reconcile-apply.sh` (host-side tar extract), `docker/reconcile-verify.sh`, `docker/diag-drift.sh` (correctly-aligned drift check).

## End-to-end validation of safe-update-app.sh (2026-07-21)

- Ran `docker/safe-update-app.sh` live. **Reinstall is proven safe:** site-packages file inventory PRE=399 → POST=399 with **0 dropped, 0 added** (force-reinstall from reconciled `apps/` reproduces the running package exactly). Imports 59/59, `get_oauth_providers` + `get_lab_test_catalog` HTTP 200, reconciled DocTypes load meta. Inventory tool: `docker/inv-sp.sh <tag>` → `/opt/health-ecosystem/backups/sp-inv-<tag>.txt`.

## ERPNext/Frappe bump — migrate unblocked (2026-07-22)

- **Was:** image `frappe/erpnext:v15.34.0` → erpnext **15.34.0**, frappe **15.40.0**, hrms **15.63.0**. `bench migrate` failed on hrms DocType **Shift Schedule Assignment** (`cannot import name 'build_qb_match_conditions'`).
- **Now (running apps/):** erpnext **15.81.1**, frappe **15.84.0**, hrms **15.63.0**. Migrate succeeds; `safe-update-app.sh` reaches `=== Safe update complete ===`. HTTP 200; 59/59 phase imports.
- **How:** `apps/erpnext` and `apps/frappe` have **no `.git`** (image layers). Upgraded via GitHub release tarball swap + `pip install -e --no-deps`, not `git checkout`. Script: `docker/upgrade-erpnext-15.70.sh` (defaults to the proven pair below; name kept for plan continuity).
- **Escalation note:** first attempt erpnext **v15.70.0** + frappe **v15.40.4** failed migrate — erpnext 15.70 needs `get_setup_wizard_completed_apps` (absent in frappe 15.40.4; present in **v15.84.0**). Proven pair matches [hrms#3619](https://github.com/frappe/hrms/issues/3619): **erpnext v15.81.1 + frappe v15.84.0**.
- **Backups:** `/opt/health-ecosystem/backups/apps-erpnext-pre-20260722-055018.tgz`, `apps-frappe-pre-20260722-055018.tgz`, site backup under `sites/health.localhost/private/backups/20260722_112019-*`, notes `upgrade-notes-20260722-055018.txt`.
- **Caveat:** compose still pins `image: frappe/erpnext:v15.34.0`. A container **recreate** from the image would wipe the swapped apps (hrms too — also not bind-mounted). Prefer `docker compose restart` only; do not recreate until image tag / bind-mount strategy is updated.

## OpenAI workflow (2026-07-23)

- **Earlier failure:** API key authenticated; project has `gpt-4o-mini`; Chat Completions returned **429 `insufficient_quota`** (OpenAI billing). Not a decrypt/key-path bug (Password field already uses `get_password`).
- **Live smoke after amend:** `probe_openai` → `ok: True` (reply `ok`); AI Physician journey `openai_enabled: True`. If quota returns, rule-based fallback still serves chat/voice.
- **Code amend:** shared `clinical_openai.py` — parses OpenAI error bodies, 5‑min cooldown on quota/429, surfaces `openai_status` on telephony dashboard + AI journey APIs; optional Settings field `openai_chat_model` (default `gpt-4o-mini`).
- **Ops:** billing https://platform.openai.com/account/billing ; probe via `check_openai_status` (`force_probe=1`) or `docker/smoke-openai-detailed.sh`.
- **Deploy note:** live workers load the app from `frappe-bench/apps/health_ecosystem_core` via `safe-update-app.sh` (pip copy into site-packages). Do **not** `pip install -e` hotfixes — that left gunicorn unable to import `health_ecosystem_core` and surfaced as “Server is missing the start_ai_physician_journey API”. Fix: `./safe-update-app.sh` + backend restart. Verified 2026-07-23: `www.e-remedium.in` start_ai_physician_journey returns success with `openai_enabled: true`.
- **AI Physician journey (2026-07-23):** OpenAI-led adaptive triage (JSON conductor, quick_replies, catalog-grounded suggest/refine, emergency phase). Host mount: `/opt/health-ecosystem/health_ecosystem_core` → container `apps/health_ecosystem_core`. Web: `health_web_app/dist` → `/opt/health-ecosystem/health_web_app/`.
- **Home / Profile / Refer & Earn (2026-07-23):** Mock-aligned home; `/account/profile` + `/account/refer`; Phase 75 patient wallet — ₹50/₹50 on signup with code, ₹100 to referrer on first paid order. Smoke: `clinical_phase75_patient_referral.smoke_phase75`.
- **Web deploy path:** nginx root is `/opt/health-ecosystem/health_web_app/dist` (not the parent folder). SCP `health_web_app/dist/*` there. Homepage mock v2 (carousel + image banners) live as of 2026-07-23.
- **Aesthetics clinic landing (2026-07-24):** Oliva-inspired `/wellness/aesthetics` — hero, trust, Skin/Hair/Body treatments, specialists, concerns, sticky CTA. Beauty & Aesthetics CSV mapped into aesthetics wing (Phase 31).
- **All wellness clinic landings (2026-07-24):** Psychology, Physio, Chiropractic share Oliva-style session landings; Yoga & Ayurveda use Indic-themed variants. Config in `wellnessClinicConfig.ts`.
- **Careers portal MVP (2026-07-24):** `career.e-remedium.in` — public `/careers`, `/jobs`, `/jobs/:id/apply`; HR `/hr/applications`. Backend `clinical_phase73b_careers.py` on HRMS Job Opening / Job Applicant. Setup: `bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase73b_careers.setup_phase73b`. **Ops:** add DNS A/AAAA for `career.e-remedium.in` + nginx server_name (same SPA root as www) + TLS; run domain seed so Frappe Domain includes `career.e-remedium.in`.
- **Applicant accounts 2a (2026-07-24):** `/my` hub — Dashboard, Applied Jobs, Profile, Documents. OTP login on careers; applications linked via `hec_user` + email/mobile claim. Prefill apply form from profile when signed in.
- **Hiring marketing 2b (2026-07-24):** `/hr/marketing` Digital Marketing Dashboard. DocTypes `HEC Hiring Campaign` / `HEC Hiring Lead`; APIs in `clinical_phase73d_hiring_marketing.py`. Setup: `…clinical_phase73d_hiring_marketing.setup_phase73d`.
- **Pipeline 2c (2026-07-24):** Interview schedule, notes/activity, job offer, onboarding checklist on HR application detail. DocTypes `HEC Interview Schedule` / `HEC Application Note` / `HEC Job Offer`; `clinical_phase73e_pipeline.py`.
