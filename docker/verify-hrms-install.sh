#!/bin/bash
# Verify HRMS is fully installed on health.localhost (no partial state).
set -e
SITE="${FRAPPE_SITE:-health.localhost}"

if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -s "$SITE" <<'EOS'
set -e
SITE="$1"
cd /home/frappe/frappe-bench
echo "=== apps.txt ==="
cat sites/apps.txt
echo
echo "=== list-apps ==="
bench --site "$SITE" list-apps
echo
echo "=== Module Def HR/HRMS ==="
./env/bin/python - <<'PY'
import frappe
frappe.init(site="health.localhost")
frappe.connect()
for name in ("HR", "HRMS", "Payroll"):
    exists = frappe.db.exists("Module Def", name)
    app = frappe.db.get_value("Module Def", name, "app_name") if exists else None
    print(f"  {name}: exists={bool(exists)} app={app}")
print("hrms in installed:", "hrms" in frappe.get_installed_apps())
PY
EOS
