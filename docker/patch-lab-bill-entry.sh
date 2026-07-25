#!/bin/bash
# Deploy Phase 70 Lab Bill Entry (RemeLab single window on Customer TRF)
set -euo pipefail
ROOT="/opt/health-ecosystem"
SITE="${FRAPPE_SITE:-health.localhost}"
APP_SRC="$ROOT/health_ecosystem_core/health_ecosystem_core"
cd "$ROOT/docker"

docker compose cp \
  "$APP_SRC/health_ecosystem_core/clinical_phase70_lab_bill_entry.py" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase70_lab_bill_entry.py

docker compose cp \
  "$APP_SRC/public/js/hec_lab_bill_entry.js" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js

docker compose cp \
  "$APP_SRC/hooks.py" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/hooks.py

docker compose exec -T backend bash -s "$SITE" <<'EOS'
set -e
SITE="$1"
cd /home/frappe/frappe-bench
PKG=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
cp -f apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase70_lab_bill_entry.py \
  "$PKG/clinical_phase70_lab_bill_entry.py"
mkdir -p sites/assets/health_ecosystem_core/js
cp -f apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js \
  sites/assets/health_ecosystem_core/js/hec_lab_bill_entry.js
bench --site "$SITE" clear-cache
EOS

docker compose restart backend
sleep 12

docker compose exec -T backend bash -s "$SITE" <<'EOS'
set -e
SITE="$1"
cd /home/frappe/frappe-bench
printf '%s\n' \
'from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import setup_phase70, api_search_hec_lab_tests, api_save_hec_lab_bill, api_get_hec_lab_bill' \
'print("SETUP", setup_phase70())' \
'sr = api_search_hec_lab_tests(txt="", limit=3)' \
'print("SEARCH_N", len(sr.get("tests") or []))' \
'fr = frappe.get_all("Franchisee Profile", limit_page_length=1, pluck="name")' \
'items = frappe.get_all("Item", filters={"disabled": 0}, fields=["name", "item_name", "standard_rate"], limit_page_length=2)' \
'print("FR", fr, "ITEMS", [i.name for i in items])' \
'assert fr and items' \
'payload = {"patient_name": "Bill Entry Smoke", "age": 35, "gender": "Male", "patient_phone": "9999999999", "referred_doctor": "Self", "franchisee_id": fr[0], "hec_coll_charge": 50, "hec_amount_paid": 100, "hec_receipt_mode": "CASH", "tests": [{"item": items[0].name, "item_name": items[0].item_name, "qty": 1, "rate": items[0].standard_rate or 100, "hec_disc_percent": 10}], "adjustments": [{"adjustment": "Discount", "amount": 10, "remark": "smoke", "conf_by": "Admin"}], "staff": [{"staff_name": "Tech1", "amount": 5}]}' \
'if len(items) > 1: payload["tests"].append({"item": items[1].name, "item_name": items[1].item_name, "qty": 1, "rate": items[1].standard_rate or 50})' \
'out = api_save_hec_lab_bill(data=payload)' \
'print("SAVE", out)' \
'got = api_get_hec_lab_bill(name=out["name"])' \
'print("LOAD_TESTS", len(got["bill"]["tests"]), "SMOKE_OK", out["name"])' \
'exit()' \
| bench --site "$SITE" console
echo PHASE70_DEPLOY_OK
EOS
