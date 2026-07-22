#!/bin/bash
# Deploy password-field OpenAI fix into apps bind-mount + site-packages, clear cache, restart.
set -e
cd /opt/health-ecosystem/docker
APPS=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SP=/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core/health_ecosystem_core

docker compose exec -T -u root backend bash -lc "
  set -e
  cp -a $APPS/clinical_phase64_telephony.py $SP/
  cp -a $APPS/clinical_phase66_ai_physician.py $SP/
  chown frappe:frappe $SP/clinical_phase64_telephony.py $SP/clinical_phase66_ai_physician.py
  echo '=== verify get_password in deployed files ==='
  grep -n 'get_password(\"telephony_openai_api_key\"' $APPS/clinical_phase64_telephony.py $SP/clinical_phase64_telephony.py
  grep -n 'get_password(\"telephony_openai_api_key\"' $APPS/clinical_phase66_ai_physician.py $SP/clinical_phase66_ai_physician.py
"
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && bench --site health.localhost clear-cache' 2>&1 | grep -vE 'version.*obsolete|^time=' | tail -3
docker compose restart backend
sleep 12
echo DEPLOYED
