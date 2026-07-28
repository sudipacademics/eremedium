#!/bin/bash
set -euo pipefail
echo "=== public curls ==="
for u in \
  'https://www.e-remedium.in/franchise/' \
  'https://www.e-remedium.in/onboard/' \
  'https://www.e-remedium.in/franchise' \
  'https://www.e-remedium.in/onboard' \
  'https://e-remedium.in/franchise/' \
  'https://e-remedium.in/onboard/'
do
  echo "URL $u"
  curl -sS -o /tmp/body.txt -D /tmp/hdrs.txt -w "final=%{url_effective} code=%{http_code}\n" --max-redirs 5 -L "$u" || true
  grep -iE 'HTTP/|^[Ll]ocation:' /tmp/hdrs.txt | head -8
  grep -oE 'Franchise applicant portal|Select FOFO|Franchise models|Why Remedium|Remedium Health|Book lab|start_url' /tmp/body.txt | sort -u | head
  echo
done

echo "=== nginx location order (www https block excerpt) ==="
# Find the ssl server block for www and show franchise/onboard/location /
awk '
  /server_name www\.e-remedium\.in/ {inwww=1}
  inwww && /listen 443/ {ssl=1}
  inwww && ssl {print NR":"$0}
  inwww && ssl && /^}/ {exit}
' /etc/nginx/sites-available/e-remedium | head -120

echo
echo "=== sw.js denylist snippet ==="
python3 - <<'PY'
from pathlib import Path
t=Path('/opt/health-ecosystem/health_web_app/dist/sw.js').read_text(encoding='utf-8')
i=t.find('createHandlerBoundToURL')
print(t[i:i+350] if i>=0 else 'missing')
print('denylist_count', t.count('denylist'))
print('navigate_unguarded', '({request:e})=>"navigate"===e.mode,new e.NetworkFirst' in t)
print('navigate_guarded', 'url:s})=>"navigate"===e.mode&&!' in t)
PY

echo
echo "=== rfms ports ==="
ss -lntp | grep -E ':3000|:3001|:3002|:8090' || true
cd /opt/health-ecosystem/docker
docker compose -f docker-compose.yml -f docker-compose.ffms.yml ps rfms 2>/dev/null | tail -5
curl -sS -o /dev/null -w "portal3001=%{http_code}\n" http://127.0.0.1:3001/ || true
curl -sS -o /dev/null -w "marketing3000=%{http_code}\n" http://127.0.0.1:3000/ || true
