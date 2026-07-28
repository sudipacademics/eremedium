#!/bin/bash
# Mint a short-lived hec token and follow redirects (prints Location path only).
set -euo pipefail
cd /opt/health-ecosystem/docker

FP=$(docker compose -f docker-compose.yml exec -T backend bash -lc \
  "bench --site health.localhost mariadb -Nse \"select name from \\\`tabFranchisee Profile\\\` order by modified desc limit 1\"" \
  | tr -d '\r' | head -1)
echo "fp=$FP"

OUT=$(docker compose -f docker-compose.yml exec -T backend bash -lc \
  "bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase80_onboarding_bridge.mint_onboarding_token --kwargs \"{'franchisee_id':'$FP','ttl_seconds':600}\"" \
  2>/dev/null | tr -d '\r')
echo "mint_raw_prefix=${OUT:0:120}"

URL=$(python3 - <<PY
import ast,sys,re
raw='''$OUT'''
# bench execute may print repr of dict
m=re.search(r"\{.*\}", raw, re.S)
if not m:
  print('')
  raise SystemExit
obj=ast.literal_eval(m.group(0))
print(obj.get('url',''))
PY
)
echo "minted_url_hostpath=$(python3 - <<PY
from urllib.parse import urlparse
u='''$URL'''
p=urlparse(u)
print(f'{p.scheme}://{p.netloc}{p.path}')
print('has_token', 'token=' in u)
PY
)"

if [ -z "$URL" ]; then
  echo "FAIL: no url minted"
  exit 1
fi

echo "=== follow redirects (max 5) ==="
curl -sS -o /tmp/hec_body.txt -D /tmp/hec_hdrs.txt -w "final_http=%{http_code} final_url=%{url_effective}\n" \
  --max-redirs 5 -L "$URL" || true
echo "--- response headers ---"
grep -iE 'HTTP/|^[Ll]ocation:' /tmp/hec_hdrs.txt || true
echo "--- final body markers ---"
grep -oE 'Franchise applicant portal|Select FOFO or FOCO|APPLICATION SUBMITTED|Complete your franchise|Remedium Labs|e-remedium' /tmp/hec_body.txt | sort -u | head
echo "--- Location targets ---"
python3 - <<'PY'
from urllib.parse import urlparse
import re
text=open('/tmp/hec_hdrs.txt',encoding='utf-8',errors='ignore').read()
for line in text.splitlines():
  if line.lower().startswith('location:'):
    loc=line.split(':',1)[1].strip()
    p=urlparse(loc)
    print(f'{p.scheme}://{p.netloc}{p.path}?{ ",".join(sorted(p.query.split("&")) if p.query else []) }')
PY
