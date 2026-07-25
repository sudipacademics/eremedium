#!/usr/bin/env bash
set -euo pipefail
cd /opt/health-ecosystem/docker

echo "=== ensure api module on apps tree ==="
APP=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
HOST=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core

# Prefer host tree (canonical deploy target) → apps bind if present
if [ -f "$HOST/api.py" ]; then
  echo "Host api.py present ($(wc -c < "$HOST/api.py") bytes)"
  # If apps path is a real directory (not only site-packages), sync critical files
  docker compose exec -T backend bash -lc "
    set -e
    DEST=/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
    SRC=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
    if [ -d \"\$DEST\" ] && [ -d \"\$SRC\" ]; then
      cp -f \"\$SRC/api.py\" \"\$DEST/api.py\"
      cp -f \"\$SRC/clinical_openai.py\" \"\$DEST/clinical_openai.py\"
      cp -f \"\$SRC/clinical_phase64_telephony.py\" \"\$DEST/clinical_phase64_telephony.py\"
      cp -f \"\$SRC/clinical_phase66_ai_physician.py\" \"\$DEST/clinical_phase66_ai_physician.py\"
      cp -f \"\$SRC/doctype/health_ecosystem_settings/health_ecosystem_settings.json\" \"\$DEST/doctype/health_ecosystem_settings/health_ecosystem_settings.json\"
      echo synced_apps_tree
      ls -la \"\$DEST/api.py\" \"\$DEST/clinical_openai.py\"
    else
      echo 'apps or host path missing inside container'
      ls -la /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py || true
      ls -la /home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py || true
    fi
  "
fi

echo "=== safe-update (reinstall + migrate + restart) ==="
./safe-update-app.sh

echo "=== HTTP smoke ==="
sleep 3
curl -sS -X POST 'http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.api.start_ai_physician_journey' \
  -H 'X-Frappe-Site-Name: health.localhost' \
  -d 'symptoms=I+have+fever' | head -c 1500
echo
curl -sS -L -X POST 'https://www.e-remedium.in/api/method/health_ecosystem_core.health_ecosystem_core.api.start_ai_physician_journey' \
  -d 'symptoms=I+have+fever' | head -c 1500
echo
echo DONE
