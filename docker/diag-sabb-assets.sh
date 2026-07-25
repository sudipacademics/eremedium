#!/bin/bash
set -e
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
INV=ACC-PINV-2026-00027
echo "=== SABB ==="
bench --site health.localhost mariadb -e "select name,voucher_type,voucher_no,item_code,total_qty,type_of_transaction from \`tabSerial and Batch Bundle\` where voucher_no='$INV'"
bench --site health.localhost mariadb -e "select parent,batch_no,qty,warehouse from \`tabSerial and Batch Entry\` where parent in (select name from \`tabSerial and Batch Bundle\` where voucher_no='$INV')"
echo "=== assets.json report ==="
python3 - <<'PY'
import json
p='sites/assets/assets.json'
try:
    d=json.load(open(p))
except Exception as e:
    print('no assets.json',e); raise SystemExit
for k,v in d.items():
    if 'report' in k.lower() or (isinstance(v,str) and 'report' in v.lower()):
        print(k, '=>', v[:120] if isinstance(v,str) else v)
# also list keys with css/js desk
for k in sorted(d)[:30]:
    pass
keys=[k for k in d if 'report' in k or 'query_report' in k]
print('keys', keys[:40])
PY
ls sites/assets/frappe/dist/js | rg -i 'report|query' || ls sites/assets/frappe/dist/js | head -40
ls sites/assets/frappe/dist/css | rg -i 'report' || true
# frontend nginx path
curl -skI https://erp.e-remedium.in/assets/frappe/dist/css/desk.bundle.KEZ4XFC2.css | head -3
# find report css hashed
find sites/assets/frappe -name '*report*' 2>/dev/null | head -20
find apps/frappe/frappe/public -name '*report*' 2>/dev/null | head -20
EOS
