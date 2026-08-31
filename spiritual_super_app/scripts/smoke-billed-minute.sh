#!/usr/bin/env bash
#
# End-to-end smoke test of the revenue path, with REAL WebRTC media.
#
# Proves, against a running deployment, that a two-party consultation actually charges money and
# credits the astrologer:
#
#   OTP login -> astrologer online -> queue -> match -> two real media participants join ->
#   session activates -> per-minute billing -> wallet debit + astrologer earning -> hangup ends it
#
# Why this exists: every earlier billing check was a simulation. Matching needs a live WebSocket and
# a billed minute needs two participants genuinely present in a LiveKit room, so nothing short of
# real media participants exercises the path a paying customer takes. Two money bugs were invisible
# until this ran -- a call that stayed INITIATED and billed nothing for its whole duration, and a
# LiveKit URL that meant no call could connect at all.
#
# Usage (on the deployment host, from the repo root):
#   bash spiritual_super_app/scripts/smoke-billed-minute.sh
#
# Requirements:
#   - The stack is up (docker compose with the shared-host overlay).
#   - OTP_TEST_NUMBERS in .env includes the two numbers below, so it can log in without an SMS
#     vendor. STAGING ONLY.
#   - /root/.ssa_webhook_secret and /root/.ssa_gate_token exist (deploy secrets).
#
# DESTRUCTIVE: wipes call sessions, earnings and the two test users' wallets. Never run against a
# deployment holding real customer data.
set -uo pipefail

BASE_URL="${BASE_URL:-https://astro.e-remedium.in}"
HOLD_SECONDS="${HOLD_SECONDS:-150}"   # >= 130 to observe two billed minutes at a 60s tick
SEEKER_PHONE="${SEEKER_PHONE:-+919000000001}"
ASTRO_PHONE="${ASTRO_PHONE:-+919000000002}"
FIXED_CODE="${FIXED_CODE:-123456}"
TOPUP="${TOPUP:-500.00}"

cd "$(dirname "$0")/.."

PGU=$(grep '^POSTGRES_USER=' .env | cut -d= -f2)
PGD=$(grep '^POSTGRES_DB=' .env | cut -d= -f2)
WEBHOOK_SECRET=$(cat /root/.ssa_webhook_secret)
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

# The 60s resend cooldown makes a second login for the same number return no challenge, so clear
# OTP state first.
login() {
  flush_otp
  curl -s --max-time 10 -H "X-SSA-Gate: $GATE" -H 'content-type: application/json' \
    -d "{\"phone\":\"$1\"}" "$BASE_URL/api/v1/auth/otp/request" >/dev/null
  curl -s --max-time 10 -H "X-SSA-Gate: $GATE" -H 'content-type: application/json' \
    -d "{\"phone\":\"$1\",\"code\":\"$FIXED_CODE\",\"name\":\"$2\"}" \
    "$BASE_URL/api/v1/auth/otp/verify" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p'
}

banner "reset"
q "DELETE FROM astrologer_earnings;" >/dev/null
q "DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id IN (SELECT id FROM users WHERE phone IN ('$SEEKER_PHONE','$ASTRO_PHONE')));" >/dev/null
q "DELETE FROM call_sessions;" >/dev/null
q "DELETE FROM payment_orders;" >/dev/null
q "UPDATE wallets SET balance=0 WHERE user_id IN (SELECT id FROM users WHERE phone IN ('$SEEKER_PHONE','$ASTRO_PHONE'));" >/dev/null
echo "  cleared sessions, earnings and test wallets"

banner "identities"
SEEKER_JWT=$(login "$SEEKER_PHONE" "Smoke Seeker")
ASTRO_JWT=$(login "$ASTRO_PHONE" "Smoke Jyotishi")
[ -n "$SEEKER_JWT" ] && pass "seeker logged in" || fail "seeker login"
[ -n "$ASTRO_JWT" ] && pass "astrologer logged in" || fail "astrologer login"
[ -z "$SEEKER_JWT" ] || [ -z "$ASTRO_JWT" ] && { echo "aborting"; exit 1; }

ASTRO_ID=$(q "SELECT a.id FROM astrologers a JOIN users u ON u.id=a.user_id WHERE u.phone='$ASTRO_PHONE';")
if [ -z "$ASTRO_ID" ]; then
  curl -s --max-time 10 -X POST -H "X-SSA-Gate: $GATE" -H "authorization: Bearer $ASTRO_JWT" \
    -H 'content-type: application/json' \
    -d '{"displayName":"Smoke Jyotishi","languages":["Hindi","English"]}' \
    "$BASE_URL/api/v1/astrologers/apply" >/dev/null
  ASTRO_ID=$(q "SELECT a.id FROM astrologers a JOIN users u ON u.id=a.user_id WHERE u.phone='$ASTRO_PHONE';")
fi
q "UPDATE astrologers SET status='OFFLINE' WHERE id='$ASTRO_ID';" >/dev/null

banner "fund the seeker (only a signed webhook may credit a wallet)"
SEEKER_ID=$(q "SELECT id FROM users WHERE phone='$SEEKER_PHONE';")
ORDER="order_smoke_$(date +%s)"
PAYMENT="pay_smoke_$(date +%s)"
PAISE=$(printf '%.0f' "$(echo "$TOPUP * 100" | bc)")
q "INSERT INTO payment_orders (user_id, provider, provider_order_id, amount, currency, status)
   VALUES ('$SEEKER_ID','RAZORPAY','$ORDER',$TOPUP,'INR','CREATED');" >/dev/null
BODY="/tmp/smoke-webhook.json"
printf '%s' "{\"event\":\"payment.captured\",\"payload\":{\"payment\":{\"entity\":{\"id\":\"$PAYMENT\",\"order_id\":\"$ORDER\",\"amount\":$PAISE}}}}" > "$BODY"
SIG=$(openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex < "$BODY" | awk '{print $NF}')
curl -s --max-time 10 -X POST -H 'content-type: application/json' -H "x-razorpay-signature: $SIG" \
  --data-binary @"$BODY" "$BASE_URL/api/v1/payments/webhook/razorpay" >/dev/null
START_BALANCE=$(q "SELECT balance FROM wallets WHERE user_id='$SEEKER_ID';")
[ "$START_BALANCE" = "$TOPUP" ] && pass "wallet credited to $START_BALANCE" || fail "expected $TOPUP, got $START_BALANCE"

banner "astrologer online"
curl -s --max-time 10 -X PATCH -H "X-SSA-Gate: $GATE" -H "authorization: Bearer $ASTRO_JWT" \
  -H 'content-type: application/json' -d '{"online":true}' \
  "$BASE_URL/api/v1/astrologers/me/availability" >/dev/null
[ "$(q "SELECT status FROM astrologers WHERE id='$ASTRO_ID';")" = "IDLE" ] \
  && pass "listed as available" || fail "astrologer not IDLE"

banner "match a call over two live sockets"
# Sent over WebSocket because the matching worker refuses to hand a waiting user to an astrologer
# unless that user has a live socket.
cat > /tmp/smoke-stage-a.mjs <<'JSEOF'
const { WebSocket } = await import('ws');
const open = (token) =>
  new WebSocket(`ws://127.0.0.1:8000/api/v1/ws?token=${encodeURIComponent(token)}`);
const seeker = open(process.env.SEEKER_JWT);
const astro = open(process.env.ASTRO_JWT);
const events = [];
for (const socket of [seeker, astro]) {
  socket.on('message', (raw) => events.push(JSON.parse(raw.toString())));
}
const ready = (s) => new Promise((r) => (s.readyState === 1 ? r() : s.once('open', r)));
await Promise.all([ready(seeker), ready(astro)]);
await new Promise((r) => setTimeout(r, 800));
seeker.send(JSON.stringify({ type: 'USER_JOIN_QUEUE', astrologerId: process.env.ASTRO_ID }));

const deadline = Date.now() + 15000;
let call;
while (Date.now() < deadline && !call) {
  call = events.find((e) => e.event === 'CALL_READY');
  if (!call) await new Promise((r) => setTimeout(r, 300));
}
if (call) {
  console.log('SESSION_ID=' + call.payload.callSessionId);
  console.log('ROOM=' + call.payload.channelId);
  console.log('SERVER_URL=' + call.payload.rtc.serverUrl);
  console.log('USER_TOKEN=' + call.payload.rtc.accessToken);
} else {
  console.log('SESSION_ID=');
  console.log('ERRORS=' + JSON.stringify(events.filter((e) => e.event === 'ERROR')));
}
seeker.close();
astro.close();
process.exit(0);
JSEOF
docker cp /tmp/smoke-stage-a.mjs ssa-core-gateway:/app/smoke-stage-a.mjs >/dev/null
STAGE_A=$(docker exec -w /app \
  -e SEEKER_JWT="$SEEKER_JWT" -e ASTRO_JWT="$ASTRO_JWT" -e ASTRO_ID="$ASTRO_ID" \
  ssa-core-gateway node /app/smoke-stage-a.mjs 2>&1 \
  | grep -E '^(SESSION_ID|ROOM|SERVER_URL|USER_TOKEN|ERRORS)=')
SESSION_ID=$(echo "$STAGE_A" | sed -n 's/^SESSION_ID=//p')
ROOM=$(echo "$STAGE_A" | sed -n 's/^ROOM=//p')
SERVER_URL=$(echo "$STAGE_A" | sed -n 's/^SERVER_URL=//p')
USER_TOKEN=$(echo "$STAGE_A" | sed -n 's/^USER_TOKEN=//p')
docker exec ssa-core-gateway rm -f /app/smoke-stage-a.mjs >/dev/null 2>&1
if [ -z "$SESSION_ID" ]; then
  fail "no match: $(echo "$STAGE_A" | sed -n 's/^ERRORS=//p')"
  exit 1
fi
pass "matched, session $SESSION_ID in room $ROOM"

ASTRO_RTC=$(curl -s --max-time 10 -X POST -H "X-SSA-Gate: $GATE" \
  -H "authorization: Bearer $ASTRO_JWT" -H 'content-type: application/json' \
  -d "{\"callSessionId\":\"$SESSION_ID\"}" "$BASE_URL/api/v1/rtc/token" \
  | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
[ -n "$ASTRO_RTC" ] && pass "astrologer RTC token minted" || { fail "no astrologer RTC token"; exit 1; }

banner "two real media participants join for ${HOLD_SECONDS}s"
PROBE_DIR=$(mktemp -d)
cat > "$PROBE_DIR/package.json" <<'PKGEOF'
{ "name": "ssa-media-probe", "private": true, "type": "module" }
PKGEOF
cat > "$PROBE_DIR/probe.mjs" <<'JSEOF'
import {
  Room, RoomEvent, AudioSource, LocalAudioTrack, TrackPublishOptions,
  TrackSource, AudioFrame, dispose,
} from '@livekit/rtc-node';

const url = process.env.SERVER_URL;

async function participant(label, token) {
  const room = new Room();
  room.on(RoomEvent.Disconnected, (reason) => console.log(`[${label}] disconnected: ${reason}`));
  room.on(RoomEvent.ParticipantConnected, (p) => console.log(`[${label}] peer joined: ${p.identity}`));
  await room.connect(url, token, { autoSubscribe: true, dynacast: false });
  console.log(`[${label}] connected as ${room.localParticipant.identity}`);

  let timer;
  try {
    const source = new AudioSource(48000, 1);
    const track = LocalAudioTrack.createAudioTrack(`${label}-mic`, source);
    await room.localParticipant.publishTrack(
      track,
      new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
    );
    // A quiet 440 Hz tone in 10 ms frames: silence would be indistinguishable from a dead track.
    const samples = 480;
    const data = new Int16Array(samples);
    let phase = 0;
    timer = setInterval(() => {
      for (let i = 0; i < samples; i += 1) {
        data[i] = Math.round(2000 * Math.sin(phase));
        phase += (2 * Math.PI * 440) / 48000;
      }
      void source.captureFrame(new AudioFrame(data, 48000, 1, samples));
    }, 10);
    console.log(`[${label}] publishing audio`);
  } catch (error) {
    console.log(`[${label}] publish failed, presence still counts: ${error.message}`);
  }

  return () => {
    if (timer) clearInterval(timer);
    return room.disconnect();
  };
}

const stopSeeker = await participant('seeker', process.env.USER_TOKEN);
const stopAstro = await participant('astrologer', process.env.ASTRO_TOKEN);
await new Promise((r) => setTimeout(r, Number(process.env.HOLD_MS)));
console.log('[both] hanging up');
await stopSeeker();
await stopAstro();
await dispose();
process.exit(0);
JSEOF

# Host network so ICE reaches the published UDP range and the TCP fallback directly.
# Deliberately not --rm: the probe's log is the only view of a media failure, and it must survive
# until the log is read below.
docker rm -f ssa-media-probe >/dev/null 2>&1
docker run -d --name ssa-media-probe --network host \
  -v "$PROBE_DIR":/probe -w /probe \
  -e SERVER_URL="$SERVER_URL" -e USER_TOKEN="$USER_TOKEN" -e ASTRO_TOKEN="$ASTRO_RTC" \
  -e HOLD_MS="$((HOLD_SECONDS * 1000))" \
  node:20 bash -c "npm install --silent @livekit/rtc-node >/dev/null 2>&1 && node probe.mjs" >/dev/null

printf '  %-7s %-10s %-8s %-9s %-9s %s\n' TIME STATUS MINUTES CHARGED BALANCE EARNINGS
SAMPLES=$(( (HOLD_SECONDS + 40) / 10 ))
for i in $(seq 1 "$SAMPLES"); do
  sleep 10
  ROW=$(q "SELECT status||'|'||total_minutes||'|'||total_deducted FROM call_sessions WHERE id='$SESSION_ID';")
  printf '  %-7s %-10s %-8s %-9s %-9s %s\n' "$((i * 10))s" \
    "$(echo "$ROW" | cut -d'|' -f1)" "$(echo "$ROW" | cut -d'|' -f2)" "$(echo "$ROW" | cut -d'|' -f3)" \
    "$(q "SELECT balance FROM wallets WHERE user_id='$SEEKER_ID';")" \
    "$(q "SELECT count(*) FROM astrologer_earnings WHERE call_session_id='$SESSION_ID';")"
done

echo
echo "  probe log:"
docker logs ssa-media-probe 2>&1 | tail -12 | sed 's/^/    /' || true
docker rm -f ssa-media-probe >/dev/null 2>&1
rm -rf "$PROBE_DIR" /tmp/smoke-webhook.json /tmp/smoke-stage-a.mjs

banner "assertions"
MINUTES=$(q "SELECT total_minutes FROM call_sessions WHERE id='$SESSION_ID';")
CHARGED=$(q "SELECT total_deducted FROM call_sessions WHERE id='$SESSION_ID';")
STATUS=$(q "SELECT status FROM call_sessions WHERE id='$SESSION_ID';")
DEBITS=$(q "SELECT count(*) FROM wallet_transactions WHERE reference_id='$SESSION_ID' AND type='DEBIT';")
EARNINGS=$(q "SELECT count(*) FROM astrologer_earnings WHERE call_session_id='$SESSION_ID';")
END_BALANCE=$(q "SELECT balance FROM wallets WHERE user_id='$SEEKER_ID';")

[ "$MINUTES" -ge 1 ] && pass "billed $MINUTES minute(s), $CHARGED total" \
  || fail "nothing billed during a live two-party call"
[ "$DEBITS" = "$MINUTES" ] && pass "one wallet debit per billed minute" \
  || fail "$MINUTES minutes but $DEBITS debits"
[ "$EARNINGS" = "$MINUTES" ] && pass "one astrologer earning per billed minute" \
  || fail "$MINUTES minutes but $EARNINGS earning rows"
[ "$(q "SELECT CASE WHEN count(*)=count(DISTINCT minute_number) THEN 'clean' ELSE 'dupes' END FROM astrologer_earnings WHERE call_session_id='$SESSION_ID';")" = "clean" ] \
  && pass "no minute billed twice" || fail "duplicate minutes charged"
[ "$(q "SELECT CASE WHEN bool_and(net_amount+platform_fee=gross_amount) THEN 'ok' ELSE 'bad' END FROM astrologer_earnings WHERE call_session_id='$SESSION_ID';")" = "ok" ] \
  && pass "every split sums to the gross" || fail "a split does not sum to its gross"
[ "$(q "SELECT CASE WHEN (SELECT total_deducted FROM call_sessions WHERE id='$SESSION_ID') = (SELECT coalesce(sum(net_amount+platform_fee),0) FROM astrologer_earnings WHERE call_session_id='$SESSION_ID') THEN 'ok' ELSE 'bad' END;")" = "ok" ] \
  && pass "what the user paid equals astrologer + platform" || fail "user charge does not match the ledger"
[ "$(echo "$START_BALANCE - $CHARGED" | bc)" = "$END_BALANCE" ] \
  && pass "balance moved exactly by the amount charged ($START_BALANCE -> $END_BALANCE)" \
  || fail "balance $START_BALANCE -> $END_BALANCE does not match $CHARGED charged"
case "$STATUS" in
  COMPLETED|DROPPED_INSUFFICIENT_FUNDS) pass "call ended cleanly ($STATUS)" ;;
  *) fail "session left in $STATUS after both parties left" ;;
esac

echo
q "SELECT '  minute '||minute_number||': gross '||gross_amount||' = astrologer '||net_amount||' + platform '||platform_fee FROM astrologer_earnings WHERE call_session_id='$SESSION_ID' ORDER BY minute_number;"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "SMOKE PASSED: a real two-party consultation charged the user and paid the astrologer."
  exit 0
fi
echo "SMOKE FAILED: $FAILURES assertion(s) failed."
exit 1
