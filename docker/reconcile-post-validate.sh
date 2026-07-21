#!/bin/bash
# Post-reinstall validation: prove nothing dropped from site-packages + app health.
cd /opt/health-ecosystem/docker
BK=/opt/health-ecosystem/backups
SITE=health.localhost

bash /opt/health-ecosystem/docker/inv-sp.sh POST >/dev/null 2>&1

echo "=== inventory delta (PRE=$(wc -l < $BK/sp-inv-PRE.txt)  POST=$(wc -l < $BK/sp-inv-POST.txt)) ==="
echo "--- DROPPED (in PRE, missing in POST) [must be empty] ---"
comm -23 "$BK/sp-inv-PRE.txt" "$BK/sp-inv-POST.txt" || true
echo "--- ADDED (in POST, not in PRE) ---"
comm -13 "$BK/sp-inv-PRE.txt" "$BK/sp-inv-POST.txt" || true
echo "--- (end delta) ---"

echo
echo "=== import integrity (all clinical_phase*, from reinstalled site-packages) ==="
SP_SUB=/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/health_ecosystem_core
mods=$(docker compose exec -T backend bash -lc "ls $SP_SUB/clinical_phase*.py | xargs -n1 basename | sed 's/.py\$//'")
ok=0; fail=0
for m in $mods; do
  out=$(docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute frappe.get_module --kwargs \"{'modulename': 'health_ecosystem_core.health_ecosystem_core.$m'}\" 2>&1")
  if echo "$out" | grep -q "module 'health_ecosystem_core"; then ok=$((ok+1)); else fail=$((fail+1)); echo "FAIL $m"; fi
done
echo "import_ok=$ok import_fail=$fail"
