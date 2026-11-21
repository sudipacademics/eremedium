import sqlite3

db = "/opt/health-ecosystem/care_portal/data/care.db"
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
cur = con.cursor()
print("=== branches ===")
for r in cur.execute("SELECT id,name,code,city,active FROM branches ORDER BY id"):
    print(dict(r))
print("=== recent patients with CRM ===")
for r in cur.execute(
    """
  SELECT id,code,name,mobile,referred_by,condition,branch_id,created_at
  FROM patients
  WHERE referred_by LIKE '%CRM%' OR condition LIKE '%CRM%' OR name LIKE '%Meera%' OR mobile LIKE '%9007123456%'
  ORDER BY id DESC LIMIT 20
"""
):
    print(dict(r))
print("=== appointments today / recent ===")
for r in cur.execute(
    """
  SELECT a.id,a.code,a.type,a.service,a.date,a.time,a.status,a.notes,a.branch_id,b.name AS branch,
         p.name AS patient,p.mobile,p.referred_by
  FROM appointments a
  JOIN patients p ON p.id=a.patient_id
  LEFT JOIN branches b ON b.id=a.branch_id
  ORDER BY a.id DESC LIMIT 25
"""
):
    print(dict(r))
print("=== count by date type ===")
for r in cur.execute(
    """
  SELECT date, type, COUNT(*) n FROM appointments
  WHERE status != 'Cancelled'
  GROUP BY date, type ORDER BY date DESC LIMIT 20
"""
):
    print(dict(r))
