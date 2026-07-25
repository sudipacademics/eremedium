#!/bin/bash
BASE=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
echo "=== phase66 whitelist around start ==="
sed -n '600,650p' "$BASE/clinical_phase66_ai_physician.py"
echo "=== phase66 more defs ==="
grep -nE '@frappe.whitelist|^def ' "$BASE/clinical_phase66_ai_physician.py" | head -40
echo "=== phase25 sales portal wrappers in api ==="
grep -nE 'get_sales_portal|phase25' "$BASE/api.py" | head -30
echo "=== phase32 create quote ==="
grep -nE '@frappe.whitelist|^def ' "$BASE/clinical_phase32_pharmacy_quote.py" | head -40
echo "=== phase44 ==="
grep -nE '@frappe.whitelist|^def ' "$BASE/clinical_phase44_insurance.py" | head -40
echo "=== Try call phase module paths ==="
curl -s "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase31_allied_health.get_allied_health_wings" -H "X-Frappe-Site-Name: health.localhost" | head -c 400
echo
curl -s "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase66_ai_physician.start_ai_physician_journey" -H "X-Frappe-Site-Name: health.localhost" -X POST -d "symptoms=fever" | head -c 400
echo
curl -s "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase44_insurance.get_insurance_landing" -H "X-Frappe-Site-Name: health.localhost" | head -c 400
echo
