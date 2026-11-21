#!/bin/bash
set -euo pipefail
BCID=$(docker compose -f /opt/health-ecosystem/docker/docker-compose.yml -f /opt/health-ecosystem/docker/docker-compose.ffms.yml -p docker ps -q backend | head -1)
docker exec -i "$BCID" bash -lc 'cd /home/frappe/frappe-bench && ./env/bin/python -' <<'PY'
import os, frappe
sites = sorted(
    d for d in os.listdir("sites")
    if os.path.isdir(os.path.join("sites", d)) and d not in ("assets",) and os.path.exists(os.path.join("sites", d, "site_config.json"))
)
print("SITES", sites)
site = sites[0]
frappe.init(site=site)
frappe.connect()
try:
    from health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking import (
        list_crm_sales_closes, extract_crm_tag, ensure_crm_sales_close_doctype
    )
    print("IMPORT_OK")
    ensure_crm_sales_close_doctype()
    print("DOCTYPE", frappe.db.exists("DocType", "CRM Sales Close"))
    print("TAG", extract_crm_tag("[CRM_TAG:CRM-SG-BK0004]"))
    print("LIST", list_crm_sales_closes(limit=20))
    print("COUNT", frappe.db.count("CRM Sales Close") if frappe.db.exists("DocType", "CRM Sales Close") else None)
except Exception:
    import traceback
    traceback.print_exc()
PY

python3 - <<'PY'
import sqlite3
db='/opt/health-ecosystem/care_portal/data-aesthetic/aesthetic.db'
con=sqlite3.connect(db)
con.row_factory=sqlite3.Row
cur=con.cursor()
print('=== aesthetic patient 7896541230 ===')
for r in cur.execute("SELECT id,code,name,mobile,condition,referred_by FROM patients WHERE mobile LIKE '%7896541230%'"):
    print(dict(r))
print('=== appointments ===')
for r in cur.execute("""
  SELECT a.id,a.code,a.notes,a.invoice_id,p.referred_by,p.condition
  FROM appointments a JOIN patients p ON p.id=a.patient_id
  WHERE p.mobile LIKE '%7896541230%' ORDER BY a.id DESC LIMIT 10
"""):
    print(dict(r))
print('=== invoices ===')
for r in cur.execute("""
  SELECT i.id,i.number,i.total,i.paid,i.status,i.notes,i.referred_by,i.appointment_id
  FROM invoices i LEFT JOIN patients p ON p.id=i.patient_id
  WHERE p.mobile LIKE '%7896541230%' OR i.number LIKE '%211121-0002%'
  ORDER BY i.id DESC LIMIT 10
"""):
    print(dict(r))
print('=== plans ===')
for r in cur.execute("""
  SELECT t.id,t.code,t.referred_by,t.notes,t.invoice_id,t.billing,t.condition
  FROM therapy_plans t JOIN patients p ON p.id=t.patient_id
  WHERE p.mobile LIKE '%7896541230%' ORDER BY t.id DESC LIMIT 5
"""):
    print(dict(r))
PY
echo DIAGNOSE_CRM_SALES_OK
