#!/bin/bash
set -euo pipefail
ROOT="/opt/health-ecosystem"
cd "$ROOT/docker"

docker compose cp "$ROOT/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js
docker compose cp "$ROOT/health_ecosystem_core/health_ecosystem_core/public/js/customer_trf.js" \
  backend:/tmp/customer_trf_base.js

docker compose exec -T -u root backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
APP_JS=apps/health_ecosystem_core/health_ecosystem_core/public/js
BILL="$APP_JS/hec_lab_bill_entry.js"
PKG=$(./env/bin/python -c "import health_ecosystem_core, os; print(os.path.dirname(health_ecosystem_core.__file__))")
echo "PKG=$PKG"
mkdir -p "$PKG/public/js"

python3 <<PY
from pathlib import Path
base = Path("/tmp/customer_trf_base.js").read_text(encoding="utf-8")
bill = Path("apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js").read_text(encoding="utf-8")
marker = "/* === HEC LAB BILL ENTRY INLINED === */"
if marker in base:
    base = base.split(marker)[0].rstrip() + "\n"
out = base.rstrip() + "\n\n" + marker + "\n" + bill + "\n"
Path("apps/health_ecosystem_core/health_ecosystem_core/public/js/customer_trf.js").write_text(out, encoding="utf-8")
Path("/tmp/customer_trf_inlined.js").write_text(out, encoding="utf-8")
print("INLINED", len(out))
PY

cp -f /tmp/customer_trf_inlined.js "$APP_JS/customer_trf.js"
cp -f /tmp/customer_trf_inlined.js "$PKG/public/js/customer_trf.js"
cp -f "$BILL" "$PKG/public/js/hec_lab_bill_entry.js"
mkdir -p sites/assets/health_ecosystem_core/js
cp -f /tmp/customer_trf_inlined.js sites/assets/health_ecosystem_core/js/customer_trf.js
cp -f "$BILL" sites/assets/health_ecosystem_core/js/hec_lab_bill_entry.js
chown -R frappe:frappe "$PKG/public" "$APP_JS" sites/assets/health_ecosystem_core/js || true
echo "SITEPKG_BYTES $(wc -c < "$PKG/public/js/customer_trf.js")"
grep -c "hec-bill-entry" "$PKG/public/js/customer_trf.js"
EOS

docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
bench --site health.localhost clear-cache
printf '%s\n' \
'from frappe.desk.form.meta import FormMeta' \
'meta = FormMeta("Customer TRF")' \
'code = (meta.as_dict().get("__js") or "")' \
'print("JS_LEN", len(code))' \
'print("HAS_BILL", "hec-bill-entry" in code)' \
'print("HAS_TITLE", "Bill Entry" in code)' \
'exit()' \
| bench --site health.localhost console
EOS

docker compose restart backend
sleep 6
echo SITEPACKAGES_JS_FIXED
