#!/bin/bash
# Multi-level smoke: FFMS ↔ Reach (Phase 80 HMAC handoff).
# Run on the mother VPS from /opt/health-ecosystem/docker
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

SITE="${FRAPPE_SITE:-health.localhost}"
PUBLIC_ORIGIN="${RFMS_PUBLIC_ORIGIN:-https://www.e-remedium.in}"
REACH_ORIGIN="${REACH_ORIGIN:-https://reach.e-remedium.in}"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)
PASS=0
FAIL=0

ok() { echo "  OK  $*"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL $*"; FAIL=$((FAIL + 1)); }
section() { echo; echo "=== $* ==="; }

http_code() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 8 --max-time 25 -L "$url" || echo "000"
}

section "L1 Network"
if "${COMPOSE[@]}" ps rfms 2>/dev/null | grep -Eq 'Up|running'; then
  ok "rfms container running"
else
  bad "rfms container not running"
fi

for url in \
  "$PUBLIC_ORIGIN/franchise/" \
  "$PUBLIC_ORIGIN/onboard/" \
  "$PUBLIC_ORIGIN/rfms-api/v1/health" \
  "$REACH_ORIGIN/sales"
do
  code="$(http_code "$url")"
  case "$code" in
    200|301|302|304) ok "$url → HTTP $code" ;;
    *) bad "$url → HTTP $code" ;;
  esac
done

section "L2 Shared HMAC secret"
CONF_JSON="$("${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && python3 - <<'PY'
import json
conf=json.load(open('sites/$SITE/site_config.json'))
print(json.dumps({
  'frappe_secret_set': bool(str(conf.get('onboard_hmac_secret') or '').strip()),
  'onboard_base_url': str(conf.get('onboard_base_url') or '').rstrip('/'),
  'frappe_secret': str(conf.get('onboard_hmac_secret') or '').strip(),
  'frappe_secret_fp': (str(conf.get('onboard_hmac_secret') or '').strip()[:8] + '…') if str(conf.get('onboard_hmac_secret') or '').strip() else '',
}))
PY")"
echo "  $(echo "$CONF_JSON" | sed 's/"frappe_secret": "[^"]*"/"frappe_secret": "[redacted]"/')"
if echo "$CONF_JSON" | grep -q '"frappe_secret_set": true'; then
  ok "Frappe onboard_hmac_secret configured"
else
  bad "Frappe onboard_hmac_secret missing — run apply-phase80-bridge.sh"
fi
if echo "$CONF_JSON" | grep -q '/onboard"'; then
  ok "onboard_base_url points at /onboard"
else
  bad "onboard_base_url not set to .../onboard"
fi

RFMS_SECRET="$("${COMPOSE[@]}" exec -T rfms printenv ONBOARD_HMAC_SECRET 2>/dev/null | tr -d '\r' || true)"
FRAPPE_SECRET="$(echo "$CONF_JSON" | sed -n 's/.*"frappe_secret": "\([^"]*\)".*/\1/p')"
if [[ -n "$RFMS_SECRET" && -n "$FRAPPE_SECRET" && "$RFMS_SECRET" == "$FRAPPE_SECRET" ]]; then
  ok "RFMS ONBOARD_HMAC_SECRET matches Frappe site_config"
else
  bad "HMAC secrets differ or missing"
fi

section "L3+L4 Mint + signed ingest (bench execute)"
SMOKE_OUT="$("${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase80_smoke" 2>&1 || true)"
echo "$SMOKE_OUT" | sed 's/^/  /' | tail -n 20
if echo "$SMOKE_OUT" | grep -q "'ok': True\|\"ok\": true\|ok.: True"; then
  ok "phase80 mint+ingest smoke succeeded"
  TOKEN_URL="$(echo "$SMOKE_OUT" | sed -n "s/.*'url': '\([^']*\)'.*/\1/p" | head -n1)"
  if [[ -z "$TOKEN_URL" ]]; then
    TOKEN_URL="$(echo "$SMOKE_OUT" | sed -n 's/.*"url": "\([^"]*\)".*/\1/p' | head -n1)"
  fi
else
  bad "phase80 mint+ingest smoke failed"
  TOKEN_URL=""
fi

if [[ -n "$TOKEN_URL" ]]; then
  code="$(curl -sS -o /tmp/hec-session-body.txt -w '%{http_code}' --connect-timeout 8 --max-time 30 -L "$TOKEN_URL" || echo 000)"
  if [[ "$code" =~ ^(200|302|303)$ ]]; then
    ok "GET hec-session handoff → HTTP $code"
  else
    bad "GET hec-session handoff → HTTP $code"
  fi
else
  bad "no hec-session URL from mint smoke"
fi

section "L5 API method exposure + Reach UI"
for method in create_onboarding_session ingest_onboarding_result; do
  code="$(curl -sS -o /tmp/method-$method.txt -w '%{http_code}' --connect-timeout 8 --max-time 20 \
    -X POST "$PUBLIC_ORIGIN/api/method/health_ecosystem_core.health_ecosystem_core.api.$method" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data 'franchisee_id=SMOKE-MISSING' || echo 000)"
  if [[ "$code" =~ ^(200|400|401|403|417)$ ]]; then
    ok "api.$method reachable → HTTP $code"
  else
    bad "api.$method → HTTP $code"
  fi
done

REACH_CODE="$(http_code "$REACH_ORIGIN/sales/onboard")"
case "$REACH_CODE" in
  200|301|302|304) ok "Reach sales onboard page → HTTP $REACH_CODE" ;;
  *) bad "Reach sales onboard page → HTTP $REACH_CODE" ;;
esac

section "Summary"
echo "  passed=$PASS failed=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
echo "FFMS_REACH_SMOKE_OK"
