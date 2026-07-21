#!/bin/bash
# Align Google OAuth redirect_uri with portal (www) — no compose down
set -e
cd /opt/health-ecosystem/docker

WWW_REDIRECT='https://www.e-remedium.in/api/method/frappe.integrations.oauth2_logins.login_via_google'

docker compose exec -T backend bash <<EOS
set -e
cd /home/frappe/frappe-bench
bench --site health.localhost execute frappe.db.set_value --args '["Social Login Key","google","redirect_url","$WWW_REDIRECT"]'
bench --site health.localhost clear-cache
echo "Social Login Key redirect_url set to www absolute URI"
EOS

echo "=== verify providers ==="
curl -sS "https://www.e-remedium.in/api/method/health_ecosystem_core.health_ecosystem_core.api.get_oauth_providers" \
  -H "X-Frappe-Site-Name: health.localhost" | python3 -c '
import sys, json, urllib.parse
d = json.load(sys.stdin)
m = d.get("message") or d
data = m.get("data") or m
for p in data.get("providers") or []:
    u = p.get("login_url") or ""
    q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query)
    print("redirect_uri=", (q.get("redirect_uri") or [""])[0])
print("google_redirect_uri=", data.get("google_redirect_uri"))
print("match=", (q.get("redirect_uri") or [""])[0] == data.get("google_redirect_uri"))
'
