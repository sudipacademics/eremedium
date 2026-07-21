#!/bin/bash
# Block 3 (P37-P46) runtime health check — module imports + safe read endpoints.
# These phases ship no smoke_* functions, so we verify import integrity and a
# representative guest read instead.
cd /opt/health-ecosystem/docker
echo "=== import integrity (all Block 3 modules via frappe.get_module) ==="
for m in clinical_phase37_report_lifecycle clinical_phase39_franchisee_kpi \
         clinical_phase40_nabl_report clinical_phase41_provider_onboarding \
         clinical_phase42_telemedicine clinical_phase43_subscription_checkout \
         clinical_phase44_insurance clinical_phase45_ops_queues \
         clinical_phase46_provider_portal; do
  out=$(docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site health.localhost execute frappe.get_module --kwargs \"{'modulename': 'health_ecosystem_core.health_ecosystem_core.$m'}\" 2>&1")
  if echo "$out" | grep -q "module 'health_ecosystem_core"; then
    echo "OK   $m"
  else
    echo "FAIL $m"; echo "$out" | grep -vE 'version.*obsolete|^time=' | tail -4
  fi
done
echo
echo "=== safe guest read: get_insurance_landing (P44) ==="
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase44_insurance.get_insurance_landing 2>&1 | tail -5"
