#!/bin/bash
set -e
BAK=/opt/health-ecosystem/My_Lab_System/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py
CUR=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py
echo "=== BACKUP ==="
wc -l "$BAK"
grep -c '^def ' "$BAK" || true
grep -nE 'def get_allied_health|def start_ai_physician|def get_sales_portal_summary|def create_pharmacy_quote|def list_insurance|openai|telephony_openai|complete_oauth|def get_yoga' "$BAK" | head -60
echo "=== CURRENT ==="
wc -l "$CUR"
grep -c '^def ' "$CUR" || true
grep -nE 'def get_allied_health|def start_ai_physician|def get_sales_portal_summary|def create_pharmacy_quote|def list_insurance|openai|telephony_openai|complete_oauth' "$CUR" | head -40
echo "=== SITEPACKAGES ==="
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc '
SP=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.api as m; print(m.__file__)")
echo "file=$SP"
grep -c "^def " "$SP" || true
grep -nE "def get_allied_health|def start_ai_physician|def get_sales_portal_summary|def create_pharmacy_quote" "$SP" | head -20
'
echo "=== OPENAI SETTINGS FIELDS ==="
grep -nE 'openai|OpenAI' /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/doctype/health_ecosystem_settings/*.json 2>/dev/null | head || true
grep -nE 'openai|OpenAI|telephony_openai' /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase64_telephony.py /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase66_ai_physician.py 2>/dev/null | head -30
