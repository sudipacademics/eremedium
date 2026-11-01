"""Monthly referring doctor commission ledger — bill by bill."""

from __future__ import annotations

import frappe
from frappe.utils import flt, getdate


def execute(filters=None):
    filters = filters or {}
    from_date = getdate(filters.get("from_date"))
    to_date = getdate(filters.get("to_date"))
    if not from_date or not to_date:
        frappe.throw("From Date and To Date are required")

    conditions = ["rdcl.posting_date between %(from_date)s and %(to_date)s"]
    params = {"from_date": from_date, "to_date": to_date}

    if filters.get("referring_doctor"):
        conditions.append("rdcl.referring_doctor = %(referring_doctor)s")
        params["referring_doctor"] = filters["referring_doctor"]
    if filters.get("franchisee"):
        conditions.append("rdcl.franchisee = %(franchisee)s")
        params["franchisee"] = filters["franchisee"]
    if filters.get("status"):
        conditions.append("rdcl.status = %(status)s")
        params["status"] = filters["status"]

    where = " and ".join(conditions)
    rows = frappe.db.sql(
        f"""
        select
            rdcl.posting_date,
            rdcl.bill_date,
            rdcl.customer_trf,
            rdcl.patient_name,
            rdcl.franchisee,
            rdcl.invoice_amount,
            rdcl.commission_percent,
            rdcl.commission_amount,
            rdcl.status,
            rd.doctor_name as referring_doctor_name
        from `tabReferring Doctor Commission Ledger` rdcl
        left join `tabReferring Doctor` rd on rd.name = rdcl.referring_doctor
        where {where}
        order by rdcl.posting_date asc, rdcl.bill_date asc, rdcl.name asc
        """,
        params,
        as_dict=True,
    )

    columns = [
        {"label": "Posting Date", "fieldname": "posting_date", "fieldtype": "Date", "width": 100},
        {"label": "Bill Date", "fieldname": "bill_date", "fieldtype": "Datetime", "width": 140},
        {"label": "Referring Doctor", "fieldname": "referring_doctor_name", "fieldtype": "Data", "width": 160},
        {"label": "Bill / TRF", "fieldname": "customer_trf", "fieldtype": "Link", "options": "Customer TRF", "width": 130},
        {"label": "Patient", "fieldname": "patient_name", "fieldtype": "Data", "width": 140},
        {"label": "Franchisee", "fieldname": "franchisee", "fieldtype": "Link", "options": "Franchisee Profile", "width": 120},
        {"label": "Invoice Amount", "fieldname": "invoice_amount", "fieldtype": "Currency", "width": 120},
        {"label": "Commission %", "fieldname": "commission_percent", "fieldtype": "Percent", "width": 90},
        {"label": "Commission Amount", "fieldname": "commission_amount", "fieldtype": "Currency", "width": 130},
        {"label": "Status", "fieldname": "status", "fieldtype": "Data", "width": 80},
    ]

    data = []
    for row in rows:
        data.append(
            {
                "posting_date": row.posting_date,
                "bill_date": row.bill_date,
                "referring_doctor_name": row.referring_doctor_name,
                "customer_trf": row.customer_trf,
                "patient_name": row.patient_name,
                "franchisee": row.franchisee,
                "invoice_amount": flt(row.invoice_amount),
                "commission_percent": flt(row.commission_percent),
                "commission_amount": flt(row.commission_amount),
                "status": row.status,
            }
        )

    return columns, data
