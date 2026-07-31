#!/bin/bash
set -euo pipefail
SRC="${1:-/tmp/cgpey-esign-v2}"
FFMS=/opt/health-ecosystem/apps_external/ffms
HEC=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)

cp -f "$SRC/cgpey-kyc-adapter.mjs" "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"
cp -f "$SRC/server.mjs" "$FFMS/apps/local-api/server.mjs"
cp -f "$SRC/page.tsx" "$FFMS/apps/franchise-portal/app/page.tsx"
cp -f "$SRC/clinical_secrets.py" "$HEC/clinical_secrets.py"
cp -f "$SRC/clinical_phase83_rfms_bridge.py" "$HEC/clinical_phase83_rfms_bridge.py"
cp -f "$SRC/docker-compose.ffms.yml" /opt/health-ecosystem/docker/docker-compose.ffms.yml

grep -q 'initiateAgreementEsign' "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"
grep -q 'esign/complete' "$FFMS/apps/local-api/server.mjs"
grep -q 'I have completed eSign' "$FFMS/apps/franchise-portal/app/page.tsx"
grep -q 'verify.cgpey.com' "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"

docker cp "$HEC/clinical_secrets.py" docker-backend-1:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_secrets.py
docker cp "$HEC/clinical_phase83_rfms_bridge.py" docker-backend-1:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase83_rfms_bridge.py

docker exec -u frappe -w /home/frappe/frappe-bench docker-backend-1 \
  bench --site health.localhost mariadb -e "UPDATE tabSingles SET value='https://verify.cgpey.com' WHERE doctype='Health Ecosystem Settings' AND field='cgpey_base_url'"
docker exec -u frappe -w /home/frappe/frappe-bench docker-backend-1 \
  bench --site health.localhost mariadb -N -e "SELECT value FROM tabSingles WHERE doctype='Health Ecosystem Settings' AND field='cgpey_base_url' LIMIT 1"
docker exec -u frappe -w /home/frappe/frappe-bench docker-backend-1 \
  bench --site health.localhost clear-cache

"${COMPOSE[@]}" up -d --build rfms
sleep 15
code=000
for i in $(seq 1 40); do
  code=$(curl -sS -o /tmp/rfms_health_esign_v2.json -w '%{http_code}' http://127.0.0.1:8090/api/v1/health || echo 000)
  echo "health_try${i}:${code}"
  [[ "$code" == "200" ]] && break
  sleep 4
done
[[ "$code" == "200" ]] || { "${COMPOSE[@]}" logs --tail 80 rfms; exit 1; }

CID=$("${COMPOSE[@]}" ps -q rfms)
docker exec -w /app "$CID" node --input-type=module -e '
import { mergeCgpeyConfig } from "/app/apps/local-api/cgpey-kyc-adapter.mjs";
import { fetchRfmsIntegrationConfig } from "/app/apps/local-api/hec-frappe-bridge.mjs";
const n = mergeCgpeyConfig({ apiKey:"x", apiSecret:"y", merchantId:"m", baseUrl:"https://docs.cgpey.com" });
if (n.baseUrl !== "https://verify.cgpey.com") { console.error("normalize_failed", n.baseUrl); process.exit(1); }
const erp = await fetchRfmsIntegrationConfig();
const cfg = mergeCgpeyConfig({
  apiKey: erp?.cgpey_api_key,
  apiSecret: erp?.cgpey_api_secret,
  merchantId: erp?.cgpey_merchant_id,
  baseUrl: erp?.cgpey_base_url,
});
console.log(JSON.stringify({ normalize_ok: true, runtime_base: cfg.baseUrl, keySet: Boolean(cfg.apiKey), merchantSet: Boolean(cfg.merchantId) }));
'

echo CGPEY_ESIGN_V2_DEPLOY_OK
