#!/bin/bash
# Deploy batch-first Marg entry + restart backend
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
    api_ensure_hec_item_batch,
    api_search_hec_marg_catalog,
    ensure_hec_item_with_batch,
)
print("imports_ok", callable(api_ensure_hec_item_batch), callable(api_search_hec_marg_catalog))
PY
bench --site "$SITE" clear-cache
bench build --app health_ecosystem_core || true
EOS

docker compose restart backend
sleep 8
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.ensure_phase69_custom_fields
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_ensure_hec_item_batch --kwargs '{"data":{"item_code":"Batch First Item","item_name":"Batch First Item","hec_batch_no":"BF-BATCH-01","hec_expiry_date":"2027-12-31","hec_item_mrp":120,"rate":95,"hec_pack_size":"1*10"}}'
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_search_hec_marg_catalog --kwargs '{"txt":"BF-BATCH","search_by":"batch","limit":5}'
echo DEPLOY_OK
EOS
