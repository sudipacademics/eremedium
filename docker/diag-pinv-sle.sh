#!/bin/bash
set -e
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
INV=ACC-PINV-2026-00027
echo "=== PINV ==="
bench --site health.localhost mariadb -e "select name,docstatus,update_stock,supplier,posting_date,bill_no,grand_total from \`tabPurchase Invoice\` where name='$INV'\G"
echo "=== ITEMS ==="
bench --site health.localhost mariadb -e "select item_code,qty,rate,amount,warehouse,batch_no,hec_batch_no,hec_expiry_date from \`tabPurchase Invoice Item\` where parent='$INV'"
echo "=== SLE count ==="
bench --site health.localhost mariadb -e "select count(*) as sle_cnt, item_code, warehouse, batch_no, voucher_type from \`tabStock Ledger Entry\` where voucher_no='$INV' group by item_code,warehouse,batch_no,voucher_type"
echo "=== SLE rows ==="
bench --site health.localhost mariadb -e "select name,item_code,warehouse,batch_no,actual_qty,qty_after_transaction,posting_date,posting_time from \`tabStock Ledger Entry\` where voucher_no='$INV' order by creation"
echo "=== assets stock ledger ==="
ls -la sites/assets/frappe/dist/js/ 2>/dev/null | head -5 || true
curl -sI http://127.0.0.1:8000/assets/frappe/dist/css/report.bundle.css 2>/dev/null | head -5 || true
curl -sI http://127.0.0.1:8000/assets/frappe/dist/js/report.bundle.js 2>/dev/null | head -5 || true
EOS
