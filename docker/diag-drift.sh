#!/bin/bash
# Read-only: detect drift between the apps/ bind-mount and installed site-packages.
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc 'diff -rq /home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core /home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core 2>&1 | grep -vE "__pycache__|egg-info|\.pyc|Only in .*egg" ; echo DIFF_DONE' 2>&1 | grep -vE 'version.*obsolete|^time='
