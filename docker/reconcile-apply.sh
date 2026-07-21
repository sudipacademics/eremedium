#!/bin/bash
# Reconcile: merge authoritative running site-packages package into apps/ bind-mount.
# Does NOT touch site-packages (running app unaffected) until a later reinstall.
set -e
cd /opt/health-ecosystem/docker
SP=/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core
APPS_TOP=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core
docker compose exec -T backend bash -lc "
  set -e
  cp -a $SP/. $APPS_TOP/
  find $APPS_TOP -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
  find $APPS_TOP -type f -name '*.pyc' -delete 2>/dev/null || true
  echo COPIED
  echo '=== verify: apps top pkg vs sp top pkg (expect only apps-extras; no \"Only in sp\", no differ) ==='
  diff -rq $APPS_TOP $SP 2>&1 | grep -vE '__pycache__|\.pyc'
  echo DIFF_DONE
"
