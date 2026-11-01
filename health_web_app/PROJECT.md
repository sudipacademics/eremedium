# Health Web App

Last updated: 2026-10-29

Chrome web client for the health ecosystem. Package name `health-web-app`. React 18, React Router 6 and Vite 5. It uses the same ERPNext methods as the Flutter app: `health_ecosystem_core.health_ecosystem_core.api.*`.

Public site, patient account, staff dashboards, careers, Reach sales, wellness clinics and a small B2B portal all live in this one SPA.

## Owns

- This folder, especially `src/pages`, `src/api.ts`, `src/auth` and `src/payments`.
- The built `dist/` that nginx serves.

## Talks to

- **Health Ecosystem Core** for every business call. Dev server proxies `/api` to ERPNext (default `http://167.233.108.90:8080`, override with `VITE_PROXY_TARGET`).
- Production leaves `VITE_API_BASE_URL` empty so the browser calls same-origin `/api`.
- **RFMS** is a different app. Public URLs `/franchise/`, `/onboard/` and `/ffms` must reach RFMS HTML. This SPA's service worker must not swallow those paths.

## Local commands

```bash
cd health_web_app
cp .env.example .env
npm install
npm run dev
```

Dev server: http://localhost:5173

```bash
VITE_API_BASE_URL= npm run build
```

## Live deploy

nginx root is `/opt/health-ecosystem/health_web_app/dist`. Copy the contents of `dist/` there.

```bash
cd health_web_app && npm ci && VITE_API_BASE_URL= npm run build
scp -r dist root@167.233.108.90:/opt/health-ecosystem/health_web_app/
```

Host config notes are in `docker/CAREER_PORTAL_NGINX.md` and the nginx samples under `docker/`.

## Routes already in `src/pages`

- Public: home, lab catalog and test detail, pharmacy, cart, checkout, centres, services, legal, wellness hub and clinic landings (`wellnessClinicConfig.ts`).
- Account: login, signup, OAuth callback, verify email, forgot password, profile, bookings, prescriptions, journey, refer and earn, subscriptions, complaints.
- Dashboards: patient, franchisee, phlebotomist, lab tech, staff, plus queues for lab reports, QC, QMS, reagents, telephony, teleconsult, insurance, pharmacy quotes and HR self-service.
- Careers: `/careers`, `/jobs`, apply, applicant `/my` hub, HR applications, hiring marketing. Intended host `career.e-remedium.in`, same SPA root as www.
- Sales (Reach): `/sales` catalog, leads, onboard, visits, franchisees, commission, reports, team map. Host `reach.e-remedium.in`.
- B2B: catalog, orders, wallet, statements.

Demo login names are seeded by Health Ecosystem Core `init.py` (for example `franchise_hub@health.local`, `lab_tech@health.local`). Do not copy passwords into this file.

## People HRMS add-ons

People HRMS (`/people/*`) features added after the last full build ship as plain files in `public/` (`people-org`, `people-access`, `people-geofence`, `employee-id-card`, `people-user-menu`, `people-profile-align`, `qrcode-generator.js`). `index.html` loads them with `?v=` versions. On the server they are kept in place by the People add-on restore cron; see the People HRMS section in `../AGENTS_CONTEXT.md` before changing them, and bump the version in both `index.html` and `.deploy/restore_people_addons.py`.

## Service worker and RFMS

`vite.config.ts` must keep a `navigateFallbackDenylist` so `/onboard/*`, `/franchise/*` and `/ffms` are not served as this app's `index.html`. After a dist deploy, re-apply `docker/scripts/patch-sw-ffms-denylist.sh` or rebuild so the denylist is baked in. Check with `docker/scripts/verify-ffms-paths-sw.sh`.

A browser that still shows the patient home on those paths is using an old service worker. The server check on 2026-07-28 already returned RFMS HTML for `/franchise/` and `/onboard/`.

## ERPNext data this UI expects

- Franchisee Profile rows with `active_status = Active` for collection centres.
- Sales items in item groups Lab Tests, Services, Medicines or Pharmacy, with a selling price or `standard_rate`.
