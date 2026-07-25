# Shared project context (read by all Cursor agents)

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
