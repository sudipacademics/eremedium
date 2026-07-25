#!/bin/bash
BASE=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
echo "=== Imports from api in phase modules ==="
for f in clinical_phase31_allied_health.py clinical_phase66_ai_physician.py clinical_phase32_pharmacy_quote.py clinical_phase44_insurance.py clinical_phase18b.py clinical_homepage.py; do
  echo "--- $f ---"
  grep -nE 'from health_ecosystem_core.health_ecosystem_core.api import|from \.api import' "$BASE/$f" -A 15 | head -25
done
echo "=== Missing symbols check ==="
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc '
./env/bin/python <<PY
import importlib, traceback
mods = [
 "health_ecosystem_core.health_ecosystem_core.clinical_phase31_allied_health",
 "health_ecosystem_core.health_ecosystem_core.clinical_phase66_ai_physician",
 "health_ecosystem_core.health_ecosystem_core.clinical_phase18b",
 "health_ecosystem_core.health_ecosystem_core.clinical_phase32_pharmacy_quote",
 "health_ecosystem_core.health_ecosystem_core.clinical_phase44_insurance",
 "health_ecosystem_core.health_ecosystem_core.appointments",
 "health_ecosystem_core.health_ecosystem_core.otp_auth",
 "health_ecosystem_core.health_ecosystem_core.email_auth",
 "health_ecosystem_core.health_ecosystem_core.clinical_journey",
 "health_ecosystem_core.health_ecosystem_core.clinical_diagnostics",
]
for m in mods:
  try:
    importlib.import_module(m)
    print("OK", m)
  except Exception as e:
    print("FAIL", m, "=>", type(e).__name__, e)
PY
'
echo "=== Helpers present in api? ==="
grep -nE 'def _load_wellness|def _load_mobile|def create_pharmacy_quote|def get_allied|def start_ai|def ai_physician|def complete_oauth|def submit_insurance|def get_insurance' "$BASE/api.py" | head -40
