"""Allied health catalog (Psychology, Aesthetics, Physio, Chiropractic, Ayurveda) — Phase 31."""

from __future__ import annotations

import csv
import os
import re
from functools import lru_cache

import frappe
from frappe import _
from frappe.utils import flt

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _load_wellness_promo_banners,
    _parse_request_value,
    _require_mobile_auth,
    _success,
)

ALLIED_WINGS = [
    {
        "id": "psychology",
        "title": "Psychology",
        "subtitle": "Mental health, counselling & therapy",
        "item_group": "Psychology & Mental Health",
        "department_name": "Psychology & Mental Health",
        "consultation_type": "Allied Psychology Session",
        "icon": "🧠",
        "color": "#6366F1",
        "image": "/wellness/psychology.svg",
    },
    {
        "id": "aesthetics",
        "title": "Aesthetics",
        "subtitle": "Skin, hair & body clinic — dermatology-led aesthetic care",
        "item_group": "Aesthetic Dermatology",
        "department_name": "Aesthetic Dermatology",
        "consultation_type": "Allied Aesthetics Session",
        "icon": "✨",
        "color": "#0d9488",
        "image": "/wellness/aesthetics-hero.jpg",
    },
    {
        "id": "physiotherapy",
        "title": "Physiotherapy",
        "subtitle": "Rehabilitation & pain relief",
        "item_group": "Physiotherapy & Rehabilitation",
        "department_name": "Physiotherapy & Rehabilitation",
        "consultation_type": "Allied Physiotherapy Session",
        "icon": "🦴",
        "color": "#0EA5E9",
        "image": "/wellness/physiotherapy.svg",
    },
    {
        "id": "chiropractic",
        "title": "Chiropractic",
        "subtitle": "Spine, posture & osteopathy",
        "item_group": "Chiropractic & Osteopathy",
        "department_name": "Chiropractic & Osteopathy",
        "consultation_type": "Allied Chiropractic Session",
        "icon": "🧘",
        "color": "#14B8A6",
        "image": "/wellness/chiropractic.svg",
    },
    {
        "id": "ayurvedic",
        "title": "Ayurvedic",
        "subtitle": "Holistic Ayurveda & naturopathy",
        "item_group": "Ayurveda & Naturopathy",
        "department_name": "Ayurveda & Naturopathy",
        "consultation_type": "Allied Ayurvedic Session",
        "icon": "🌿",
        "color": "#22C55E",
        "image": "/wellness/ayurvedic.svg",
    },
    {
        "id": "yoga",
        "title": "Yoga & Mindfulness",
        "subtitle": "Group classes, breathwork & meditation",
        "item_group": "Yoga & Mindfulness",
        "department_name": "Yoga & Mindfulness",
        "consultation_type": "Allied Yoga Session",
        "icon": "🧘‍♀️",
        "color": "#8B5CF6",
        "image": "/wellness/yoga.svg",
    },
]

WING_BY_ID = {w["id"]: w for w in ALLIED_WINGS}
WING_BY_GROUP = {w["item_group"]: w for w in ALLIED_WINGS}
# Beauty & Aesthetics CSV rows belong under the Aesthetics clinic wing.
WING_BY_GROUP["Beauty & Aesthetics"] = WING_BY_ID["aesthetics"]


def _csv_path():
    """Resolve allied_health_services.csv across apps volume and installed package layouts."""
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.normpath(os.path.join(here, "..", "data", "allied_health_services.csv")),
        os.path.normpath(os.path.join(here, "..", "..", "data", "allied_health_services.csv")),
    ]
    try:
        app_path = frappe.get_app_path("health_ecosystem_core")
        candidates.append(os.path.join(app_path, "data", "allied_health_services.csv"))
        candidates.append(os.path.join(os.path.dirname(app_path), "data", "allied_health_services.csv"))
        candidates.append(
            os.path.join(os.path.dirname(app_path), "health_ecosystem_core", "data", "allied_health_services.csv")
        )
    except Exception:
        pass
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return candidates[0]


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:72]


def _parse_rate(raw: str) -> float:
    if not raw:
        return 0.0
    cleaned = re.sub(r"[^\d.]", "", str(raw).replace(",", ""))
    try:
        return flt(cleaned)
    except Exception:
        return 0.0


def _normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").replace("\n", " ")).strip()


@lru_cache(maxsize=1)
def _load_services():
    path = _csv_path()
    if not os.path.isfile(path):
        return []
    services = []
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.reader(handle)
        rows = list(reader)
    for row in rows[3:]:
        if len(row) < 6:
            continue
        group = (row[1] or "").strip()
        wing = WING_BY_GROUP.get(group)
        if not wing:
            continue
        name = _normalize_name(row[2])
        if not name:
            continue
        services.append(
            {
                "service_code": f"{wing['id']}-{_slug(name)}",
                "wing_id": wing["id"],
                "wing_title": wing["title"],
                "item_group": group,
                "service_name": name,
                "mode": (row[3] or "").strip(),
                "duration": (row[4] or "").strip(),
                "rate": _parse_rate(row[5]),
                "includes": (row[6] or "").strip() if len(row) > 6 else "",
                "short_description": (row[7] or "").strip() if len(row) > 7 else "",
                "long_description": (row[8] or "").strip() if len(row) > 8 else "",
                "department_name": wing["department_name"],
                "consultation_type": wing["consultation_type"],
                "image": wing["image"],
                "color": wing["color"],
                "icon": wing["icon"],
            }
        )
    return services


def _wing_payload(wing: dict, services: list) -> dict:
    wing_services = [s for s in services if s["wing_id"] == wing["id"]]
    rates = [s["rate"] for s in wing_services if s["rate"] > 0]
    return {
        **wing,
        "service_count": len(wing_services),
        "starting_rate": min(rates) if rates else 0,
    }


@frappe.whitelist(allow_guest=True)
def get_allied_health_wings():
    services = _load_services()
    wings = [_wing_payload(w, services) for w in ALLIED_WINGS]
    return _success({"wings": wings, "promo_banners": _load_wellness_promo_banners()})


@frappe.whitelist(allow_guest=True)
def get_allied_health_services(wing_id=None, q=None):
    wing_id = (_parse_request_value("wing_id", wing_id) or "").strip().lower()
    q = (_parse_request_value("q", q) or "").strip().lower()
    services = _load_services()
    if wing_id:
        services = [s for s in services if s["wing_id"] == wing_id]
    if q:
        services = [
            s
            for s in services
            if q in s["service_name"].lower()
            or q in s["short_description"].lower()
            or q in s["item_group"].lower()
        ]
    return _success({"services": services, "count": len(services)})


@frappe.whitelist(allow_guest=True)
def get_allied_health_service(service_code=None):
    service_code = (_parse_request_value("service_code", service_code) or "").strip()
    if not service_code:
        return _error(_("Service code is required"))
    for service in _load_services():
        if service["service_code"] == service_code:
            return _success({"service": service})
    return _error(_("Service not found"), 404)


@frappe.whitelist(allow_guest=True)
def book_allied_health_appointment(
    service_code=None,
    patient_name=None,
    patient_phone=None,
    gender=None,
    practitioner=None,
    appointment_date=None,
    appointment_time=None,
    notes=None,
    payment_method=None,
    sid=None,
):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    service_code = _parse_request_value("service_code", service_code)
    service = None
    for row in _load_services():
        if row["service_code"] == service_code:
            service = row
            break
    if not service:
        return _error(_("Allied health service not found"), 404)

    wing = WING_BY_ID.get(service["wing_id"])
    if not wing:
        return _error(_("Invalid service wing"))

    setup_allied_health_masters()

    dept_name = frappe.db.get_value(
        "Clinical Department", {"department_name": wing["department_name"]}, "name"
    )
    ctype = wing["consultation_type"]
    if not frappe.db.exists("Consultation Type", ctype):
        return _error(_("Consultation type not configured on server"))

    detail = (
        f"Allied service: {service['service_name']}\n"
        f"Wing: {wing['title']}\n"
        f"Duration: {service.get('duration') or '—'}\n"
        f"Mode: {service.get('mode') or '—'}\n"
        f"Code: {service_code}"
    )
    extra = _parse_request_value("notes", notes) or ""
    combined_notes = f"{detail}\n{extra}".strip()

    from health_ecosystem_core.health_ecosystem_core.appointments import book_patient_appointment

    return book_patient_appointment(
        patient_name=patient_name,
        patient_phone=patient_phone,
        gender=gender,
        practitioner=practitioner,
        appointment_type=ctype,
        appointment_date=appointment_date,
        appointment_time=appointment_time,
        department=dept_name,
        notes=combined_notes,
        payment_method=payment_method,
        amount=service.get("rate") or 0,
        sid=sid,
    )


def setup_allied_health_masters():
    """Seed allied departments, consultation types, and a shared practitioner schedule."""
    if not frappe.db.exists("DocType", "Clinical Department"):
        return {"skipped": True}

    created = {"departments": 0, "consultation_types": 0, "doctors": 0, "schedules": 0}

    for wing in ALLIED_WINGS:
        dept_name = wing["department_name"]
        if not frappe.db.exists("Clinical Department", {"department_name": dept_name}):
            frappe.get_doc(
                {
                    "doctype": "Clinical Department",
                    "department_name": dept_name,
                    "description": f"Allied health — {wing['title']}",
                    "is_active": 1,
                }
            ).insert(ignore_permissions=True)
            created["departments"] += 1

        ctype = wing["consultation_type"]
        if not frappe.db.exists("Consultation Type", ctype):
            frappe.get_doc(
                {
                    "doctype": "Consultation Type",
                    "consultation_type": ctype,
                    "default_duration": 45,
                }
            ).insert(ignore_permissions=True)
            created["consultation_types"] += 1

        doctor_name = f"Allied — {wing['title']}"
        doctor_id = frappe.db.get_value("Doctor", {"doctor_name": doctor_name}, "name")
        dept_id = frappe.db.get_value("Clinical Department", {"department_name": dept_name}, "name")
        if not doctor_id and dept_id:
            doc = frappe.get_doc(
                {
                    "doctype": "Doctor",
                    "doctor_name": doctor_name,
                    "primary_department": dept_id,
                    "status": "Active",
                    "specialities": [
                        {
                            "department": dept_id,
                            "consultation_type": ctype,
                            "service_label": wing["title"],
                        }
                    ],
                }
            )
            doc.insert(ignore_permissions=True)
            doctor_id = doc.name
            created["doctors"] += 1

        if doctor_id and dept_id and frappe.db.exists("DocType", "Doctor Schedule Slot"):
            for day in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"):
                exists = frappe.db.exists(
                    "Doctor Schedule Slot",
                    {
                        "doctor": doctor_id,
                        "department": dept_id,
                        "day": day,
                    },
                )
                if exists:
                    continue
                frappe.get_doc(
                    {
                        "doctype": "Doctor Schedule Slot",
                        "doctor": doctor_id,
                        "department": dept_id,
                        "day": day,
                        "from_time": "09:00:00",
                        "to_time": "18:00:00",
                        "slot_duration": 30,
                        "consultation_type": ctype,
                    }
                ).insert(ignore_permissions=True)
                created["schedules"] += 1

    frappe.db.commit()
    return created
