#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)
FFMS=/opt/health-ecosystem/apps_external/ffms
HEC=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SRC="${1:-/tmp/cgpey-baseurl-fix}"

cp -f "$SRC/cgpey-kyc-adapter.mjs" "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"
cp -f "$SRC/clinical_secrets.py" "$HEC/clinical_secrets.py"

CID=$("${COMPOSE[@]}" ps -q rfms)
docker cp "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs" "$CID:/app/apps/local-api/cgpey-kyc-adapter.mjs"
docker cp "$HEC/clinical_secrets.py" docker-backend-1:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_secrets.py

docker exec -u frappe -w /home/frappe/frappe-bench docker-backend-1 \
  bench --site health.localhost mariadb -e "UPDATE tabSingles SET value='https://docs.cgpey.com' WHERE doctype='Health Ecosystem Settings' AND field='cgpey_base_url'"

docker exec -u frappe -w /home/frappe/frappe-bench docker-backend-1 \
  bench --site health.localhost mariadb -N -e "SELECT value FROM tabSingles WHERE doctype='Health Ecosystem Settings' AND field='cgpey_base_url' LIMIT 1"

docker exec -u frappe -w /home/frappe/frappe-bench docker-backend-1 \
  bench --site health.localhost clear-cache

"${COMPOSE[@]}" restart rfms
sleep 8
code=$(curl -sS -o /tmp/rfms_health_cgpey_base.json -w '%{http_code}' http://127.0.0.1:8090/api/v1/health || echo 000)
echo "health:$code"
test "$code" = "200"

docker exec "$CID" node --input-type=module -e 'import { mergeCgpeyConfig } from "/app/apps/local-api/cgpey-kyc-adapter.mjs"; const cfg=mergeCgpeyConfig({apiKey:"x",apiSecret:"y",merchantId:"m",baseUrl:"https://www.cgpey.com",simulate:false}); console.log("normalize", cfg.baseUrl); if(cfg.baseUrl!=="https://docs.cgpey.com") process.exit(1);'

docker exec -u frappe -w /home/frappe/frappe-bench docker-backend-1 \
  bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_secrets.get_cgpey_base_url

echo CGPEY_BASEURL_FIX_OK
