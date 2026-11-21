import sqlite3

db = "/opt/health-ecosystem/care_portal/data-aesthetic/aesthetic.db"
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
cur = con.cursor()
print("=== aesthetic patient 7896541230 ===")
for r in cur.execute(
    "SELECT id,code,name,mobile,condition,referred_by FROM patients WHERE mobile LIKE '%7896541230%'"
):
    print(dict(r))
print("=== appointments ===")
for r in cur.execute(
    """
  SELECT a.id,a.code,a.notes,a.invoice_id,p.referred_by,p.condition
  FROM appointments a JOIN patients p ON p.id=a.patient_id
  WHERE p.mobile LIKE '%7896541230%' ORDER BY a.id DESC LIMIT 10
"""
):
    print(dict(r))
print("=== invoices ===")
for r in cur.execute(
    """
  SELECT i.id,i.number,i.total,i.paid,i.status,i.notes,i.referred_by,i.appointment_id
  FROM invoices i LEFT JOIN patients p ON p.id=i.patient_id
  WHERE p.mobile LIKE '%7896541230%' OR i.number LIKE '%211121-0002%'
  ORDER BY i.id DESC LIMIT 10
"""
):
    print(dict(r))
print("=== plans ===")
for r in cur.execute(
    """
  SELECT t.id,t.code,t.referred_by,t.notes,t.invoice_id,t.billing,t.condition
  FROM therapy_plans t JOIN patients p ON p.id=t.patient_id
  WHERE p.mobile LIKE '%7896541230%' ORDER BY t.id DESC LIMIT 5
"""
):
    print(dict(r))
