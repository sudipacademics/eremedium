#!/bin/bash
set -e
cd /opt/health-ecosystem/docker

echo "=== worker/backend logs around XML ==="
docker compose logs backend --tail 120 2>&1 | grep -iE 'telephony|respond_xml|Error|Traceback|xml|Exception' | tail -60

echo "=== extract xml helpers ==="
python3 - <<'PY'
from pathlib import Path
text=Path('/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase64_telephony.py').read_text(encoding='utf-8',errors='ignore')
for name in ['_exotel_xml_ai_greeting','_exotel_xml_gather','_exotel_connect_xml','_respond_xml','_public_base_url','_method_url']:
    i=text.find(f'def {name}')
    print('====', name, '====')
    print(text[i:i+900] if i>=0 else 'MISSING')
PY

echo "=== reproduce XML inside request via curl verbose + Error Log after ==="
curl -sS -X POST \
  "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony.telephony_incoming" \
  -H "X-Frappe-Site-Name: health.localhost" \
  -d "CallFrom=9876500888&CallTo=08011112222&CallSid=diag-xml-errlog" >/dev/null || true
sleep 1
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench
bench --site health.localhost mariadb -e "select name, creation, method, left(error,1200) from \`tabError Log\` where creation > DATE_SUB(NOW(), INTERVAL 5 MINUTE) order by creation desc limit 5;"
'

echo "=== api.py has masked? installed package vs source ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench
./env/bin/python - <<"PY"
import health_ecosystem_core.health_ecosystem_core.api as api
print("start_masked_call", hasattr(api,"start_masked_call"))
print("get_masked_call_context", hasattr(api,"get_masked_call_context"))
print("api file", api.__file__)
PY
grep -n "start_masked_call\|get_masked_call_context\|phase65" apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py | head
'
