#!/bin/bash
set -euo pipefail
SW=/opt/health-ecosystem/health_web_app/dist/sw.js
CONF=/etc/nginx/sites-available/e-remedium

echo "=== sw.js denylist ==="
python3 - <<PY
from pathlib import Path
t=Path("$SW").read_text(encoding="utf-8")
print("exists", Path("$SW").exists(), "bytes", Path("$SW").stat().st_size)
i=t.find("createHandlerBoundToURL")
print(t[i:i+360] if i>=0 else "MISSING NavigationRoute")
print("has_onboard_deny", "/onboard" in t[i:i+400] if i>=0 else False)
print("has_franchise_deny", "/franchise" in t[i:i+400] if i>=0 else False)
print("unguarded_navigate", '({request:e})=>"navigate"===e.mode,new e.NetworkFirst' in t)
print("guarded_navigate", 'navigate"===e.mode&&!' in t or "navigate\"===e.mode&&!" in t)
PY

echo
echo "=== nginx FFMS locations (www) ==="
grep -nE 'location (= |\^~ )/(franchise|onboard|ffms|rfms-api)|hec-session|FFMS path' "$CONF" | head -40

echo
echo "=== public responses (no SW; server truth) ==="
for u in \
  'https://www.e-remedium.in/franchise/' \
  'https://www.e-remedium.in/onboard/' \
  'https://www.e-remedium.in/'
do
  echo "URL $u"
  curl -sS -o /tmp/b.txt -D /tmp/h.txt -w "code=%{http_code} final=%{url_effective}\n" --max-redirs 3 -L "$u" || true
  grep -iE 'HTTP/|^[Ll]ocation:' /tmp/h.txt | head -6
  grep -oE 'Franchise applicant portal|Select FOFO|Franchise models|Why Remedium|Remedium Health|Book lab|APPLICATION SUBMITTED|Apply for franchise' /tmp/b.txt | sort -u | head
  # homepage shell is tiny ~1k; FFMS pages are larger
  wc -c /tmp/b.txt | awk '{print "bytes",$1}'
  echo
done

echo "=== rfms upstreams ==="
ss -lntp | grep -E ':3000|:3001|:3002' || true
curl -sS -o /dev/null -w "mkt3000=%{http_code} " http://127.0.0.1:3000/ || true
curl -sS -o /dev/null -w "portal3001=%{http_code} " http://127.0.0.1:3001/ || true
curl -sS -o /dev/null -w "admin3002=%{http_code}\n" http://127.0.0.1:3002/ || true
