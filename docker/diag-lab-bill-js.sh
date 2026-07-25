#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
echo "=== FILES ==="
ls -la apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js || true
ls -la sites/assets/health_ecosystem_core/js/hec_lab_bill_entry.js || true
echo "=== HOOKS SNIPPET ==="
grep -n -A5 'Customer TRF' apps/health_ecosystem_core/health_ecosystem_core/hooks.py | head -40
echo "=== CONSOLE ==="
printf '%s\n' \
'h = frappe.get_hooks("doctype_js") or {}' \
'print("HOOK", repr(h.get("Customer TRF")))' \
'meta = frappe.get_meta("Customer TRF")' \
'print("HAS_JS_ATTR", hasattr(meta, "js"))' \
'from frappe.core.doctype.doctype.doctype import get_js' \
'try:' \
'  print("GET_JS_LEN", len(get_js("Customer TRF") or ""))' \
'except Exception as e:' \
'  print("GET_JS_ERR", e)' \
'import os' \
'p="apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js"' \
'print("JS_EXISTS", os.path.exists(p), "BYTES", os.path.getsize(p) if os.path.exists(p) else 0)' \
'exit()' \
| bench --site health.localhost console
EOS
