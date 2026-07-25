#!/bin/bash
set -e
cd /opt/health-ecosystem/docker
docker compose restart frontend || true
docker compose exec -T backend bench --site health.localhost execute \
  health_ecosystem_core.health_ecosystem_core.clinical_phase71_ops_dashboards.api_get_company_ops_kpis \
  --kwargs '{"board":"hr"}'
