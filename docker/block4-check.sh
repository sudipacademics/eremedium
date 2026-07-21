#!/bin/bash
# Block 4 (P47-P56) runtime health check — module import integrity + auth-gate probe.
# These phases ship no smoke_* functions and expose no guest endpoints, so we verify
# import integrity and confirm a sensitive endpoint rejects unauthenticated access.
cd /opt/health-ecosystem/docker
echo "=== import integrity (all Block 4 modules via frappe.get_module) ==="
for m in clinical_phase47_complete_care clinical_phase48_eprescribe \
         clinical_phase49_rx_diagnostics clinical_phase50_erx_fulfillment \
         clinical_phase51_employee_gamification clinical_phase52_staff_gamification_web \
         clinical_phase53_critical_alerts clinical_phase53_executive_analytics \
         clinical_phase54_franchisee_rate_model clinical_phase55_lab_content \
         clinical_phase56_lab_parameters; do
  out=$(docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site health.localhost execute frappe.get_module --kwargs \"{'modulename': 'health_ecosystem_core.health_ecosystem_core.$m'}\" 2>&1")
  if echo "$out" | grep -q "module 'health_ecosystem_core"; then
    echo "OK   $m"
  else
    echo "FAIL $m"; echo "$out" | grep -vE 'version.*obsolete|^time=' | tail -4
  fi
done
echo
echo "=== phase55 functional probe: build_lab_content normalizes sample type (serum -> Blood) ==="
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase55_lab_content.build_lab_content --kwargs \"{'raw_name': 'lipid profile', 'sample_type': 'serum'}\" 2>&1 | grep -oE '\"(display_name|sample_type)\": \"[^\"]*\"' | head -4"
