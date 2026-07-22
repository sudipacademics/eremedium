#!/bin/bash
# Read-only: how erpnext/hrms/frappe are installed + pinned versions on live bench.
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc '
  set -e
  cd /home/frappe/frappe-bench
  echo "=== app versions ==="
  for a in frappe erpnext hrms healthcare; do
    if [ -f apps/$a/$a/__init__.py ]; then
      ver=$(grep -m1 __version__ apps/$a/$a/__init__.py || true)
      echo "$a: $ver"
    else
      echo "$a: NOT IN apps/"
    fi
  done
  echo
  echo "=== sites/apps.txt ==="
  cat sites/apps.txt
  echo
  echo "=== apps/ layout (top) ==="
  ls -la apps/ | head -30
  echo
  echo "=== erpnext install method (git? pip? bind?) ==="
  ls -la apps/erpnext/.git 2>/dev/null && (cd apps/erpnext && git rev-parse --abbrev-ref HEAD; git describe --tags --always 2>/dev/null; git remote -v | head -2) || echo "no .git in apps/erpnext"
  ls -la apps/hrms/.git 2>/dev/null && (cd apps/hrms && git rev-parse --abbrev-ref HEAD; git describe --tags --always 2>/dev/null; git remote -v | head -2) || echo "no .git in apps/hrms"
  ls -la apps/frappe/.git 2>/dev/null && (cd apps/frappe && git rev-parse --abbrev-ref HEAD; git describe --tags --always 2>/dev/null; git remote -v | head -2) || echo "no .git in apps/frappe"
  echo
  echo "=== pip show ==="
  ./env/bin/pip show erpnext hrms frappe 2>/dev/null | grep -E "^(Name|Version|Location|Editable)"
  echo
  echo "=== docker compose mounts involving apps ==="
' 
# host-side: check compose mounts
grep -nE "apps|erpnext|hrms|frappe|volumes" docker-compose.yml compose.yaml 2>/dev/null | head -40 || true
ls docker-compose*.yml compose.yaml 2>/dev/null
