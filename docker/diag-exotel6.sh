#!/bin/bash
set -e
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
cd /home/frappe/frappe-bench
echo "=== response.py text handling ==="
grep -n "text\|message\|type" apps/frappe/frappe/utils/response.py | head -80
echo "=== relevant functions ==="
python3 - <<'PY'
from pathlib import Path
p=Path('apps/frappe/frappe/utils/response.py')
text=p.read_text()
# print build_response and related
for name in ['def build_response','def as_page','def json_handler']:
    i=text.find(name)
    print('----', name, i)
print('--- snippet around type == ---')
import re
for m in re.finditer(r'if response\.get\("type"\)|elif.*type|response\["type"\]|"text"', text):
    start=max(0, m.start()-80)
    print(text[start:m.start()+200])
    print('----')
PY
# also check app.py make_response
grep -n '"text"\|KeyError\|response.get' apps/frappe/frappe/app.py | head -40
EOS

echo "=== recent backend KeyError text ==="
docker compose logs backend --tail 200 2>&1 | grep -A8 "KeyError: 'text'" | tail -40
