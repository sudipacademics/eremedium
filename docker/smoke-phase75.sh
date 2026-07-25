#!/usr/bin/env bash
set -euo pipefail
cd /opt/health-ecosystem/docker
cp -f /tmp/hec-refer/clinical_phase75_patient_referral.py \
  /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase75_patient_referral.py
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && ./env/bin/pip install -q --force-reinstall --no-deps /tmp/hec_reinstall 2>/dev/null || true'
# Reinstall from apps mount
docker compose exec -T backend bash -lc '
  set -e
  cd /home/frappe/frappe-bench
  rm -rf /tmp/hec_reinstall
  cp -a apps/health_ecosystem_core /tmp/hec_reinstall
  ./env/bin/pip install -q --force-reinstall --no-deps /tmp/hec_reinstall
  rm -rf /tmp/hec_reinstall
  bench --site health.localhost clear-cache
'
docker compose restart backend
sleep 5
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && bench --site health.localhost console' <<'PY'
from health_ecosystem_core.health_ecosystem_core.clinical_phase75_patient_referral import setup_phase75, smoke_phase75
print("SETUP", setup_phase75())
print("SMOKE", smoke_phase75())
print("DONE")
PY
