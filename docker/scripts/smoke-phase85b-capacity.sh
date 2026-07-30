#!/bin/bash
# Smoke Phase 85b capacity endpoints (officer token required via env).
set -euo pipefail
API="${RFMS_API:-http://127.0.0.1:8090/api/v1}"
TOKEN="${RFMS_OFFICER_TOKEN:-}"

echo "=== Phase 85b capacity smoke ==="
if [[ -z "$TOKEN" ]]; then
  # Login with seed admin if token not provided
  LOGIN=$(curl -sS -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "{\"login_id\":\"${RFMS_OFFICER_ID:-RFMS-0001}\",\"password\":\"${RFMS_OFFICER_PASSWORD:-AdminChangeMe@123}\"}")
  TOKEN=$(python3 - <<'PY' "$LOGIN"
import json,sys
raw=sys.argv[1]
try:
  data=json.loads(raw)
except Exception:
  print(''); raise SystemExit(0)
print(((data.get('data') or {}).get('token')) or '')
PY
)
fi
[[ -n "$TOKEN" ]] || { echo "PHASE85B_SMOKE_FAIL no officer token"; exit 1; }

curl -sS -H "Authorization: Bearer $TOKEN" "$API/territories/capacities" | grep -q '"rows"' && echo CAPACITIES_JSON_OK
curl -sS -H "Authorization: Bearer $TOKEN" "$API/territories/capacity-alerts?threshold=1" | grep -q '"alerts"' && echo CAPACITY_ALERTS_OK
CSV=$(curl -sS -H "Authorization: Bearer $TOKEN" "$API/territories/capacities?format=csv" | head -c 40)
echo "$CSV" | grep -q 'PIN' && echo CAPACITIES_CSV_OK

echo "PHASE85B_SMOKE_OK"
