#!/bin/bash
# Deploy api.py restore + reinstall (no volume wipe)
set -e
cd /opt/health-ecosystem/docker
echo "=== Verify helpers in mounted api.py ==="
API=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py
# apps path inside container
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
API=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py
grep -n "def _load_wellness_promo_banners\|def start_ai_physician_journey\|def create_pharmacy_quote_request\|get_allied_health_wings\|get_insurance_landing\|complete_oauth_login" "$API" | head -30
rm -rf /tmp/hec_reinstall
cp -a apps/health_ecosystem_core /tmp/hec_reinstall
./env/bin/pip install -q --force-reinstall --no-deps /tmp/hec_reinstall
./env/bin/python <<'PY'
import health_ecosystem_core.health_ecosystem_core.api as m
for name in [
  "_load_wellness_promo_banners",
  "start_ai_physician_journey",
  "ai_physician_turn",
  "create_pharmacy_quote_request",
  "get_allied_health_wings",
  "get_insurance_landing",
  "complete_oauth_login",
]:
  assert hasattr(m, name), name
  print("OK", name)
import health_ecosystem_core.health_ecosystem_core.clinical_phase31_allied_health as p31
print("OK phase31 import")
import health_ecosystem_core.health_ecosystem_core.appointments as ap
print("OK appointments import", hasattr(ap, "get_allied_health_wings"))
PY
bench --site health.localhost clear-cache
EOS
docker compose restart backend queue-short queue-long scheduler
echo DONE
