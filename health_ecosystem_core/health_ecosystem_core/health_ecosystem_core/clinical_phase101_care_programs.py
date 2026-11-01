"""Phase 101 — Digital Therapeutics / Care Programs (GoodFlip-style chronic care)."""

from __future__ import annotations

import json
from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff

TEMPLATE_DT = "Care Program Template"
ENROLL_DT = "Care Enrollment"
VITAL_DT = "Patient Vital Log"
TASK_DT = "Care Task Log"

PROGRAM_SEEDS = (
    {
        "program_code": "DIABETES",
        "title": "Diabetes Care Program",
        "condition": "Diabetes",
        "duration_days": 90,
        "description": "Glycemic tracking, daily tasks, and coach follow-up for type 2 diabetes.",
        "goal_metrics_json": json.dumps(
            {"fasting_glucose_max": 130, "hba1c_max": 7.0, "weight_loss_kg": 3}
        ),
        "task_library_json": json.dumps(
            [
                {"code": "log_glucose", "title": "Log fasting glucose", "cadence": "daily"},
                {"code": "walk_20", "title": "Walk 20 minutes", "cadence": "daily"},
                {"code": "meds", "title": "Take prescribed medicines", "cadence": "daily"},
            ]
        ),
        "assessment_json": json.dumps(
            [
                {"id": "years", "label": "Years since diagnosis", "type": "number"},
                {"id": "on_insulin", "label": "On insulin?", "type": "yesno"},
            ]
        ),
        "vital_ranges_json": json.dumps(
            {
                "glucose": {"min": 70, "max": 180},
                "weight": {"min": 30, "max": 200},
                "bp_systolic": {"min": 90, "max": 140},
            }
        ),
    },
    {
        "program_code": "NAFLD",
        "title": "Fatty Liver Care Program",
        "condition": "NAFLD",
        "duration_days": 90,
        "description": "Lifestyle tasks and weight tracking for NAFLD / fatty liver.",
        "goal_metrics_json": json.dumps({"weight_loss_kg": 5, "alt_max": 40}),
        "task_library_json": json.dumps(
            [
                {"code": "log_weight", "title": "Log weight", "cadence": "daily"},
                {"code": "no_fried", "title": "Avoid fried / sugary foods", "cadence": "daily"},
                {"code": "activity", "title": "30 min activity", "cadence": "daily"},
            ]
        ),
        "assessment_json": json.dumps(
            [
                {"id": "alcohol", "label": "Alcohol use?", "type": "yesno"},
                {"id": "bmi", "label": "Approximate BMI", "type": "number"},
            ]
        ),
        "vital_ranges_json": json.dumps({"weight": {"min": 30, "max": 200}, "glucose": {"min": 70, "max": 160}}),
    },
)


def _ensure_doctype(name, fields, autoname, permissions=None):
    if frappe.db.exists("DocType", name):
        return False
    doc = frappe.get_doc(
        {
            "doctype": "DocType",
            "name": name,
            "module": "Health Ecosystem Core",
            "custom": 0,
            "autoname": autoname,
            "naming_rule": (
                "Expression"
                if autoname.startswith("format:")
                else ("By fieldname" if autoname.startswith("field:") else "Random")
            ),
            "engine": "InnoDB",
            "track_changes": 1,
            "fields": fields,
            "permissions": permissions
            or [
                {
                    "role": "System Manager",
                    "read": 1,
                    "write": 1,
                    "create": 1,
                    "delete": 1,
                    "export": 1,
                    "report": 1,
                },
                {
                    "role": "Health System Admin",
                    "read": 1,
                    "write": 1,
                    "create": 1,
                    "export": 1,
                    "report": 1,
                },
                {"role": "Physician", "read": 1, "write": 1, "create": 1, "report": 1},
            ],
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.clear_cache(doctype=name)
    return True


def ensure_phase101_doctypes():
    created = []
    if _ensure_doctype(
        TEMPLATE_DT,
        [
            {"fieldname": "program_code", "label": "Program Code", "fieldtype": "Data", "reqd": 1, "unique": 1, "in_list_view": 1},
            {"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
            {"fieldname": "condition", "label": "Condition", "fieldtype": "Select", "options": "Diabetes\nNAFLD\nPCOS\nObesity\nCOPD\nAsthma\nOther", "in_list_view": 1},
            {"fieldname": "enabled", "label": "Enabled", "fieldtype": "Check", "default": "1"},
            {"fieldname": "duration_days", "label": "Duration (days)", "fieldtype": "Int", "default": "90"},
            {"fieldname": "description", "label": "Description", "fieldtype": "Small Text"},
            {"fieldname": "linked_item", "label": "Sellable Item", "fieldtype": "Link", "options": "Item"},
            {"fieldname": "assessment_json", "label": "Assessment JSON", "fieldtype": "Long Text"},
            {"fieldname": "goal_metrics_json", "label": "Goal Metrics JSON", "fieldtype": "Long Text"},
            {"fieldname": "task_library_json", "label": "Task Library JSON", "fieldtype": "Long Text"},
            {"fieldname": "vital_ranges_json", "label": "Vital Ranges JSON", "fieldtype": "Long Text"},
        ],
        "field:program_code",
    ):
        created.append(TEMPLATE_DT)

    if _ensure_doctype(
        ENROLL_DT,
        [
            {"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": "Health Patient", "reqd": 1, "in_list_view": 1},
            {"fieldname": "program", "label": "Program", "fieldtype": "Link", "options": TEMPLATE_DT, "reqd": 1, "in_list_view": 1},
            {"fieldname": "assigned_doctor", "label": "Assigned Doctor", "fieldtype": "Link", "options": "Doctor"},
            {"fieldname": "assigned_coach", "label": "Assigned Coach", "fieldtype": "Link", "options": "User"},
            {"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Active\nCompleted\nPaused\nCancelled", "default": "Active", "in_list_view": 1},
            {"fieldname": "start_date", "label": "Start Date", "fieldtype": "Date", "default": "Today", "in_list_view": 1},
            {"fieldname": "end_date", "label": "End Date", "fieldtype": "Date"},
            {"fieldname": "health_score", "label": "Health Score", "fieldtype": "Float", "default": "50"},
            {"fieldname": "adherence_percent", "label": "Adherence %", "fieldtype": "Float", "default": "0"},
            {"fieldname": "assessment_answers_json", "label": "Assessment Answers", "fieldtype": "Long Text"},
            {"fieldname": "study_protocol", "label": "Study Protocol", "fieldtype": "Data"},
            {"fieldname": "study_consent", "label": "Study Consent", "fieldtype": "Check", "default": "0"},
        ],
        "format:HEC-CARE-{YYYY}-{#####}",
    ):
        created.append(ENROLL_DT)

    if _ensure_doctype(
        VITAL_DT,
        [
            {"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": "Health Patient", "reqd": 1, "in_list_view": 1},
            {"fieldname": "enrollment", "label": "Enrollment", "fieldtype": "Link", "options": ENROLL_DT},
            {"fieldname": "vital_type", "label": "Vital Type", "fieldtype": "Select", "options": "glucose\nbp_systolic\nbp_diastolic\nweight\nspo2\nhba1c\nother", "reqd": 1, "in_list_view": 1},
            {"fieldname": "value", "label": "Value", "fieldtype": "Float", "reqd": 1, "in_list_view": 1},
            {"fieldname": "unit", "label": "Unit", "fieldtype": "Data"},
            {"fieldname": "source", "label": "Source", "fieldtype": "Select", "options": "manual\ndevice\nlab", "default": "manual"},
            {"fieldname": "recorded_at", "label": "Recorded At", "fieldtype": "Datetime", "default": "Now", "in_list_view": 1},
            {"fieldname": "out_of_range", "label": "Out of Range", "fieldtype": "Check", "default": "0"},
            {"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
        ],
        "format:HEC-VIT-{YYYY}-{#####}",
        permissions=[
            {"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1, "export": 1, "report": 1},
            {"role": "Health System Admin", "read": 1, "write": 1, "create": 1, "export": 1, "report": 1},
            {"role": "Physician", "read": 1, "write": 1, "create": 1, "report": 1},
            {"role": "Patient", "read": 1, "write": 1, "create": 1},
        ],
    ):
        created.append(VITAL_DT)

    if _ensure_doctype(
        TASK_DT,
        [
            {"fieldname": "enrollment", "label": "Enrollment", "fieldtype": "Link", "options": ENROLL_DT, "reqd": 1, "in_list_view": 1},
            {"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": "Health Patient", "reqd": 1},
            {"fieldname": "task_code", "label": "Task Code", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
            {"fieldname": "task_title", "label": "Task Title", "fieldtype": "Data", "in_list_view": 1},
            {"fieldname": "task_date", "label": "Task Date", "fieldtype": "Date", "default": "Today", "in_list_view": 1},
            {"fieldname": "completed", "label": "Completed", "fieldtype": "Check", "default": "0", "in_list_view": 1},
            {"fieldname": "completed_at", "label": "Completed At", "fieldtype": "Datetime"},
        ],
        "format:HEC-TSK-{YYYY}-{#####}",
        permissions=[
            {"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1, "export": 1, "report": 1},
            {"role": "Health System Admin", "read": 1, "write": 1, "create": 1, "export": 1, "report": 1},
            {"role": "Physician", "read": 1, "write": 1, "create": 1, "report": 1},
            {"role": "Patient", "read": 1, "write": 1, "create": 1},
        ],
    ):
        created.append(TASK_DT)

    return created


def seed_care_programs():
    ensure_phase101_doctypes()
    seeded = []
    for spec in PROGRAM_SEEDS:
        code = spec["program_code"]
        if frappe.db.exists(TEMPLATE_DT, code):
            doc = frappe.get_doc(TEMPLATE_DT, code)
            for k, v in spec.items():
                doc.set(k, v)
            doc.enabled = 1
            doc.save(ignore_permissions=True)
        else:
            frappe.get_doc({"doctype": TEMPLATE_DT, "enabled": 1, **spec}).insert(ignore_permissions=True)
        seeded.append(code)
    frappe.db.commit()
    return seeded


def _patient_for_user():
    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

    profile = patient_profile_for_user()
    return profile.get("patient_id") if profile else None


def _json_loads(raw, default=None):
    if default is None:
        default = {}
    if not raw:
        return default
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return default


def _serialize_program(name):
    doc = frappe.get_doc(TEMPLATE_DT, name)
    return {
        "program_code": doc.program_code or doc.name,
        "name": doc.name,
        "title": doc.title,
        "condition": doc.condition,
        "description": doc.description,
        "duration_days": cint(doc.duration_days),
        "enabled": cint(doc.enabled),
        "assessment": _json_loads(doc.assessment_json, []),
        "goal_metrics": _json_loads(doc.goal_metrics_json, {}),
        "task_library": _json_loads(doc.task_library_json, []),
        "vital_ranges": _json_loads(doc.vital_ranges_json, {}),
    }


def _serialize_enrollment(name):
    doc = frappe.get_doc(ENROLL_DT, name)
    program = _serialize_program(doc.program) if doc.program else None
    return {
        "name": doc.name,
        "patient": doc.patient,
        "program": program,
        "assigned_doctor": doc.assigned_doctor,
        "assigned_coach": doc.assigned_coach,
        "status": doc.status,
        "start_date": str(doc.start_date) if doc.start_date else None,
        "end_date": str(doc.end_date) if doc.end_date else None,
        "health_score": flt(doc.health_score),
        "adherence_percent": flt(doc.adherence_percent),
        "study_protocol": getattr(doc, "study_protocol", None),
        "study_consent": cint(getattr(doc, "study_consent", 0)),
    }


def _compute_health_score(enrollment_name):
    enc = frappe.get_doc(ENROLL_DT, enrollment_name)
    program = frappe.get_doc(TEMPLATE_DT, enc.program)
    ranges = _json_loads(program.vital_ranges_json, {})

    vitals = frappe.get_all(
        VITAL_DT,
        filters={"enrollment": enrollment_name},
        fields=["vital_type", "value", "out_of_range", "recorded_at"],
        order_by="recorded_at desc",
        limit=30,
    )
    in_range = 0
    total_v = 0
    for v in vitals:
        total_v += 1
        if not cint(v.out_of_range):
            in_range += 1

    since = getdate(today()) - timedelta(days=7)
    tasks = frappe.get_all(
        TASK_DT,
        filters={"enrollment": enrollment_name, "task_date": [">=", since]},
        fields=["completed"],
    )
    done = sum(1 for t in tasks if cint(t.completed))
    adherence = (done / len(tasks) * 100.0) if tasks else 0.0
    vital_score = (in_range / total_v * 100.0) if total_v else 50.0
    score = round(0.55 * vital_score + 0.45 * adherence, 1)

    enc.health_score = score
    enc.adherence_percent = round(adherence, 1)
    enc.save(ignore_permissions=True)
    return score, adherence, ranges


def _check_out_of_range(program_name, vital_type, value):
    program = frappe.get_doc(TEMPLATE_DT, program_name)
    ranges = _json_loads(program.vital_ranges_json, {})
    spec = ranges.get(vital_type) or {}
    lo = spec.get("min")
    hi = spec.get("max")
    val = flt(value)
    if lo is not None and val < flt(lo):
        return True
    if hi is not None and val > flt(hi):
        return True
    return False


def _notify_oob(enrollment_name, vital_type, value):
    try:
        enc = frappe.get_doc(ENROLL_DT, enrollment_name)
        patient_phone = frappe.db.get_value("Health Patient", enc.patient, "mobile")
        msg = (
            f"e-Remedium Care alert: your {vital_type} reading ({value}) is outside the program range. "
            f"Please follow up with your care team."
        )
        if patient_phone:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import (
                send_whatsapp,
            )

            send_whatsapp(patient_phone, msg)
        # Notify assigned doctor via notification log if possible
        if enc.assigned_doctor:
            user = frappe.db.get_value("Doctor", enc.assigned_doctor, "user")
            if user:
                frappe.get_doc(
                    {
                        "doctype": "Notification Log",
                        "subject": f"Care alert: {vital_type} OOB for {enc.patient}",
                        "email_content": msg,
                        "for_user": user,
                        "type": "Alert",
                        "document_type": ENROLL_DT,
                        "document_name": enc.name,
                    }
                ).insert(ignore_permissions=True)
    except Exception:
        frappe.log_error(title="care_oob_notify", message=frappe.get_traceback())


@frappe.whitelist()
def list_care_programs(sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    ensure_phase101_doctypes()
    names = frappe.get_all(TEMPLATE_DT, filters={"enabled": 1}, pluck="name", order_by="title asc")
    return _success({"programs": [_serialize_program(n) for n in names]})


@frappe.whitelist()
def enroll_care_program(program_code=None, assessment_answers=None, assigned_doctor=None, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    ensure_phase101_doctypes()
    patient = _patient_for_user()
    if not patient and not is_staff(_user_roles()):
        return _error(_("Patient profile required"))
    if not patient:
        # staff must pass patient via assessment? keep simple — require patient user
        return _error(_("Patient profile required"))

    program_code = (_parse_request_value("program_code", program_code) or "").strip()
    if not program_code or not frappe.db.exists(TEMPLATE_DT, program_code):
        return _error(_("Invalid care program"))

    active = frappe.db.exists(
        ENROLL_DT, {"patient": patient, "program": program_code, "status": "Active"}
    )
    if active:
        return _success({"enrollment": _serialize_enrollment(active), "already": True})

    program = frappe.get_doc(TEMPLATE_DT, program_code)
    end = getdate(today()) + timedelta(days=cint(program.duration_days) or 90)
    answers = assessment_answers
    if isinstance(answers, str):
        try:
            answers = json.loads(answers)
        except Exception:
            answers = {"raw": answers}

    doc = frappe.get_doc(
        {
            "doctype": ENROLL_DT,
            "patient": patient,
            "program": program_code,
            "assigned_doctor": _parse_request_value("assigned_doctor", assigned_doctor),
            "status": "Active",
            "start_date": today(),
            "end_date": end,
            "health_score": 50,
            "assessment_answers_json": json.dumps(answers or {}),
        }
    )
    doc.insert(ignore_permissions=True)

    # Seed today's tasks
    for task in _json_loads(program.task_library_json, []):
        frappe.get_doc(
            {
                "doctype": TASK_DT,
                "enrollment": doc.name,
                "patient": patient,
                "task_code": task.get("code") or "task",
                "task_title": task.get("title") or task.get("code"),
                "task_date": today(),
                "completed": 0,
            }
        ).insert(ignore_permissions=True)

    frappe.db.commit()
    return _success({"enrollment": _serialize_enrollment(doc.name)}, message=_("Enrolled"))


@frappe.whitelist()
def get_my_care_enrollments(sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    ensure_phase101_doctypes()
    patient = _patient_for_user()
    if not patient:
        return _success({"enrollments": []})
    names = frappe.get_all(
        ENROLL_DT,
        filters={"patient": patient, "status": ["!=", "Cancelled"]},
        pluck="name",
        order_by="creation desc",
    )
    return _success({"enrollments": [_serialize_enrollment(n) for n in names]})


@frappe.whitelist()
def log_patient_vital(
    enrollment_id=None,
    vital_type=None,
    value=None,
    unit=None,
    notes=None,
    sid=None,
):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    ensure_phase101_doctypes()
    patient = _patient_for_user()
    enrollment_id = (_parse_request_value("enrollment_id", enrollment_id) or "").strip()
    vital_type = (_parse_request_value("vital_type", vital_type) or "").strip()
    value = flt(_parse_request_value("value", value))

    if not enrollment_id or not frappe.db.exists(ENROLL_DT, enrollment_id):
        return _error(_("Enrollment not found"), 404)
    enc = frappe.get_doc(ENROLL_DT, enrollment_id)
    if patient and enc.patient != patient and not is_staff(_user_roles()):
        return _error(_("Not authorized"), 403)
    if not vital_type:
        return _error(_("vital_type required"))

    oob = _check_out_of_range(enc.program, vital_type, value)
    row = frappe.get_doc(
        {
            "doctype": VITAL_DT,
            "patient": enc.patient,
            "enrollment": enc.name,
            "vital_type": vital_type,
            "value": value,
            "unit": _parse_request_value("unit", unit),
            "source": "manual",
            "recorded_at": now_datetime(),
            "out_of_range": 1 if oob else 0,
            "notes": _parse_request_value("notes", notes),
        }
    )
    row.insert(ignore_permissions=True)
    score, adherence, _ = _compute_health_score(enc.name)
    if oob:
        _notify_oob(enc.name, vital_type, value)
    frappe.db.commit()
    return _success(
        {
            "vital": {
                "name": row.name,
                "vital_type": vital_type,
                "value": value,
                "out_of_range": oob,
            },
            "health_score": score,
            "adherence_percent": adherence,
        }
    )


@frappe.whitelist()
def get_care_dashboard(enrollment_id=None, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    ensure_phase101_doctypes()
    enrollment_id = (_parse_request_value("enrollment_id", enrollment_id) or "").strip()
    if not enrollment_id or not frappe.db.exists(ENROLL_DT, enrollment_id):
        return _error(_("Enrollment not found"), 404)

    enc = frappe.get_doc(ENROLL_DT, enrollment_id)
    patient = _patient_for_user()
    roles = _user_roles()
    if patient and enc.patient != patient and not is_staff(roles) and "Physician" not in roles:
        return _error(_("Not authorized"), 403)

    _compute_health_score(enc.name)
    enc.reload()

    vitals = frappe.get_all(
        VITAL_DT,
        filters={"enrollment": enrollment_id},
        fields=["name", "vital_type", "value", "unit", "recorded_at", "out_of_range"],
        order_by="recorded_at desc",
        limit=50,
    )
    tasks = frappe.get_all(
        TASK_DT,
        filters={"enrollment": enrollment_id, "task_date": today()},
        fields=["name", "task_code", "task_title", "completed", "task_date"],
        order_by="creation asc",
    )
    # Ensure today's tasks exist
    if not tasks:
        program = frappe.get_doc(TEMPLATE_DT, enc.program)
        for task in _json_loads(program.task_library_json, []):
            frappe.get_doc(
                {
                    "doctype": TASK_DT,
                    "enrollment": enc.name,
                    "patient": enc.patient,
                    "task_code": task.get("code") or "task",
                    "task_title": task.get("title") or task.get("code"),
                    "task_date": today(),
                    "completed": 0,
                }
            ).insert(ignore_permissions=True)
        frappe.db.commit()
        tasks = frappe.get_all(
            TASK_DT,
            filters={"enrollment": enrollment_id, "task_date": today()},
            fields=["name", "task_code", "task_title", "completed", "task_date"],
            order_by="creation asc",
        )

    return _success(
        {
            "enrollment": _serialize_enrollment(enc.name),
            "vitals": [
                {
                    "name": v.name,
                    "vital_type": v.vital_type,
                    "value": v.value,
                    "unit": v.unit,
                    "recorded_at": str(v.recorded_at) if v.recorded_at else None,
                    "out_of_range": cint(v.out_of_range),
                }
                for v in vitals
            ],
            "tasks": [
                {
                    "name": t.name,
                    "task_code": t.task_code,
                    "task_title": t.task_title,
                    "completed": cint(t.completed),
                    "task_date": str(t.task_date) if t.task_date else None,
                }
                for t in tasks
            ],
        }
    )


@frappe.whitelist()
def complete_care_task(task_id=None, sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    task_id = (_parse_request_value("task_id", task_id) or "").strip()
    if not task_id or not frappe.db.exists(TASK_DT, task_id):
        return _error(_("Task not found"), 404)
    task = frappe.get_doc(TASK_DT, task_id)
    patient = _patient_for_user()
    if patient and task.patient != patient and not is_staff(_user_roles()):
        return _error(_("Not authorized"), 403)
    task.completed = 1
    task.completed_at = now_datetime()
    task.save(ignore_permissions=True)
    score, adherence, _ = _compute_health_score(task.enrollment)
    frappe.db.commit()
    return _success({"task_id": task.name, "health_score": score, "adherence_percent": adherence})


@frappe.whitelist()
def get_patient_care_strip(patient_id=None, sid=None):
    """Provider-facing strip: active enrollments + recent OOB vitals."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = _user_roles()
    if "Physician" not in roles and not is_staff(roles):
        return _error(_("Not authorized"), 403)
    ensure_phase101_doctypes()
    patient_id = (_parse_request_value("patient_id", patient_id) or "").strip()
    if not patient_id:
        return _success({"enrollments": [], "alerts": []})
    enrollments = frappe.get_all(
        ENROLL_DT,
        filters={"patient": patient_id, "status": "Active"},
        pluck="name",
    )
    alerts = frappe.get_all(
        VITAL_DT,
        filters={"patient": patient_id, "out_of_range": 1},
        fields=["vital_type", "value", "recorded_at", "enrollment"],
        order_by="recorded_at desc",
        limit=10,
    )
    return _success(
        {
            "enrollments": [_serialize_enrollment(n) for n in enrollments],
            "alerts": [
                {
                    "vital_type": a.vital_type,
                    "value": a.value,
                    "recorded_at": str(a.recorded_at) if a.recorded_at else None,
                    "enrollment": a.enrollment,
                }
                for a in alerts
            ],
        }
    )


def run_care_oob_alerts():
    """Scheduled-friendly: re-notify recent OOB vitals from last hour (idempotent-ish)."""
    ensure_phase101_doctypes()
    since = now_datetime() - timedelta(hours=1)
    rows = frappe.get_all(
        VITAL_DT,
        filters={"out_of_range": 1, "recorded_at": [">=", since]},
        fields=["enrollment", "vital_type", "value"],
        limit=50,
    )
    for r in rows:
        if r.enrollment:
            _notify_oob(r.enrollment, r.vital_type, r.value)
    return {"ok": True, "notified": len(rows)}


def setup_phase101_care_programs():
    created = ensure_phase101_doctypes()
    seeded = seed_care_programs()
    return {"ok": True, "phase": "101", "created": created, "seeded": seeded}


def smoke_phase101_care_programs():
    setup = setup_phase101_care_programs()
    programs = frappe.get_all(TEMPLATE_DT, pluck="name") if frappe.db.exists("DocType", TEMPLATE_DT) else []
    return {"ok": True, "phase": "101", "setup": setup, "programs": programs}
