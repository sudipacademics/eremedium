# Smilecure CRM portal

Telecaller console for leads, opportunities, Aesthetic / Care bookings, FFMS/RFMS franchise leads, and partner-unit lab bookings. Public URL: https://crm.e-remedium.in  
It runs on the same Hetzner server as remediumlabs.in (`167.233.108.90`).

## Run

```bash
npm install
npm run dev   # http://127.0.0.1:5184/
npm run build # dist/ for the domain root
```

`/api` and `/files` proxy to the live labs site (same pattern as ops). `/rfms-api` proxies to RFMS/FFMS. `/care-api` and `/aes-api` proxy to the Care / Aesthetic session engines on the host.

Sign-in is `public/crm-gate.js` (HRMS login + Portal Access → **CRM Backend**). Session: `localStorage.crm_session`. Sales Representative / Sales Manager roles are also admitted until HR grants module rows.

## What telecallers can do

- **CRM core** — dashboard, leads, contacts, accounts, deals, activities, campaigns, reports (session store in `src/data.ts` / `src/store.tsx`; seed data for demos).
- **Aesthetic booking** — create consultation bookings via `/aes-api` (`createAestheticBooking` in `src/crmApi.ts`).
- **Care booking** — consultation / physiotherapy via `/care-api`.
- **Franchise (FFMS/RFMS)** — add franchise leads and start FOFO/FOCO creation; posts to `/rfms-api/v1/leads/public` and links to `/franchise`, `/ffms`, `/onboard` on www.
- **Partner unit bookings** — book lab work against franchise hubs (ERP `book_lab_test` when available; always kept in CRM bookings list).

UI matches the Smilecure CRM dashboard mock (navy sidebar, wing filters, funnel, Meta campaign card, follow-ups, timeline).

## Access (People HRMS)

Portal key `crm` in `clinical_people_access.py` (`PORTALS["crm"]`):

| Module | Paths |
|---|---|
| Dashboard | `/` |
| Service Lead (all wings) | `/leads/service/*` |
| Franchise Lead (all wings) | `/leads/franchise/*` |
| Contacts | `/contacts` |
| Accounts | `/accounts` |
| Deals | `/deals` |
| Service Followup (all wings) | `/activities/service/*` |
| Franchise Followup (all wings) | `/activities/franchise/*` |
| WhatsApp Centre (all wings) | `/whatsapp/*` |
| Bookings | `/bookings` |
| Franchise (FFMS/RFMS) | `/franchise` |
| Partner Unit Bookings | `/partner-bookings` |
| Campaigns | `/campaigns` |
| Reports & Analytics | `/reports` |
| Settings | `/settings` |

Roles: **CRM Executive** / **CRM Manager** (created on first use). Manage on any module → CRM Manager (sees all activity for enabled modules). Executive → only assigned modules. Categories **Service** / **Franchise** (stored on the access row) further scope leads, follow-ups, and WhatsApp wings for executives.

## Deploy

- Web root: `/opt/health-ecosystem/crm_portal/dist`
- Config: `/etc/nginx/sites-available/crm.e-remedium.in` (source in `nginx/crm.e-remedium.in.conf`)
- Certificate: `/etc/letsencrypt/live/crm.e-remedium.in/`
- DNS: `crm.e-remedium.in` A/AAAA to `167.233.108.90`

Until the certificate exists, `nginx/crm.e-remedium.in.http.conf` serves the site on port 80 so certbot can complete.

```bash
npm run build
# upload dist + nginx to the server
# install HTTP conf → certbot → swap to SSL conf
# ensure dist/assets is 755 and files 644
```

Also ship the updated `clinical_people_access.py` (CRM portal) via the People add-on backend store so HR can grant telecallers access.
