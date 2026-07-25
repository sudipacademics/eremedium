#!/bin/bash
set -e
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_get_hec_party_history --kwargs '{"party":"Zuckerman Security Ltd.","direction":"purchase"}'
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_create_hec_pharma_invoice --kwargs '{"data":{"direction":"purchase","party":"Zuckerman Security Ltd.","submit":0,"update_stock":0,"bill_no":"MARG-TEST-001","bill_date":"2026-07-19","items":[{"item_code":"Batch-First-Item","qty":2,"rate":95,"hec_batch_no":"BF-BATCH-01","hec_expiry_date":"2027-12-31","hec_item_mrp":120,"discount_percentage":5.55,"hec_pack_size":"1*10"}]}}'
echo SMOKE_OK
EOS
