#!/bin/bash
# Fix Stock Ledger CSS + speed up Marg purchase save
set -e
ROOT="/opt/health-ecosystem"
SITE="${FRAPPE_SITE:-health.localhost}"
cd "$ROOT/docker"

# --- restore report/desk assets ---
bash "$ROOT/docker/patch-restore-report-assets.sh" || true

docker compose cp \
  "$ROOT/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase69_pharma_bill.py" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase69_pharma_bill.py

docker compose exec -T backend bash -s "$SITE" <<'EOS'
set -e
SITE="$1"
cd /home/frappe/frappe-bench
PKG=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
cp -f apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase69_pharma_bill.py "$PKG/clinical_phase69_pharma_bill.py"
bench --site "$SITE" clear-cache
EOS

docker compose restart backend
sleep 8

docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
# time create with existing item+batch (fast path)
START=$(date +%s.%N)
OUT=$(bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.api_create_hec_pharma_invoice --kwargs '{"data":{"direction":"purchase","party":"Zuckerman Security Ltd.","submit":0,"update_stock":0,"bill_no":"SPEED2","bill_date":"2026-07-19","items":[{"item_code":"OMEZ-20","qty":1,"rate":28.12,"hec_batch_no":"SFGE3345","hec_expiry_date":"2028-03-31","hec_item_mrp":40},{"item_code":"OMEZ-20","qty":1,"rate":28.12,"hec_batch_no":"SFGE3345","hec_expiry_date":"2028-03-31","hec_item_mrp":40}]}}')
END=$(date +%s.%N)
python3 - <<PY
start=float("$START"); end=float("$END")
print("CREATE_SECONDS", round(end-start, 3))
print("OUT_HEAD", """$OUT"""[:200])
PY
# verify report css reachable via nginx path inside container
python3 - <<'PY'
import json, os
d=json.load(open("sites/assets/assets.json"))
for k in ("report.bundle.css","report.bundle.js","desk.bundle.css"):
    p=d.get(k,"")
    disk="sites/assets"+p[len("/assets"):] if p.startswith("/assets/") else p
    print(k, p, "ok" if os.path.exists(disk) else "MISSING "+disk)
PY
echo FIX_OK
EOS
