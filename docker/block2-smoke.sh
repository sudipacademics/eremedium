#!/bin/bash
# Block 2 (P27-P36) smoke baseline — read-only self-tests
cd /opt/health-ecosystem/docker
run() {
  local label="$1"; local method="$2"
  echo "=== $label ==="
  docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site health.localhost execute $method 2>&1 | tail -20"
  echo
}
run "P27 scheduled reminders" "health_ecosystem_core.health_ecosystem_core.clinical_phase27.smoke_scheduled_reminders"
run "P28 ops"                 "health_ecosystem_core.health_ecosystem_core.clinical_phase28_ops.smoke_phase28_ops"
run "P29 lab import"          "health_ecosystem_core.health_ecosystem_core.clinical_phase29_lab_import.smoke_phase29_lab_import"
