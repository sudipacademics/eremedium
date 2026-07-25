#!/bin/bash
# Restart backend so new whitelisted api_ensure_hec_item is loaded
set -e
cd /opt/health-ecosystem/docker
docker compose restart backend
# wait for health
sleep 8
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
bench --site health.localhost clear-cache
./env/bin/python - <<'PY'
import frappe
from frappe.utils.caching import redis_cache
frappe.init(site="health.localhost")
frappe.connect()
from health_ecosystem_core.health_ecosystem_core import clinical_phase69_pharma_bill as m
assert hasattr(m, "api_ensure_hec_item"), "missing api_ensure_hec_item"
print("OK", m.api_ensure_hec_item)
# Exercise whitelist resolve path
fn = frappe.get_attr("health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_ensure_hec_item")
print("get_attr OK", fn)
frappe.destroy()
PY
echo RESTART_OK
EOS
