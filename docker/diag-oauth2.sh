#!/bin/bash
set -e
cd /opt/health-ecosystem/docker

echo "=== get_oauth_providers ==="
RESP=$(curl -sS "https://www.e-remedium.in/api/method/health_ecosystem_core.api.get_oauth_providers")
python3 -c '
import json, urllib.parse, sys
raw = sys.argv[1]
d = json.loads(raw)
m = d.get("message") or d
print(json.dumps(m, indent=2)[:5000])
for p in (m.get("providers") or []):
    u = p.get("login_url") or ""
    q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query)
    print("---")
    print("provider:", p.get("name") or p.get("provider") or p.get("provider_name"))
    print("redirect_uri:", (q.get("redirect_uri") or [""])[0])
print("google_redirect_uri field:", m.get("google_redirect_uri"))
' "$RESP"

echo "=== site host_name / get_url / portal ==="
docker compose exec -T frappe bash -lc 'cd /home/frappe/frappe-bench && bench --site health.localhost execute "
import frappe
from frappe.utils import get_url
print(\"host_name=\", frappe.conf.host_name)
print(\"get_url=\", get_url())
from health_ecosystem_core.health_ecosystem_core.clinical_phase18b import portal_base_url, frappe_oauth_callback_url
print(\"portal_base_url=\", portal_base_url())
print(\"frappe_oauth_callback_url=\", frappe_oauth_callback_url())
"'

echo "=== nginx snippets ==="
grep -RIn --include='*.conf' 'server_name\|location /api\|proxy_pass\|e-remedium' /opt/health-ecosystem/docker /etc/nginx 2>/dev/null | head -120
