#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
printf '%s\n' \
'print("Doctor", frappe.db.exists("DocType","Doctor"))' \
'meta=frappe.get_meta("Doctor") if frappe.db.exists("DocType","Doctor") else None' \
'print("Doctor fields", [f.fieldname for f in meta.fields][:20] if meta else None)' \
'print(frappe.get_all("Doctor", limit_page_length=3))' \
'fm=frappe.get_meta("Franchisee Profile")' \
'print("FP fields", [f.fieldname for f in fm.fields if f.fieldname in ("franchise_name","branch_code","name","franchisee_name")] )' \
'print(frappe.get_all("Franchisee Profile", fields=["name","franchise_name"] if fm.has_field("franchise_name") else ["name"], limit_page_length=5))' \
'exit()' \
| bench --site health.localhost console
EOS
