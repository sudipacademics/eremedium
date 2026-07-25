#!/bin/bash
# Deploy Phase 71 Company Ops KPI dashboards
set -euo pipefail
ROOT="/opt/health-ecosystem"
SITE="${FRAPPE_SITE:-health.localhost}"
cd "$ROOT/docker"

docker compose cp \
  "$ROOT/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase71_ops_dashboards.py" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase71_ops_dashboards.py

docker compose exec -T -u root backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
mkdir -p apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/page/hec_company_ops
EOS

docker compose cp \
  "$ROOT/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/page/hec_company_ops/hec_company_ops.js" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/page/hec_company_ops/hec_company_ops.js
docker compose cp \
  "$ROOT/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/page/hec_company_ops/hec_company_ops.json" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/page/hec_company_ops/hec_company_ops.json
docker compose cp \
  "$ROOT/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/page/hec_company_ops/__init__.py" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/page/hec_company_ops/__init__.py

docker compose exec -T -u root backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
NEST=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
PKG=$(./env/bin/python -c "import health_ecosystem_core, os; print(os.path.dirname(health_ecosystem_core.__file__))")
cp -f apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase71_ops_dashboards.py \
  "$NEST/clinical_phase71_ops_dashboards.py"
mkdir -p "$NEST/page/hec_company_ops" "$PKG/public/js" sites/assets/health_ecosystem_core/js
cp -rf apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/page/hec_company_ops/. \
  "$NEST/page/hec_company_ops/"
cp -f apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/page/hec_company_ops/hec_company_ops.js \
  sites/assets/health_ecosystem_core/js/hec_company_ops.js
cp -f apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/page/hec_company_ops/hec_company_ops.js \
  "$PKG/public/js/hec_company_ops.js"
chown -R frappe:frappe "$NEST" "$PKG/public" sites/assets/health_ecosystem_core/js \
  apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/page || true
EOS

docker compose restart backend
sleep 12

docker compose exec -T backend bash -s "$SITE" <<'EOS'
set -e
SITE="$1"
cd /home/frappe/frappe-bench
printf '%s\n' \
'from health_ecosystem_core.health_ecosystem_core.clinical_phase71_ops_dashboards import setup_phase71, api_get_company_ops_kpis' \
'print("SETUP", setup_phase71())' \
'k = api_get_company_ops_kpis(board="overview")' \
'print("OV", k.get("overview"))' \
'print("DASH", [d for d in ("HEC Company Overview","HEC Lab Operations","HEC Franchisee Network","HEC Pharmacy & Purchase","HEC Clinical Appointments") if frappe.db.exists("Dashboard", d)])' \
'print("PAGE", frappe.db.exists("Page","hec-company-ops"))' \
'print("WS", frappe.db.exists("Workspace","HEC Company Ops"))' \
'exit()' \
| bench --site "$SITE" console
bench --site "$SITE" clear-cache
echo PHASE71_OK
EOS
