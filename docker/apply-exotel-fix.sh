#!/bin/bash
set -e
python3 /tmp/patch-exotel-xml-and-masked-api.py
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
rm -rf /tmp/hec_reinstall
cp -a apps/health_ecosystem_core /tmp/hec_reinstall
cp /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase64_telephony.py \
  /tmp/hec_reinstall/health_ecosystem_core/health_ecosystem_core/clinical_phase64_telephony.py
cp /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py \
  /tmp/hec_reinstall/health_ecosystem_core/health_ecosystem_core/api.py
# also update apps path if present
cp /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase64_telephony.py \
  apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase64_telephony.py
cp /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py \
  apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py
./env/bin/pip install -q --force-reinstall --no-deps /tmp/hec_reinstall
./env/bin/python - <<'PY'
from health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony import _respond_xml
import inspect
print(inspect.getsource(_respond_xml))
import health_ecosystem_core.health_ecosystem_core.api as api
print("masked", hasattr(api, "start_masked_call"), hasattr(api, "get_masked_call_context"))
PY
bench --site health.localhost clear-cache
EOS
docker compose restart backend
sleep 10
echo "=== XML smoke ==="
curl -sS -D /tmp/exotel_xml.hdr -o /tmp/exotel_xml_out.xml -X POST \
  "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony.telephony_incoming" \
  -H "X-Frappe-Site-Name: health.localhost" \
  -d "CallFrom=9876500777&CallTo=08011112222&CallSid=diag-xml-fixed"
head -20 /tmp/exotel_xml.hdr
echo "BODY:"
head -c 900 /tmp/exotel_xml_out.xml
echo
echo "=== JSON smoke ==="
curl -sS -X POST \
  "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony.telephony_incoming" \
  -H "X-Frappe-Site-Name: health.localhost" -H "Accept: application/json" \
  -d "CallFrom=9876500777&CallTo=08011112222&CallSid=diag-json-fixed&format=json" | head -c 450
echo
