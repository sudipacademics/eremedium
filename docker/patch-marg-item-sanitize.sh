#!/bin/bash
# Deploy item-code sanitize + restart backend
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
from health_ecosystem_core.health_ecosystem_core import clinical_phase69_pharma_bill as m
assert hasattr(m, "sanitize_hec_item_code")
print("has_sanitize_ok")
PY
bench --site "$SITE" clear-cache
bench build --app health_ecosystem_core || true
EOS

docker compose restart backend
sleep 6
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_ensure_hec_item --kwargs '{"data":{"item_code":"New Item 2","item_name":"New Item 2","stock_uom":"Nos","rate":5}}'
echo DEPLOY_OK
EOS
