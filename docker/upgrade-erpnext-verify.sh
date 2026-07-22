#!/bin/bash
# Post-upgrade verification.
cd /opt/health-ecosystem/docker
SITE=health.localhost

echo "=== versions ==="
docker compose exec -T backend bash -lc '
  cd /home/frappe/frappe-bench
  for a in frappe erpnext hrms; do grep -m1 __version__ apps/$a/$a/__init__.py; done
  ./env/bin/python -c "
from erpnext.accounts.utils import build_qb_match_conditions
from frappe.core.doctype.installed_applications.installed_applications import get_setup_wizard_completed_apps
print(\"helpers_ok\")
"
' 2>&1 | grep -vE 'version.*obsolete|^time='

echo
echo "=== HTTP ==="
bash /opt/health-ecosystem/docker/probe-http.sh POSTMIG 2>&1 | grep -vE 'version.*obsolete|^time='

echo
echo "=== clinical_phase import integrity ==="
SP_SUB=/home/frappe/frappe-bench/env/lib/python3.11/site-packages
# use apps path via editable install
mods=$(docker compose exec -T backend bash -lc "ls /home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase*.py | xargs -n1 basename | sed 's/.py\$//'")
ok=0; fail=0
for m in $mods; do
  out=$(docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute frappe.get_module --kwargs \"{'modulename': 'health_ecosystem_core.health_ecosystem_core.$m'}\" 2>&1")
  if echo "$out" | grep -q "module 'health_ecosystem_core"; then ok=$((ok+1)); else fail=$((fail+1)); echo "FAIL $m"; fi
done
echo "import_ok=$ok import_fail=$fail"
