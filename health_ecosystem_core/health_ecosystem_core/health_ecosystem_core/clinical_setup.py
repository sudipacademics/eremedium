"""
Native clinical module setup — replaces Marley Healthcare dependency.
Run: bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_setup.setup_clinical_module
"""

import json

import frappe

CLINICAL_ROLES = [
    ("Physician", "Doctor / consultant access"),
    ("Nurse", "Nursing assessment and intake"),
    ("Phlebotomist", "Sample collection assignment"),
    ("Pathologist", "Lab report authorization"),
]

SEED_DEPARTMENTS = [
    ("General Medicine", "Outpatient and general consultations"),
    ("Pathology", "Laboratory diagnostics"),
    ("Radiology", "Imaging diagnostics"),
    ("Cardiology", "Cardiac care"),
]

SEED_CONSULTATION_TYPES = [
    ("OPD Consultation", 15),
    ("Follow-up", 10),
    ("Teleconsultation", 15),
]


def setup_clinical_module(seed_demo=True):
    ensure_clinical_roles()
    ensure_item_salt_fields()
    ensure_patient_link_fields()
    from health_ecosystem_core.health_ecosystem_core.cors import ensure_cors_config

    ensure_cors_config()
    frappe.db.commit()
    if seed_demo:
        seed_clinical_masters(seed_panels=seed_demo)
    setup_clinical_workspace()
    frappe.db.commit()
    frappe.clear_cache()
    return {"ok": True, "desk": "/app/clinical"}


def ensure_clinical_roles():
    for role_name, description in CLINICAL_ROLES:
        if frappe.db.exists("Role", role_name):
            continue
        frappe.get_doc(
            {"doctype": "Role", "role_name": role_name, "desk_access": 1, "description": description}
        ).insert(ignore_permissions=True)


def ensure_item_salt_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Item": [
                {
                    "fieldname": "generic_name",
                    "label": "Salt / Generic Name",
                    "fieldtype": "Data",
                    "insert_after": "item_name",
                }
            ],
            "Item Group": [
                {
                    "fieldname": "generic_name",
                    "label": "Default Salt / Generic",
                    "fieldtype": "Data",
                    "insert_after": "item_group_name",
                }
            ],
        },
        update=True,
    )


def _remove_obsolete_marley_custom_fields():
    """Drop Marley Patient links that break after healthcare uninstall."""
    obsolete = [
        ("Customer TRF", "patient"),
        ("Pharmacy Order", "patient"),
        ("User", "hec_patient"),
    ]
    for dt, fieldname in obsolete:
        cf = frappe.db.get_value("Custom Field", {"dt": dt, "fieldname": fieldname})
        if cf:
            frappe.delete_doc("Custom Field", cf, ignore_permissions=True, force=True)
    frappe.clear_cache(doctype="Customer TRF")
    frappe.clear_cache(doctype="Pharmacy Order")
    frappe.clear_cache(doctype="User")


def ensure_patient_link_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    _remove_obsolete_marley_custom_fields()

    create_custom_fields(
        {
            "Customer TRF": [
                {
                    "fieldname": "health_patient",
                    "label": "Health Patient",
                    "fieldtype": "Link",
                    "options": "Health Patient",
                    "insert_after": "patient_name",
                    "read_only": 1,
                },
                {
                    "fieldname": "care_journey",
                    "label": "Patient Care Journey",
                    "fieldtype": "Link",
                    "options": "Patient Care Journey",
                    "insert_after": "sales_order",
                },
                {
                    "fieldname": "payment_method",
                    "label": "Payment Method",
                    "fieldtype": "Select",
                    "options": "Online\nCash on Delivery\nPay at Hub",
                    "default": "Online",
                    "insert_after": "razorpay_payment_status",
                    "in_list_view": 1,
                },
            ],
            "Pharmacy Order": [
                {
                    "fieldname": "health_patient",
                    "label": "Health Patient",
                    "fieldtype": "Link",
                    "options": "Health Patient",
                    "insert_after": "customer_name",
                    "read_only": 1,
                },
                {
                    "fieldname": "payment_method",
                    "label": "Payment Method",
                    "fieldtype": "Select",
                    "options": "Online\nCash on Delivery\nPay at Hub",
                    "default": "Online",
                    "insert_after": "razorpay_payment_status",
                    "in_list_view": 1,
                },
            ],
            "User": [
                {
                    "fieldname": "hec_health_patient",
                    "label": "Linked Health Patient",
                    "fieldtype": "Link",
                    "options": "Health Patient",
                    "insert_after": "mobile_no",
                    "read_only": 1,
                },
                {
                    "fieldname": "hec_franchisee_hub",
                    "label": "Franchisee Hub",
                    "fieldtype": "Link",
                    "options": "Franchisee Profile",
                    "insert_after": "hec_health_patient",
                    "description": "Collection centre for phlebotomist staff",
                },
            ],
            "Franchisee Profile": [
                {
                    "fieldname": "default_phlebotomist",
                    "label": "Default Phlebotomist",
                    "fieldtype": "Link",
                    "options": "User",
                    "insert_after": "linked_user",
                    "description": "Receives home-collection orders for this hub",
                },
            ],
        },
        update=True,
    )


def seed_doctor_schedule_slots():
    """Seed weekday OPD windows for active doctors (idempotent)."""
    if not frappe.db.exists("DocType", "Doctor Schedule Slot"):
        return
    dept = frappe.db.get_value("Clinical Department", {"department_name": "General Medicine"})
    ctype = frappe.db.get_value("Consultation Type", {"consultation_type": "OPD Consultation"})
    for doctor in frappe.get_all("Doctor", filters={"status": "Active"}, pluck="name", limit=20):
        doctor_dept = frappe.db.get_value("Doctor", doctor, "primary_department") or dept
        for day in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday"):
            if frappe.db.exists(
                "Doctor Schedule Slot",
                {"doctor": doctor, "day_of_week": day, "from_time": "09:00:00"},
            ):
                continue
            frappe.get_doc(
                {
                    "doctype": "Doctor Schedule Slot",
                    "doctor": doctor,
                    "department": doctor_dept,
                    "day_of_week": day,
                    "from_time": "09:00:00",
                    "to_time": "13:00:00",
                    "slot_duration": 15,
                    "consultation_type": ctype,
                    "is_active": 1,
                }
            ).insert(ignore_permissions=True)


def seed_diagnostic_masters_from_items():
    """Create Diagnostic Test Master rows from lab Items (idempotent)."""
    if not frappe.db.exists("DocType", "Diagnostic Test Master"):
        return
    pathology = frappe.db.get_value("Clinical Department", {"department_name": "Pathology"})
    if not pathology:
        pathology = frappe.db.get_value("Clinical Department", {"department_name": ["like", "%Path%"]})

    lab_groups = ("Lab Tests", "Laboratory", "Diagnostics", "Lab")
    for item in frappe.get_all(
        "Item",
        filters={"item_group": ["in", lab_groups], "disabled": 0},
        fields=["name", "item_name", "description"],
        limit=50,
    ):
        if frappe.db.exists("Diagnostic Test Master", item.item_name):
            continue
        lis_code = None
        if item.description and str(item.description).startswith("LIS:"):
            lis_code = str(item.description).split(":", 1)[1].strip()
        doc = frappe.get_doc(
            {
                "doctype": "Diagnostic Test Master",
                "test_name": item.item_name,
                "department": pathology,
                "item": item.name,
                "lis_code": lis_code or item.name,
            }
        )
        doc.insert(ignore_permissions=True)


def seed_therapeutic_templates():
    if not frappe.db.exists("DocType", "Therapeutic Template"):
        return
    if frappe.db.exists("Therapeutic Template", "General OPD Pack"):
        return
    dept = frappe.db.get_value("Clinical Department", {"department_name": "General Medicine"})
    medicines = []
    for item in frappe.get_all(
        "Item",
        filters={"item_group": ["in", ("Medicines", "Medicine", "Pharmacy")], "disabled": 0},
        pluck="name",
        limit=3,
    ):
        medicines.append(
            {"medicine_item": item, "dosage": "1 tab", "duration": "5 days", "frequency": "BD", "instructions": "After food"}
        )
    if not medicines:
        return
    frappe.get_doc(
        {
            "doctype": "Therapeutic Template",
            "template_name": "General OPD Pack",
            "department": dept,
            "description": "Starter OPD medicine template",
            "medicines": medicines,
        }
    ).insert(ignore_permissions=True)


def seed_clinical_masters(seed_panels=True):
    for dept_name, desc in SEED_DEPARTMENTS:
        if not frappe.db.exists("Clinical Department", dept_name):
            frappe.get_doc(
                {"doctype": "Clinical Department", "department_name": dept_name, "description": desc}
            ).insert(ignore_permissions=True)

    for ctype, duration in SEED_CONSULTATION_TYPES:
        if not frappe.db.exists("Consultation Type", ctype):
            frappe.get_doc(
                {
                    "doctype": "Consultation Type",
                    "consultation_type": ctype,
                    "default_duration": duration,
                }
            ).insert(ignore_permissions=True)

    if not frappe.get_all("Doctor", limit=1):
        dept = frappe.db.get_value("Clinical Department", {"department_name": "General Medicine"})
        doc = frappe.get_doc(
            {
                "doctype": "Doctor",
                "doctor_name": "Dr. Demo Physician",
                "primary_department": dept,
                "status": "Active",
                "specialities": [
                    {
                        "department": dept,
                        "consultation_type": "OPD Consultation",
                        "service_label": "General Physician",
                    }
                ],
            }
        )
        doc.insert(ignore_permissions=True)

    seed_diagnostic_masters_from_items()
    seed_therapeutic_templates()
    seed_doctor_schedule_slots()
    seed_care_journeys_for_patients()
    from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import setup_phase6

    setup_phase6(seed_panels=seed_panels)


def seed_care_journeys_for_patients():
    """Backfill an active care journey for patients that do not have one."""
    if not frappe.db.exists("DocType", "Patient Care Journey"):
        return
    from health_ecosystem_core.health_ecosystem_core.clinical_journey import ensure_journey_for_patient

    for patient_id in frappe.get_all("Health Patient", filters={"status": "Active"}, pluck="name"):
        if frappe.db.exists(
            "Patient Care Journey",
            {"patient": patient_id, "status": ["not in", ["Authorized", "Dispatched"]]},
        ):
            continue
        ensure_journey_for_patient(patient_id, status="Nursing Intake")


def migrate_from_marley():
    """Copy Marley records into HEC clinical DocTypes before uninstall."""
    if "healthcare" not in (frappe.get_installed_apps() or []):
        return {"skipped": True, "reason": "healthcare not installed"}

    migrated = {"patients": 0, "doctors": 0, "departments": 0, "appointments": 0}

    if frappe.db.exists("DocType", "Medical Department"):
        for row in frappe.get_all("Medical Department", fields=["name"], limit=200):
            dept_name = row.name
            if frappe.db.exists("Clinical Department", dept_name):
                continue
            frappe.get_doc(
                {"doctype": "Clinical Department", "department_name": dept_name}
            ).insert(ignore_permissions=True)
            migrated["departments"] += 1

    if frappe.db.exists("DocType", "Patient"):
        for p in frappe.get_all(
            "Patient",
            fields=["name", "patient_name", "sex", "mobile", "email", "dob", "customer"],
            limit=500,
        ):
            existing = frappe.db.get_value("Health Patient", {"mobile": p.mobile}, "name") if p.mobile else None
            if existing:
                continue
            hp = frappe.get_doc(
                {
                    "doctype": "Health Patient",
                    "patient_name": p.patient_name or p.name,
                    "gender": p.sex or "Male",
                    "mobile": p.mobile,
                    "email": p.email,
                    "dob": p.dob,
                    "customer": p.customer,
                    "status": "Active",
                }
            )
            hp.flags.ignore_mandatory = True
            hp.insert(ignore_permissions=True)
            migrated["patients"] += 1

    marley_to_hec_doctor = {}
    if frappe.db.exists("DocType", "Healthcare Practitioner"):
        for pr in frappe.get_all(
            "Healthcare Practitioner",
            fields=["name", "practitioner_name", "department", "mobile_phone", "office_phone"],
            limit=200,
        ):
            doc = frappe.get_doc(
                {
                    "doctype": "Doctor",
                    "doctor_name": pr.practitioner_name or pr.name,
                    "primary_department": pr.department,
                    "mobile": pr.mobile_phone or pr.office_phone,
                    "status": "Active",
                }
            )
            doc.insert(ignore_permissions=True)
            marley_to_hec_doctor[pr.name] = doc.name
            migrated["doctors"] += 1

    if frappe.db.exists("DocType", "Patient Appointment"):
        for apt in frappe.get_all(
            "Patient Appointment",
            fields=[
                "name",
                "patient",
                "patient_name",
                "practitioner",
                "department",
                "appointment_type",
                "appointment_date",
                "appointment_time",
                "status",
                "notes",
                "company",
            ],
            limit=500,
        ):
            hp = None
            if apt.patient:
                marley_p = frappe.db.get_value(
                    "Patient", apt.patient, ["patient_name", "mobile"], as_dict=True
                )
                if marley_p:
                    hp = frappe.db.get_value("Health Patient", {"mobile": marley_p.mobile}, "name")
                    if not hp and marley_p.patient_name:
                        hp = frappe.db.get_value(
                            "Health Patient", {"patient_name": marley_p.patient_name}, "name"
                        )
            if not hp:
                continue
            doctor = marley_to_hec_doctor.get(apt.practitioner)
            ctype = apt.appointment_type if frappe.db.exists("Consultation Type", apt.appointment_type) else "OPD Consultation"
            if not frappe.db.exists("Consultation Type", ctype):
                ctype = "OPD Consultation"
            status_map = {
                "Open": "Scheduled",
                "Scheduled": "Scheduled",
                "Confirmed": "Confirmed",
                "Checked In": "Checked In",
                "Closed": "Completed",
                "Cancelled": "Cancelled",
            }
            frappe.get_doc(
                {
                    "doctype": "Doctor Appointment",
                    "patient": hp,
                    "patient_name": apt.patient_name,
                    "doctor": doctor,
                    "department": apt.department,
                    "consultation_type": ctype,
                    "appointment_date": apt.appointment_date,
                    "appointment_time": apt.appointment_time,
                    "status": status_map.get(apt.status, "Scheduled"),
                    "notes": apt.notes,
                    "company": apt.company,
                }
            ).insert(ignore_permissions=True)
            migrated["appointments"] += 1

    frappe.db.commit()
    return migrated


def uninstall_marley_healthcare():
    migrate_result = migrate_from_marley()
    if "healthcare" not in (frappe.get_installed_apps() or []):
        return {"ok": True, "migrate": migrate_result, "uninstall": "already removed"}

    from frappe.installer import remove_app

    remove_app("healthcare", dry_run=False, force=True)
    frappe.db.commit()

  # Ensure apps.txt no longer lists healthcare
    apps_path = frappe.get_site_path("apps.txt")
    lines = [ln.strip() for ln in open(apps_path).read().splitlines() if ln.strip() and ln.strip() != "healthcare"]
    with open(apps_path, "w") as handle:
        handle.write("\n".join(lines) + "\n")

    frappe.clear_cache()
    return {"ok": True, "migrate": migrate_result, "uninstall": "healthcare removed"}


def setup_clinical_workspace():
    """Rebuild Clinical workspace blocks (Frappe v15 needs content JSON + child tables in sync)."""
    CLINICAL_SHORTCUTS = [
        ("Patient Care Journey", "Patient Care Journey", "Blue"),
        ("Health Patient", "Health Patient", "Green"),
        ("Doctor Appointment", "Doctor Appointment", "Orange"),
        ("Clinical Prescription", "Clinical Prescription", "Purple"),
    ]
    CARD_GROUPS = [
        (
            "Patient Workflow",
            [
                ("Patient Care Journeys", "Patient Care Journey"),
                ("Nursing Assessments", "Nursing Assessment"),
                ("Clinical Prescriptions", "Clinical Prescription"),
                ("Pharmacy Orders", "Pharmacy Order"),
            ],
        ),
        (
            "Scheduling",
            [
                ("Doctors", "Doctor"),
                ("Appointments", "Doctor Appointment"),
                ("Doctor Schedules", "Doctor Schedule Slot"),
                ("Consultation Types", "Consultation Type"),
            ],
        ),
        (
            "Laboratory",
            [
                ("Lab TRFs", "Customer TRF"),
                ("Lab Test Panels", "Lab Test Panel"),
                ("Diagnostic Test Masters", "Diagnostic Test Master"),
                ("Lab Test Results", "Lab Test Result"),
            ],
        ),
        (
            "Masters",
            [
                ("Departments", "Clinical Department"),
                ("Therapeutic Templates", "Therapeutic Template"),
                ("Health Patients", "Health Patient"),
            ],
        ),
    ]

    def _block_id():
        return frappe.generate_hash(length=10)

    content = [
        {
            "id": _block_id(),
            "type": "header",
            "data": {"text": '<span class="h4"><b>Clinical Shortcuts</b></span>', "col": 12},
        }
    ]
    for label, _, _ in CLINICAL_SHORTCUTS:
        content.append(
            {
                "id": _block_id(),
                "type": "shortcut",
                "data": {"shortcut_name": label, "col": 3},
            }
        )
    content.append({"id": _block_id(), "type": "spacer", "data": {"col": 12}})
    content.append(
        {
            "id": _block_id(),
            "type": "header",
            "data": {"text": '<span class="h4"><b>Clinical Modules</b></span>', "col": 12},
        }
    )
    for card_name, _links in CARD_GROUPS:
        content.append(
            {
                "id": _block_id(),
                "type": "card",
                "data": {"card_name": card_name, "col": 4},
            }
        )

    if frappe.db.exists("Workspace", "Clinical"):
        ws = frappe.get_doc("Workspace", "Clinical")
    else:
        ws = frappe.new_doc("Workspace")
        ws.label = "Clinical"
        ws.title = "Clinical"

    ws.module = "Health Ecosystem Core"
    ws.public = 1
    ws.icon = "health"
    ws.indicator_color = "green"
    ws.content = json.dumps(content)

    ws.set("shortcuts", [])
    for label, link_to, color in CLINICAL_SHORTCUTS:
        ws.append(
            "shortcuts",
            {
                "label": label,
                "type": "DocType",
                "link_to": link_to,
                "color": color,
            },
        )

    ws.set("links", [])
    for card_name, links in CARD_GROUPS:
        ws.append(
            "links",
            {
                "label": card_name,
                "type": "Card Break",
                "link_type": "DocType",
                "hidden": 0,
                "is_query_report": 0,
                "onboard": 0,
            },
        )
        for label, link_to in links:
            ws.append(
                "links",
                {
                    "label": label,
                    "type": "Link",
                    "link_type": "DocType",
                    "link_to": link_to,
                    "hidden": 0,
                    "is_query_report": 0,
                    "onboard": 0,
                },
            )

    roles = [
        "System Manager",
        "Health System Admin",
        "Physician",
        "Nurse",
        "Lab Technician",
        "Phlebotomist",
        "Pathologist",
    ]
    ws.set("roles", [])
    for role in roles:
        ws.append("roles", {"role": role})

    if ws.is_new():
        ws.insert(ignore_permissions=True)
    else:
        ws.save(ignore_permissions=True)

    for user in frappe.get_all("User", filters={"enabled": 1}, pluck="name"):
        user_roles = frappe.get_roles(user)
        if any(r in user_roles for r in roles):
            frappe.db.set_value("User", user, "default_workspace", "Clinical", update_modified=False)


def get_clinical_desk_urls():
    return {
        "clinical_workspace": "/app/clinical",
        "patients": "/app/health-patient",
        "doctors": "/app/doctor",
        "appointments": "/app/doctor-appointment",
        "prescriptions": "/app/clinical-prescription",
        "journeys": "/app/patient-care-journey",
    }
