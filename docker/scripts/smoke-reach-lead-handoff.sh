#!/bin/bash
# Reach → FFMS: mint session, confirm lead-only redirect (no FOFO auto-app).
set -uo pipefail
cd /opt/health-ecosystem/docker
SITE="${FRAPPE_SITE:-health.localhost}"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ffms.yml)
PASS=0; FAIL=0
ok(){ echo "  OK  $*"; PASS=$((PASS+1)); }
bad(){ echo "  FAIL $*"; FAIL=$((FAIL+1)); }

echo "=== Mint Reach handoff token (Phase 80) ==="
SMOKE_OUT="$("${COMPOSE[@]}" exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.init.run_phase80_smoke" 2>&1 || true)"
echo "$SMOKE_OUT" | sed 's/^/  /' | tail -n 25
TOKEN_URL="$(echo "$SMOKE_OUT" | sed -n "s/.*'url': '\([^']*\)'.*/\1/p" | head -n1)"
[[ -z "$TOKEN_URL" ]] && TOKEN_URL="$(echo "$SMOKE_OUT" | sed -n 's/.*"url": "\([^"]*\)".*/\1/p' | head -n1)"
FP="$(echo "$SMOKE_OUT" | sed -n "s/.*'franchisee_id': '\([^']*\)'.*/\1/p" | head -n1)"
[[ -z "$FP" ]] && FP="$(echo "$SMOKE_OUT" | sed -n 's/.*"franchisee_id": "\([^"]*\)".*/\1/p' | head -n1)"
if [[ -n "$TOKEN_URL" ]]; then ok "minted url (fp=${FP:-unknown})"; else bad "no mint url"; echo REACH_LEAD_HANDOFF_FAIL; exit 1; fi

if [[ "$TOKEN_URL" != *"/onboard/hec-session"* ]]; then
  TOKEN_Q="${TOKEN_URL#*\?}"
  TOKEN_URL="https://www.e-remedium.in/onboard/hec-session?${TOKEN_Q}"
  ok "normalized to public hec-session URL"
fi

echo
echo "=== hec-session redirect (no follow) ==="
HDR=$(curl -sS -D - -o /dev/null --max-redirs 0 "$TOKEN_URL" || true)
echo "$HDR" | head -n 15 | sed 's/^/  /'
LOC=$(echo "$HDR" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2; exit}')
CODE=$(echo "$HDR" | tr -d '\r' | awk 'NR==1{print $2; exit}')
[[ "$CODE" == "302" || "$CODE" == "303" ]] && ok "hec-session HTTP $CODE" || bad "hec-session HTTP $CODE (want 302)"
[[ -n "$LOC" ]] && ok "Location present" || bad "missing Location"
echo "  Location=$LOC"

echo "$LOC" | grep -q 'hec_lead=' && ok "redirect has hec_lead" || bad "missing hec_lead"
echo "$LOC" | grep -q 'hec_fp=' && ok "redirect has hec_fp" || bad "missing hec_fp"
echo "$LOC" | grep -qiE 'rfms_applicant_token|applicant_token' && bad "auto applicant token present" || ok "no applicant session auto-token"
echo "$LOC" | grep -qiE '[?&]model=FOFO|franchise_model=FOFO' && bad "FOFO forced in redirect" || ok "no FOFO forced in redirect"
echo "$LOC" | grep -qE '/onboard/\?' && ok "lands under /onboard/" || bad "not under /onboard/"

LEAD_ID=$(echo "$LOC" | sed -n 's/.*[?&]hec_lead=\([^&]*\).*/\1/p' | head -n1)
echo "  hec_lead=$LEAD_ID"

echo
echo "=== CRM lead via admin API ==="
curl -sS -X POST 'http://127.0.0.1:8090/api/v1/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"login_id":"RFMS-0001","password":"Admin@12345","role_type":"officer"}' \
  > /tmp/rfms_login.json
python3 - <<'PY'
import json
login = json.load(open("/tmp/rfms_login.json"))
token = (login.get("data") or {}).get("token") or ""
open("/tmp/rfms_tok.txt", "w").write(token)
raise SystemExit(0 if token else 1)
PY
if [[ $? -eq 0 ]]; then ok "officer login"; else bad "officer login for lead check"; fi

python3 - <<PY
import json, urllib.request, sys
lead_id = "$LEAD_ID"
fp = "$FP"
tok = open("/tmp/rfms_tok.txt").read().strip()
if not tok:
    print("skip_lead_check")
    sys.exit(0)
req = urllib.request.Request(
    "http://127.0.0.1:8090/api/v1/leads",
    headers={"Authorization": f"Bearer {tok}"},
)
payload = json.load(urllib.request.urlopen(req, timeout=20))
items = payload.get("data", payload)
if isinstance(items, dict):
    items = items.get("leads") or items.get("items") or items.get("rows") or []
if not isinstance(items, list):
    items = []
lead = next((x for x in items if str(x.get("id")) == lead_id), None)
if not lead and fp:
    lead = next((x for x in items if str(x.get("hec_franchisee_profile", "")) == fp), None)
print("lead_found", bool(lead), "count", len(items))
if not lead:
    sys.exit(2)
model = lead.get("franchise_model") or ""
src = lead.get("source") or ""
print("id", lead.get("id"))
print("source", src)
print("franchise_model", repr(model))
print("hec_fp", lead.get("hec_franchisee_profile"))
open("/tmp/lead_ok_src.txt", "w").write(src)
open("/tmp/lead_ok_model.txt", "w").write(str(model))
sys.exit(0)
PY
LEAD_RC=$?
if [[ $LEAD_RC -eq 0 ]]; then
  ok "lead found"
  SRC=$(cat /tmp/lead_ok_src.txt 2>/dev/null || true)
  MODEL=$(cat /tmp/lead_ok_model.txt 2>/dev/null || true)
  [[ "$SRC" == "reach_sales" ]] && ok "lead source=reach_sales" || bad "lead source=$SRC"
  if [[ -z "$MODEL" ]]; then
    ok "lead franchise_model blank (applicant must select)"
  else
    bad "lead franchise_model prefilled as '$MODEL'"
  fi
elif [[ $LEAD_RC -eq 2 ]]; then
  bad "lead not found for hec_lead=$LEAD_ID fp=$FP"
fi

echo
echo "=== Portal form markers ==="
BODY=$(curl -sS -L --max-redirs 3 "$LOC" || true)
echo "$BODY" | grep -q 'Select FOFO' && ok "portal shows Select FOFO or FOCO" || bad "missing Select FOFO marker"
echo "$BODY" | grep -qiE 'Franchise applicant portal|Start your' && ok "applicant portal shell" || bad "portal shell markers missing"
BYTES=$(printf '%s' "$BODY" | wc -c)
[[ "$BYTES" -gt 3000 ]] && ok "portal HTML size=$BYTES" || bad "HTML too small ($BYTES) — maybe homepage SW"

echo
echo "=== Summary passed=$PASS failed=$FAIL ==="
if [[ "$FAIL" -eq 0 ]]; then
  echo REACH_LEAD_HANDOFF_OK
  exit 0
fi
echo REACH_LEAD_HANDOFF_FAIL
exit 1
