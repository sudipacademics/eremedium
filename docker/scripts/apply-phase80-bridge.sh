#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
SITE="${FRAPPE_SITE:-health.localhost}"

docker compose exec -T backend bash -s <<'EOS'
set -e
cd /home/frappe/frappe-bench
CORE=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
PKG=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
echo "PKG=$PKG"
for f in clinical_phase80_onboarding_bridge.py api.py init.py clinical_phase27b.py; do
  cp -f "$CORE/$f" "$PKG/$f"
  ./env/bin/python -m py_compile "$PKG/$f"
  echo "copied $f"
done
# Also keep apps tree copy for next migrate
for f in clinical_phase80_onboarding_bridge.py api.py init.py clinical_phase27b.py; do
  test -f "$CORE/$f"
done
bench --site health.localhost clear-cache
EOS

# Align HMAC secret to RFMS compose default (or existing rfms env)
RFMS_SECRET=$(docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms printenv ONBOARD_HMAC_SECRET 2>/dev/null | tr -d '\r' || true)
if [ -z "$RFMS_SECRET" ]; then
  RFMS_SECRET="hec-onboard-dev-secret-change-me"
fi

docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase80_setup --kwargs '{\"secret\": \"$RFMS_SECRET\", \"base_url\": \"https://www.e-remedium.in/onboard\"}'"

docker compose restart backend queue-short queue-long scheduler
sleep 8
echo PHASE80_SETUP_OK
