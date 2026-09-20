#!/usr/bin/env bash
#
# Seed (idempotent) + E2E fulfilment smoke on staging:
#   seeker books cheapest puja + places an Ayurveda order
#   admin advances puja through the pipeline and packs/dispatches the order
#
# Usage (on host, from spiritual_super_app/):
#   bash scripts/smoke-ops-fulfilment.sh
#
# Needs: OTP_TEST_NUMBERS for SEEKER + ADMIN phones, X-SSA-Gate token, stack up.
set -uo pipefail

BASE_URL="${BASE_URL:-https://astro.e-remedium.in}"
SEEKER_PHONE="${SEEKER_PHONE:-+919000000001}"
ADMIN_PHONE="${ADMIN_PHONE:-}"
FIXED_CODE="${FIXED_CODE:-123456}"
TOPUP="${TOPUP:-15000.00}"

cd "$(dirname "$0")/.."

PGU=$(grep '^POSTGRES_USER=' .env | cut -d= -f2)
PGD=$(grep '^POSTGRES_DB=' .env | cut -d= -f2)
GATE=$(cat /root/.ssa_gate_token)

if [ -z "$ADMIN_PHONE" ]; then
  # First number listed in ADMIN_PHONES (comma-separated E.164).
  ADMIN_PHONE=$(grep '^ADMIN_PHONES=' .env | cut -d= -f2- | cut -d, -f1 | tr -d '[:space:]')
fi

q() { docker exec ssa-postgres-db psql -U "$PGU" -d "$PGD" -tAc "$1"; }
banner() { echo; echo "=== $* ==="; }
fail() { echo "  FAIL: $*"; FAILURES=$((FAILURES + 1)); }
pass() { echo "  ok: $*"; }
FAILURES=0

json_field() {
  # Usage: json_field '{"a":"b"}' a  — naive extractor for flat/simple nested strings
  local json="$1" key="$2"
  echo "$json" | sed -n "s/.*\"$key\":\"\\([^\"]*\\)\".*/\\1/p" | head -1
}

flush_otp() {
  docker exec ssa-redis-state sh -c \
    'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning KEYS "ssa:otp:*" | xargs -r redis-cli -a "$REDIS_PASSWORD" --no-auth-warning DEL' >/dev/null 2>&1
}

login() {
  flush_otp
  curl -s --max-time 10 -H "X-SSA-Gate: $GATE" -H 'content-type: application/json' \
    -d "{\"phone\":\"$1\"}" "$BASE_URL/api/v1/auth/otp/request" >/dev/null
  curl -s --max-time 10 -H "X-SSA-Gate: $GATE" -H 'content-type: application/json' \
    -d "{\"phone\":\"$1\",\"code\":\"$FIXED_CODE\",\"name\":\"$2\"}" \
    "$BASE_URL/api/v1/auth/otp/verify" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p'
}

banner "seed catalog (idempotent)"
docker compose -f docker-compose.yml -f docker-compose.shared-host.yml \
  exec -T core-gateway npx tsx prisma/seed.ts >/tmp/ssa-seed-out.json 2>/tmp/ssa-seed-err.txt \
  && pass "seed ran" \
  || { fail "seed failed"; cat /tmp/ssa-seed-err.txt; }

TEMPLES=$(q "SELECT count(*) FROM temples WHERE active;")
OFFERINGS=$(q "SELECT count(*) FROM puja_offerings WHERE active;")
PRODUCTS=$(q "SELECT count(*) FROM ayurveda_products WHERE active;")
echo "  temples=$TEMPLES offerings=$OFFERINGS products=$PRODUCTS"
[ "${TEMPLES:-0}" -ge 1 ] && [ "${OFFERINGS:-0}" -ge 1 ] && pass "puja catalog present" || fail "puja catalog empty"
[ "${PRODUCTS:-0}" -ge 1 ] && pass "ayurveda catalog present" || fail "ayurveda catalog empty"

if [ -z "$ADMIN_PHONE" ]; then
  fail "ADMIN_PHONES empty — cannot exercise admin fulfilment"
  echo "SMOKE FAIL ($FAILURES)"
  exit 1
fi
echo "  admin phone: ${ADMIN_PHONE:0:6}…${ADMIN_PHONE: -4}"

banner "login seeker + admin"
SEEKER_JWT=$(login "$SEEKER_PHONE" "Smoke Seeker")
[ -n "$SEEKER_JWT" ] && pass "seeker logged in" || { fail "seeker login"; echo "aborting"; exit 1; }
ADMIN_JWT=$(login "$ADMIN_PHONE" "Smoke Admin")
[ -n "$ADMIN_JWT" ] && pass "admin logged in" || { fail "admin login"; echo "aborting"; exit 1; }

# Prove ADMIN by hitting a role-gated endpoint (no /auth/me route in this API).
PROBE=$(curl -s -o /tmp/ssa-admin-probe.json -w '%{http_code}' --max-time 10 \
  -H "X-SSA-Gate: $GATE" -H "authorization: Bearer $ADMIN_JWT" \
  "$BASE_URL/api/v1/pujas/admin/fulfilment")
[ "$PROBE" = "200" ] && pass "admin fulfilment authorized" || fail "admin probe HTTP $PROBE ($(cat /tmp/ssa-admin-probe.json))"

banner "fund seeker wallet"
USER_ID=$(q "SELECT id FROM users WHERE phone='$SEEKER_PHONE';" | tr -d '[:space:]')
WALLET_ID=$(q "SELECT id FROM wallets WHERE user_id='$USER_ID';" | tr -d '[:space:]')
q "UPDATE wallets SET balance = GREATEST(balance, $TOPUP::numeric) WHERE id='$WALLET_ID';" >/dev/null
BALANCE=$(q "SELECT to_char(balance, 'FM999999990.00') FROM wallets WHERE id='$WALLET_ID';" | tr -d '[:space:]')
pass "wallet ≥ ₹$TOPUP (now ₹$BALANCE)"

# --- E-Puja -----------------------------------------------------------------------------------

banner "book cheapest puja"
OFFERING_ID=$(q "SELECT id FROM puja_offerings WHERE active ORDER BY price ASC LIMIT 1;" | tr -d '[:space:]')
OFFERING_PRICE=$(q "SELECT to_char(price, 'FM999999990.00') FROM puja_offerings WHERE id='$OFFERING_ID';" | tr -d '[:space:]')
KEY_PUJA=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen)
BOOK_JSON=$(curl -s --max-time 20 -H "X-SSA-Gate: $GATE" -H "authorization: Bearer $SEEKER_JWT" \
  -H 'content-type: application/json' \
  -d "{\"pujaOfferingId\":\"$OFFERING_ID\",\"sankalpName\":\"Smoke Devotee\",\"sankalpGotra\":\"Kashyap\",\"sankalpWish\":\"Staging fulfilment smoke\",\"idempotencyKey\":\"$KEY_PUJA\"}" \
  "$BASE_URL/api/v1/pujas/bookings")
BOOKING_ID=$(echo "$BOOK_JSON" | sed -n 's/.*"booking":{[^}]*"id":"\([^"]*\)".*/\1/p')
if [ -z "$BOOKING_ID" ]; then
  BOOKING_ID=$(json_field "$BOOK_JSON" id)
fi
[ -n "$BOOKING_ID" ] && pass "booking $BOOKING_ID @ ₹$OFFERING_PRICE" || fail "book failed: $BOOK_JSON"

banner "admin advance puja"
SCHED=$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+2H +%Y-%m-%dT%H:%M:%SZ)
curl -s --max-time 15 -H "X-SSA-Gate: $GATE" -H "authorization: Bearer $ADMIN_JWT" \
  -H 'content-type: application/json' \
  -d "{\"scheduledFor\":\"$SCHED\"}" \
  "$BASE_URL/api/v1/pujas/admin/bookings/$BOOKING_ID/schedule" >/tmp/ssa-sched.json
echo "$(cat /tmp/ssa-sched.json)" | grep -q "$BOOKING_ID" && pass "scheduled" || fail "schedule: $(cat /tmp/ssa-sched.json)"

advance_puja() {
  local status="$1"
  shift
  local body="{\"status\":\"$status\""
  while [ $# -gt 0 ]; do
    body="$body,\"$1\":\"$2\""
    shift 2
  done
  body="$body}"
  curl -s --max-time 15 -H "X-SSA-Gate: $GATE" -H "authorization: Bearer $ADMIN_JWT" \
    -H 'content-type: application/json' \
    -d "$body" \
    "$BASE_URL/api/v1/pujas/admin/bookings/$BOOKING_ID/advance"
}

R1=$(advance_puja IN_PROGRESS)
echo "$R1" | grep -q '"IN_PROGRESS"' && pass "→ IN_PROGRESS" || fail "IN_PROGRESS: $R1"
R2=$(advance_puja COMPLETED videoProofUrl "https://example.com/smoke/puja-proof.mp4")
echo "$R2" | grep -q '"COMPLETED"' && pass "→ COMPLETED" || fail "COMPLETED: $R2"
R3=$(advance_puja PRASAD_DISPATCHED prasadAwb "SMOKEAWB$(date +%s)" prasadCourier "SmokeCourier")
echo "$R3" | grep -q '"PRASAD_DISPATCHED"' && pass "→ PRASAD_DISPATCHED" || fail "PRASAD_DISPATCHED: $R3"

FINAL_PUJA=$(q "SELECT status FROM puja_bookings WHERE id='$BOOKING_ID';" | tr -d '[:space:]')
[ "$FINAL_PUJA" = "PRASAD_DISPATCHED" ] && pass "db status PRASAD_DISPATCHED" || fail "db status=$FINAL_PUJA"

# --- Ayurveda ---------------------------------------------------------------------------------

banner "place Ayurveda order"
PRODUCT_ID=$(q "SELECT id FROM ayurveda_products WHERE active ORDER BY price ASC LIMIT 1;" | tr -d '[:space:]')
PRODUCT_PRICE=$(q "SELECT to_char(price, 'FM999999990.00') FROM ayurveda_products WHERE id='$PRODUCT_ID';" | tr -d '[:space:]')
KEY_ORD=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen)
ORD_JSON=$(curl -s --max-time 20 -H "X-SSA-Gate: $GATE" -H "authorization: Bearer $SEEKER_JWT" \
  -H 'content-type: application/json' \
  -d "{\"productId\":\"$PRODUCT_ID\",\"shippingName\":\"Smoke Seeker\",\"shippingPhone\":\"$SEEKER_PHONE\",\"shippingAddress\":\"12 Assi Ghat Road, Varanasi, UP 221005\",\"idempotencyKey\":\"$KEY_ORD\"}" \
  "$BASE_URL/api/v1/ayurveda/shop/orders")
ORDER_ID=$(echo "$ORD_JSON" | sed -n 's/.*"order":{[^}]*"id":"\([^"]*\)".*/\1/p')
if [ -z "$ORDER_ID" ]; then
  ORDER_ID=$(json_field "$ORD_JSON" id)
fi
[ -n "$ORDER_ID" ] && pass "order $ORDER_ID @ ₹$PRODUCT_PRICE" || fail "order failed: $ORD_JSON"

banner "admin advance order"
O1=$(curl -s --max-time 15 -H "X-SSA-Gate: $GATE" -H "authorization: Bearer $ADMIN_JWT" \
  -H 'content-type: application/json' \
  -d '{"status":"PACKED"}' \
  "$BASE_URL/api/v1/ayurveda/shop/admin/orders/$ORDER_ID/advance")
echo "$O1" | grep -q '"PACKED"' && pass "→ PACKED" || fail "PACKED: $O1"
O2=$(curl -s --max-time 15 -H "X-SSA-Gate: $GATE" -H "authorization: Bearer $ADMIN_JWT" \
  -H 'content-type: application/json' \
  -d "{\"status\":\"DISPATCHED\",\"awb\":\"SMOKEORD$(date +%s)\",\"courier\":\"SmokeCourier\"}" \
  "$BASE_URL/api/v1/ayurveda/shop/admin/orders/$ORDER_ID/advance")
echo "$O2" | grep -q '"DISPATCHED"' && pass "→ DISPATCHED" || fail "DISPATCHED: $O2"

FINAL_ORD=$(q "SELECT status FROM ayurveda_orders WHERE id='$ORDER_ID';" | tr -d '[:space:]')
[ "$FINAL_ORD" = "DISPATCHED" ] && pass "db status DISPATCHED" || fail "db status=$FINAL_ORD"

banner "admin queues empty of these rows"
PF=$(curl -s --max-time 10 -H "X-SSA-Gate: $GATE" -H "authorization: Bearer $ADMIN_JWT" \
  "$BASE_URL/api/v1/pujas/admin/fulfilment")
echo "$PF" | grep -q "$BOOKING_ID" && fail "booking still in fulfilment queue" || pass "booking left fulfilment queue"
AF=$(curl -s --max-time 10 -H "X-SSA-Gate: $GATE" -H "authorization: Bearer $ADMIN_JWT" \
  "$BASE_URL/api/v1/ayurveda/shop/admin/fulfilment")
echo "$AF" | grep -q "$ORDER_ID" && fail "order still in fulfilment queue" || pass "order left fulfilment queue"

banner "support board"
SUP=$(curl -s --max-time 10 -H "X-SSA-Gate: $GATE" -H "authorization: Bearer $ADMIN_JWT" \
  "$BASE_URL/api/v1/calls/admin/support")
echo "$SUP" | grep -q '"summary"' && pass "support overview reachable" || fail "support: $SUP"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "SMOKE PASS"
  echo "  booking=$BOOKING_ID order=$ORDER_ID"
  exit 0
fi
echo "SMOKE FAIL ($FAILURES)"
exit 1
