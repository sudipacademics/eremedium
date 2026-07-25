#!/bin/bash
# Pull latest telephony_openai error body (redacted).
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site health.localhost console" <<'PY'
import frappe, re
rows = frappe.get_all("Error Log", filters={"method": "telephony_openai"}, fields=["creation","error"], order_by="creation desc", limit_page_length=1)
if not rows:
    rows = frappe.db.sql("""select creation, error from `tabError Log` where error like '%openai%' or method like '%openai%' order by creation desc limit 1""", as_dict=1)
if not rows:
    print("NO_ERROR")
else:
    e = rows[0]
    err = e.error or ""
    err = re.sub(r"sk-[A-Za-z0-9_\-]+", "sk-REDACTED", err)
    err = re.sub(r"Bearer\s+\S+", "Bearer REDACTED", err)
    # find HTTPError / status
    m = re.search(r"HTTP Error (\d+)", err)
    print("creation", e.creation)
    print("http_error", m.group(1) if m else "unknown")
    # print last 25 lines of traceback for the urllib error
    lines = err.strip().splitlines()
    for line in lines[-25:]:
        print(line)
print("DONE")
PY
