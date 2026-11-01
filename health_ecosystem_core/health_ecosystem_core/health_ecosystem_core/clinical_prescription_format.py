"""E-prescription print payload and HTML format."""

from __future__ import annotations

from html import escape

import frappe
from frappe import _
from frappe.utils import getdate, today

from health_ecosystem_core.health_ecosystem_core.api import (
    _parse_request_value,
    _require_mobile_auth,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff


def _absolute_asset(path):
    if not path:
        return ""
    if str(path).startswith("http"):
        return path
    try:
        from frappe.utils import get_url

        return get_url(path)
    except Exception:
        return path


def _fmt_date(value):
    if not value:
        return ""
    try:
        return getdate(value).strftime("%d-%b-%Y")
    except Exception:
        return str(value)


def _patient_demographics(patient_id):
    if not patient_id:
        return {}
    row = frappe.db.get_value(
        "Health Patient",
        patient_id,
        ["patient_name", "gender", "age", "mobile", "email"],
        as_dict=True,
    )
    return row or {}


def prescription_print_payload(prescription_id):
    doc = frappe.get_doc("Clinical Prescription", prescription_id)
    patient = _patient_demographics(doc.patient)
    doctor_name = frappe.db.get_value("Doctor", doc.doctor, "doctor_name") if doc.doctor else ""
    dept_name = (
        frappe.db.get_value("Clinical Department", doc.department, "department_name")
        if doc.department
        else ""
    )
    apt = None
    if getattr(doc, "doctor_appointment", None):
        apt = frappe.db.get_value(
            "Doctor Appointment",
            doc.doctor_appointment,
            ["name", "appointment_date", "appointment_time", "consultation_mode"],
            as_dict=True,
        )

    medicines = []
    for row in doc.medicines or []:
        item_name = frappe.db.get_value("Item", row.medicine_item, "item_name") if row.medicine_item else ""
        salt = getattr(row, "salt", None)
        if not salt and row.medicine_item:
            try:
                from health_ecosystem_core.health_ecosystem_core.doctype.clinical_prescription.clinical_prescription import (
                    _resolve_salt,
                )

                salt = _resolve_salt(row.medicine_item)
            except Exception:
                salt = ""
        medicines.append(
            {
                "medicine_item": row.medicine_item,
                "item_name": item_name or row.medicine_item,
                "salt": salt or "",
                "dosage": row.dosage or "",
                "frequency": row.frequency or "",
                "duration": row.duration or "",
                "route": getattr(row, "route", None) or "",
                "instructions": row.instructions or "",
            }
        )

    diagnostics = []
    for row in doc.diagnostics or []:
        test_name = (
            frappe.db.get_value("Diagnostic Test Master", row.diagnostic_test, "test_name")
            if row.diagnostic_test
            else None
        )
        item_name = frappe.db.get_value("Item", row.item, "item_name") if row.item else None
        diagnostics.append(
            {
                "diagnostic_test": row.diagnostic_test,
                "test_name": test_name or item_name or row.item or row.diagnostic_test,
                "notes": row.notes or "",
            }
        )

    gender = patient.get("gender") or ""
    age = patient.get("age")
    gender_age = ""
    if age and gender:
        gender_age = f"{age} Y / {gender[:1].upper()}"
    elif age:
        gender_age = f"{age} Y"
    elif gender:
        gender_age = gender

    return {
        "prescription_id": doc.name,
        "status": doc.status,
        "encounter_date": str(doc.encounter_date or today()),
        "diagnosis": doc.diagnosis or "",
        "clinical_notes": doc.clinical_notes or "",
        "patient_id": doc.patient,
        "patient_name": doc.patient_name or patient.get("patient_name") or "",
        "patient_mobile": patient.get("mobile") or "",
        "patient_email": patient.get("email") or "",
        "gender_age": gender_age,
        "doctor_id": doc.doctor,
        "doctor_name": doctor_name or doc.doctor or "",
        "department": dept_name or doc.department or "",
        "appointment_id": getattr(doc, "doctor_appointment", None),
        "appointment_date": str(apt.appointment_date) if apt and apt.appointment_date else "",
        "appointment_time": str(apt.appointment_time or "") if apt else "",
        "consultation_mode": apt.consultation_mode if apt else "",
        "medicines": medicines,
        "diagnostics": diagnostics,
    }


def render_prescription_html(payload, letterhead_plain=0):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import get_report_branding

    branding = get_report_branding()
    clinic_name = escape(branding.get("lab_name") or "Health Ecosystem Clinic")
    tagline = escape(branding.get("lab_tagline") or "")
    clinic_address = escape(branding.get("lab_address") or "")
    clinic_phone = escape(branding.get("lab_phone") or "")
    clinic_website = escape(branding.get("lab_website") or "")
    accent = escape(branding.get("report_primary_color") or "#0b5cab")
    logo = _absolute_asset(branding.get("lab_logo") or "")
    footer_note = escape(
        branding.get("report_footer")
        or "This is a computer-generated e-prescription. Valid without physical signature when issued via the Health Ecosystem portal."
    )

    logo_html = (
        f'<img src="{escape(logo)}" alt="" class="rx-logo" />'
        if logo and not letterhead_plain
        else f'<div class="rx-logo-fallback">{clinic_name[:1]}</div>'
    )
    contact_bits = " · ".join([b for b in (clinic_phone, clinic_website) if b])
    contact_html = f"<div class='rx-contact'>{contact_bits}</div>" if contact_bits else ""
    address_html = f"<div class='rx-address'>{clinic_address}</div>" if clinic_address else ""

    rx_id = escape(str(payload.get("prescription_id") or ""))
    patient = escape(str(payload.get("patient_name") or ""))
    patient_id = escape(str(payload.get("patient_id") or ""))
    gender_age = escape(str(payload.get("gender_age") or ""))
    mobile = escape(str(payload.get("patient_mobile") or ""))
    doctor = escape(str(payload.get("doctor_name") or ""))
    department = escape(str(payload.get("department") or ""))
    encounter = escape(_fmt_date(payload.get("encounter_date")))
    diagnosis = escape(str(payload.get("diagnosis") or ""))
    clinical_notes = escape(str(payload.get("clinical_notes") or "")).replace("\n", "<br/>")
    status = escape(str(payload.get("status") or ""))
    apt_date = escape(_fmt_date(payload.get("appointment_date")))
    apt_time = escape(str(payload.get("appointment_time") or ""))
    mode = escape(str(payload.get("consultation_mode") or ""))

    med_rows = ""
    for idx, row in enumerate(payload.get("medicines") or [], start=1):
        name = escape(str(row.get("item_name") or row.get("medicine_item") or ""))
        salt = escape(str(row.get("salt") or ""))
        salt_html = f"<div class='rx-salt'>{salt}</div>" if salt else ""
        med_rows += f"""
        <tr>
          <td class="rx-num">{idx}</td>
          <td><strong>{name}</strong>{salt_html}</td>
          <td>{escape(str(row.get("dosage") or "—"))}</td>
          <td>{escape(str(row.get("frequency") or "—"))}</td>
          <td>{escape(str(row.get("duration") or "—"))}</td>
          <td>{escape(str(row.get("instructions") or "—"))}</td>
        </tr>"""

    diag_rows = ""
    for idx, row in enumerate(payload.get("diagnostics") or [], start=1):
        test = escape(str(row.get("test_name") or row.get("diagnostic_test") or ""))
        notes = escape(str(row.get("notes") or "—"))
        diag_rows += f"""
        <tr>
          <td class="rx-num">{idx}</td>
          <td><strong>{test}</strong></td>
          <td>{notes}</td>
        </tr>"""

    meds_block = ""
    if med_rows:
        meds_block = f"""
        <section class="rx-section">
          <h2>℞ Medicines</h2>
          <table class="rx-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Medicine</th>
                <th>Dosage</th>
                <th>Frequency</th>
                <th>Duration</th>
                <th>Instructions</th>
              </tr>
            </thead>
            <tbody>{med_rows}</tbody>
          </table>
        </section>"""

    diag_block = ""
    if diag_rows:
        diag_block = f"""
        <section class="rx-section">
          <h2>Investigations / Lab tests</h2>
          <table class="rx-table rx-table-diag">
            <thead>
              <tr>
                <th>#</th>
                <th>Test</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>{diag_rows}</tbody>
          </table>
        </section>"""

    diagnosis_block = (
        f'<section class="rx-section"><h2>Diagnosis</h2><p class="rx-diagnosis">{diagnosis}</p></section>'
        if diagnosis
        else ""
    )
    notes_block = (
        f'<section class="rx-section"><h2>Clinical notes</h2><p class="rx-notes">{clinical_notes}</p></section>'
        if clinical_notes
        else ""
    )

    meta_bits = [
        ("Prescription No.", rx_id),
        ("Date", encounter),
        ("Status", status),
    ]
    if apt_date:
        meta_bits.append(("Consultation", f"{apt_date}{(' ' + apt_time) if apt_time else ''}"))
    if mode:
        meta_bits.append(("Mode", mode))

    meta_html = "".join(
        f"<div class='rx-meta-item'><span class='rx-meta-label'>{escape(label)}</span><span>{value}</span></div>"
        for label, value in meta_bits
        if value
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>E-Prescription {rx_id}</title>
  <style>
    @page {{ size: A4; margin: 14mm; }}
    * {{ box-sizing: border-box; }}
    body {{
      font-family: "Segoe UI", Arial, sans-serif;
      color: #0f172a;
      font-size: 11pt;
      line-height: 1.45;
      margin: 0;
      padding: 0;
    }}
    .rx-sheet {{
      max-width: 780px;
      margin: 0 auto;
      padding: 8px 0 24px;
    }}
    .rx-header {{
      display: flex;
      gap: 16px;
      align-items: flex-start;
      border-bottom: 3px solid {accent};
      padding-bottom: 12px;
      margin-bottom: 16px;
    }}
    .rx-logo, .rx-logo-fallback {{
      width: 64px;
      height: 64px;
      object-fit: contain;
      border-radius: 8px;
    }}
    .rx-logo-fallback {{
      display: flex;
      align-items: center;
      justify-content: center;
      background: {accent};
      color: #fff;
      font-size: 28px;
      font-weight: 700;
    }}
    .rx-clinic-name {{
      font-size: 18pt;
      font-weight: 700;
      color: {accent};
      margin: 0;
    }}
    .rx-tagline {{ color: #64748b; margin: 2px 0 0; font-size: 10pt; }}
    .rx-address, .rx-contact {{ color: #475569; font-size: 9.5pt; margin-top: 4px; }}
    .rx-title {{
      text-align: center;
      font-size: 14pt;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: {accent};
      margin: 0 0 14px;
      font-weight: 700;
    }}
    .rx-meta {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 8px 16px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 14px;
      margin-bottom: 14px;
    }}
    .rx-meta-label {{
      display: block;
      font-size: 8.5pt;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #64748b;
    }}
    .rx-parties {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }}
    .rx-party {{
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
      background: #fff;
    }}
    .rx-party h3 {{
      margin: 0 0 8px;
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
    }}
    .rx-party p {{ margin: 0 0 4px; }}
    .rx-section {{ margin-bottom: 16px; }}
    .rx-section h2 {{
      margin: 0 0 8px;
      font-size: 11pt;
      color: {accent};
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
    }}
    .rx-diagnosis, .rx-notes {{ margin: 0; }}
    .rx-table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 10pt;
    }}
    .rx-table th, .rx-table td {{
      border: 1px solid #e2e8f0;
      padding: 7px 8px;
      vertical-align: top;
      text-align: left;
    }}
    .rx-table th {{
      background: #f1f5f9;
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }}
    .rx-num {{ width: 28px; text-align: center; color: #64748b; }}
    .rx-salt {{ color: #64748b; font-size: 9pt; margin-top: 2px; }}
    .rx-sign {{
      margin-top: 28px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 24px;
    }}
    .rx-sign-block {{
      min-width: 220px;
      border-top: 1px solid #94a3b8;
      padding-top: 6px;
      text-align: center;
      font-size: 10pt;
    }}
    .rx-footer {{
      margin-top: 20px;
      padding-top: 10px;
      border-top: 1px dashed #cbd5e1;
      font-size: 8.5pt;
      color: #64748b;
      text-align: center;
    }}
    @media print {{
      body {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
    }}
  </style>
</head>
<body>
  <div class="rx-sheet">
    <header class="rx-header">
      {logo_html}
      <div>
        <h1 class="rx-clinic-name">{clinic_name}</h1>
        {f'<p class="rx-tagline">{tagline}</p>' if tagline else ''}
        {address_html}
        {contact_html}
      </div>
    </header>

    <h2 class="rx-title">E-Prescription</h2>

    <div class="rx-meta">{meta_html}</div>

    <div class="rx-parties">
      <div class="rx-party">
        <h3>Patient</h3>
        <p><strong>{patient}</strong></p>
        {f'<p>ID: {patient_id}</p>' if patient_id else ''}
        {f'<p>{gender_age}</p>' if gender_age else ''}
        {f'<p>{mobile}</p>' if mobile else ''}
      </div>
      <div class="rx-party">
        <h3>Prescriber</h3>
        <p><strong>Dr. {doctor}</strong></p>
        {f'<p>{department}</p>' if department else ''}
      </div>
    </div>

    {diagnosis_block}
    {meds_block}
    {diag_block}
    {notes_block}

    <div class="rx-sign">
      <div class="rx-sign-block">
        <div>Dr. {doctor}</div>
        {f'<div class="muted">{department}</div>' if department else ''}
      </div>
      <div class="rx-sign-block">
        <div>Date: {encounter}</div>
        <div>Rx: {rx_id}</div>
      </div>
    </div>

    <footer class="rx-footer">{footer_note}</footer>
  </div>
</body>
</html>"""


def _can_view_prescription(prescription_id, user=None):
    user = user or frappe.session.user
    if user == "Guest":
        return False
    roles = frappe.get_roles(user)
    if is_staff(roles) or "Physician" in roles:
        return True
    from health_ecosystem_core.health_ecosystem_core.clinical_phase46_provider_portal import (
        resolve_doctor_for_user,
    )
    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

    doc = frappe.db.get_value(
        "Clinical Prescription",
        prescription_id,
        ["patient", "doctor"],
        as_dict=True,
    )
    if not doc:
        return False
    profile = patient_profile_for_user(user)
    if profile and profile.get("patient_id") == doc.patient:
        return True
    my_doctor = resolve_doctor_for_user(user)
    return bool(my_doctor and my_doctor == doc.doctor)


@frappe.whitelist()
def get_prescription_print_html(prescription_id=None, letterhead_plain=0, sid=None):
    """Return printable HTML for a clinical prescription."""
    if not _require_mobile_auth(sid) and frappe.session.user == "Guest":
        frappe.throw(_("Not authenticated"), frappe.AuthenticationError)

    prescription_id = (_parse_request_value("prescription_id", prescription_id) or "").strip()
    if not prescription_id or not frappe.db.exists("Clinical Prescription", prescription_id):
        frappe.throw(_("Prescription not found"), frappe.DoesNotExistError)

    if not _can_view_prescription(prescription_id):
        frappe.throw(_("Not authorized"), frappe.PermissionError)

    from frappe.utils import cint

    plain = cint(_parse_request_value("letterhead_plain", letterhead_plain) or 0)
    payload = prescription_print_payload(prescription_id)
    return render_prescription_html(payload, letterhead_plain=plain)
