#!/bin/bash
# Verify running app health after reconciliation:
#  - import every clinical_phase* module (running site-packages) via frappe.get_module
#  - re-affirm apps/ is a superset of site-packages (reinstall-safe)
cd /opt/health-ecosystem/docker
SITE=health.localhost
# Package levels (aligned for a Frappe app whose repo root shares the app name):
#   SP_TOP  = site-packages/health_ecosystem_core            == apps/.../health_ecosystem_core/health_ecosystem_core  (top package on sys.path)
#   SP_SUB  = site-packages/health_ecosystem_core/health_ecosystem_core  (the "health_ecosystem_core.health_ecosystem_core" subpackage that holds clinical_phase*.py)
SP_TOP=/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core
SP_SUB=$SP_TOP/health_ecosystem_core

echo "=== import integrity: all clinical_phase* modules ==="
mods=$(docker compose exec -T backend bash -lc "ls $SP_SUB/clinical_phase*.py | xargs -n1 basename | sed 's/.py\$//'")
fail=0; ok=0
for m in $mods; do
  out=$(docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute frappe.get_module --kwargs \"{'modulename': 'health_ecosystem_core.health_ecosystem_core.$m'}\" 2>&1")
  if echo "$out" | grep -q "module 'health_ecosystem_core"; then ok=$((ok+1)); else fail=$((fail+1)); echo "FAIL $m"; echo "$out" | grep -vE 'version.*obsolete|^time=' | tail -3; fi
done
echo "import_ok=$ok import_fail=$fail"

echo
echo "=== reinstall-safety: apps top package must be a SUPERSET of site-packages top package ==="
# Correct alignment: apps top package vs site-packages top package.
APPS_TOP=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core
docker compose exec -T backend bash -lc "diff -rq $APPS_TOP $SP_TOP 2>&1 | grep -vE '__pycache__|\.pyc' | grep -E 'Only in $SP_TOP|differ' || echo 'SUPERSET_OK (apps contains everything site-packages has; reinstall will not drop running code)'"
