#!/bin/bash
# Force-sync Installed Application + import payroll DocTypes; smoke ESS + Employee meta.
set -e
SITE="${FRAPPE_SITE:-health.localhost}"
ROOT="/opt/health-ecosystem"

if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

cd "$ROOT/docker"

docker compose exec -T backend bash -s "$SITE" <<'EOS'
set -e
SITE="$1"
cd /home/frappe/frappe-bench
APPS_PKG=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SITE_PKG=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.api as m, os; print(os.path.dirname(m.__file__))")
for f in clinical_hrms_repair.py clinical_phase21.py clinical_phase72_payroll.py clinical_phase71_ops_dashboards.py clinical_phase73_talent.py init.py; do
  cp -f "$APPS_PKG/$f" "$SITE_PKG/$f"
  python3 -m py_compile "$SITE_PKG/$f"
done

echo "=== Installed Application rows ==="
bench --site "$SITE" mariadb -e "SELECT app_name, app_version FROM \`tabInstalled Application\` ORDER BY app_name;"

echo "=== ensure hrms in Installed Application ==="
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair.ensure_hrms_installed_app

echo "=== import priority HRMS (incl payroll) ==="
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair.run_repair

echo "=== phase 21/72/73 ==="
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase21_setup
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase72_setup
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase73_setup

echo "=== Employee meta smoke ==="
bench --site "$SITE" execute frappe.client.get --kwargs "{'doctype':'Employee','name':frappe.db.get_value('Employee',{},'name')}" 2>/dev/null || \
bench --site "$SITE" console <<'PY'
import frappe
frappe.connect()
name = frappe.db.get_value("Employee", {}, "name")
print("employee", name)
meta = frappe.get_meta("Employee")
print("employee_fields", len(meta.fields))
print("timeline_ok", True)
print("leave_app", frappe.db.exists("DocType","Leave Application"))
print("expense", frappe.db.exists("DocType","Expense Claim"))
print("payroll_entry", frappe.db.exists("DocType","Payroll Entry"))
print("salary_slip", frappe.db.exists("DocType","Salary Slip"))
print("salary_component", frappe.db.exists("DocType","Salary Component"))
print("list_apps", frappe.get_installed_apps())
PY

bench --site "$SITE" list-apps
bench --site "$SITE" clear-cache
EOS

docker compose restart backend
sleep 12
bash "$ROOT/docker/test-hr-self-service.sh"
