#!/bin/bash
# Block 1 (P6-P26) smoke baseline — read-only self-tests
cd /opt/health-ecosystem/docker
run() {
  local label="$1"; local method="$2"
  echo "=== $label ==="
  docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site health.localhost execute $method 2>&1 | tail -15"
  echo
}
run "P18b OAuth"        "health_ecosystem_core.health_ecosystem_core.clinical_phase18b.smoke_phase18b_oauth"
run "P19 subscriptions" "health_ecosystem_core.health_ecosystem_core.clinical_phase19.smoke_phase19"
run "P20 phlebo GPS"    "health_ecosystem_core.health_ecosystem_core.clinical_phase20.smoke_phase20"
run "P21 HR self-serve" "health_ecosystem_core.health_ecosystem_core.clinical_phase21.smoke_phase21"
run "P23 B2B franchise" "health_ecosystem_core.health_ecosystem_core.clinical_phase23.smoke_phase23"
run "P24 reagents"      "health_ecosystem_core.health_ecosystem_core.clinical_phase24.smoke_phase24_reagents"
run "P25 sales force"   "health_ecosystem_core.health_ecosystem_core.clinical_phase25.smoke_phase25"
