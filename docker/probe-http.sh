#!/bin/bash
# Read-only HTTP health probe of key endpoints (guest). Prints status codes with a tag.
cd /opt/health-ecosystem/docker
TAG="${1:-PROBE}"
SITE=health.localhost
for ep in api.get_oauth_providers api.get_lab_test_catalog; do
  code=$(docker compose exec -T backend bash -lc "curl -s -o /dev/null -w '%{http_code}' 'http://localhost:8000/api/method/health_ecosystem_core.health_ecosystem_core.$ep' -H 'X-Frappe-Site-Name: $SITE'")
  echo "$TAG $ep -> HTTP $code"
done
