#!/bin/bash
# e5: confirm reconciled DocTypes load (meta => DB+controller consistent) and diagnose the migrate blocker.
cd /opt/health-ecosystem/docker
SITE=health.localhost

echo "=== reconciled DocTypes: meta load (proves registered in DB + controller importable) ==="
for dt in "MCA Company Profile" "GST Return Period" "Sale Projection" "Material Requirement Plan" "Ops Feedback Entry"; do
  out=$(docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute frappe.get_meta --kwargs \"{'doctype': '$dt'}\" 2>&1")
  if echo "$out" | grep -qiE "DocType: $dt|'name': '$dt'|<frappe"; then echo "OK   $dt"; else echo "FAIL $dt"; echo "$out" | grep -vE 'version.*obsolete|^time=' | tail -2; fi
done

echo
echo "=== migrate blocker diagnosis (hrms vs erpnext) ==="
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && cat apps/erpnext/erpnext/__init__.py | grep -m1 __version__; cat apps/hrms/hrms/__init__.py | grep -m1 __version__; echo -n 'build_qb_match_conditions in erpnext.accounts.utils: '; grep -rl 'def build_qb_match_conditions' apps/erpnext/erpnext/accounts/utils.py 2>/dev/null && echo FOUND || echo MISSING"
