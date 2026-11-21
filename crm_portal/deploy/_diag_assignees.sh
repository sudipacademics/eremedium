#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml -p docker)
"${COMPOSE[@]}" exec -T backend bash -lc '
set -e
cd /home/frappe/frappe-bench
grep -n "list_crm_portal_assignees" apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py | head -5
SP=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
grep -n "list_crm_portal_assignees" "$SP/api.py" "$SP/clinical_people_access.py" | head -10
./env/bin/python - <<PY
import frappe
frappe.init(site="health.localhost")
frappe.connect()
try:
    from health_ecosystem_core.health_ecosystem_core.clinical_people_access import list_crm_portal_assignees, ACCESS_DT
    rows = frappe.get_all(ACCESS_DT, fields=["portal","active","employee","login_user"], limit_page_length=200)
    from collections import Counter
    print("PORTALS", Counter((r.portal, int(r.active or 0)) for r in rows))
    crm = [r for r in rows if str(r.portal).lower() in ("crm","crm portal") or "crm" in str(r.portal).lower()]
    print("CRM_ROWS", len(crm))
    for r in crm[:30]:
        print(dict(r))
    print("RESULT", list_crm_portal_assignees())
finally:
    frappe.destroy()
PY
'
