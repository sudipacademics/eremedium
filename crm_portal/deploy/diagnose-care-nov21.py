import sqlite3

db = "/opt/health-ecosystem/care_portal/data/care.db"
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
print("=== 2026-11-21 all appointments ===")
for r in con.execute(
    """
  SELECT a.id,a.code,a.type,a.service,a.date,a.time,a.status,a.notes,a.branch_id,b.name AS branch,
         p.name AS patient,p.mobile,p.referred_by
  FROM appointments a
  JOIN patients p ON p.id=a.patient_id
  LEFT JOIN branches b ON b.id=a.branch_id
  WHERE a.date='2026-11-21'
  ORDER BY a.branch_id, a.type, a.time
"""
):
    print(dict(r))
print("=== CRM-tagged anything ===")
for r in con.execute(
    """
  SELECT a.id,a.code,a.type,a.date,a.time,a.notes,b.name AS branch,p.name,p.mobile,p.referred_by
  FROM appointments a
  JOIN patients p ON p.id=a.patient_id
  LEFT JOIN branches b ON b.id=a.branch_id
  WHERE a.notes LIKE '%CRM%' OR p.referred_by LIKE '%CRM%'
  ORDER BY a.id DESC LIMIT 30
"""
):
    print(dict(r))
print("=== practitioners Hasnabad ===")
for r in con.execute(
    "SELECT id,name,role,branch_id,active FROM practitioners WHERE active=1 ORDER BY role,name LIMIT 40"
):
    print(dict(r))
