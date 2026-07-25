"""
Patient bridge — Health Ecosystem native Health Patient (no Marley dependency).
"""

from frappe.utils import add_years, today

import frappe


def patient_doctype():
    return "Health Patient"


def patient_doctype_available():
    return frappe.db.exists("DocType", patient_doctype())


def _normalize_gender(gender):
    gender = (gender or "Male").strip()
    if gender.lower() in ("male", "m"):
        return "Male"
    if gender.lower() in ("female", "f"):
        return "Female"
    return gender


def _approx_dob_from_age(age):
    try:
        age = int(age)
        if age > 0:
            return add_years(today(), -age)
    except Exception:
        pass
    return None


def find_patient(phone=None, email=None, patient_name=None):
    if not patient_doctype_available():
        return None
    dt = patient_doctype()
    if phone:
        name = frappe.db.get_value(dt, {"mobile": phone}, "name")
        if name:
            return name
    if email:
        name = frappe.db.get_value(dt, {"email": email}, "name")
        if name:
            return name
    if patient_name:
        name = frappe.db.get_value(dt, {"patient_name": patient_name}, "name")
        if name:
            return name
    return None


def ensure_patient(patient_name, phone=None, age=None, gender=None, email=None, user=None):
    if not patient_doctype_available():
        return None
    patient_name = (patient_name or "").strip()
    if not patient_name:
        return None

    existing = find_patient(phone=phone, email=email, patient_name=patient_name)
    if existing:
        _update_patient_demographics(existing, phone=phone, age=age, gender=gender, email=email)
        if user:
            _link_user_to_patient(user, existing)
        return existing

    doc = {
        "doctype": patient_doctype(),
        "patient_name": patient_name,
        "gender": _normalize_gender(gender),
        "mobile": phone,
        "email": email,
        "status": "Active",
    }
    dob = _approx_dob_from_age(age)
    if dob:
        doc["dob"] = dob
        doc["age"] = age

    patient = frappe.get_doc(doc)
    patient.flags.ignore_mandatory = True
    patient.insert(ignore_permissions=True)

    if user:
        _link_user_to_patient(user, patient.name)
    return patient.name


def _update_patient_demographics(patient_id, phone=None, age=None, gender=None, email=None):
    dt = patient_doctype()
    updates = {}
    if phone and not frappe.db.get_value(dt, patient_id, "mobile"):
        updates["mobile"] = phone
    if email and not frappe.db.get_value(dt, patient_id, "email"):
        updates["email"] = email
    if gender and not frappe.db.get_value(dt, patient_id, "gender"):
        updates["gender"] = _normalize_gender(gender)
    if age and not frappe.db.get_value(dt, patient_id, "dob"):
        dob = _approx_dob_from_age(age)
        if dob:
            updates["dob"] = dob
            updates["age"] = age
    if updates:
        frappe.db.set_value(dt, patient_id, updates, update_modified=False)


def _link_user_to_patient(user, patient_id):
    field = "hec_health_patient"
    if not frappe.db.exists("Custom Field", {"dt": "User", "fieldname": field}):
        return
    if not frappe.db.get_value("User", user, field):
        frappe.db.set_value("User", user, field, patient_id, update_modified=False)


def patient_customer(patient_id):
    if not patient_id or not frappe.db.exists(patient_doctype(), patient_id):
        return None
    return frappe.db.get_value(patient_doctype(), patient_id, "customer")


def ensure_customer_for_patient(patient_id, fallback_name, phone=None):
    customer = patient_customer(patient_id)
    if customer:
        return customer
    customer_name = (fallback_name or "").strip()
    if frappe.db.exists("Customer", customer_name):
        return customer_name
    customer = frappe.get_doc(
        {
            "doctype": "Customer",
            "customer_name": customer_name,
            "customer_type": "Individual",
            "customer_group": frappe.db.get_single_value("Selling Settings", "customer_group")
            or "Individual",
            "territory": frappe.db.get_single_value("Selling Settings", "territory") or "All Territories",
            "mobile_no": phone,
        }
    )
    customer.insert(ignore_permissions=True)
    if patient_id:
        frappe.db.set_value(patient_doctype(), patient_id, "customer", customer.name, update_modified=False)
    return customer.name


def sync_trf_patient(trf, user=None):
    patient_id = ensure_patient(
        patient_name=trf.patient_name,
        phone=trf.patient_phone,
        age=trf.age,
        gender=trf.gender,
        user=user or frappe.session.user,
    )
    if patient_id:
        meta = frappe.get_meta("Customer TRF")
        if meta.has_field("health_patient"):
            frappe.db.set_value("Customer TRF", trf.name, "health_patient", patient_id, update_modified=False)
        elif meta.has_field("patient"):
            frappe.db.set_value("Customer TRF", trf.name, "patient", patient_id, update_modified=False)
    return patient_id


def ensure_healthcare_patient_fields():
    from health_ecosystem_core.health_ecosystem_core.clinical_setup import ensure_patient_link_fields

    ensure_patient_link_fields()
    return "Health Patient bridge fields ensured"


def patient_profile_for_user(user=None):
    user = user or frappe.session.user
    if not user or user == "Guest":
        return None

    patient_id = None
    if frappe.db.exists("Custom Field", {"dt": "User", "fieldname": "hec_health_patient"}):
        patient_id = frappe.db.get_value("User", user, "hec_health_patient")

    phone = frappe.db.get_value("User", user, "mobile_no")
    email = frappe.db.get_value("User", user, "email")
    if not patient_id:
        patient_id = find_patient(phone=phone, email=email)

    if not patient_id:
        return {"linked": False, "user": user, "mobile_no": phone, "email": email}

    dt = patient_doctype()
    fields = [
        "name",
        "patient_name",
        "gender",
        "mobile",
        "email",
        "dob",
        "customer",
        "status",
        "referral_code",
        "wallet_balance",
        "profile_image",
        "referred_by",
    ]
    available = [f for f in fields if frappe.get_meta(dt).has_field(f)]
    profile = frappe.db.get_value(dt, patient_id, available, as_dict=True) or {}
    profile["linked"] = True
    profile["patient_id"] = patient_id
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase75_patient_referral import (
            ensure_patient_wallet_and_code,
            get_wallet_balance,
        )

        ensure_patient_wallet_and_code(patient_id)
        if "wallet_balance" not in profile:
            profile["wallet_balance"] = get_wallet_balance(patient_id)
        if not profile.get("referral_code"):
            profile["referral_code"] = frappe.db.get_value(dt, patient_id, "referral_code")
    except Exception:
        pass
    return profile


def patient_scope_or_filters(phone_field="customer_phone", name_field="customer_name"):
    """OR filters matching the logged-in user to their Health Patient record."""
    profile = patient_profile_for_user()
    user = frappe.session.user
    seen = set()
    or_filters = []

    def _add(field, value):
        if not value:
            return
        key = (field, str(value).strip())
        if key in seen:
            return
        seen.add(key)
        or_filters.append([field, "=", value])

    if profile:
        _add(phone_field, profile.get("mobile"))
        _add(name_field, profile.get("patient_name"))

    _add(phone_field, frappe.db.get_value("User", user, "mobile_no"))
    _add(name_field, frappe.db.get_value("User", user, "full_name"))
    _add(name_field, frappe.db.get_value("User", user, "email"))
    return or_filters


# Backward compatibility aliases
healthcare_installed = patient_doctype_available
