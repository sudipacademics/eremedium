#!/bin/bash
# Escalate: swap to proven pair erpnext v15.81.1 + frappe v15.84.0
# (erpnext 15.70 needs get_setup_wizard_completed_apps, only present in newer frappe).
set -e
cd /opt/health-ecosystem/docker
ERPNEXT_TAG=v15.81.1
FRAPPE_TAG=v15.84.0
TMP=/opt/health-ecosystem/backups/upgrade-src
mkdir -p "$TMP"

echo "=== download $ERPNEXT_TAG + $FRAPPE_TAG ==="
if [ ! -f "$TMP/erpnext-$ERPNEXT_TAG.tar.gz" ]; then
  curl -fsSL -o "$TMP/erpnext-$ERPNEXT_TAG.tar.gz" \
    "https://github.com/frappe/erpnext/archive/refs/tags/${ERPNEXT_TAG}.tar.gz"
fi
if [ ! -f "$TMP/frappe-$FRAPPE_TAG.tar.gz" ]; then
  curl -fsSL -o "$TMP/frappe-$FRAPPE_TAG.tar.gz" \
    "https://github.com/frappe/frappe/archive/refs/tags/${FRAPPE_TAG}.tar.gz"
fi
ls -lh "$TMP"/erpnext-$ERPNEXT_TAG.tar.gz "$TMP"/frappe-$FRAPPE_TAG.tar.gz

docker compose cp "$TMP/erpnext-$ERPNEXT_TAG.tar.gz" backend:/tmp/erpnext-src.tar.gz
docker compose cp "$TMP/frappe-$FRAPPE_TAG.tar.gz" backend:/tmp/frappe-src.tar.gz

echo "=== replace apps (keep current as *.mid-upgrade) ==="
docker compose exec -T -u root backend bash -lc '
  set -e
  cd /home/frappe/frappe-bench
  rm -rf /tmp/erpnext-extract /tmp/frappe-extract
  mkdir -p /tmp/erpnext-extract /tmp/frappe-extract
  tar xzf /tmp/erpnext-src.tar.gz -C /tmp/erpnext-extract
  tar xzf /tmp/frappe-src.tar.gz -C /tmp/frappe-extract
  ESRC=$(find /tmp/erpnext-extract -mindepth 1 -maxdepth 1 -type d | head -1)
  FSRC=$(find /tmp/frappe-extract -mindepth 1 -maxdepth 1 -type d | head -1)
  test -f "$ESRC/erpnext/__init__.py"
  test -f "$FSRC/frappe/__init__.py"
  # verify helper exists in new frappe before swap
  grep -q "def get_setup_wizard_completed_apps" "$FSRC/frappe/core/doctype/installed_applications/installed_applications.py"
  grep -q "def build_qb_match_conditions" "$ESRC/erpnext/accounts/utils.py"

  rm -rf apps/erpnext.mid-upgrade apps/frappe.mid-upgrade
  mv apps/erpnext apps/erpnext.mid-upgrade
  mv apps/frappe apps/frappe.mid-upgrade
  mv "$ESRC" apps/erpnext
  mv "$FSRC" apps/frappe
  chown -R frappe:frappe apps/erpnext apps/frappe
  rm -f /tmp/erpnext-src.tar.gz /tmp/frappe-src.tar.gz
  rm -rf /tmp/erpnext-extract /tmp/frappe-extract

  echo "=== versions ==="
  grep -m1 __version__ apps/erpnext/erpnext/__init__.py
  grep -m1 __version__ apps/frappe/frappe/__init__.py
'

echo "=== pip reinstall editable ==="
docker compose exec -T backend bash -lc '
  set -e
  cd /home/frappe/frappe-bench
  ./env/bin/pip install -q --force-reinstall --no-deps -e apps/frappe
  ./env/bin/pip install -q --force-reinstall --no-deps -e apps/erpnext
  ./env/bin/python -c "
import erpnext, frappe
from erpnext.accounts.utils import build_qb_match_conditions
from frappe.core.doctype.installed_applications.installed_applications import get_setup_wizard_completed_apps
print(\"erpnext\", erpnext.__version__)
print(\"frappe\", frappe.__version__)
print(\"qb_helper\", callable(build_qb_match_conditions))
print(\"wizard_helper\", callable(get_setup_wizard_completed_apps))
"
'
echo "ESCALATE_SWAP_OK"
