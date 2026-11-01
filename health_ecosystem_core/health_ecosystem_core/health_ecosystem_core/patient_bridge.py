"""
Patient bridge — Health Ecosystem native Health Patient (no Marley dependency).
"""

import re

from frappe.utils import add_years, cint, cstr, getdate, today

import frappe

ACCOUNT_LINK_DT = "Patient Account Link"
_NAME_TITLES = frozenset(
    {"mr", "mrs", "ms", "miss", "mx", "dr", "prof", "smt", "shri", "sri", "kumari", "master", "baby"}
)
_PLACEHOLDER_NAME = re.compile(r"^patient( \d{1,4})?$")


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


def normalize_person_name(name):
    tokens = re.sub(r"[^a-z0-9]+", " ", cstr(name).lower()).split()
    while len(tokens) > 1 and tokens[0] in _NAME_TITLES:
        tokens.pop(0)
    return " ".join(tokens)


def _is_placeholder_name(name):
    """OTP signups use "Patient 1234" until the person enters a real name."""
    norm = normalize_person_name(name)
    return not norm or bool(_PLACEHOLDER_NAME.match(norm)) or norm.replace(" ", "").isdigit()


def names_match(a, b):
    na, nb = normalize_person_name(a), normalize_person_name(b)
    return bool(na) and (na == nb or sorted(na.split()) == sorted(nb.split()))


def strict_matching_enabled():
    """Name-aware dedupe needs Patient Account Link (setup_phase132); site_config hec_strict_patient_dedupe=0 reverts."""
    if not cint(frappe.conf.get("hec_strict_patient_dedupe", 1)):
        return False
    return bool(frappe.db.exists("DocType", ACCOUNT_LINK_DT))


def _is_dependant(patient_id, user=None):
    """Linked to an account as a non-Self profile (for `user` when given)."""
    if not patient_id or not frappe.db.exists("DocType", ACCOUNT_LINK_DT):
        return False
    filters = {"patient": patient_id, "active": 1, "relation": ("!=", "Self")}
    if user:
        filters["user"] = user
    return bool(frappe.db.exists(ACCOUNT_LINK_DT, filters))


def _phone_lookup(phone):
    """Phone-only lookup as before, but a family dependant never shadows the account holder's record."""
    dt = patient_doctype()
    name = frappe.db.get_value(dt, {"mobile": phone}, "name")
    if not name or not _is_dependant(name):
        return name
    for row in frappe.get_all(dt, filters={"mobile": phone}, pluck="name", limit=50):
        if not _is_dependant(row):
            return row
    return name


def _dob_ok(candidate_dob, dob):
    if not dob or not candidate_dob:
        return True
    try:
        return getdate(candidate_dob) == getdate(dob)
    except Exception:
        return True


def _first_named(field, value, patient_name, dob):
    dt = patient_doctype()
    fields = ["name", "patient_name"]
    if frappe.get_meta(dt).has_field("dob"):
        fields.append("dob")
    rows = frappe.get_all(dt, filters={field: value}, fields=fields, limit=200)
    for row in rows:
        if names_match(row.patient_name, patient_name) and _dob_ok(row.get("dob"), dob):
            return row.name, rows
    return None, rows


def _legacy_find(phone=None, email=None, patient_name=None, name_fallback=True):
    dt = patient_doctype()
    if phone:
        name = _phone_lookup(phone)
        if name:
            return name
    if email:
        name = frappe.db.get_value(dt, {"email": email}, "name")
        if name:
            return name
    if patient_name and name_fallback:
        name = frappe.db.get_value(dt, {"patient_name": patient_name}, "name")
        if name:
            return name
    return None


def resolve_patient(phone=None, email=None, patient_name=None, upi=None, dob=None):
    """{"match", "conflict"}: match = UPI, else phone + name (+ DOB), else email + name.
    conflict = a patient sharing the phone / email under a different name (never reused)."""
    out = {"match": None, "conflict": None}
    if not patient_doctype_available():
        return out
    dt = patient_doctype()
    upi = cstr(upi).strip().upper()
    if upi and frappe.get_meta(dt).has_field("universal_patient_id"):
        out["match"] = _patient_for_upi(dt, upi)
        if out["match"]:
            return out
    if not strict_matching_enabled():
        out["match"] = _legacy_find(phone, email, patient_name)
        return out
    if not patient_name or _is_placeholder_name(patient_name):
        out["match"] = _legacy_find(phone, email, None, name_fallback=False)
        return out
    if phone:
        out["match"], rows = _first_named("mobile", phone, patient_name, dob)
        if out["match"]:
            return out
        if rows:
            out["conflict"] = _phone_lookup(phone)
    if email:
        match, rows = _first_named("email", email, patient_name, dob)
        if match:
            out["match"] = match
            return out
        if rows and not out["conflict"]:
            out["conflict"] = rows[0].name
    if not phone and not email:
        out["match"] = frappe.db.get_value(dt, {"patient_name": patient_name}, "name")
    return out


def find_patient(phone=None, email=None, patient_name=None, upi=None, dob=None):
    if not patient_doctype_available():
        return None
    return resolve_patient(phone=phone, email=email, patient_name=patient_name, upi=upi, dob=dob)["match"]


def find_patient_by_phone(phone, patient_name=None):
    """Phone lookup that respects the name rule when strict dedupe is on (no name-only fallback)."""
    if not phone or not patient_doctype_available():
        return None
    if patient_name and not _is_placeholder_name(patient_name) and strict_matching_enabled():
        return _first_named("mobile", phone, patient_name, None)[0]
    return _phone_lookup(phone)


def _is_portal_user(user):
    return bool(user) and frappe.db.get_value("User", user, "user_type") == "Website User"


def primary_patient_for_user(user):
    if not user or user == "Guest":
        return None
    if frappe.db.exists("Custom Field", {"dt": "User", "fieldname": "hec_health_patient"}):
        pid = frappe.db.get_value("User", user, "hec_health_patient")
        if pid:
            return pid
    if frappe.get_meta(patient_doctype()).has_field("linked_user"):
        return frappe.db.get_value(patient_doctype(), {"linked_user": user}, "name")
    return None


def patient_account_owner(patient_id):
    if not patient_id:
        return None
    dt = patient_doctype()
    if frappe.get_meta(dt).has_field("linked_user"):
        user = frappe.db.get_value(dt, patient_id, "linked_user")
        if user:
            return user
    if frappe.db.exists("Custom Field", {"dt": "User", "fieldname": "hec_health_patient"}):
        return frappe.db.get_value("User", {"hec_health_patient": patient_id}, "name")
    return None


def _foundations():
    try:
        from health_ecosystem_core.health_ecosystem_core import clinical_phase132_foundations

        return clinical_phase132_foundations
    except ImportError:
        return None


def _patient_for_upi(dt, upi):
    """REM-UID (normalised) or a legacy RUP ID kept in Health Patient.legacy_upi."""
    mod = _foundations()
    if mod and hasattr(mod, "patient_for_uid"):
        try:
            return mod.patient_for_uid(upi)
        except Exception:
            frappe.log_error(title="patient_for_uid", message=frappe.get_traceback())
    return frappe.db.get_value(dt, {"universal_patient_id": upi}, "name")


def _assign_upi(patient_id):
    mod = _foundations()
    if not mod or not patient_id:
        return None
    try:
        return mod.assign_upi(patient_id)
    except Exception:
        frappe.log_error(title="assign_upi", message=frappe.get_traceback())
        return None


def _link_account(user, patient_id, relation, is_primary=0):
    mod = _foundations()
    if mod and user and patient_id:
        mod.link_patient_account(user, patient_id, relation, is_primary=is_primary)


def ensure_patient(
    patient_name, phone=None, age=None, gender=None, email=None, user=None, upi=None, dob=None, relation=None
):
    if not patient_doctype_available():
        return None
    patient_name = (patient_name or "").strip()
    if not patient_name:
        return None

    res = resolve_patient(phone=phone, email=email, patient_name=patient_name, upi=upi, dob=dob)
    existing = res["match"]
    if existing:
        _update_patient_demographics(existing, phone=phone, age=age, gender=gender, email=email)
        if user and not _is_dependant(existing, user):
            _link_user_to_patient(user, existing)
        _assign_upi(existing)
        return existing

    # Same phone / email but a different person: new record, attached to the family account instead.
    conflict = res["conflict"]
    self_profile = bool(user)
    owner = None
    if conflict:
        if user and _is_portal_user(user) and not primary_patient_for_user(user):
            owner = user
        else:
            self_profile = False
            owner = user if _is_portal_user(user) else patient_account_owner(conflict)

    doc = {
        "doctype": patient_doctype(),
        "patient_name": patient_name,
        "gender": _normalize_gender(gender),
        "mobile": phone,
        "email": email,
        "status": "Active",
    }
    if self_profile and frappe.get_meta(patient_doctype()).has_field("linked_user"):
        doc["linked_user"] = user
    if dob:
        doc["dob"] = getdate(dob)
    else:
        approx = _approx_dob_from_age(age)
        if approx:
            doc["dob"] = approx
            doc["age"] = age

    patient = frappe.get_doc(doc)
    patient.flags.ignore_mandatory = True
    patient.insert(ignore_permissions=True)
    _assign_upi(patient.name)

    if self_profile:
        _link_user_to_patient(user, patient.name)
    if conflict and owner:
        _link_account(
            owner, patient.name, "Self" if self_profile else (relation or "Other"), is_primary=1 if self_profile else 0
        )
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
    """Bidirectional User ↔ Health Patient link (idempotent)."""
    if not user or not patient_id or user == "Guest":
        return
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_setup import ensure_patient_link_fields

        ensure_patient_link_fields()
    except Exception:
        pass

    field = "hec_health_patient"
    if frappe.db.exists("Custom Field", {"dt": "User", "fieldname": field}):
        current = frappe.db.get_value("User", user, field)
        if current != patient_id:
            frappe.db.set_value("User", user, field, patient_id, update_modified=False)

    dt = patient_doctype()
    if frappe.get_meta(dt).has_field("linked_user"):
        current_user = frappe.db.get_value(dt, patient_id, "linked_user")
        if current_user != user:
            frappe.db.set_value(dt, patient_id, "linked_user", user, update_modified=False)


def ensure_patient_for_user(user=None, patient_name=None, phone=None, email=None, age=None, gender=None):
    """Resolve or create a Health Patient for the given User and ensure links."""
    user = user or frappe.session.user
    if not user or user == "Guest":
        return None
    if not patient_doctype_available():
        return None

    # Prefer existing links / phone / email match without creating yet
    patient_id = None
    if frappe.db.exists("Custom Field", {"dt": "User", "fieldname": "hec_health_patient"}):
        patient_id = frappe.db.get_value("User", user, "hec_health_patient")

    user_phone = phone or frappe.db.get_value("User", user, "mobile_no")
    user_email = email or frappe.db.get_value("User", user, "email")
    user_full_name = patient_name or frappe.db.get_value("User", user, "full_name") or user

    if not patient_id and frappe.get_meta(patient_doctype()).has_field("linked_user"):
        patient_id = frappe.db.get_value(patient_doctype(), {"linked_user": user}, "name")

    if not patient_id:
        patient_id = find_patient(phone=user_phone, email=user_email)

    if patient_id:
        _link_user_to_patient(user, patient_id)
        _update_patient_demographics(
            patient_id, phone=user_phone, age=age, gender=gender, email=user_email
        )
        return patient_id

    return ensure_patient(
        patient_name=user_full_name,
        phone=user_phone,
        age=age,
        gender=gender,
        email=user_email,
        user=user,
    )


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
    _ensure_patient_city_field()
    return "Health Patient bridge fields ensured"


def _ensure_patient_city_field():
    """Optional city field used by mobile Update Profile."""
    if not patient_doctype_available():
        return
    meta = frappe.get_meta(patient_doctype())
    if meta.has_field("city"):
        return
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            patient_doctype(): [
                {
                    "fieldname": "city",
                    "label": "City",
                    "fieldtype": "Data",
                    "insert_after": "email",
                }
            ]
        },
        update=True,
    )


def patient_profile_for_user(user=None):
    user = user or frappe.session.user
    if not user or user == "Guest":
        return None

    if not patient_doctype_available():
        return {"linked": False, "user": user}

    phone = frappe.db.get_value("User", user, "mobile_no")
    email = frappe.db.get_value("User", user, "email")
    patient_id = None

    if frappe.db.exists("Custom Field", {"dt": "User", "fieldname": "hec_health_patient"}):
        patient_id = frappe.db.get_value("User", user, "hec_health_patient")

    if not patient_id and frappe.get_meta(patient_doctype()).has_field("linked_user"):
        patient_id = frappe.db.get_value(patient_doctype(), {"linked_user": user}, "name")

    if not patient_id:
        patient_id = find_patient(phone=phone, email=email)

    # Auto-heal: create + link from User demographics when still missing
    if not patient_id:
        full_name = frappe.db.get_value("User", user, "full_name") or ""
        if (phone or email) and full_name and not str(full_name).startswith("Patient "):
            patient_id = ensure_patient_for_user(user=user)
        elif phone:
            patient_id = ensure_patient_for_user(
                user=user,
                patient_name=full_name or f"Patient {(phone or '')[-4:]}",
            )

    if patient_id:
        _link_user_to_patient(user, patient_id)

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
        "city",
        "linked_user",
        "universal_patient_id",
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
