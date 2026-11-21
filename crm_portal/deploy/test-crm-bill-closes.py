import re
import sqlite3

CRM_TAG_RE = re.compile(r"(?:\[CRM_TAG:)?(CRM-[A-Z0-9]{2,6}-[A-Z0-9-]{3,24})\]?", re.I)


def extract(*texts):
    for text in texts:
        m = CRM_TAG_RE.search(str(text or ""))
        if m:
            return m.group(1).upper()
    return ""


db = "/opt/health-ecosystem/care_portal/data-aesthetic/aesthetic.db"
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
closes = []
for inv in con.execute(
    """
  SELECT i.id, i.number, i.total, i.paid, i.status, i.notes, i.referred_by, i.appointment_id,
         p.name AS patient_name, p.mobile, p.referred_by AS patient_referred_by
  FROM invoices i LEFT JOIN patients p ON p.id = i.patient_id
  WHERE i.status != 'Cancelled' ORDER BY i.id DESC LIMIT 20
"""
):
    appt_notes = None
    if inv["appointment_id"]:
        row = con.execute("SELECT notes FROM appointments WHERE id = ?", (inv["appointment_id"],)).fetchone()
        appt_notes = row["notes"] if row else None
    tag = extract(inv["referred_by"], inv["notes"], inv["patient_referred_by"], appt_notes)
    if not tag and inv["patient_name"]:
        # patient id path
        pid = con.execute("SELECT patient_id FROM invoices WHERE id = ?", (inv["id"],)).fetchone()
        if pid and pid[0]:
            tagged = con.execute(
                "SELECT notes FROM appointments WHERE patient_id = ? AND notes LIKE '%CRM%' ORDER BY id DESC LIMIT 1",
                (pid[0],),
            ).fetchone()
            tag = extract(tagged["notes"] if tagged else None, inv["patient_referred_by"])
    if not tag:
        continue
    amount = inv["paid"] if inv["paid"] and inv["paid"] > 0 else inv["total"]
    closes.append(
        {
            "tracking_tag": tag,
            "bill_ref": inv["number"],
            "amount": amount,
            "patient_name": inv["patient_name"],
            "mobile": inv["mobile"],
            "portal": "aesthetic",
        }
    )
print(closes)
print("COUNT", len(closes))
