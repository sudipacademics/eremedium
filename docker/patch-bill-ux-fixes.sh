#!/bin/bash
# Deploy Bill Entry UX fixes: disc math + doctor/centre pickers → site-packages
set -euo pipefail
ROOT="/opt/health-ecosystem"
cd "$ROOT/docker"

docker compose cp "$ROOT/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase70_lab_bill_entry.py" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase70_lab_bill_entry.py
docker compose cp "$ROOT/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js
docker compose cp "$ROOT/health_ecosystem_core/health_ecosystem_core/public/js/customer_trf.js" \
  backend:/tmp/customer_trf_base.js

docker compose exec -T -u root backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
PKG=$(./env/bin/python -c "import health_ecosystem_core, os; print(os.path.dirname(health_ecosystem_core.__file__))")
APP_PY=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
APP_JS=apps/health_ecosystem_core/health_ecosystem_core/public/js
cp -f "$APP_PY/clinical_phase70_lab_bill_entry.py" "$PKG/clinical_phase70_lab_bill_entry.py" 2>/dev/null || \
  cp -f "$APP_PY/clinical_phase70_lab_bill_entry.py" "$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")/clinical_phase70_lab_bill_entry.py"

# Resolve nested package path for py
NEST=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
cp -f "$APP_PY/clinical_phase70_lab_bill_entry.py" "$NEST/clinical_phase70_lab_bill_entry.py"

python3 <<'PY'
from pathlib import Path
base = Path("/tmp/customer_trf_base.js").read_text(encoding="utf-8")
bill = Path("apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js").read_text(encoding="utf-8")
marker = "/* === HEC LAB BILL ENTRY INLINED === */"
if marker in base:
    base = base.split(marker)[0].rstrip() + "\n"
out = base.rstrip() + "\n\n" + marker + "\n" + bill + "\n"
Path("/tmp/customer_trf_inlined.js").write_text(out, encoding="utf-8")
print("INLINED", len(out))
PY

mkdir -p "$PKG/public/js" sites/assets/health_ecosystem_core/js
cp -f /tmp/customer_trf_inlined.js "$APP_JS/customer_trf.js"
cp -f /tmp/customer_trf_inlined.js "$PKG/public/js/customer_trf.js"
cp -f "$APP_JS/hec_lab_bill_entry.js" "$PKG/public/js/hec_lab_bill_entry.js"
cp -f /tmp/customer_trf_inlined.js sites/assets/health_ecosystem_core/js/customer_trf.js
cp -f "$APP_JS/hec_lab_bill_entry.js" sites/assets/health_ecosystem_core/js/hec_lab_bill_entry.js
chown -R frappe:frappe "$PKG/public" "$APP_JS" "$NEST" sites/assets/health_ecosystem_core/js || true
echo "SITEPKG $(wc -c < "$PKG/public/js/customer_trf.js") HAS_PICK $(grep -c hec-pick-doctor "$PKG/public/js/customer_trf.js" || true)"
EOS

docker compose restart backend
sleep 10

docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
bench --site health.localhost clear-cache
printf '%s\n' \
'from health_ecosystem_core.health_ecosystem_core.clinical_phase70_lab_bill_entry import compute_line, api_search_hec_doctors, api_search_hec_collection_centres' \
'print("DISC", compute_line({"item":"X","qty":2,"rate":100,"hec_disc_percent":10}))' \
'print("DISC_AMT", compute_line({"item":"X","qty":2,"rate":100,"hec_disc_amount":30,"_disc_source":"amt"}))' \
'print("DOCS", len(api_search_hec_doctors(txt="")["doctors"]))' \
'print("CENTS", len(api_search_hec_collection_centres(txt="")["centres"]))' \
'from frappe.desk.form.meta import FormMeta' \
'code=FormMeta("Customer TRF").as_dict().get("__js") or ""' \
'print("META_PICK", "hec-pick-doctor" in code, "hec-pick-centre" in code, "JS_LEN", len(code))' \
'exit()' \
| bench --site health.localhost console
echo BILL_UX_FIX_OK
EOS
