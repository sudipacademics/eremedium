#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
docker compose exec -T -u root backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
JS=apps/health_ecosystem_core/health_ecosystem_core/public/js/customer_trf.js
echo "=== customer_trf.js ==="
wc -c "$JS"
grep -c "hec-bill-entry\|HEC LAB BILL ENTRY\|Bill Entry" "$JS" || true
head -5 "$JS"
echo "..."
tail -5 "$JS"

echo "=== How form meta loads JS ==="
python3 <<'PY'
import frappe, os
frappe.init(site="health.localhost", sites_path="sites")
frappe.connect()
# Mimic Form Meta code loading
from frappe.desk.form.meta import FormMeta
meta = FormMeta("Customer TRF")
# after load
js_paths = frappe.get_hooks("doctype_js", {}).get("Customer TRF") or []
if isinstance(js_paths, str):
    js_paths = [js_paths]
print("DOCTYPE_JS_HOOKS", js_paths)
for path in js_paths:
    full = frappe.get_app_path("health_ecosystem_core", *path.split("/"))
    # get_app_path joins app + path parts; path is public/js/...
    alt = os.path.join(frappe.get_app_path("health_ecosystem_core"), path)
    print("PATH", path)
    print(" ALT_EXISTS", os.path.exists(alt), alt, os.path.getsize(alt) if os.path.exists(alt) else 0)
    if os.path.exists(alt):
        txt = open(alt, encoding="utf-8").read()
        print(" HAS_BILL", "hec-bill-entry" in txt, "LEN", len(txt))

# Client Scripts
cs = frappe.get_all("Client Script", filters={"dt": "Customer TRF", "enabled": 1}, fields=["name", "view"])
print("CLIENT_SCRIPTS", cs)
frappe.destroy()
PY
EOS
