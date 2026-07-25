#!/bin/bash
# Fix Bill Entry JS load: app_include_js (doctype_js list was ignored)
set -euo pipefail
ROOT="/opt/health-ecosystem"
SITE="${FRAPPE_SITE:-health.localhost}"
APP_SRC="$ROOT/health_ecosystem_core/health_ecosystem_core"
cd "$ROOT/docker"

docker compose cp "$APP_SRC/hooks.py" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/hooks.py
docker compose cp "$APP_SRC/public/js/hec_lab_bill_entry.js" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js

docker compose exec -T backend bash -s "$SITE" <<'EOS'
set -e
SITE="$1"
cd /home/frappe/frappe-bench
mkdir -p sites/assets/health_ecosystem_core/js
cp -f apps/health_ecosystem_core/health_ecosystem_core/public/js/hec_lab_bill_entry.js \
  sites/assets/health_ecosystem_core/js/hec_lab_bill_entry.js
# Symlink-friendly public assets path used by some nginx configs
mkdir -p apps/health_ecosystem_core/health_ecosystem_core/public/js
bench --site "$SITE" clear-cache
bench --site "$SITE" clear-website-cache || true
# Confirm hook
printf '%s\n' \
'print("APP_JS", frappe.get_hooks("app_include_js"))' \
'exit()' \
| bench --site "$SITE" console
EOS

docker compose restart backend
sleep 8
echo "JS_LOAD_FIX_OK"
echo "Hard-refresh Desk (Ctrl+Shift+R) then open Customer TRF New"
