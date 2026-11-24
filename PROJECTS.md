# e-Remedium — project index

Last updated: 2026-11-01

This repository is the master tree for several products. Each product has its own `PROJECT.md`. Shared live-system notes stay in `AGENTS_CONTEXT.md`. Phased delivery history stays in `VERSION_HISTORY.md`.

Source commit: `bfa782c` (2026-09-20, `Merge branch 'feat/jyotish-ai-predict'`).

Do not copy passwords, API keys or tokens into any of these files.

## Health ecosystem

Live lab, pharmacy, careers, sales and wellness site. One ERPNext site, one Docker stack.

| Project | Path | What it is |
|---|---|---|
| Health Ecosystem Core | `health_ecosystem_core/PROJECT.md` | Frappe app on ERPNext v15. Lab TRF, LIS, franchisee, pharmacy, HR and sales APIs. |
| Health Web App | `health_web_app/PROJECT.md` | React + Vite site for patients, staff, careers, sales and wellness. |
| Health Flutter App | `health_flutter_app/PROJECT.md` | Mobile client of the same APIs. Dart sources are absent from this remote. |
| Docker and server scripts | `docker/PROJECT.md` | Safe deploy, smoke tests and FFMS path fixes for the live server. |
| People HRMS add-ons | `.deploy/` + `AGENTS_CONTEXT.md` (People HRMS section) | Add-on JS/CSS and `clinical_people_*` modules for people.e-remedium.in, plus the self-healing restore cron. |
| Operations portal | `ops_portal/AGENTS.md` | Static operations console at ops.e-remedium.in with the HRMS sign-in gate (`public/ops-gate.js`). |
| CRM portal | `crm_portal/AGENTS.md` | Telecaller CRM at crm.e-remedium.in — leads, Aesthetic/Care bookings, FFMS/RFMS franchise, partner-unit bookings. |

## Remedium Franchise Management (RFMS / FFMS)

Monorepo at `apps_external/ffms/PROJECT.md`.

| App | Path | Local port |
|---|---|---|
| Marketing website | `apps_external/ffms/apps/marketing-web/PROJECT.md` | 3000 |
| Applicant portal | `apps_external/ffms/apps/franchise-portal/PROJECT.md` | 3001 |
| Admin dashboard | `apps_external/ffms/apps/admin-dashboard/PROJECT.md` | 3002 |
| Local API | `apps_external/ffms/apps/local-api/PROJECT.md` | 8080 |
| Laravel API | `apps_external/ffms/apps/api/PROJECT.md` | Docker (PHP 8.2+) |

Shared libraries live in `apps_external/ffms/packages/` (`api-client`, `types`, `ui`, `utils`, `validation`).

## Smilecure AI Workforce

Internal multi-channel AI agent platform (telephone, WhatsApp, email; Bengali, Hindi, English). Separate
Docker Compose project (`aiw`: Laravel core, FastAPI AI service, React console, PostgreSQL + pgvector, Redis).
Reaches the ERP/HRMS only over HTTP through verified endpoints. Phase 01 (foundation) done 2026-11-12,
awaiting approval.

| Project | Path | What it is |
|---|---|---|
| AI Workforce | `ai_workforce/AGENTS.md` → `ai_workforce/docs/PROJECT_BIBLE.md` | Architecture, documents, services and Docker environment. Dev console http://localhost:8700. |

## Spiritual-Tech Super App

A separate product. Its own Postgres, Redis and LiveKit stack. It does not use the health ERPNext site.

| Service | Path |
|---|---|
| Product rules | `spiritual_super_app/PROJECT.md` and `spiritual_super_app/.cursorrules` |
| Web | `spiritual_super_app/frontend/PROJECT.md` |
| Business gateway | `spiritual_super_app/backend/core-gateway/PROJECT.md` |
| Astrology and Ayurveda compute | `spiritual_super_app/backend/astro-service/PROJECT.md` |

CI for this product only: `.github/workflows/spiritual-super-app.yml`.
