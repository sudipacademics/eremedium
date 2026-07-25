#!/bin/bash
set -e
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_ensure_hec_item --kwargs '{"data":{"item_code":"New Item 1","item_name":"New Item 1","stock_uom":"Nos","rate":0}}' || true
EOS
