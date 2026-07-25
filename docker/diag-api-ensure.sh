#!/bin/bash
set -e
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
FILE=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill as m; print(m.__file__)")
echo "LOADED=$FILE"
echo "--- grep api_ensure / upsert ---"
grep -n "def api_ensure_hec_item\|def upsert_hec_pharma_item\|def api_upsert\|def api_get_hec" "$FILE" | head -30
echo "--- dir api_* ---"
./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill as m; print([x for x in dir(m) if x.startswith('api_')])"
echo "--- apps copy ---"
APP=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase69_pharma_bill.py
grep -n "def api_ensure_hec_item\|def upsert_hec_pharma_item\|def api_upsert" "$APP" | head -20
wc -l "$FILE" "$APP"
EOS
