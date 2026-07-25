#!/bin/bash
set -e
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
ls -la sites/health.localhost | head
pwd
# Use bench execute which knows the site layout
bench --site health.localhost execute frappe.ping || true
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_ensure_hec_item --kwargs '{"data":{"item_code":"HEC-MARG-UOM-SMOKE","item_name":"Marg UOM Smoke","stock_uom":"Nos","rate":1}}'
echo VERIFY_OK
EOS
