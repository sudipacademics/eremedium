#!/bin/bash
# Read-only: map package nesting + accurate diff at MATCHING levels.
cd /opt/health-ecosystem/docker
APPS=/home/frappe/frappe-bench/apps/health_ecosystem_core
SP=/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core
docker compose exec -T backend bash -lc "
  echo '=== apps OUTER ==='; ls -1 $APPS | head -40
  echo '=== apps INNER (health_ecosystem_core/health_ecosystem_core) ==='; ls -1 $APPS/health_ecosystem_core | head -60
  echo '=== sp OUTER ==='; ls -1 $SP | head -40
  echo '=== sp INNER ==='; ls -1 $SP/health_ecosystem_core | head -60
  echo '=== CORRECT DIFF: apps INNER vs sp INNER (py-relevant) ==='
  diff -rq $APPS/health_ecosystem_core $SP/health_ecosystem_core 2>&1 | grep -vE '__pycache__|\.pyc' 
  echo DIFF_DONE
" 2>&1 | grep -vE 'version.*obsolete|^time='
