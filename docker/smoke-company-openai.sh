#!/bin/bash
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
cd /home/frappe/frappe-bench
bench --site health.localhost execute frappe.db.sql --kwargs '{"query":"select name, abbr from tabCompany","as_dict":1}'
echo "--- default company ---"
bench --site health.localhost execute frappe.defaults.get_global_default --args '["company"]'
echo "--- openai key set? ---"
bench --site health.localhost execute frappe.db.get_single_value --args '["Health Ecosystem Settings","telephony_openai_api_key"]'
EOS
