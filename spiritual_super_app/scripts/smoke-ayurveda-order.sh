#!/usr/bin/env bash
#
# Smoke test: Ayurveda commerce path against a running deployment.
#
#   OTP login -> list catalog -> place wallet-paid order -> assert debit + AYURVEDA_ORDER ledger
#
# Usage (on the deployment host, from spiritual_super_app/):
#   bash scripts/smoke-ayurveda-order.sh
#
# Requirements:
#   - Stack up with shared-host overlay
#   - OTP_TEST_NUMBERS includes +919000000001 (fixed code 123456)
#   - /root/.ssa_gate_token exists
#   - Seed has run so ayurveda_products is non-empty (or this script seeds one row)
#
# Safe for staging: only touches the demo seeker wallet and creates one order.
set -uo pipefail

BASE_URL="${BASE_URL:-https://astro.e-remedium.in}"
SEEKER_PHONE="${SEEKER_PHONE:-+919000000001}"
FIXED_CODE="${FIXED_CODE:-123456}"
TOPUP="${TOPUP:-1500.00}"

cd "$(dirname "$0")/.."

PGU=$(grep '^POSTGRES_USER=' .env | cut -d= -f2)
PGD=$(grep '^POSTGRES_DB=' .env | cut -d= -f2)
GATE=$(cat /root/.ssa_gate_token)

q() { docker exec ssa-postgres-db psql -U "$PGU" -d "$PGD" -tAc "$1"; }
banner() { echo; echo "=== $* ==="; }
fail() { echo "  FAIL: $*"; FAILURES=$((FAILURES + 1)); }
pass() { echo "  ok: $*"; }
FAILURES=0

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

banner "ensure catalog"
PRODUCT_COUNT=$(q "SELECT COUNT(*) FROM ayurveda_products WHERE active;")
if [ "${PRODUCT_COUNT:-0}" -lt 1 ]; then
  echo "  seeding a smoke kit…"
  q "INSERT INTO ayurveda_products (sku, name, description, price, suited_doshas, form_factor)
     VALUES ('smoke-vata-kit', 'Smoke Vata Kit', 'Staging smoke kit', 199.00, ARRAY['VATA']::\"Dosha\"[], 'kit')
     ON CONFLICT (sku) DO UPDATE SET active=true, price=199.00;"
fi
SKU=$(q "SELECT sku FROM ayurveda_products WHERE active ORDER BY price ASC LIMIT 1;" | tr -d '[:space:]')
PRODUCT_ID=$(q "SELECT id FROM ayurveda_products WHERE sku='$SKU';" | tr -d '[:space:]')
PRICE=$(q "SELECT TRIM(TRAILING '0' FROM TRIM(TRAILING '.' FROM price::text)) FROM ayurveda_products WHERE id='$PRODUCT_ID';" | tr -d '[:space:]')
# Prefer fixed two-decimal form from catalog
PRICE=$(q "SELECT to_char(price, 'FM999999990.00') FROM ayurveda_products WHERE id='$PRODUCT_ID';" | tr -d '[:space:]')
[ -n "$PRODUCT_ID" ] && pass "product $SKU @ ₹$PRICE" || fail "no product"

banner "login"
SEEKER_JWT=$(login "$SEEKER_PHONE" "Smoke Seeker")
[ -n "$SEEKER_JWT" ] && pass "seeker logged in" || { fail "seeker login"; echo "aborting"; exit 1; }

banner "fund wallet if needed"
BALANCE=$(curl -s --max-time 10 -H "X-SSA-Gate: $GATE" -H "authorization: Bearer $SEEKER_JWT" \
  "$BASE_URL/api/v1/wallet" | sed -n 's/.*"balance":"\([^"]*\)".*/\1/p')
echo "  balance before: ₹${BALANCE:-unknown}"
# Credit via SQL for smoke only — avoids needing a Razorpay webhook secret for this path.
USER_ID=$(q "SELECT id FROM users WHERE phone='$SEEKER_PHONE';" | tr -d '[:space:]')
WALLET_ID=$(q "SELECT id FROM wallets WHERE user_id='$USER_ID';" | tr -d '[:space:]')
q "UPDATE wallets SET balance = GREATEST(balance, $TOPUP::numeric) WHERE id='$WALLET_ID';" >/dev/null
BALANCE=$(q "SELECT to_char(balance, 'FM999999990.00') FROM wallets WHERE id='$WALLET_ID';" | tr -d '[:space:]')
pass "wallet funded to ≥ ₹$TOPUP (now ₹$BALANCE)"

banner "catalog"
CATALOG=$(curl -s --max-time 10 -H "X-SSA-Gate: $GATE" -H "authorization: Bearer $SEEKER_JWT" \
  "$BASE_URL/api/v1/ayurveda/shop/products")
echo "$CATALOG" | grep -q "$SKU" && pass "catalog lists $SKU" || fail "catalog missing $SKU"

banner "place order"
KEY=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen)
ORDER_JSON=$(curl -s --max-time 15 -H "X-SSA-Gate: $GATE" -H "authorization: Bearer $SEEKER_JWT" \
  -H 'content-type: application/json' \
  -d "{\"productId\":\"$PRODUCT_ID\",\"shippingName\":\"Smoke Seeker\",\"shippingPhone\":\"$SEEKER_PHONE\",\"shippingAddress\":\"12 Assi Ghat Road, Varanasi, UP 221005\",\"idempotencyKey\":\"$KEY\"}" \
  "$BASE_URL/api/v1/ayurveda/shop/orders")
ORDER_ID=$(echo "$ORDER_JSON" | sed -n 's/.*"order":{[^}]*"id":"\([^"]*\)".*/\1/p')
if [ -z "$ORDER_ID" ]; then
  ORDER_ID=$(echo "$ORDER_JSON" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
fi
DEBITED=$(echo "$ORDER_JSON" | sed -n 's/.*"amountDebited":"\([^"]*\)".*/\1/p')
[ -n "$ORDER_ID" ] && pass "order $ORDER_ID" || fail "order not created: $ORDER_JSON"
[ "$DEBITED" = "$PRICE" ] && pass "debited catalog price ₹$DEBITED" || fail "debited '$DEBITED' expected '$PRICE'"

banner "ledger"
REF=$(q "SELECT reference_type FROM wallet_transactions WHERE reference_id='$ORDER_ID' ORDER BY created_at DESC LIMIT 1;" | tr -d '[:space:]')
[ "$REF" = "AYURVEDA_ORDER" ] && pass "ledger reference AYURVEDA_ORDER" || fail "ledger ref='$REF'"

banner "idempotent replay"
REPLAY=$(curl -s --max-time 15 -H "X-SSA-Gate: $GATE" -H "authorization: Bearer $SEEKER_JWT" \
  -H 'content-type: application/json' \
  -d "{\"productId\":\"$PRODUCT_ID\",\"shippingName\":\"Smoke Seeker\",\"shippingPhone\":\"$SEEKER_PHONE\",\"shippingAddress\":\"12 Assi Ghat Road, Varanasi, UP 221005\",\"idempotencyKey\":\"$KEY\"}" \
  "$BASE_URL/api/v1/ayurveda/shop/orders")
REPLAY_ID=$(echo "$REPLAY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
[ "$REPLAY_ID" = "$ORDER_ID" ] && pass "replay returned same order" || fail "replay id='$REPLAY_ID'"

banner "page"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "X-SSA-Gate: $GATE" "$BASE_URL/ayurveda")
[ "$CODE" = "200" ] && pass "/ayurveda returns 200" || fail "/ayurveda status $CODE"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "SMOKE PASS"
  exit 0
fi
echo "SMOKE FAIL ($FAILURES)"
exit 1
