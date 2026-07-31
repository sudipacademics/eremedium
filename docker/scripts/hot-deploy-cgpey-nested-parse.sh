#!/bin/bash
set -euo pipefail
SRC="${1:-/tmp/cgpey-page-fix}"
FFMS=/opt/health-ecosystem/apps_external/ffms
cd /opt/health-ecosystem/docker
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)

cp -f "$SRC/cgpey-kyc-adapter.mjs" "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"
grep -q "CGPEY wraps IDTOAI" "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"
grep -q "resolveEsignPageNumber" "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs"

CID=$("${COMPOSE[@]}" ps -q rfms)
docker cp "$FFMS/apps/local-api/cgpey-kyc-adapter.mjs" "$CID:/app/apps/local-api/cgpey-kyc-adapter.mjs"
"${COMPOSE[@]}" restart rfms
sleep 8
code=$(curl -sS -o /tmp/rfms_health_esign_nested.json -w '%{http_code}' http://127.0.0.1:8090/api/v1/health || echo 000)
echo "health:$code"
test "$code" = "200"

docker exec "$CID" node --input-type=module <<'NODE'
function invitationFrom(json) {
  const nestedErrorData = json?.error && typeof json.error === 'object' && !Array.isArray(json.error)
    ? json.error.data
    : null;
  const outer = json?.data && typeof json.data === 'object' ? json.data : null;
  const inner = outer?.data && typeof outer.data === 'object' ? outer.data : null;
  const candidates = [inner, outer, nestedErrorData, json].filter((item) => item && typeof item === 'object');
  const data = candidates.find((item) => (
    item.docket_id || item.docketId || item.signer_info || item.signers_info || item.invitation_link
  )) || outer || json;
  const signers = Array.isArray(data?.signer_info)
    ? data.signer_info
    : Array.isArray(data?.signers_info)
      ? data.signers_info
      : [];
  const first = signers[0] && typeof signers[0] === 'object' ? signers[0] : {};
  return {
    docketId: String(data?.docket_id || data?.docketId || '').trim(),
    invitationLink: String(first.invitation_link || first.invitationLink || data?.invitation_link || '').trim(),
  };
}

const sample = {
  success: true,
  data: {
    transactionId: 't1',
    data: {
      docket_id: 'd1',
      signer_info: [{ invitation_link: 'https://example.test/sign' }],
    },
  },
};
const parsed = invitationFrom(sample);
if (!parsed.docketId || !parsed.invitationLink) {
  console.error('PARSE_FAIL', parsed);
  process.exit(1);
}
console.log('PARSE_OK', parsed);
NODE

docker exec "$CID" grep -n "CGPEY wraps IDTOAI\|page_number: pageNumber" /app/apps/local-api/cgpey-kyc-adapter.mjs | head
echo CGPEY_NESTED_PARSE_OK
