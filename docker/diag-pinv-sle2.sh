#!/bin/bash
set -e
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
INV=ACC-PINV-2026-00027
echo "=== Item flags ==="
bench --site health.localhost mariadb -e "select name,has_batch_no,has_expiry_date,create_new_batch,is_stock_item from \`tabItem\` where name='OMEZ-20'\G"
echo "=== Batch ==="
bench --site health.localhost mariadb -e "select name,item,expiry_date,batch_qty from \`tabBatch\` where name='SFGE3345' or item='OMEZ-20' limit 5"
echo "=== Serial Batch Bundle? ==="
bench --site health.localhost mariadb -e "show tables like '%Serial and Batch%'; show tables like '%Batch Bundle%'"
bench --site health.localhost mariadb -e "select name,item_code,batch_no,qty from \`tabPurchase Invoice Item\` where parent='$INV'"
echo "=== assets frappe ==="
ls sites/assets/frappe/dist/css 2>/dev/null | head -20
ls sites/assets/frappe/dist/js 2>/dev/null | head -20
ls apps/frappe/frappe/public/dist/css 2>/dev/null | head -10
# time a lightweight create
/usr/bin/time -f 'ELAPSED %e' bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_create_hec_pharma_invoice --kwargs '{"data":{"direction":"purchase","party":"Zuckerman Security Ltd.","submit":0,"update_stock":0,"bill_no":"SPEED-TEST","items":[{"item_code":"OMEZ-20","qty":1,"rate":28.12,"hec_batch_no":"SFGE3345","hec_expiry_date":"2028-03-31","hec_item_mrp":40}]}}' 2>&1 | tail -20
EOS
