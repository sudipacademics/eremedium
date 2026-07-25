#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
ls apps/frappe/frappe/core/doctype | grep -iE 'dashboard|number' || true
ls apps/frappe/frappe/desk/doctype | grep -iE 'dashboard|number|workspace' || true
printf '%s\n' \
'print("NC", frappe.db.exists("DocType","Number Card"))' \
'print("DC", frappe.db.exists("DocType","Dashboard Chart"))' \
'print("DB", frappe.db.exists("DocType","Dashboard"))' \
'print("WS", frappe.db.exists("DocType","Workspace"))' \
'print("TRF_TODAY", frappe.db.count("Customer TRF", {"creation": [">=", frappe.utils.today()]}))' \
'exit()' \
| bench --site health.localhost console
EOS
