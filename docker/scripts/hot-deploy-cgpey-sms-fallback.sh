#!/bin/bash
set -euo pipefail
SRC="${1:-/tmp/cgpey-sms-fallback}"
FFMS=/opt/health-ecosystem/apps_external/ffms
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)

cp -f "$SRC/cgpey-kyc-adapter.mjs" "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"
cp -f "$SRC/page.tsx" "$FFMS/apps/franchise-portal/app/page.tsx"
grep -q "deepFindSigningLink" "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"
grep -q "signing SMS" "$FFMS/apps/franchise-portal/app/page.tsx"

echo "=== rebuild rfms (API + portal) ==="
"${COMPOSE[@]}" up -d --build rfms
code=000
for i in $(seq 1 50); do
  code=$(curl -sS -o /tmp/rfms_health_sms_fb.json -w '%{http_code}' http://127.0.0.1:8090/api/v1/health || echo 000)
  echo "health_try${i}:${code}"
  [[ "$code" == "200" ]] && break
  sleep 4
done
[[ "$code" == "200" ]] || { "${COMPOSE[@]}" logs --tail 100 rfms; exit 1; }

CID=$("${COMPOSE[@]}" ps -q rfms)
docker exec "$CID" grep -n "deepFindSigningLink\|idto.ai SMS" /app/apps/local-api/cgpey-kyc-adapter.mjs /app/apps/franchise-portal/app/page.tsx 2>/dev/null | head -20 || true
# portal may only exist as built out/
docker exec "$CID" sh -lc 'grep -R "idto.ai SMS\|signing SMS" /app/apps/franchise-portal/out /app/apps/franchise-portal/.next 2>/dev/null | head -5 || grep -n "idto.ai SMS" /app/apps/franchise-portal/app/page.tsx | head -5'

echo "=== real PDF initiate smoke ==="
docker exec "$CID" node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { fetchRfmsIntegrationConfig } from '/app/apps/local-api/hec-frappe-bridge.mjs';
import { mergeCgpeyConfig, initiateAgreementEsign } from '/app/apps/local-api/cgpey-kyc-adapter.mjs';

function findPdf() {
  let found = null;
  const walk = (dir, depth = 0) => {
    if (depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p, depth + 1);
      else if (/\.pdf$/i.test(ent.name)) {
        try {
          const st = fs.statSync(p);
          if (!found || st.mtimeMs > found.mtimeMs) found = { p, mtimeMs: st.mtimeMs, size: st.size };
        } catch {}
      }
    }
  };
  walk('/data/uploads');
  return found;
}

const found = findPdf();
if (!found) {
  console.log(JSON.stringify({ pdf: false }));
  process.exit(0);
}
const buf = fs.readFileSync(found.p);
const erp = await fetchRfmsIntegrationConfig();
const cfg = mergeCgpeyConfig({
  apiKey: erp?.cgpey_api_key,
  apiSecret: erp?.cgpey_api_secret,
  merchantId: erp?.cgpey_merchant_id,
  baseUrl: erp?.cgpey_base_url,
});
try {
  const result = await initiateAgreementEsign({
    pdfBase64: buf.toString('base64'),
    signerName: 'Probe Applicant',
    signerMobile: '9876543210',
    referencePrefix: 'RFMS-SMOKE',
    config: cfg,
  });
  console.log(JSON.stringify({
    pdf: found.p,
    size: found.size,
    ok: true,
    docketId: result.docketId || '',
    hasLink: Boolean(result.invitationLink),
    linkPreview: result.invitationLink ? result.invitationLink.slice(0, 80) : '',
    pageNumber: result.pageNumber,
    pageCount: result.pageCount,
  }));
} catch (error) {
  console.log(JSON.stringify({
    pdf: found.p,
    size: found.size,
    ok: false,
    code: error?.code || '',
    message: String(error?.message || error).slice(0, 400),
  }));
}
NODE

echo CGPEY_SMS_FALLBACK_OK
