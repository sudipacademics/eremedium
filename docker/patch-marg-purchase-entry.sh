#!/bin/bash
# Deploy Marg-style Purchase Entry UX
set -e
ROOT="/opt/health-ecosystem"
SITE="${FRAPPE_SITE:-health.localhost}"
cd "$ROOT/docker"

docker compose cp \
  "$ROOT/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase69_pharma_bill.py" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase69_pharma_bill.py

docker compose cp \
  "$ROOT/health_ecosystem_core/health_ecosystem_core/public/js/hec_invoice_marg.js" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_invoice_marg.js

docker compose exec -T backend bash -s "$SITE" <<'EOS'
set -e
SITE="$1"
cd /home/frappe/frappe-bench
PKG=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
mkdir -p "$(dirname "$PKG")/public/js" sites/assets/health_ecosystem_core/js
cp -f apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase69_pharma_bill.py "$PKG/clinical_phase69_pharma_bill.py"
cp -f apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_invoice_marg.js "$(dirname "$PKG")/public/js/hec_invoice_marg.js"
cp -f apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_invoice_marg.js sites/assets/health_ecosystem_core/js/hec_invoice_marg.js || true
./env/bin/python - <<'PY'
from health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill import (
    api_get_hec_party_history,
    api_search_hec_items,
    api_list_item_batches,
)
print("imports_ok", all(map(callable, [api_get_hec_party_history, api_search_hec_items, api_list_item_batches])))
PY
bench --site "$SITE" clear-cache
bench build --app health_ecosystem_core || true
EOS

docker compose restart backend
sleep 8
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
# seed fields
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.ensure_phase69_custom_fields
# item search
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_search_hec_items --kwargs '{"txt":"Batch","limit":5}'
# batches for known item
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_list_item_batches --kwargs '{"item_code":"Batch-First-Item","limit":5}'
# party history (first supplier if any)
SUP=$(bench --site health.localhost execute frappe.client.get_list --kwargs '{"doctype":"Supplier","fields":["name"],"limit_page_length":1}' 2>/dev/null | head -1 || true)
echo "SUP_RAW=$SUP"
bench --site health.localhost mariadb -e "select name from \`tabSupplier\` limit 1" 2>/dev/null || true
echo DEPLOY_OK
EOS
