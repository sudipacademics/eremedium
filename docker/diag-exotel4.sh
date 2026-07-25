#!/bin/bash
set -e
cd /opt/health-ecosystem/docker

echo "=== XML path HTTP (Exotel-like, no Accept:json) ==="
curl -sS -D /tmp/exotel_xml.hdr -o /tmp/exotel_xml.body -X POST \
  "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony.telephony_incoming" \
  -H "X-Frappe-Site-Name: health.localhost" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "CallFrom=9876500999&CallTo=08011112222&CallSid=diag-xml-http&Direction=incoming"
echo "headers:"; head -20 /tmp/exotel_xml.hdr
echo "body:"; head -c 2000 /tmp/exotel_xml.body; echo

echo "=== Error Log rows ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench
bench --site health.localhost mariadb -e "select name, creation, method, left(error,400) err from \`tabError Log\` order by creation desc limit 8;"
'

echo "=== settings values (phase64+65) ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench
for f in telephony_enabled exotel_sid exotel_api_key exotel_api_token exotel_virtual_number exotel_subdomain exotel_agent_connect_number exotel_webhook_secret telephony_openai_api_key; do
  echo -n "$f="
  out=$(bench --site health.localhost execute frappe.db.get_single_value --args "[\"Health Ecosystem Settings\",\"$f\"]" 2>/dev/null | tr -d "\r")
  # mask secrets
  case "$f" in
    *key*|*token*|*secret*)
      if [ -n "$out" ] && [ "$out" != "None" ] && [ "$out" != '""' ] && [ "$out" != "null" ]; then echo SET; else echo EMPTY/None; fi
      ;;
    *)
      echo "$out"
      ;;
  esac
done
'

echo "=== phase65 source excerpt + api wrappers ==="
python3 - <<'PY'
from pathlib import Path
p=Path('/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase65_number_masking.py')
text=p.read_text(encoding='utf-8', errors='ignore')
for needle in ['def _exotel_creds','def _exotel_configured','def _exotel_connect','def start_masked_call','def get_masked_call_context','def smoke']:
    i=text.find(needle)
    print('====', needle, i, '====')
    print(text[i:i+1600] if i>=0 else 'MISSING')
    print()
api=Path('/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py').read_text(encoding='utf-8', errors='ignore')
for needle in ['start_masked_call','get_masked_call_context','phase65']:
    print('api.py', needle, api.count(needle))
PY

echo "=== run phase65 smoke via bench ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase65_number_masking.smoke_phase65 2>&1 | tail -80
'

echo "=== run phase64 smoke ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony.smoke_phase64 2>&1 | tail -80
'
