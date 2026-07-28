#!/bin/bash
set -euo pipefail
echo "=== apex e-remedium.in redirects (path preservation?) ==="
for path in '/' '/onboard/' '/onboard/hec-session?token=test' '/franchise/'; do
  echo "PATH $path"
  curl -sS -o /dev/null -D - "https://e-remedium.in$path" | grep -iE 'HTTP/|^[Ll]ocation:' | head -5
  echo
done

echo "=== onboard_base_url from running backend conf ==="
cd /opt/health-ecosystem/docker
docker compose -f docker-compose.yml exec -T backend bash -lc \
  "bench --site health.localhost execute frappe.get_conf --kwargs \"{'key':'onboard_base_url'}\"" 2>/dev/null \
  || docker compose -f docker-compose.yml exec -T backend bash -lc \
  "bench --site health.localhost console" <<'PY' 2>/dev/null | tail -5
import frappe
print(repr(frappe.conf.get('onboard_base_url')))
PY

docker compose -f docker-compose.yml exec -T backend bash -lc 'python3 - <<"PY"
import frappe
from frappe.utils import get_site_path
frappe.init(site="health.localhost")
frappe.connect()
print("onboard_base_url=", repr(frappe.conf.get("onboard_base_url")))
print("sites_path=", frappe.utils.get_sites_path() if hasattr(frappe.utils,"get_sites_path") else "")
PY' 2>/dev/null || true

echo
echo "=== nginx server_name e-remedium.in (apex) ==="
grep -n 'server_name e-remedium\|return 301.*www\|server_name .*;' /etc/nginx/sites-available/e-remedium | head -40
