#!/bin/bash
set -e
cd /opt/health-ecosystem/docker
echo "=== locate phase64 ==="
find /opt/health-ecosystem /home/frappe -name 'clinical_phase64_telephony.py' 2>/dev/null | head
docker compose exec -T backend bash -lc 'find /home/frappe/frappe-bench -name clinical_phase64_telephony.py 2>/dev/null | head; grep -n "def _respond_xml" $(find /home/frappe/frappe-bench -name clinical_phase64_telephony.py | head -1) | head; sed -n "/def _respond_xml/,/^def /p" $(find /home/frappe/frappe-bench -name clinical_phase64_telephony.py | head -1) | head -20'

# Re-run patch against whatever path exists
python3 - <<'PY'
from pathlib import Path
cands = list(Path('/opt/health-ecosystem').rglob('clinical_phase64_telephony.py'))
print('host cands', cands)
for p in cands:
    text = p.read_text(encoding='utf-8')
    if 'def _respond_xml' not in text:
        continue
    if 'display_content_as' in text and 'exotel.xml' in text:
        print('already patched', p)
        continue
    start = text.find('def _respond_xml(xml):')
    end = text.find('\n\n', start)
    new = '''def _respond_xml(xml):
\t# Frappe has no response type "text" (KeyError) — use download/inline for raw XML.
\tfrappe.local.response["type"] = "download"
\tfrappe.local.response["filename"] = "exotel.xml"
\tfrappe.local.response["filecontent"] = xml
\tfrappe.local.response["content_type"] = "application/xml"
\tfrappe.local.response["display_content_as"] = "inline"
\tfrappe.local.response["http_status_code"] = 200
\treturn xml'''
    p.write_text(text[:start] + new + text[end:], encoding='utf-8')
    print('patched', p)
PY

docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
SRC64=$(find /home/frappe/frappe-bench/apps /opt/health-ecosystem -name clinical_phase64_telephony.py 2>/dev/null | head -1)
SRCAPI=$(find /home/frappe/frappe-bench/apps /opt/health-ecosystem -name api.py 2>/dev/null | grep 'health_ecosystem_core/health_ecosystem_core/api.py$' | head -1)
echo SRC64=$SRC64
echo SRCAPI=$SRCAPI
# patch inside container copy too
python3 - <<PY
from pathlib import Path
p=Path("$SRC64")
text=p.read_text(encoding='utf-8')
if 'exotel.xml' not in text or 'display_content_as' not in text.split('def _respond_xml',1)[1][:500]:
    start=text.find('def _respond_xml(xml):')
    end=text.find('\n\n', start)
    new='''def _respond_xml(xml):
\t# Frappe has no response type "text" (KeyError) — use download/inline for raw XML.
\tfrappe.local.response["type"] = "download"
\tfrappe.local.response["filename"] = "exotel.xml"
\tfrappe.local.response["filecontent"] = xml
\tfrappe.local.response["content_type"] = "application/xml"
\tfrappe.local.response["display_content_as"] = "inline"
\tfrappe.local.response["http_status_code"] = 200
\treturn xml'''
    p.write_text(text[:start]+new+text[end:], encoding='utf-8')
    print('container patched', p)
else:
    print('container already patched', p)
api=Path("$SRCAPI")
t=api.read_text(encoding='utf-8')
if 'start_masked_call' not in t:
    t=t.rstrip()+"\n\nfrom health_ecosystem_core.health_ecosystem_core.clinical_phase65_number_masking import (  # noqa: E402\n    get_masked_call_context,\n    start_masked_call,\n)\n"
    api.write_text(t, encoding='utf-8')
    print('api exports added', api)
else:
    print('api exports present')
PY
rm -rf /tmp/hec_reinstall
cp -a apps/health_ecosystem_core /tmp/hec_reinstall
./env/bin/pip install -q --force-reinstall --no-deps /tmp/hec_reinstall
./env/bin/python - <<'PY'
from health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony import _respond_xml
import inspect
print(inspect.getsource(_respond_xml))
import health_ecosystem_core.health_ecosystem_core.api as api
print('masked', hasattr(api,'start_masked_call'), hasattr(api,'get_masked_call_context'))
PY
bench --site health.localhost clear-cache
EOS
docker compose restart backend
sleep 12
echo "=== XML ==="
curl -sS -D /tmp/exotel_xml.hdr -o /tmp/exotel_xml_out.xml -X POST \
  "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony.telephony_incoming" \
  -H "X-Frappe-Site-Name: health.localhost" \
  -d "CallFrom=9876500777&CallTo=08011112222&CallSid=diag-xml-fixed2"
head -15 /tmp/exotel_xml.hdr
echo BODY:
head -c 700 /tmp/exotel_xml_out.xml; echo
