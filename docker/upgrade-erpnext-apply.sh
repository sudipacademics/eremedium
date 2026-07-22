#!/bin/bash
# Swap apps/erpnext -> v15.70.0 and apps/frappe -> v15.40.4 via GitHub tarballs
# (no .git in image-based apps). Does NOT compose down -v.
set -e
cd /opt/health-ecosystem/docker
ERPNEXT_TAG=v15.70.0
FRAPPE_TAG=v15.40.4

echo "=== download release tarballs on host ==="
TMP=/opt/health-ecosystem/backups/upgrade-src
mkdir -p "$TMP"
if [ ! -f "$TMP/erpnext-$ERPNEXT_TAG.tar.gz" ]; then
  curl -fsSL -o "$TMP/erpnext-$ERPNEXT_TAG.tar.gz" \
    "https://github.com/frappe/erpnext/archive/refs/tags/${ERPNEXT_TAG}.tar.gz"
fi
if [ ! -f "$TMP/frappe-$FRAPPE_TAG.tar.gz" ]; then
  curl -fsSL -o "$TMP/frappe-$FRAPPE_TAG.tar.gz" \
    "https://github.com/frappe/frappe/archive/refs/tags/${FRAPPE_TAG}.tar.gz"
fi
ls -lh "$TMP"/*.tar.gz

echo "=== copy tarballs into backend container ==="
docker compose cp "$TMP/erpnext-$ERPNEXT_TAG.tar.gz" backend:/tmp/erpnext-src.tar.gz
docker compose cp "$TMP/frappe-$FRAPPE_TAG.tar.gz" backend:/tmp/frappe-src.tar.gz

echo "=== replace apps/erpnext + apps/frappe (keep old dirs as *.pre for session) ==="
docker compose exec -T -u root backend bash -lc '
  set -e
  cd /home/frappe/frappe-bench
  # extract
  rm -rf /tmp/erpnext-extract /tmp/frappe-extract
  mkdir -p /tmp/erpnext-extract /tmp/frappe-extract
  tar xzf /tmp/erpnext-src.tar.gz -C /tmp/erpnext-extract
  tar xzf /tmp/frappe-src.tar.gz -C /tmp/frappe-extract
  ESRC=$(find /tmp/erpnext-extract -mindepth 1 -maxdepth 1 -type d | head -1)
  FSRC=$(find /tmp/frappe-extract -mindepth 1 -maxdepth 1 -type d | head -1)
  echo "ESRC=$ESRC FSRC=$FSRC"
  test -f "$ESRC/erpnext/__init__.py"
  test -f "$FSRC/frappe/__init__.py"

  # swap erpnext
  rm -rf apps/erpnext.pre-upgrade
  mv apps/erpnext apps/erpnext.pre-upgrade
  mv "$ESRC" apps/erpnext
  chown -R frappe:frappe apps/erpnext

  # swap frappe
  rm -rf apps/frappe.pre-upgrade
  mv apps/frappe apps/frappe.pre-upgrade
  mv "$FSRC" apps/frappe
  chown -R frappe:frappe apps/frappe

  rm -f /tmp/erpnext-src.tar.gz /tmp/frappe-src.tar.gz
  rm -rf /tmp/erpnext-extract /tmp/frappe-extract

  echo "=== versions after swap ==="
  grep -m1 __version__ apps/erpnext/erpnext/__init__.py
  grep -m1 __version__ apps/frappe/frappe/__init__.py
  grep -n "def build_qb_match_conditions" apps/erpnext/erpnext/accounts/utils.py | head -3
'

echo "=== pip reinstall editable erpnext + frappe ==="
docker compose exec -T backend bash -lc '
  set -e
  cd /home/frappe/frappe-bench
  ./env/bin/pip install -q --force-reinstall --no-deps -e apps/frappe
  ./env/bin/pip install -q --force-reinstall --no-deps -e apps/erpnext
  ./env/bin/python -c "import erpnext,frappe; from erpnext.accounts.utils import build_qb_match_conditions; print(\"erpnext\", erpnext.__version__); print(\"frappe\", frappe.__version__); print(\"helper_ok\", callable(build_qb_match_conditions))"
'

echo "SWAP_OK"
