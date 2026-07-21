"""
Phase 74 — Staff training, KRA library, and appraisal self-service.

Builds on Frappe HRMS DocTypes (KRA, Appraisal Template/Cycle, Training Program/Event).
Provides ESS APIs + web hub at /dashboard/performance.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import (
    _default_company,
    ensure_employee_for_user,
    is_hr_eligible,
)

PERF_DOCTYPES = (
    "KRA",
    "Appraisal Template",
    "Appraisal Cycle",
    "Appraisal",
    "Training Program",
    "Training Event",
    "Employee Feedback Criteria",
)


def performance_ready():
    return all(frappe.db.exists("DocType", name) for name in PERF_DOCTYPES)


def missing_performance_doctypes():
    return [name for name in PERF_DOCTYPES if not frappe.db.exists("DocType", name)]


# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------

KRA_LIBRARY = (
    ("Sample Collection Quality", "Accurate, aseptic sample collection with minimal redraws."),
    ("TRF & Data Accuracy", "Correct TRF entry, barcodes, and patient demographics."),
    ("Customer Service", "Professional communication with patients and franchise partners."),
    ("Attendance & Punctuality", "On-time shifts, hub check-ins, and route adherence."),
    ("SOP & NABL Compliance", "Follow lab SOPs, QC checks, and documentation standards."),
    ("Team Collaboration", "Coordinate with lab, franchisee, and clinical teams."),
    ("Sales & Revenue Target", "Meet lead, visit, and conversion targets (sales roles)."),
)

FEEDBACK_CRITERIA = (
    ("Quality of Work", 25),
    ("Communication", 20),
    ("Teamwork", 20),
    ("Initiative", 15),
    ("Compliance", 20),
)

APPRAISAL_TEMPLATES = {
    "HEC Phlebotomist Appraisal": (
        "Sample Collection Quality",
        "TRF & Data Accuracy",
        "Customer Service",
        "Attendance & Punctuality",
        "SOP & NABL Compliance",
    ),
    "HEC Lab Technician Appraisal": (
        "TRF & Data Accuracy",
        "SOP & NABL Compliance",
        "Team Collaboration",
        "Attendance & Punctuality",
        "Sample Collection Quality",
    ),
    "HEC Field Staff Appraisal": (
        "Customer Service",
        "Team Collaboration",
        "Attendance & Punctuality",
        "TRF & Data Accuracy",
    ),
    "HEC Sales Appraisal": (
        "Sales & Revenue Target",
        "Customer Service",
        "Team Collaboration",
        "Attendance & Punctuality",
    ),
}

TRAINING_PROGRAMS = (
    ("NABL & Lab Quality Basics", "Intro to NABL documentation, QC, and audit readiness."),
    ("Phlebotomy & Sample Collection SOP", "Venipuncture, labeling, cold chain, and TRF workflow."),
    ("RemeLab / ERP Operations", "Desk TRF, Bill Entry, franchisee hub, and mobile workflows."),
    ("Customer Service Excellence", "Phone etiquette, complaint handling, and patient experience."),
)

ROLE_TEMPLATE_MAP = {
    "Phlebotomist": "HEC Phlebotomist Appraisal",
    "Lab Technician": "HEC Lab Technician Appraisal",
    "Franchisee Operator": "HEC Field Staff Appraisal",
    "Sales Representative": "HEC Sales Appraisal",
    "Sales Manager": "HEC Sales Appraisal",
}


def _ensure_perf_doctypes():
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair import (
            import_priority_hrms_doctypes,
        )

        return import_priority_hrms_doctypes()
    except Exception:
        frappe.log_error(title="phase74_import", message=frappe.get_traceback())
        return []


def ensure_feedback_criteria():
    if not frappe.db.exists("DocType", "Employee Feedback Criteria"):
        return []
    created = []
    for title, _weight in FEEDBACK_CRITERIA:
        if frappe.db.exists("Employee Feedback Criteria", title):
            continue
        frappe.get_doc({"doctype": "Employee Feedback Criteria", "criteria": title}).insert(
            ignore_permissions=True
        )
        created.append(title)
    return created


def ensure_kras():
    if not frappe.db.exists("DocType", "KRA"):
        return []
    created = []
    for title, desc in KRA_LIBRARY:
        if frappe.db.exists("KRA", title):
            continue
        frappe.get_doc({"doctype": "KRA", "title": title, "description": desc}).insert(
            ignore_permissions=True
        )
        created.append(title)
    return created


def _template_goal_rows(kra_titles, weight_each=None):
    weight_each = weight_each or int(100 / max(len(kra_titles), 1))
    rows = []
    for title in kra_titles:
        if not frappe.db.exists("KRA", title):
            continue
        rows.append({"key_result_area": title, "per_weightage": weight_each})
    return rows


def ensure_appraisal_templates():
    if not frappe.db.exists("DocType", "Appraisal Template"):
        return []
    ensure_kras()
    ensure_feedback_criteria()
    created = []
    criteria_rows = [
        {"criteria": c, "per_weightage": w} for c, w in FEEDBACK_CRITERIA if frappe.db.exists("Employee Feedback Criteria", c)
    ]
    for template_title, kra_titles in APPRAISAL_TEMPLATES.items():
        if frappe.db.exists("Appraisal Template", template_title):
            continue
        goals = _template_goal_rows(kra_titles)
        if not goals:
            continue
        doc = frappe.get_doc(
            {
                "doctype": "Appraisal Template",
                "template_title": template_title,
                "description": f"HEC default KRAs for {template_title}.",
                "goals": goals,
                "rating_criteria": criteria_rows,
            }
        )
        doc.insert(ignore_permissions=True)
        created.append(template_title)
    return created


def ensure_appraisal_cycle():
    if not frappe.db.exists("DocType", "Appraisal Cycle"):
        return None
    company = _default_company()
    if not company:
        return None
    year = getdate(today()).year
    name = f"HEC FY {year} H1"
    if frappe.db.exists("Appraisal Cycle", name):
        return name
    doc = frappe.get_doc(
        {
            "doctype": "Appraisal Cycle",
            "cycle_name": name,
            "company": company,
            "start_date": f"{year}-01-01",
            "end_date": f"{year}-06-30",
            "status": "In Progress",
            "description": "HEC mid-year performance review cycle (seeded by Phase 74).",
        }
    )
    meta = frappe.get_meta("Appraisal Cycle")
    if meta.has_field("kra_evaluation_method"):
        doc.kra_evaluation_method = "Manual Rating"
    doc.insert(ignore_permissions=True)
    return doc.name


def _template_for_user(user):
    roles = frappe.get_roles(user)
    for role, template in ROLE_TEMPLATE_MAP.items():
        if role in roles and frappe.db.exists("Appraisal Template", template):
            return template
    return "HEC Field Staff Appraisal"


def ensure_appraisal_for_employee(employee, cycle=None, template=None):
    if not frappe.db.exists("DocType", "Appraisal") or not employee:
        return None
    cycle = cycle or ensure_appraisal_cycle()
    if not cycle:
        return None
    company = frappe.db.get_value("Employee", employee, "company") or _default_company()
    user = frappe.db.get_value("Employee", employee, "user_id")
    template = template or (_template_for_user(user) if user else "HEC Field Staff Appraisal")
    if not frappe.db.exists("Appraisal Template", template):
        ensure_appraisal_templates()
    if not frappe.db.exists("Appraisal Template", template):
        return None

    existing = frappe.db.exists(
        "Appraisal",
        {"employee": employee, "appraisal_cycle": cycle, "docstatus": ["<", 2]},
    )
    if existing:
        return existing

    doc = frappe.get_doc(
        {
            "doctype": "Appraisal",
            "employee": employee,
            "company": company,
            "appraisal_cycle": cycle,
            "appraisal_template": template,
        }
    )
    if frappe.get_meta("Appraisal").has_field("start_date"):
        doc.start_date = getdate(today())
    if frappe.get_meta("Appraisal").has_field("end_date"):
        doc.end_date = add_days(getdate(today()), 180)
    try:
        doc.insert(ignore_permissions=True)
        return doc.name
    except Exception:
        frappe.log_error(title="phase74_appraisal", message=frappe.get_traceback())
        return None


def ensure_training_programs():
    if not frappe.db.exists("DocType", "Training Program"):
        return []
    created = []
    company = _default_company()
    for title, desc in TRAINING_PROGRAMS:
        if frappe.db.exists("Training Program", {"training_program": title}):
            continue
        row = {"doctype": "Training Program", "training_program": title}
        meta = frappe.get_meta("Training Program")
        if meta.has_field("company"):
            row["company"] = company
        if meta.has_field("description"):
            row["description"] = desc
        if meta.has_field("status"):
            opts = (meta.get_field("status").options or "").split("\n")
            row["status"] = opts[0] if opts and opts[0] else "Scheduled"
        try:
            frappe.get_doc(row).insert(ignore_permissions=True)
            created.append(title)
        except Exception:
            frappe.log_error(title="phase74_training_program", message=frappe.get_traceback())
    return created


def ensure_training_events():
    if not frappe.db.exists("DocType", "Training Event"):
        return []
    ensure_training_programs()
    company = _default_company()
    created = []
    start = add_days(getdate(today()), 7)
    end = add_days(start, 1)
    meta = frappe.get_meta("Training Event")
    for title, _desc in TRAINING_PROGRAMS:
        event_name = f"{title} — Intro Session"
        if frappe.db.exists("Training Event", event_name):
            continue
        row = {
            "doctype": "Training Event",
            "event_name": event_name,
            "training_program": title,
            "event_status": "Scheduled",
            "company": company,
            "type": "Seminar",
            "level": "Beginner",
            "start_time": f"{start} 10:00:00",
            "end_time": f"{end} 13:00:00",
            "introduction": f"Scheduled introduction for {title}.",
        }
        if meta.has_field("location"):
            row["location"] = "Head Office / Online"
        if meta.has_field("course"):
            row["course"] = title
        try:
            doc = frappe.get_doc(row)
            doc.insert(ignore_permissions=True)
            created.append(doc.name)
        except Exception:
            frappe.log_error(title="phase74_training_event", message=frappe.get_traceback())
    return created


def _training_event_employee_field():
    if not frappe.db.exists("DocType", "Training Event"):
        return None
    meta = frappe.get_meta("Training Event")
    for field in meta.fields:
        if field.fieldtype == "Table" and field.options == "Training Event Employee":
            return field.fieldname
    return "employees" if meta.has_field("employees") else None


def _append_training_participant(doc, employee, table_field):
    child_meta = frappe.get_meta("Training Event Employee")
    row = {"employee": employee}
    if child_meta.has_field("attendance"):
        row["attendance"] = "Present"
    if child_meta.has_field("status"):
        row["status"] = "Open"
    doc.append(table_field, row)


def prepare_training_event_for_feedback(training_event, employee):
    """Enroll employee, mark event completed, and submit so HRMS feedback validation passes."""
    from health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair import ensure_hrms_modules

    ensure_hrms_modules()
    if not employee or not frappe.db.exists("Training Event", training_event):
        return False

    table_field = _training_event_employee_field()
    if not table_field:
        return False

    doc = frappe.get_doc("Training Event", training_event)
    child_meta = frappe.get_meta("Training Event Employee")
    participants = doc.get(table_field) or []
    found = False
    for row in participants:
        if row.employee != employee:
            continue
        found = True
        if child_meta.has_field("attendance"):
            row.attendance = "Present"
        if child_meta.has_field("status") and not row.status:
            row.status = "Open"
    if not found:
        _append_training_participant(doc, employee, table_field)

    event_meta = frappe.get_meta("Training Event")
    if event_meta.has_field("event_status"):
        doc.event_status = "Completed"
    doc.save(ignore_permissions=True)
    if doc.docstatus == 0:
        doc.submit()
    frappe.db.commit()
    return True


def enroll_employee_in_events(employee, submit_for_feedback=False):
    if not employee or not frappe.db.exists("DocType", "Training Event"):
        return []
    ensure_training_events()
    enrolled = []
    if not frappe.db.exists("DocType", "Training Event Employee"):
        return enrolled
    table_field = _training_event_employee_field()
    if not table_field:
        return enrolled
    for ev in frappe.get_all(
        "Training Event",
        filters={"docstatus": ["<", 2]},
        pluck="name",
        limit=10,
    ):
        doc = frappe.get_doc("Training Event", ev)
        existing = {row.employee for row in (doc.get(table_field) or []) if getattr(row, "employee", None)}
        if employee in existing:
            enrolled.append(ev)
            continue
        _append_training_participant(doc, employee, table_field)
        doc.save(ignore_permissions=True)
        enrolled.append(ev)
        if submit_for_feedback:
            try:
                prepare_training_event_for_feedback(ev, employee)
            except Exception:
                frappe.log_error(title="phase74_prepare_training", message=frappe.get_traceback())
    return enrolled


def ensure_hr_performance_permissions():
    from frappe.permissions import add_permission

    perm_sets = {
        "KRA": ["read"],
        "Appraisal": ["read", "write"],
        "Appraisal Template": ["read"],
        "Appraisal Cycle": ["read"],
        "Training Program": ["read"],
        "Training Event": ["read"],
        "Training Feedback": ["read", "write", "create"],
        "Employee Feedback Criteria": ["read"],
    }
    roles = (
        "Phlebotomist",
        "Franchisee Operator",
        "Lab Technician",
        "Health System Admin",
        "System Manager",
        "Pathologist",
        "Sales Representative",
        "Sales Manager",
        "HR Manager",
        "HR User",
    )
    for doctype, ptypes in perm_sets.items():
        if not frappe.db.exists("DocType", doctype):
            continue
        for role in roles:
            for ptype in ptypes:
                try:
                    add_permission(doctype, role, permlevel=0, ptype=ptype)
                except Exception:
                    pass


def ensure_performance_workspace_links():
    ws_name = "Company Ops KPIs"
    if not frappe.db.exists("Workspace", ws_name):
        return False
    try:
        ws = frappe.get_doc("Workspace", ws_name)
        existing = {(l.link_type, l.link_to) for l in (ws.links or []) if l.link_to}
        added = False
        for doctype, label in (
            ("KRA", "KRA Library"),
            ("Appraisal Template", "Appraisal Templates"),
            ("Appraisal Cycle", "Appraisal Cycles"),
            ("Training Program", "Training Programs"),
            ("Training Event", "Training Events"),
        ):
            if not frappe.db.exists("DocType", doctype):
                continue
            key = ("DocType", doctype)
            if key in existing:
                continue
            ws.append("links", {"label": label, "link_type": "DocType", "link_to": doctype, "type": "Link"})
            added = True
        if added:
            ws.save(ignore_permissions=True)
        return True
    except Exception:
        frappe.log_error(title="phase74_workspace", message=frappe.get_traceback())
        return False


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------


def serialize_kra(name):
    if not name or not frappe.db.exists("KRA", name):
        return None
    row = frappe.db.get_value("KRA", name, ["title", "description"], as_dict=True) or {}
    return {"name": name, "title": row.get("title") or name, "description": row.get("description")}


def serialize_appraisal(docname):
    if not docname or not frappe.db.exists("Appraisal", docname):
        return None
    fields = ["employee", "employee_name", "appraisal_cycle", "appraisal_template", "company"]
    meta = frappe.get_meta("Appraisal")
    for f in ("start_date", "end_date", "final_score", "total_score", "self_score", "reflections", "docstatus"):
        if meta.has_field(f):
            fields.append(f)
    row = frappe.db.get_value("Appraisal", docname, fields, as_dict=True) or {}
    kras = []
    if meta.has_field("appraisal_kra"):
        for r in frappe.get_all(
            "Appraisal KRA",
            filters={"parent": docname},
            fields=["kra", "per_weightage", "score"] if frappe.db.has_column("Appraisal KRA", "score") else ["kra", "per_weightage"],
        ):
            kra = serialize_kra(r.get("kra"))
            if kra:
                kra["weightage"] = r.get("per_weightage")
                kra["score"] = r.get("score")
                kras.append(kra)
    self_ratings = []
    if meta.has_field("self_ratings"):
        for r in frappe.get_all(
            "Employee Feedback Rating",
            filters={"parent": docname, "parenttype": "Appraisal"},
            fields=["criteria", "rating", "per_weightage"],
        ):
            self_ratings.append(r)
    row["name"] = docname
    row["kras"] = kras
    row["self_ratings"] = self_ratings
    return row


def serialize_training_event(name):
    if not name or not frappe.db.exists("Training Event", name):
        return None
    fields = ["event_name", "training_program", "event_status", "start_time", "end_time", "type", "introduction"]
    row = frappe.db.get_value("Training Event", name, fields, as_dict=True) or {}
    row["name"] = name
    return row


def serialize_training_program(name):
    if not name:
        return None
    if frappe.db.exists("Training Program", name):
        fields = ["training_program", "status", "description"] if frappe.get_meta("Training Program").has_field("description") else ["training_program"]
        row = frappe.db.get_value("Training Program", name, fields, as_dict=True) or {}
        row["name"] = name
        return row
    return {"name": name, "training_program": name}


# ---------------------------------------------------------------------------
# ESS payloads + actions
# ---------------------------------------------------------------------------


def get_performance_hub_payload(user):
    ready = performance_ready()
    employee = ensure_employee_for_user(user) if ready else None
    out = {
        "performance_available": ready,
        "missing_modules": missing_performance_doctypes() if not ready else [],
        "employee": employee,
        "kras": [],
        "appraisals": [],
        "training_programs": [],
        "training_events": [],
        "feedback_criteria": [],
    }
    if not ready or not employee:
        return out

    # Active appraisal + KRAs
    appraisals = frappe.get_all(
        "Appraisal",
        filters={"employee": employee, "docstatus": ["<", 2]},
        fields=["name"],
        order_by="modified desc",
        limit=5,
    )
    out["appraisals"] = [serialize_appraisal(a.name) for a in appraisals if serialize_appraisal(a.name)]

    kra_seen = set()
    for app in out["appraisals"]:
        for kra in app.get("kras") or []:
            key = kra.get("name") or kra.get("title")
            if key and key not in kra_seen:
                kra_seen.add(key)
                out["kras"].append(kra)

    # Fallback: template KRAs if no appraisal yet
    if not out["kras"]:
        template = _template_for_user(user)
        if frappe.db.exists("Appraisal Template", template):
            for row in frappe.get_all(
                "Appraisal Template Goal",
                filters={"parent": template},
                fields=["key_result_area", "per_weightage"],
            ):
                kra = serialize_kra(row.key_result_area)
                if kra:
                    kra["weightage"] = row.per_weightage
                    out["kras"].append(kra)

    out["training_programs"] = [
        serialize_training_program(p.name)
        for p in frappe.get_all("Training Program", fields=["name"], limit=20, order_by="modified desc")
        if serialize_training_program(p.name)
    ]

    # Events enrolled or open
    event_names = set()
    if frappe.get_meta("Training Event").has_field("employees"):
        for row in frappe.get_all(
            "Training Event Employee",
            filters={"employee": employee},
            pluck="parent",
            limit=20,
        ):
            event_names.add(row)
    for ev in frappe.get_all(
        "Training Event",
        filters={"event_status": ["in", ["Scheduled", "Completed"]]},
        pluck="name",
        limit=20,
        order_by="start_time desc",
    ):
        event_names.add(ev)

    out["training_events"] = [
        serialize_training_event(n) for n in sorted(event_names) if serialize_training_event(n)
    ]

    if frappe.db.exists("DocType", "Employee Feedback Criteria"):
        out["feedback_criteria"] = frappe.get_all(
            "Employee Feedback Criteria",
            fields=["name", "criteria"],
            limit=20,
        )

    return out


def submit_appraisal_self_review(user, appraisal_name, reflections=None, ratings=None):
    if not performance_ready():
        frappe.throw(_("Performance module is not installed. Ask admin to run Phase 74 setup."))

    employee = ensure_employee_for_user(user)
    if not employee:
        frappe.throw(_("No employee profile linked to your user account"))
    if not frappe.db.exists("Appraisal", appraisal_name):
        frappe.throw(_("Appraisal not found"))

    owner = frappe.db.get_value("Appraisal", appraisal_name, "employee")
    if owner != employee:
        frappe.throw(_("Not permitted"))

    doc = frappe.get_doc("Appraisal", appraisal_name)
    meta = frappe.get_meta("Appraisal")

    if reflections and meta.has_field("reflections"):
        doc.reflections = reflections

    if ratings and meta.has_field("self_ratings"):
        import json

        if isinstance(ratings, str):
            ratings = json.loads(ratings)
        doc.set("self_ratings", [])
        for row in ratings or []:
            criteria = row.get("criteria")
            if not criteria:
                continue
            doc.append(
                "self_ratings",
                {
                    "criteria": criteria,
                    "rating": flt(row.get("rating")),
                    "per_weightage": flt(row.get("per_weightage") or row.get("weightage") or 0),
                },
            )

    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return serialize_appraisal(doc.name)


def submit_training_feedback(user, training_event, rating=None, feedback=None):
    from health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair import ensure_hrms_modules

    if not frappe.db.exists("DocType", "Training Feedback"):
        frappe.throw(_("Training Feedback is not available"))

    ensure_hrms_modules()
    employee = ensure_employee_for_user(user)
    if not employee:
        frappe.throw(_("No employee profile linked to your user account"))
    if not frappe.db.exists("Training Event", training_event):
        frappe.throw(_("Training event not found"))

    prepare_training_event_for_feedback(training_event, employee)

    meta = frappe.get_meta("Training Feedback")
    text = feedback or ""
    if rating is not None:
        text = f"Rating: {flt(rating)}/5. {text}".strip()
    if not text:
        text = "Submitted via HEC staff portal"

    filters = {"employee": employee, "docstatus": ["<", 2]}
    if meta.has_field("training_event"):
        filters["training_event"] = training_event
    elif meta.has_field("event"):
        filters["event"] = training_event
    existing = frappe.db.exists("Training Feedback", filters)

    if existing:
        doc = frappe.get_doc("Training Feedback", existing)
        if meta.has_field("feedback"):
            doc.feedback = text
        elif meta.has_field("comments"):
            doc.comments = text
        doc.save(ignore_permissions=True)
        if doc.docstatus == 0:
            doc.submit()
        frappe.db.commit()
        return {"ok": True, "training_feedback": doc.name, "updated": True}

    row = {"doctype": "Training Feedback", "employee": employee}
    if meta.has_field("training_event"):
        row["training_event"] = training_event
    elif meta.has_field("event"):
        row["event"] = training_event
    if meta.has_field("feedback"):
        row["feedback"] = text
    elif meta.has_field("comments"):
        row["comments"] = text

    doc = frappe.get_doc(row)
    doc.insert(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    return {"ok": True, "training_feedback": doc.name}


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


def setup_phase74():
    from health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair import ensure_hrms_modules

    ensure_hrms_modules()
    imported = _ensure_perf_doctypes()
    missing = missing_performance_doctypes()
    if missing:
        return {
            "ok": False,
            "phase": 74,
            "missing_modules": missing,
            "imported": imported,
            "hint": "Run HRMS repair / migrate, then re-run Phase 74",
        }

    kras = ensure_kras()
    criteria = ensure_feedback_criteria()
    templates = ensure_appraisal_templates()
    cycle = ensure_appraisal_cycle()
    programs = ensure_training_programs()
    events = ensure_training_events()
    ensure_hr_performance_permissions()
    ensure_performance_workspace_links()

    appraisals = []
    enrollments = []
    for email in (
        "phlebotomist@health.local",
        "franchise_hub@health.local",
        "lab_tech@health.local",
    ):
        if not frappe.db.exists("User", email):
            continue
        try:
            emp = ensure_employee_for_user(email)
            if emp:
                appraisals.append(ensure_appraisal_for_employee(emp, cycle))
                enrolled = enroll_employee_in_events(emp, submit_for_feedback=True)
                enrollments.extend(enrolled)
                if enrolled:
                    try:
                        prepare_training_event_for_feedback(enrolled[0], emp)
                    except Exception:
                        frappe.log_error(title="phase74_seed_training", message=frappe.get_traceback())
        except Exception:
            frappe.log_error(title="phase74_staff_seed", message=frappe.get_traceback())

    frappe.db.commit()
    return {
        "ok": True,
        "phase": 74,
        "imported": imported,
        "kras_created": kras,
        "criteria_created": criteria,
        "templates_created": templates,
        "appraisal_cycle": cycle,
        "programs_created": programs,
        "events_created": events,
        "appraisals": [a for a in appraisals if a],
        "enrollments": enrollments,
    }


def smoke_phase74():
    result = {"ok": True, "checks": []}

    def check(name, cond, detail=""):
        result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
        if not cond:
            result["ok"] = False

    setup = setup_phase74()
    check("setup", setup.get("ok"), str(setup.get("missing_modules") or "ok"))
    check("performance_ready", performance_ready(), str(missing_performance_doctypes()))
    for dt in PERF_DOCTYPES:
        check(f"doctype_{dt}", frappe.db.exists("DocType", dt))

    user = "phlebotomist@health.local" if frappe.db.exists("User", "phlebotomist@health.local") else frappe.session.user
    try:
        payload = get_performance_hub_payload(user)
        check("hub_payload", isinstance(payload, dict), str(list(payload.keys())[:10]))
        check("has_kras_or_template", bool(payload.get("kras")), str(len(payload.get("kras") or [])))
    except Exception as exc:
        check("hub_payload", False, str(exc)[:160])

    return result
