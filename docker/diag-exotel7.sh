#!/bin/bash
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc 'sed -n "74,180p" /home/frappe/frappe-bench/apps/frappe/frappe/utils/response.py; echo ====; grep -n "KeyError\|\[.text.\]\|response\[.text.\]\|def as_" /home/frappe/frappe-bench/apps/frappe/frappe/app.py | head -40; sed -n "90,160p" /home/frappe/frappe-bench/apps/frappe/frappe/app.py'
