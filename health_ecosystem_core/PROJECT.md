# Health Ecosystem Core

Last updated: 2026-10-29

Frappe application `health_ecosystem_core` 1.0.0 for ERPNext v15. It is the system of record for the live health site: lab TRF booking, payment, LIS results, franchisee, pharmacy, careers, sales and wellness.

Read `../AGENTS_CONTEXT.md` before any live change. History of phases 1–63 is in `../VERSION_HISTORY.md`.

## Owns

- This folder.
- Server package at `site-packages/health_ecosystem_core` after `docker/safe-update-app.sh`.
- DocTypes, hooks, patches and `clinical_phase*.py` modules.

## Talks to

- **Health Web App** and **Health Flutter App** call `/api/method/health_ecosystem_core.health_ecosystem_core.api.*`.
- **RFMS** receives franchise handoff from Reach (`clinical_phase80_onboarding_bridge.py`) and reads franchisee hub fields.
- ERPNext, HRMS and Frappe are the host. This app does not replace them.

## Layout

The repo root and the Python package share a name, so there is one extra directory:

- `health_ecosystem_core/health_ecosystem_core/` is the top package on `sys.path`. On the server that matches `site-packages/health_ecosystem_core/`.
- `health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/` is the inner package. It holds `clinical_phase*.py`, `api.py` and `doctype/`. On the server that matches `site-packages/health_ecosystem_core/health_ecosystem_core/`.

When comparing the repo with site-packages, line up the inner package with site-packages `health_ecosystem_core`. A one-level mismatch looks like drift that is not there.

`modules.txt` names the Frappe module **Health Ecosystem Core**. `setup.py` describes the app as lab TRF, results, franchisee and pharmacy.

## Live stack (recorded in this repo)

- Server `167.233.108.90`. Site name `health.localhost`.
- ERPNext desk: `http://167.233.108.90:8080`.
- Running apps recorded on 2026-07-22: ERPNext **15.81.1**, Frappe **15.84.0**, HRMS **15.63.0**.
- Compose on the server: `/opt/health-ecosystem/docker`. Older notes also mention `/root/My_Lab_System/docker`. Check which path exists before copying files.
- The image tag in compose was still `frappe/erpnext:v15.34.0` after the in-place upgrade. Recreating the container from that image would drop the upgraded apps. Prefer `docker compose restart`.

## Deploy

1. Copy only the changed app folder to the server.
2. Run `docker/safe-update-app.sh` inside the server compose directory.
3. Run bench only inside the backend container (`docker/bench.sh` or the safe-update script). Bench on the host VM fails.

`safe-update-app.sh` force-reinstalls from the apps tree into site-packages. A live check on 2026-07-21 kept the file count at 399 with nothing dropped. Do not `pip install -e` a hotfix onto the live workers. That left gunicorn unable to import this app.

Full migrate can still fail on the DocType `hec_job_application_education`. Phase 80 and Phase 81 used their own apply scripts until that module is restored.

## Working behaviour to keep

- Lab TRF booking, payment, LIS and results.
- Franchisee dashboard, pharmacy orders and the mobile API in `api.py`.
- Users already on the site include `system_admin`, `franchise_hub` and `lab_tech_core`. Demo account names are seeded from `init.py`. Passwords stay on the server and in `AGENTS_CONTEXT.md`. Do not copy them here.

## Later additions recorded in the shared context

- Native ERPNext Department, Employee, ToDo, Communication and Email Template workflows (`tasks.py`, `hooks.py`, `workflow_seed.py`, `task_catalog.py`).
- Franchisee hub sheet import and opening wallet (`clinical_franchisee_import.py`). Opening balance is `max(0, deposit − ₹80,000)` through the existing Franchisee Wallet Transaction. There is no second wallet DocType.
- Reach to FFMS onboarding (`clinical_phase80_onboarding_bridge.py`): a CRM lead only, then the applicant chooses FOFO or FOCO.
- OpenAI physician journey (`clinical_openai.py`), careers (`clinical_phase73b_careers.py` onward), patient referral wallet (`clinical_phase75_patient_referral`).
- People HRMS (`clinical_phase90_people_hrms.py` and the `clinical_people_*.py` modules: WDD org masters, employee edit/delete, leave attachments, payroll edit, ID verification, portal access and permission enforcement). These are hot-deployed by the People add-on restore cron, not by `safe-update-app.sh`; see the People HRMS section in `../AGENTS_CONTEXT.md`.

## Commands

```bash
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.init.run_clinical_setup
```

Phase setup entry points live on `init.py` (`run_phase6_setup`, `run_phase8_setup`, `run_phase9_setup`, `run_phase11_iam`, and the later `setup_phase73*` helpers).
