#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
echo "=== HOST HOOKS app_include ==="
grep -n -A6 'app_include_js' /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/hooks.py
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
echo "=== CONTAINER HOOKS app_include ==="
grep -n -A6 'app_include_js' apps/health_ecosystem_core/health_ecosystem_core/hooks.py
# Force-copy assets + customer_trf
mkdir -p sites/assets/health_ecosystem_core/js
cp -f /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js \
  apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js 2>/dev/null || true
cp -f apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js \
  sites/assets/health_ecosystem_core/js/hec_lab_bill_entry.js
# Also copy customer_trf from host if present in apps
if [[ -f /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/public/js/customer_trf.js ]]; then
  cp -f /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/public/js/customer_trf.js \
    apps/health_ecosystem_core/health_ecosystem_core/public/js/customer_trf.js
fi
# Concatenate bill entry INTO customer_trf.js so doctype_js always loads it
python3 <<'PY'
from pathlib import Path
base = Path("apps/health_ecosystem_core/health_ecosystem_core/public/js")
trf = (base / "customer_trf.js").read_text(encoding="utf-8")
bill = (base / "hec_lab_bill_entry.js").read_text(encoding="utf-8")
marker = "/* === HEC LAB BILL ENTRY INLINED === */"
if marker not in trf:
    # strip previous require stub if present
    if "hec_lab_bill_entry.js" in trf and "frappe.require" in trf:
        lines = []
        skip = False
        for line in trf.splitlines(True):
            if "Ensure RemeLab Bill Entry" in line or "__hec_lab_bill_entry_loading" in line:
                continue
            if "frappe.require(\"/assets/health_ecosystem_core/js/hec_lab_bill_entry.js\")" in line:
                continue
            lines.append(line)
        trf = "".join(lines).rstrip() + "\n"
    out = trf.rstrip() + "\n\n" + marker + "\n" + bill + "\n"
    (base / "customer_trf.js").write_text(out, encoding="utf-8")
    print("INLINED", len(out), "bytes into customer_trf.js")
else:
    print("ALREADY_INLINED")
PY
ls -la apps/health_ecosystem_core/health_ecosystem_core/public/js/customer_trf.js sites/assets/health_ecosystem_core/js/hec_lab_bill_entry.js
bench --site health.localhost clear-cache
printf '%s\n' \
'print("APP_JS", frappe.get_hooks("app_include_js"))' \
'print("DOCTYPE_JS", frappe.get_hooks("doctype_js").get("Customer TRF"))' \
'exit()' \
| bench --site health.localhost console
EOS
docker compose restart backend
sleep 6
echo INLINE_FIX_OK
