#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker

docker compose cp /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js
docker compose cp /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/public/js/customer_trf.js \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/public/js/customer_trf.js
docker compose cp /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/hooks.py \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/hooks.py

docker compose exec -T -u root backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
JS=apps/health_ecosystem_core/health_ecosystem_core/public/js
chown frappe:frappe "$JS/customer_trf.js" "$JS/hec_lab_bill_entry.js" || true
chmod 664 "$JS/customer_trf.js" "$JS/hec_lab_bill_entry.js" || true
python3 <<'PY'
from pathlib import Path
base = Path("apps/health_ecosystem_core/health_ecosystem_core/public/js")
trf_path = base / "customer_trf.js"
bill_path = base / "hec_lab_bill_entry.js"
trf = trf_path.read_text(encoding="utf-8")
bill = bill_path.read_text(encoding="utf-8")
marker = "/* === HEC LAB BILL ENTRY INLINED === */"
if marker in trf:
    # replace old inline
    trf = trf.split(marker)[0].rstrip() + "\n"
# drop require stub
clean = []
for line in trf.splitlines(True):
    if "Ensure RemeLab Bill Entry" in line or "__hec_lab_bill_entry_loading" in line:
        continue
    if "frappe.require(\"/assets/health_ecosystem_core/js/hec_lab_bill_entry.js\")" in line:
        continue
    clean.append(line)
trf = "".join(clean).rstrip() + "\n\n" + marker + "\n" + bill + "\n"
trf_path.write_text(trf, encoding="utf-8")
print("INLINED_BYTES", len(trf))
PY
mkdir -p sites/assets/health_ecosystem_core/js
cp -f "$JS/hec_lab_bill_entry.js" sites/assets/health_ecosystem_core/js/hec_lab_bill_entry.js
cp -f "$JS/customer_trf.js" sites/assets/health_ecosystem_core/js/customer_trf.js
# bust asset cache version if present
chown -R frappe:frappe sites/assets/health_ecosystem_core/js || true
wc -l "$JS/customer_trf.js"
grep -c "hec-bill-entry\|Bill Entry" "$JS/customer_trf.js" || true
EOS

docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
bench --site health.localhost clear-cache
bench --site health.localhost clear-website-cache || true
EOS

docker compose restart backend
sleep 8
echo "INLINE_DONE — hard refresh Desk (Ctrl+Shift+R) and open New Customer TRF"
