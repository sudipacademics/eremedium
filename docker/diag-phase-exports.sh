#!/bin/bash
set -e
BASE=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
echo "=== Whitelisted methods in key phase modules ==="
for f in clinical_phase18b.py clinical_phase31_allied_health.py clinical_phase32_pharmacy_quote.py clinical_phase44_insurance.py clinical_phase66_ai_physician.py clinical_phase25.py clinical_phase64_telephony.py; do
  echo "--- $f ---"
  grep -nE '@frappe.whitelist|def get_|def start_|def create_|def list_|def complete_|def book_' "$BASE/$f" | head -40
done
echo "=== api.py wrappers mentioning phase31/66/44/32 ==="
grep -nE 'phase31|phase66|phase44|phase32|allied_health|ai_physician|insurance|pharmacy_quote' "$BASE/api.py" | head -40
echo "=== build/lib api (maybe fuller) ==="
BL=/opt/health-ecosystem/health_ecosystem_core/build/lib/health_ecosystem_core/health_ecosystem_core/api.py
if [ -f "$BL" ]; then
  wc -l "$BL"
  grep -nE 'def get_allied_health|def start_ai_physician|def get_sales_portal_summary|def create_pharmacy_quote' "$BL" | head
fi
