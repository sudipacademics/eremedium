# Health Web App

Chrome-ready customer and staff web app using the **same ERPNext APIs** as the Flutter mobile app (`health_ecosystem_core.health_ecosystem_core.api.*`).

## Phase 10 features

- **Session auth** — login persists `sid` in localStorage (same pattern as Flutter secure storage)
- **Role-aware routing** — franchisee, phlebotomist, staff, and patient dashboards
- **Protected routes** — lab booking and dashboards require sign-in
- **Public browsing** — home, lab catalog, and pharmacy work without login
- **Live data** — `get_my_bookings` scoped by role (franchisee hub, staff, or patient)

## Setup (local dev)

```bash
cd health_web_app
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:5173

Dev server proxies `/api` to your ERPNext backend (default `http://167.233.108.90:8080`). Override with `VITE_PROXY_TARGET` in `.env`.

## Production build

```bash
# Same-origin API (nginx serves SPA + proxies /api) — leave VITE_API_BASE_URL empty
VITE_API_BASE_URL= npm run build
```

Serve `dist/` behind nginx (`docker/nginx/hetzner-host.conf` or `host-gateway.conf`).

Deploy to server:

```bash
cd health_web_app && npm ci && VITE_API_BASE_URL= npm run build
scp -r dist root@167.233.108.90:/opt/health-ecosystem/health_web_app/
```

Or run `bash docker/deploy-full-stack.sh` on the server after syncing the repo.

## Routes

| Path | Access |
|------|--------|
| `/` | Public |
| `/lab`, `/pharmacy` | Public catalog |
| `/lab/book/:itemCode` | Login required |
| `/login` | Guest |
| `/account` | Login required |
| `/dashboard` | Redirects to role default |
| `/dashboard/patient` | Any authenticated user |
| `/dashboard/franchisee` | Franchisee Operator |
| `/dashboard/phlebotomist` | Phlebotomist |
| `/dashboard/staff` | Admin / Lab Tech / Pathologist |

## Demo logins

See `health_ecosystem_core` `init.py` default users, e.g. `franchise_hub@health.local`, `lab_tech@health.local`.

## ERPNext requirements

1. **Collection centres** — `Franchisee Profile` with `active_status = Active`
2. **Lab items** — `Item` with `is_sales_item`, `item_group` = `Lab Tests` or `Services`
3. **Medicines** — `item_group` = `Medicines` or `Pharmacy`
4. **Prices** — `Item Price` on default selling price list or `standard_rate` on Item
