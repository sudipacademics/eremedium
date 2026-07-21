#!/bin/bash
# Deploy native clinical APIs and re-seed masters on server.
ROOT="/opt/health-ecosystem"
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  for f in "$ROOT"/docker/*.sh; do
    [ -f "$f" ] && sed -i 's/\r$//' "$f"
  done
  exec /bin/bash "$0" "$@"
fi
set -e
SITE="${FRAPPE_SITE:-health.localhost}"
cd "$ROOT/docker"

for f in "$ROOT"/docker/*.sh; do
  [ -f "$f" ] && sed -i 's/\r$//' "$f"
done

# Code must live on HOST at $ROOT/health_ecosystem_core (bind-mounted into the container).
test -f "$ROOT/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase6.py" || {
  echo "ERROR: Upload code first from your PC:"
  echo "  scp -r C:\\develop\\My_Lab_System\\health_ecosystem_core root@167.233.108.90:$ROOT/"
  exit 1
}

docker compose exec -T backend bash <<EOS
set -e
cd /home/frappe/frappe-bench
test -f apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase6.py
APPS_PKG=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SITE_PKG=\$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.api as m, os; print(os.path.dirname(m.__file__))")
for pyfile in api.py clinical_iam.py clinical_phase6.py clinical_phase8.py clinical_phase9.py clinical_secrets.py clinical_report_format.py clinical_utils.py clinical_workflow.py clinical_journey.py clinical_diagnostics.py clinical_setup.py patient_bridge.py init.py; do
  if [ -f "\$APPS_PKG/\$pyfile" ]; then
    cp -f "\$APPS_PKG/\$pyfile" "\$SITE_PKG/\$pyfile"
    echo "Synced \$pyfile -> site-packages"
  fi
done
rm -rf /tmp/hec_reinstall && cp -a apps/health_ecosystem_core /tmp/hec_reinstall
./env/bin/pip install -q --force-reinstall --no-deps /tmp/hec_reinstall
# site-packages can lag behind bind-mounted apps — mirror doctype controllers explicitly
if [ -d "\$APPS_PKG/doctype" ]; then
  mkdir -p "\$SITE_PKG/doctype"
  for dt_dir in "\$APPS_PKG"/doctype/*/; do
    [ -d "\$dt_dir" ] || continue
    dt=\$(basename "\$dt_dir")
    mkdir -p "\$SITE_PKG/doctype/\$dt"
    cp -f "\$dt_dir"*.py "\$SITE_PKG/doctype/\$dt/" 2>/dev/null || true
    cp -f "\$dt_dir"*.json "\$SITE_PKG/doctype/\$dt/" 2>/dev/null || true
  done
  echo "Synced doctype controllers -> site-packages"
fi
./env/bin/python -c "from health_ecosystem_core.health_ecosystem_core.doctype.lab_report_parameter.lab_report_parameter import LabReportParameter; print('LabReportParameter OK:', LabReportParameter)"
bench --site "$SITE" migrate
bench --site "$SITE" execute frappe.model.sync.sync_for --args "['health_ecosystem_core']" --kwargs "{'force': True}"
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.clinical_phase6.setup_phase6
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.clinical_phase8.setup_phase8
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.clinical_phase9.setup_phase9
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.clinical_setup.setup_clinical_module
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase11_iam
bench --site "$SITE" clear-cache
EOS

docker compose restart backend queue-short queue-long
echo "Restarted backend workers (docker compose — no supervisor in this stack)."

bash "$ROOT/docker/sync-hec-assets.sh"
echo "Clinical APIs deployed."
