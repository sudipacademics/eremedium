#!/bin/bash
# Read-only: pull the most recent telephony_openai Error Log traceback.
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site health.localhost execute frappe.get_all --kwargs \"{'doctype':'Error Log','filters':{'method':'telephony_openai'},'fields':['creation','error'],'order_by':'creation desc','limit_page_length':1}\"" 2>&1 | grep -vE 'version.*obsolete|^time='
