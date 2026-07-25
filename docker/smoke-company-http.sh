#!/bin/bash
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
cd /home/frappe/frappe-bench
./env/bin/python <<'PY'
import frappe
frappe.init(site="health.localhost")
frappe.connect()
rows = frappe.get_all("Company", fields=["name", "abbr"])
print("companies", rows)
print("default", frappe.defaults.get_global_default("company"))
print("openai_field", frappe.get_meta("Health Ecosystem Settings").has_field("telephony_openai_api_key"))
s = frappe.get_single("Health Ecosystem Settings")
print("openai_configured", bool((getattr(s, "telephony_openai_api_key", None) or "").strip()))
print("item_has_company", frappe.get_meta("Item").has_field("company"))
print(
    "pharmacy_count",
    frappe.db.count(
        "Item",
        {"item_group": ["in", ["Medicines", "Pharmacy"]], "disabled": 0, "is_sales_item": 1},
    ),
)
PY
EOS

echo "=== HTTP ==="
for u in / /wellness /insurance /pharmacy /services /login; do
  code=$(curl -sk -o /dev/null -w "%{http_code}" "https://www.e-remedium.in${u}")
  echo "www${u} => ${code}"
done
for host in partners.e-remedium.in collect.e-remedium.in reach.e-remedium.in erp.e-remedium.in; do
  code=$(curl -sk -o /dev/null -w "%{http_code}" -L --max-redirs 3 "https://${host}/")
  echo "${host} => ${code}"
done
curl -sk "https://www.e-remedium.in/" | head -c 220
echo
