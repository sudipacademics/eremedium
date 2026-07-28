#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
docker compose -f docker-compose.yml -f docker-compose.ffms.yml up -d --build rfms
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms grep -c '/api/v1/auth/login' /app/apps/local-api/server.mjs
docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms grep -c 'Company ID' /app/apps/admin-dashboard/out/index.html || \
  docker compose -f docker-compose.yml -f docker-compose.ffms.yml exec -T rfms sh -c 'grep -Rcl "Company ID\|auth/login" /app/apps/admin-dashboard/out | head'
echo RFMS_LOGIN_DONE
