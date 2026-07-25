#!/bin/bash
# Deploy Marg grid fix: ensure Item + fill item_name/uom on Apply
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
# PKG == .../site-packages/health_ecosystem_core/health_ecosystem_core
mkdir -p "$(dirname "$PKG")/public/js" sites/assets/health_ecosystem_core/js
cp -f apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase69_pharma_bill.py "$PKG/clinical_phase69_pharma_bill.py"
cp -f apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_invoice_marg.js "$(dirname "$PKG")/public/js/hec_invoice_marg.js"
cp -f apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_invoice_marg.js sites/assets/health_ecosystem_core/js/hec_invoice_marg.js || true
if [ -d "$PKG/health_ecosystem_core" ]; then
  cp -f apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase69_pharma_bill.py "$PKG/health_ecosystem_core/clinical_phase69_pharma_bill.py"
fi
./env/bin/python - <<'PY'
from health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill import api_ensure_hec_item, upsert_hec_pharma_item
print("api_ensure_hec_item ok", callable(api_ensure_hec_item))
print("upsert ok", callable(upsert_hec_pharma_item))
PY
grep -n "call_ensure_item\|add_invoice_line\|item_name" apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_invoice_marg.js | head -20
bench --site "$SITE" clear-cache
bench build --app health_ecosystem_core || true
echo DEPLOY_OK
EOS
