#!/bin/bash
# Safe ERPNext/Frappe bump for the live Docker bench (no compose down -v).
#
# Context: image frappe/erpnext:v15.34.0 has apps/erpnext + apps/frappe WITHOUT .git,
# so upgrades use GitHub release tarballs + editable pip reinstall.
#
# Proven pair that unblocks hrms 15.63.0 migrate (build_qb_match_conditions +
# get_setup_wizard_completed_apps):
#   erpnext v15.81.1 + frappe v15.84.0
#
# Minimal attempt (erpnext v15.70.0 + frappe v15.40.4) FAILED migrate because
# erpnext 15.70 imports get_setup_wizard_completed_apps which is absent until
# newer frappe (present in v15.84.0).
#
# Usage on server:
#   cd /opt/health-ecosystem/docker && bash upgrade-erpnext-15.70.sh
set -e
cd "$(dirname "$0")"
SITE="${FRAPPE_SITE:-health.localhost}"
ERPNEXT_TAG="${ERPNEXT_TAG:-v15.81.1}"
FRAPPE_TAG="${FRAPPE_TAG:-v15.84.0}"
BK=/opt/health-ecosystem/backups
TMP="$BK/upgrade-src"
TS=$(date +%Y%m%d-%H%M%S)

echo "=== 0. Pre-flight versions ==="
docker compose exec -T backend bash -lc '
  cd /home/frappe/frappe-bench
  for a in frappe erpnext hrms; do grep -m1 __version__ apps/$a/$a/__init__.py; done
'

echo "=== 1. Backup site + apps ==="
mkdir -p "$BK" "$TMP"
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE backup --with-files"
docker compose exec -T backend bash -lc '
  set -e
  cd /home/frappe/frappe-bench/apps
  tar czf /tmp/apps-erpnext-pre.tgz erpnext
  tar czf /tmp/apps-frappe-pre.tgz frappe
'
docker compose cp backend:/tmp/apps-erpnext-pre.tgz "$BK/apps-erpnext-pre-$TS.tgz"
docker compose cp backend:/tmp/apps-frappe-pre.tgz "$BK/apps-frappe-pre-$TS.tgz"
docker compose exec -T backend bash -lc 'rm -f /tmp/apps-erpnext-pre.tgz /tmp/apps-frappe-pre.tgz'
echo "Backups: $BK/apps-*-pre-$TS.tgz (+ site private/backups)"

echo "=== 2. Download GitHub release tarballs ==="
if [ ! -f "$TMP/erpnext-$ERPNEXT_TAG.tar.gz" ]; then
  curl -fsSL -o "$TMP/erpnext-$ERPNEXT_TAG.tar.gz" \
    "https://github.com/frappe/erpnext/archive/refs/tags/${ERPNEXT_TAG}.tar.gz"
fi
if [ ! -f "$TMP/frappe-$FRAPPE_TAG.tar.gz" ]; then
  curl -fsSL -o "$TMP/frappe-$FRAPPE_TAG.tar.gz" \
    "https://github.com/frappe/frappe/archive/refs/tags/${FRAPPE_TAG}.tar.gz"
fi

echo "=== 3. Swap apps/erpnext + apps/frappe ==="
docker compose cp "$TMP/erpnext-$ERPNEXT_TAG.tar.gz" backend:/tmp/erpnext-src.tar.gz
docker compose cp "$TMP/frappe-$FRAPPE_TAG.tar.gz" backend:/tmp/frappe-src.tar.gz
docker compose exec -T -u root backend bash -lc '
  set -e
  cd /home/frappe/frappe-bench
  rm -rf /tmp/erpnext-extract /tmp/frappe-extract
  mkdir -p /tmp/erpnext-extract /tmp/frappe-extract
  tar xzf /tmp/erpnext-src.tar.gz -C /tmp/erpnext-extract
  tar xzf /tmp/frappe-src.tar.gz -C /tmp/frappe-extract
  ESRC=$(find /tmp/erpnext-extract -mindepth 1 -maxdepth 1 -type d | head -1)
  FSRC=$(find /tmp/frappe-extract -mindepth 1 -maxdepth 1 -type d | head -1)
  grep -q "def build_qb_match_conditions" "$ESRC/erpnext/accounts/utils.py"
  grep -q "def get_setup_wizard_completed_apps" "$FSRC/frappe/core/doctype/installed_applications/installed_applications.py"
  rm -rf apps/erpnext.pre-upgrade apps/frappe.pre-upgrade
  mv apps/erpnext apps/erpnext.pre-upgrade
  mv apps/frappe apps/frappe.pre-upgrade
  mv "$ESRC" apps/erpnext
  mv "$FSRC" apps/frappe
  chown -R frappe:frappe apps/erpnext apps/frappe
  rm -f /tmp/erpnext-src.tar.gz /tmp/frappe-src.tar.gz
  rm -rf /tmp/erpnext-extract /tmp/frappe-extract
  grep -m1 __version__ apps/erpnext/erpnext/__init__.py
  grep -m1 __version__ apps/frappe/frappe/__init__.py
'

echo "=== 4. Pip editable reinstall ==="
docker compose exec -T backend bash -lc '
  set -e
  cd /home/frappe/frappe-bench
  ./env/bin/pip install -q --force-reinstall --no-deps -e apps/frappe
  ./env/bin/pip install -q --force-reinstall --no-deps -e apps/erpnext
  ./env/bin/python -c "
from erpnext.accounts.utils import build_qb_match_conditions
from frappe.core.doctype.installed_applications.installed_applications import get_setup_wizard_completed_apps
import erpnext, frappe
print(\"erpnext\", erpnext.__version__, \"frappe\", frappe.__version__, \"helpers_ok\")
"
'

echo "=== 5. Migrate + restart ==="
docker compose exec -T backend bash -lc "
  set -e
  cd /home/frappe/frappe-bench
  bench --site $SITE migrate
  bench --site $SITE clear-cache
"
docker compose restart backend queue-short queue-long scheduler
sleep 12

echo "=== 6. Probe ==="
bash "$(dirname "$0")/probe-http.sh" UPGRADE || true
echo "UPGRADE_COMPLETE erpnext=$ERPNEXT_TAG frappe=$FRAPPE_TAG"
