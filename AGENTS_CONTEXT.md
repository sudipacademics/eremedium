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
