#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml -p docker)
BCID=$("${COMPOSE[@]}" ps -q backend)
docker cp /tmp/crm-reach-sync/_check_crm_perms.py "$BCID:/tmp/_check_crm_perms.py"
"${COMPOSE[@]}" exec -T backend bash -lc '
set -e
cd /home/frappe/frappe-bench
if [[ -f sites/currentsite.txt ]]; then
  SITE=$(tr -d "\r\n" < sites/currentsite.txt)
else
  SITE=$(find sites -maxdepth 2 -name site_config.json | head -1 | sed "s|sites/||;s|/site_config.json||")
fi
echo SITE=$SITE
cd sites
../env/bin/python <<PY
import frappe, importlib.util
frappe.init(site="$SITE")
frappe.connect()
spec = importlib.util.spec_from_file_location("check", "/tmp/_check_crm_perms.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
frappe.destroy()
PY
'
