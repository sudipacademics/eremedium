#!/bin/bash
# Block 6 (P67-P74) runtime health check.
# - Import integrity for all 9 modules (catches drift like the P55 break in Block 4).
# - Security probe: safe_download_pdf (allow_guest) must NOT return a PDF to a Guest
#   for a financial doc; it delegates to validate_print_permission (expect 403, not 200).
# NOTE: P67/P69/P72 smokes create real financial docs (GST/invoices/payroll) and are
#       intentionally NOT run here to avoid side effects on the live site.
cd /opt/health-ecosystem/docker
SITE=health.localhost

echo "=== import integrity (all Block 6 modules via frappe.get_module) ==="
for m in clinical_phase67_gst_compliance clinical_phase68_ops_planning \
         clinical_phase69_pharma_bill clinical_phase70_lab_bill_entry \
         clinical_phase70_lab_result_entry clinical_phase71_ops_dashboards \
         clinical_phase72_payroll clinical_phase73_talent \
         clinical_phase74_performance; do
  out=$(docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute frappe.get_module --kwargs \"{'modulename': 'health_ecosystem_core.health_ecosystem_core.$m'}\" 2>&1")
  if echo "$out" | grep -q "module 'health_ecosystem_core"; then
    echo "OK   $m"
  else
    echo "FAIL $m"; echo "$out" | grep -vE 'version.*obsolete|^time=' | tail -4
  fi
done

echo
echo "=== security probe: guest safe_download_pdf must be permission-gated (expect 403/404, NOT 200) ==="
code=$(docker compose exec -T backend bash -lc "curl -s -o /dev/null -w '%{http_code}' 'http://localhost:8000/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.safe_download_pdf?doctype=Purchase%20Invoice&name=ACC-PINV-2026-00020' -H 'X-Frappe-Site-Name: $SITE'")
echo "guest safe_download_pdf(Purchase Invoice) -> HTTP $code (200 would be an IDOR leak)"
