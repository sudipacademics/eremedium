#!/bin/bash
cd /opt/health-ecosystem/docker
BASE=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
echo "=== phase18b oauth helpers ==="
grep -nE 'redirect|host_name|portal_base|get_oauth|google|Social Login' "$BASE/clinical_phase18b.py" | head -60
echo "=== Social Login Key ==="
docker compose exec -T backend bash <<'EOS'
cd /home/frappe/frappe-bench
bench --site health.localhost mariadb -e "select name, provider_name, client_id, base_url, custom_base_url, redirect_url, enable_social_login from \`tabSocial Login Key\` where provider_name like '%google%' or name like '%google%';"
bench --site health.localhost execute frappe.conf.get --args '["host_name"]'
EOS
