#!/bin/bash
set -euo pipefail
ROOT="/opt/health-ecosystem"
cd "$ROOT/docker"
docker compose cp \
  "$ROOT/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase71_ops_dashboards.py" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase71_ops_dashboards.py
docker compose exec -T -u root backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
NEST=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
cp -f apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase71_ops_dashboards.py "$NEST/clinical_phase71_ops_dashboards.py"
chown frappe:frappe "$NEST/clinical_phase71_ops_dashboards.py"
EOS
docker compose restart backend
sleep 10
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
printf '%s\n' \
'from health_ecosystem_core.health_ecosystem_core.clinical_phase71_ops_dashboards import setup_phase71' \
'print(setup_phase71())' \
'print("DASH", frappe.get_all("Dashboard", filters={"name":["like","HEC %"]}, pluck="name"))' \
'print("WS", frappe.db.exists("Workspace","HEC Company Ops"))' \
'print("PAGE", frappe.db.exists("Page","hec-company-ops"))' \
'exit()' \
| bench --site health.localhost console
bench --site health.localhost clear-cache
echo PHASE71_FIX_OK
EOS
