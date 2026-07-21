#!/bin/bash
# Block 5 (P57-P66) runtime health check.
# - Import integrity for all 10 modules (catches drift like the P55 break in Block 4).
# - Security probe: run_phase64_setup / run_phase64_smoke must reject Guest over HTTP
#   (they were allow_guest=True; smoke creates real patients/bookings + leaks diagnostics).
# NOTE: P64/P65/P66 smokes are intentionally NOT run here — they create real bookings,
#       place Exotel calls, or call OpenAI (cost/side effects on the live site).
cd /opt/health-ecosystem/docker
SITE=health.localhost

echo "=== import integrity (all Block 5 modules via frappe.get_module) ==="
for m in clinical_phase57_lab_interpretations clinical_phase58_report_signatories \
         clinical_phase59_parameter_inventory clinical_phase60_health_packages \
         clinical_phase61_nabl_112b clinical_phase62_nabl_112a_qc \
         clinical_phase63_nabl_112a_qms clinical_phase64_telephony \
         clinical_phase65_number_masking clinical_phase66_ai_physician; do
  out=$(docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute frappe.get_module --kwargs \"{'modulename': 'health_ecosystem_core.health_ecosystem_core.$m'}\" 2>&1")
  if echo "$out" | grep -q "module 'health_ecosystem_core"; then
    echo "OK   $m"
  else
    echo "FAIL $m"; echo "$out" | grep -vE 'version.*obsolete|^time=' | tail -4
  fi
done

echo
echo "=== security probe: guest HTTP must be rejected (expect 403) ==="
for fn in run_phase64_setup run_phase64_smoke; do
  code=$(docker compose exec -T backend bash -lc "curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8000/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony.$fn -H 'X-Frappe-Site-Name: $SITE'")
  echo "$fn -> HTTP $code (expect 403)"
done
