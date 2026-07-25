#!/bin/bash
set -e
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
S=$(date +%s.%N)
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_create_hec_pharma_invoice --kwargs '{"data":{"direction":"purchase","party":"Zuckerman Security Ltd.","submit":0,"update_stock":0,"bill_no":"SPEED4","items":[{"item_code":"OMEZ-20","qty":1,"rate":28.12,"hec_batch_no":"SFGE3345","hec_expiry_date":"2028-03-31","hec_item_mrp":40},{"item_code":"OMEZ-20","qty":1,"rate":28.12,"hec_batch_no":"SFGE3345","hec_expiry_date":"2028-03-31","hec_item_mrp":40}]}}' > /tmp/speed_out.json
E=$(date +%s.%N)
python3 -c "print('WARM_CREATE_SECONDS', round(float('$E')-float('$S'), 3))"
head -c 180 /tmp/speed_out.json; echo
curl -skI "https://erp.e-remedium.in/assets/frappe/dist/css/report.bundle.PXPYT4ZF.css" | head -3
echo DONE
EOS
