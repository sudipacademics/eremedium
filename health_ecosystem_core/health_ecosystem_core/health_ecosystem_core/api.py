"""
Secure REST API for Health Ecosystem Core.
All machine-facing endpoints require API key + secret headers.
Mobile app endpoints use Frappe session tokens after authenticate_user.
"""

import base64
import hashlib
import hmac
import json
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, get_datetime, now_datetime, today


# ---------------------------------------------------------------------------
# Security helpers
# ---------------------------------------------------------------------------

ALLOWED_PUBLIC_METHODS = {
    "authenticate_user",
    "update_password_on_first_login",
    "validate_session",
    "send_otp",
    "verify_otp",
    "verify_otp_and_login",
    "send_email_otp",
    "verify_email_otp",
    "ingest_onboarding_result",
    "get_rfms_integration_config",
    "create_rfms_razorpay_order",
    "verify_rfms_razorpay_payment",
    "get_wb_geo_hierarchy",
    "resolve_wb_pincode",
}

MACHINE_METHODS = {
    "log_machine_result",
    "get_barcode_tests",
}

PAYMENT_METHODS = {
    "verify_razorpay_payment",
}


def _get_site_api_credentials():
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import get_site_api_credentials

    return get_site_api_credentials()


def _razorpay_test_mode():
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import razorpay_sandbox_active

    return razorpay_sandbox_active()


def _otp_test_mode():
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import otp_test_mode

    return otp_test_mode()


def _user_roles():
    if frappe.session.user == "Guest":
        return []
    return frappe.get_roles(frappe.session.user)


def _is_staff_user():
    roles = _user_roles()
    return bool(
        set(roles)
        & {"Lab Technician", "Franchisee Operator", "Health System Admin", "System Manager"}
    )


def _machine_test_code(item_code):
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import machine_test_code

    return machine_test_code(item_code)


ORDER_STATUS_FLOW = {
    "Booked": {"Sample Collected", "Cancelled"},
    "Sample Collected": {"In Lab", "Cancelled"},
    "In Lab": {"Completed", "Cancelled"},
    "Completed": set(),
    "Cancelled": set(),
}


def _validate_machine_auth():
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import validate_machine_headers

    api_key = frappe.get_request_header("X-Health-Api-Key")
    api_secret = frappe.get_request_header("X-Health-Api-Secret")
    if not api_key or not api_secret:
        frappe.throw(_("Missing API credentials"), frappe.AuthenticationError)
    if not validate_machine_headers(api_key, api_secret):
        frappe.throw(_("Invalid API credentials"), frappe.AuthenticationError)


def _success(data=None, message="OK"):
    return {"status": "success", "message": message, "data": data or {}}


def _error(message, code=400):
    frappe.local.response["http_status_code"] = code
    return {"status": "error", "message": message, "data": {}}


def _set_no_cache_headers():
    """Catalog/booking APIs must always reflect latest ERPNext data."""
    try:
        headers = getattr(frappe.local, "response_headers", None)
        if isinstance(headers, dict):
            headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
            headers["Pragma"] = "no-cache"
    except Exception:
        pass


LAB_ITEM_GROUPS = ["Lab Tests", "Laboratory", "Diagnostics", "Lab"]
PHARMACY_ITEM_GROUPS = ["Medicines", "Pharmacy", "Healthcare"]
# Never show these as customer-buyable lab catalog / packages / popular tests
EXCLUDED_LAB_CATALOG_GROUPS = ("Consumables", "Raw Material", "Sub Assemblies")
REAGENT_NAME_PREFIXES = ("REAGENT", "REAG-", "KIT-REAGENT")


def _default_selling_price_list():
    return (
        frappe.db.get_single_value("Selling Settings", "selling_price_list")
        or frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")
        or "Standard Selling"
    )


PATIENT_FALLBACK_DISCOUNT = 0.10  # 10% off when FOCO rate is missing
WALLET_EARN_ON_PURCHASE = 0.10  # 10% wallet points on paid orders


def _list_selling_rate(item_code):
    """Undiscounted list price from Item Price / standard_rate (pre-offer)."""
    if not item_code or not frappe.db.exists("Item", item_code):
        return 0

    price_list = _default_selling_price_list()
    rate = flt(
        frappe.db.get_value(
            "Item Price",
            {"item_code": item_code, "price_list": price_list, "selling": 1},
            "price_list_rate",
        )
    )
    if rate:
        return rate

    return flt(frappe.db.get_value("Item", item_code, "standard_rate"))


def _foco_rate_for_item(item_code):
    if not item_code or not frappe.db.exists("Item", item_code):
        return 0.0
    try:
        if not frappe.get_meta("Item").has_field("hec_foco_rate"):
            return 0.0
    except Exception:
        return 0.0
    return flt(frappe.db.get_value("Item", item_code, "hec_foco_rate"))


def _patient_offer_pricing(item_code):
    """
    Patient web pricing:
      - Sell at FOCO (hec_foco_rate) when available
      - Else 10% off list/MRP
    """
    list_rate = _list_selling_rate(item_code)
    standard = flt(frappe.db.get_value("Item", item_code, "standard_rate")) if item_code else 0
    mrp = max(standard, list_rate)
    foco = _foco_rate_for_item(item_code)

    if foco > 0:
        rate = foco
        basis = "foco"
        if mrp <= rate:
            mrp = round(rate * 1.2, 2)
    elif mrp > 0:
        rate = round(mrp * (1.0 - PATIENT_FALLBACK_DISCOUNT), 2)
        basis = "ten_percent"
    elif list_rate > 0:
        rate = round(list_rate * (1.0 - PATIENT_FALLBACK_DISCOUNT), 2)
        mrp = list_rate
        basis = "ten_percent"
    else:
        rate = 0
        basis = "none"

    if mrp and mrp < rate:
        mrp = round(rate / (1.0 - PATIENT_FALLBACK_DISCOUNT), 2)

    return {
        "rate": flt(rate),
        "mrp": flt(mrp) if mrp and mrp > rate else 0,
        "foco_rate": flt(foco) if foco else None,
        "price_basis": basis,
        "list_rate": flt(list_rate),
    }


def _resolve_selling_rate(item_code):
    """Patient sell rate for catalog + bookings: FOCO if available, else 10% off."""
    return _patient_offer_pricing(item_code)["rate"]


def _strip_catalog_description(text):
    if not text:
        return ""
    try:
        from frappe.utils import strip_html

        return strip_html(str(text)).strip()
    except Exception:
        return str(text)


def _item_pricing(item_code):
    """Return (selling_rate, mrp) — mrp is list price when higher than selling rate."""
    pricing = _patient_offer_pricing(item_code)
    return pricing["rate"], pricing["mrp"]


def _subscription_coupon_tag(item_group=None, user=None):
    """Health Circle chip — further discount beyond FOCO / 10% offer."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase19 import get_entitlements

        entitlements = get_entitlements(user) if user and user not in ("Guest", None) else None
    except Exception:
        entitlements = None

    group = (item_group or "").lower()
    is_pharma = any(k in group for k in ("medic", "pharma", "healthcare"))
    if entitlements and entitlements.get("active"):
        pct = flt(
            entitlements.get("pharmacy_discount_percent")
            if is_pharma
            else entitlements.get("lab_discount_percent")
        )
        title = (entitlements.get("plan_title") or entitlements.get("plan_code") or "Circle").strip()
        if pct > 0:
            return f"{title} −{int(pct)}% extra"
        return f"{title} member"
    return "Circle coupon"


def _coupon_for_item_group(item_group, promos):
    group = (item_group or "").lower()
    if any(k in group for k in ("medic", "pharma", "healthcare")):
        for promo in promos:
            label = (promo.get("label") or "").upper()
            title = (promo.get("title") or "").lower()
            if label == "HEALTH25" or "pharmacy" in title:
                return promo.get("label")
    for promo in promos:
        label = (promo.get("label") or "").upper()
        title = (promo.get("title") or "").lower()
        if label == "FIRST10" or "lab" in title or "booking" in title:
            return promo.get("label")
    return None


def _is_lab_item_group(item_group):
    group = (item_group or "").strip()
    return group in LAB_ITEM_GROUPS


def _is_reagent_or_excluded_item(item_code=None, item_group=None, item_name=None):
    """Reagents / consumables must not appear in customer package or catalog surfaces."""
    group = (item_group or "").strip()
    if group in EXCLUDED_LAB_CATALOG_GROUPS:
        return True
    code = (item_code or "").strip().upper()
    name = (item_name or "").strip().upper()
    for prefix in REAGENT_NAME_PREFIXES:
        if code.startswith(prefix) or name.startswith(prefix):
            return True
    if "REAGENT" in code or "REAGENT" in name:
        return True
    return False


def _filter_public_lab_items(items):
    """Keep only Lab Tests group items; drop reagents/consumables."""
    out = []
    for item in items or []:
        code = item.get("name") or item.get("item_code")
        group = item.get("item_group")
        if group is None and code:
            group = frappe.db.get_value("Item", code, "item_group")
        if not _is_lab_item_group(group):
            continue
        if _is_reagent_or_excluded_item(code, group, item.get("item_name")):
            continue
        out.append(item)
    return out


def _public_lab_item_profile(item_code):
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase29_lab_import import lab_item_profile

        profile = lab_item_profile(item_code) or {}
        # Keep foco_rate for FOCO Deal badge; catalog rate already applies FOCO
        return profile
    except Exception:
        return {}


def _enrich_catalog_items(items):
    promos = _load_mobile_promotions()
    user = frappe.session.user if getattr(frappe, "session", None) else None
    for item in items:
        code = item.get("name")
        offer = _patient_offer_pricing(code)
        rate = offer["rate"]
        mrp = offer["mrp"]
        item["rate"] = rate
        item["standard_rate"] = rate
        item["mrp"] = mrp or None
        item["discount_percent"] = round((1 - rate / mrp) * 100) if mrp and mrp > rate else 0
        item["price_basis"] = offer["price_basis"]
        item["foco_rate"] = offer.get("foco_rate")
        item["wallet_earn_percent"] = int(WALLET_EARN_ON_PURCHASE * 100)
        item["wallet_earn_amount"] = round(rate * WALLET_EARN_ON_PURCHASE, 2) if rate else 0
        item["coupon_label"] = _coupon_for_item_group(item.get("item_group"), promos)
        item["member_tag"] = _subscription_coupon_tag(item.get("item_group"), user)
        desc = item.get("description") or frappe.db.get_value("Item", code, "description") or ""
        item["description"] = _strip_catalog_description(desc)
        if _is_lab_item_group(item.get("item_group")):
            item.update(_public_lab_item_profile(code))
            # Profile merge must not overwrite patient offer pricing
            item["rate"] = rate
            item["standard_rate"] = rate
            item["mrp"] = mrp or None
            item["discount_percent"] = round((1 - rate / mrp) * 100) if mrp and mrp > rate else 0
            item["price_basis"] = offer["price_basis"]
            item["foco_rate"] = offer.get("foco_rate")
            item["wallet_earn_percent"] = int(WALLET_EARN_ON_PURCHASE * 100)
            item["wallet_earn_amount"] = round(rate * WALLET_EARN_ON_PURCHASE, 2) if rate else 0
            item["member_tag"] = item.get("member_tag") or _subscription_coupon_tag(
                item.get("item_group"), user
            )
            item["coupon_label"] = item.get("coupon_label") or _coupon_for_item_group(
                item.get("item_group"), promos
            )
    return items


def _company_name():
    """Company for new sales orders, invoices and payments (HEC Payment Settings → main company)."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase121_payment_core import sales_company

    return sales_company() or frappe.get_all("Company", limit=1)[0].name


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

# sha256("hec-default-pw:" + password) of the seeded demo passwords; only digests are kept so the
# credentials are not published here. A login with any of them is forced through the password change.
DEFAULT_PASSWORD_DIGESTS = frozenset(
    {
        "6fae7f98cb01db2886a2e447ddefcba2216812810f93a0ee1f047a1cc1dba7bb",
        "3c042705002ed60d9c99cd61680a4738cdbfb511e5f6eea51d05f73bdb233b85",
        "691c04773b88af06aa58edebb09721cb5669e2677ee3400a37a98a28a57b317e",
        "23cd8642807617a85b43858fb038ce2af2451f2a64d6e427a300857159f82921",
        "96d7183f32967ef35bc927ae07532a9620a497eed38eb87824a5b4c3f544e4c9",
        "4b4e1c726915b88e15e948a39d4f25fb4771311a3e0a37183137a2b7cd3d939a",
        "368ba4abd7eec7c3431f568b354278f3ab22d40878ff6baef45e36338ff1a610",
        "ba1750a12d76f0dc13f924f24ac1545b34b5fb2aef6284a487d7b9e8ad180d41",
        "3c5eb1f200c4f5f0d4d9c2b1961833c3466c3437ff4f2727bd6742c0606805b1",
        "c33d348e42b5ca3f5421c886e0310e6ca8a77c6967e27205d4096ebc1aab22db",
        "fcf61429c03f9e657603c9de1565a3585d01c0cd5d2fd15a3097138895d2c628",
        "e05ea13762a64b61231508284e327a5268bf58873a41d1c830fa21122a38a12b",
        "babd93f34f1b928a1f055ac9ed5ce66fcf67473e85e950e841e2775677d67585",
        "3348b91332fc09bfd7032b903645d14e952310fd3c15964bb887b4df5b6bc53e",
        "5714f31f7a00d68d1eb978fa457dc66bd65fa8be4f009060fa8a06eb08a0155d",
    }
)


def _is_default_password(pwd):
    if not pwd:
        return False
    digest = hashlib.sha256(f"hec-default-pw:{pwd}".encode("utf-8")).hexdigest()
    return digest in DEFAULT_PASSWORD_DIGESTS


def _parse_request_value(key, explicit=None):
    if explicit:
        return explicit
    value = frappe.form_dict.get(key)
    if value:
        return value
    try:
        raw = frappe.request.data if getattr(frappe.local, "request", None) else None
        if raw:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            if raw.strip().startswith("{"):
                return json.loads(raw).get(key)
    except Exception:
        pass
    return None


def _valid_session_user():
    user = frappe.session.user
    if not user or user in ("Guest", "None"):
        return None
    if not frappe.db.exists("User", user):
        return None
    return user


def _ensure_mobile_session(sid=None):
    """Resume login for mobile clients (Cookie header is not always sent on POST)."""
    user = _valid_session_user()
    if user:
        return user

    sid = _parse_request_value("sid", sid)
    if not sid and getattr(frappe.local, "request", None):
        sid = frappe.request.cookies.get("sid")

    if not sid:
        return None

    try:
        from frappe.auth import LoginManager

        login_manager = LoginManager()
        login_manager.user = None
        login_manager.resume = True
        login_manager.sid = sid
        login_manager.get_user()
        user = login_manager.user
        if user and user not in ("Guest", "None") and frappe.db.exists("User", user):
            if frappe.db.get_value("User", user, "enabled"):
                frappe.local.login_manager = login_manager
                frappe.set_user(user)
                return user
    except Exception:
        frappe.log_error(title="_ensure_mobile_session", message=frappe.get_traceback())

    return None


def _require_mobile_auth(sid=None):
    user = _ensure_mobile_session(sid)
    if not user:
        return None
    return user


def _resolve_user_id(login_id):
    if not login_id:
        return login_id

    login_id = login_id.strip()
    if login_id.lower() == "none":
        return None
    if frappe.db.exists("User", login_id):
        return login_id

    by_username = frappe.db.get_value("User", {"username": login_id}, "name")
    if by_username:
        return by_username

    by_email = frappe.db.get_value("User", {"email": login_id}, "name")
    return by_email or login_id


PARTNER_PORTAL_HOSTS = ("partners.remediumlabs.in", "partners.e-remedium.in", "phlebofirst.com")


def _is_partner_portal_login():
    """Partner portal and patient vault logins skip the patient email-verification gate."""
    if cstr(frappe.form_dict.get("portal")).strip().lower() in ("partners", "vault"):
        return True
    req = getattr(frappe.local, "request", None)
    if not req:
        return False
    for header in ("Origin", "Referer", "X-Forwarded-Host"):
        value = cstr(req.headers.get(header)).lower()
        if any(host in value for host in PARTNER_PORTAL_HOSTS):
            return True
    return False


@frappe.whitelist(allow_guest=True)
def authenticate_user(usr=None, pwd=None):
    """Validate login and return session token + role metadata."""
    frappe.flags.ignore_csrf = True
    usr = _parse_request_value("usr", usr)
    pwd = _parse_request_value("pwd", pwd)

    if not usr or not pwd:
        return _error(_("Username and password are required"))

    usr = _resolve_user_id(usr)
    if not usr:
        return _error(_("Username and password are required"))

    try:
        login_manager = frappe.local.login_manager
        login_manager.authenticate(usr, pwd)
        from health_ecosystem_core.health_ecosystem_core.clinical_login_2fa import start_challenge

        challenge = start_challenge(
            login_manager.user,
            must_change_password=_user_must_change_password(login_manager.user, pwd=pwd),
            partner=_is_partner_portal_login(),
        )
        if challenge is not None:
            return challenge
        login_manager.post_login()
    except frappe.AuthenticationError:
        return _error(_("Invalid credentials"), 401)
    except frappe.ValidationError as exc:
        message = str(exc)
        if "disabled" in message.lower():
            return _error(_("User account is disabled. Contact your administrator."), 401)
        return _error(_("Invalid credentials"), 401)
    except Exception:
        frappe.log_error(title="authenticate_user", message=frappe.get_traceback())
        return _error(_("Invalid credentials"), 401)

    try:
        user_id = frappe.session.user
        if not user_id or user_id == "Guest":
            return _error(_("Invalid credentials"), 401)

        user = frappe.get_doc("User", user_id)
        roles = list(frappe.get_roles(user_id))
        from health_ecosystem_core.health_ecosystem_core.clinical_email import user_requires_email_verification

        if not _is_partner_portal_login() and user_requires_email_verification(user_id):
            frappe.local.login_manager.logout()
            frappe.db.commit()
            return _error(
                _("Please verify your email before signing in. Check your inbox or request a new link."),
                401,
            )

        must_change_password = _user_must_change_password(user_id, pwd=pwd)

        franchisee = None
        if "Franchisee Operator" in roles:
            franchisee = frappe.db.get_value(
                "Franchisee Profile",
                {"linked_user": user_id, "active_status": "Active"},
                [
                    "name",
                    "branch_code",
                    "franchise_name",
                    "territory_region",
                    "address",
                    "contact_phone",
                    "contact_email",
                    "commission_percentage_rate",
                ],
                as_dict=True,
            )

        return _success(
            {
                "user": user_id,
                "username": user.username or user_id,
                "full_name": user.full_name,
                "roles": roles,
                "sid": frappe.session.sid,
                "must_change_password": must_change_password,
                "franchisee": franchisee,
            },
            message="Authenticated",
        )
    except Exception:
        frappe.log_error(title="authenticate_user_response", message=frappe.get_traceback())
        return _error(_("Login failed. Please try again."), 500)


def _user_must_change_password(user_id, pwd=None):
    if _is_default_password(pwd):
        return True

    return not bool(frappe.db.get_value("User", user_id, "last_password_reset_date"))


@frappe.whitelist()
def update_password_on_first_login(new_password=None, confirm_password=None):
    """Force password update route for default credential users."""
    new_password = _parse_request_value("new_password", new_password)
    confirm_password = _parse_request_value("confirm_password", confirm_password)

    if frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)

    if not new_password or not confirm_password:
        return _error(_("Both password fields are required"))

    if new_password != confirm_password:
        return _error(_("Passwords do not match"))

    if len(new_password) < 10:
        return _error(_("Password must be at least 10 characters"))

    frappe.set_user(frappe.session.user)
    from frappe.utils.password import update_password

    update_password(frappe.session.user, new_password, logout_all_sessions=False)

    frappe.db.set_value("User", frappe.session.user, "last_password_reset_date", today())

    return _success(
        {"user": frappe.session.user, "sid": frappe.session.sid},
        message="Password updated successfully",
    )


# ---------------------------------------------------------------------------
# Customer TRF
# ---------------------------------------------------------------------------

def _create_customer_trf_impl(
    patient_name=None,
    age=None,
    gender=None,
    test_required=None,
    test_items=None,
    franchisee_id=None,
    patient_phone=None,
    collection_address=None,
    collection_latitude=None,
    collection_longitude=None,
    collection_slot=None,
    amount=None,
    unique_barcode=None,
    payment_method=None,
    promo_code=None,
):
    """Core TRF + sales invoice logic (not whitelisted — call from public APIs only)."""
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import create_customer_trf_booking

    return create_customer_trf_booking(
        patient_name=patient_name,
        age=age,
        gender=gender,
        test_required=test_required,
        test_items=test_items,
        franchisee_id=franchisee_id,
        patient_phone=patient_phone,
        collection_address=collection_address,
        collection_latitude=collection_latitude,
        collection_longitude=collection_longitude,
        collection_slot=collection_slot,
        amount=amount,
        unique_barcode=unique_barcode,
        payment_method=payment_method,
        promo_code=promo_code,
    )


@frappe.whitelist(allow_guest=True)
def create_customer_trf(
    patient_name=None,
    age=None,
    gender=None,
    test_required=None,
    test_items=None,
    franchisee_id=None,
    patient_phone=None,
    collection_address=None,
    collection_slot=None,
    amount=None,
    unique_barcode=None,
    payment_method=None,
    sid=None,
):
    """Create TRF from mobile app and auto-generate Sales Invoice."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    return _create_customer_trf_impl(
        patient_name=patient_name,
        age=age,
        gender=gender,
        test_required=test_required,
        test_items=test_items,
        franchisee_id=franchisee_id,
        patient_phone=patient_phone,
        collection_address=collection_address,
        collection_slot=collection_slot,
        amount=amount,
        unique_barcode=unique_barcode,
        payment_method=payment_method,
    )


def _ensure_healthcare_invoice_fields():
    if "healthcare" not in (frappe.get_installed_apps() or []):
        return
    try:
        from health_ecosystem_core.health_ecosystem_core.init import (
            ensure_healthcare_sales_invoice_fields,
        )

        ensure_healthcare_sales_invoice_fields()
    except Exception:
        frappe.log_error(title="ensure_healthcare_invoice_fields", message=frappe.get_traceback())


def _create_sales_order_for_trf(trf, patient_id=None):
    """Create submitted Sales Order for mobile lab booking (invoice after delivery)."""
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import get_trf_test_lines
    from health_ecosystem_core.health_ecosystem_core.patient_bridge import ensure_customer_for_patient

    company = _company_name()
    lines = get_trf_test_lines(trf)
    if not lines:
        lines = [{"item_code": trf.test_required, "qty": 1, "rate": flt(trf.amount)}]

    if not patient_id and frappe.get_meta("Customer TRF").has_field("patient"):
        patient_id = trf.get("patient")

    customer = ensure_customer_for_patient(patient_id, trf.patient_name, trf.patient_phone)

    so_items = []
    for line in lines:
        so_items.append(
            {
                "item_code": line["item_code"],
                "qty": flt(line.get("qty", 1)) or 1,
                "rate": flt(line.get("rate")) or _resolve_selling_rate(line["item_code"]),
                "description": f"Lab Test for {trf.patient_name} - {trf.unique_barcode}",
                "delivery_date": today(),
            }
        )

    so = frappe.get_doc(
        {
            "doctype": "Sales Order",
            "customer": customer,
            "company": company,
            "transaction_date": today(),
            "delivery_date": today(),
            "order_type": "Sales",
            "items": so_items,
            "remarks": f"Mobile app TRF {trf.name} — invoice on delivery",
        }
    )
    so.insert(ignore_permissions=True)
    so.submit()
    return so


@frappe.whitelist()
def create_sales_invoice_from_trf(trf_id=None):
    """Desk/staff: create Sales Invoice from TRF Sales Order after delivery starts."""
    if frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)
    if not _is_staff_user():
        return _error(_("Permission denied"), 403)

    trf_id = _parse_request_value("trf_id", trf_id)
    if not trf_id or not frappe.db.exists("Customer TRF", trf_id):
        return _error(_("TRF not found"), 404)

    trf = frappe.get_doc("Customer TRF", trf_id)
    if trf.sales_invoice:
        return _success({"sales_invoice": trf.sales_invoice}, message="Invoice already exists")

    if not trf.sales_order:
        return _error(_("No Sales Order linked to this TRF"))

    from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice

    si = frappe.get_doc(make_sales_invoice(trf.sales_order))
    _ensure_healthcare_invoice_fields()
    if frappe.get_meta("Sales Invoice").has_field("service_unit"):
        si.service_unit = None
    si.insert(ignore_permissions=True)
    si.submit()
    trf.db_set("sales_invoice", si.name)
    frappe.db.commit()
    return _success({"sales_invoice": si.name}, message="Sales Invoice created")


def _create_sales_invoice_for_trf(trf):
    _ensure_healthcare_invoice_fields()
    company = _company_name()
    item_rate = flt(trf.amount) or _resolve_selling_rate(trf.test_required)

    customer = _ensure_customer(trf.patient_name, trf.patient_phone)

    invoice_data = {
        "doctype": "Sales Invoice",
        "customer": customer,
        "company": company,
        "due_date": today(),
        "items": [
            {
                "item_code": trf.test_required,
                "qty": 1,
                "rate": item_rate,
                "description": f"Lab Test for {trf.patient_name} - {trf.unique_barcode}",
            }
        ],
        "remarks": f"Auto-generated from TRF {trf.name}",
    }
    if frappe.get_meta("Sales Invoice").has_field("service_unit"):
        invoice_data["service_unit"] = None

    si = frappe.get_doc(invoice_data)
    si.insert(ignore_permissions=True)
    si.submit()
    return si


def _ensure_customer(patient_name, phone=None):
    customer_name = patient_name.strip()
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
    return customer.name


# ---------------------------------------------------------------------------
# Razorpay payment verification
# ---------------------------------------------------------------------------

@frappe.whitelist(allow_guest=True)
def verify_razorpay_payment(
    razorpay_payment_id=None,
    razorpay_order_id=None,
    razorpay_signature=None,
    reference_doctype=None,
    reference_name=None,
    sid=None,
):
    """Validate Razorpay signature and record Payment Entry."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not all([razorpay_payment_id, razorpay_order_id, razorpay_signature, reference_doctype, reference_name]):
        return _error(_("Missing payment verification fields"))

    if reference_doctype not in ("Customer TRF", "Pharmacy Order", "Doctor Appointment", "Health Subscription"):
        return _error(
            _(
                "Invalid payment reference. Use Customer TRF, Pharmacy Order, Doctor Appointment or "
                "Health Subscription (not Payment Gateway). Received: {0}"
            ).format(reference_doctype or "")
        )

    if not frappe.db.exists(reference_doctype, reference_name):
        return _error(_("Reference document not found"))

    creds = _get_site_api_credentials()
    key_secret = creds.get("razorpay_key_secret")
    if not key_secret and not _razorpay_test_mode():
        return _error(_("Razorpay secret not configured on server"))

    doc = frappe.get_doc(reference_doctype, reference_name)
    if reference_doctype == "Health Subscription":
        if not _subscription_owner_ok(doc):
            return _error(_("Not permitted"), 403)
        if doc.status == "Active":
            if cstr(doc.razorpay_subscription_id) == cstr(razorpay_payment_id):
                return _success({"reference": reference_name, "status": "Paid", "already_verified": True})
            return _error(_("This subscription is already active"), 409)
    if (getattr(doc, "razorpay_payment_status", None) or "") == "Paid":
        if cstr(getattr(doc, "payment_id", None)) == cstr(razorpay_payment_id):
            return _success(
                {
                    "reference": reference_name,
                    "payment_entry": None,
                    "sales_invoice": getattr(doc, "sales_invoice", None),
                    "status": "Paid",
                    "already_verified": True,
                },
                message="Payment already verified",
            )
        return _error(_("This order is already paid with a different payment"), 409)

    if not _razorpay_test_mode():
        from health_ecosystem_core.health_ecosystem_core.clinical_razorpay import confirm_payment, signature_valid

        if not signature_valid(razorpay_order_id, razorpay_payment_id, razorpay_signature):
            return _error(_("Payment signature verification failed"), 403)
        check = confirm_payment(
            razorpay_order_id,
            razorpay_payment_id,
            expected_receipt=_razorpay_receipt(reference_doctype, reference_name),
        )
        payable_paise = int(round(_payable_amount(doc) * 100))
        if check.get("ok") and check.get("checked") and payable_paise and cint(check.get("amount_paise")) < payable_paise - 100:
            check = {"ok": False, "reason": "amount_short"}
        if not check.get("ok"):
            frappe.log_error(
                title="verify_razorpay_payment rejected",
                message=f"{reference_doctype} {reference_name} {razorpay_order_id} {razorpay_payment_id}: {check.get('reason')}",
            )
            return _error(_("This payment does not match the order being paid. Please contact support."), 403)

    result = _finalize_checkout_payment(
        reference_doctype, reference_name, razorpay_payment_id, order_id=razorpay_order_id, via="Checkout"
    )
    if result.get("already_verified") and not result.get("same_payment"):
        return _error(_("This order is already paid with a different payment"), 409)
    return _success(result, message="Payment already verified" if result.get("already_verified") else "Payment verified")


def _finalize_checkout_payment(reference_doctype, reference_name, payment_id, order_id=None, via="Checkout"):
    """Mark a checkout document paid, invoice it and post the Payment Entry. Row-locked; safe to call twice."""
    frappe.db.get_value(reference_doctype, reference_name, "name", for_update=True)
    doc = frappe.get_doc(reference_doctype, reference_name)
    if reference_doctype == "Health Subscription":
        if doc.status == "Active":
            return {
                "reference": reference_name,
                "status": "Paid",
                "already_verified": True,
                "same_payment": cstr(doc.razorpay_subscription_id) == cstr(payment_id),
            }
        result = _complete_subscription_payment(doc, _payable_amount(doc), payment_id)
        _mark_payment_intent(order_id, payment_id, via)
        frappe.db.commit()
        return result
    if (getattr(doc, "razorpay_payment_status", None) or "") == "Paid":
        return {
            "reference": reference_name,
            "payment_entry": None,
            "sales_invoice": getattr(doc, "sales_invoice", None),
            "status": "Paid",
            "already_verified": True,
            "same_payment": cstr(getattr(doc, "payment_id", None)) == cstr(payment_id),
        }

    amount = flt(getattr(doc, "amount", None) or getattr(doc, "order_total", None))
    razorpay_payment_id = payment_id
    previous_user = frappe.session.user
    payment_entry = None
    sales_invoice_name = None
    try:
        frappe.set_user("Administrator")
        doc.db_set("razorpay_payment_status", "Paid")
        doc.db_set("payment_id", razorpay_payment_id)

        # Ensure Sales Invoice exists at checkout for TRF / pharmacy
        try:
            if reference_doctype == "Customer TRF":
                sales_invoice_name = getattr(doc, "sales_invoice", None)
                if not sales_invoice_name:
                    si = None
                    if getattr(doc, "sales_order", None) and frappe.db.exists("Sales Order", doc.sales_order):
                        try:
                            from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice

                            si = frappe.get_doc(make_sales_invoice(doc.sales_order))
                            si.insert(ignore_permissions=True)
                            si.submit()
                        except Exception:
                            si = _create_sales_invoice_for_trf(doc)
                    else:
                        si = _create_sales_invoice_for_trf(doc)
                    if si:
                        sales_invoice_name = si.name
                        if frappe.get_meta("Customer TRF").has_field("sales_invoice"):
                            doc.db_set("sales_invoice", sales_invoice_name)
                doc = frappe.get_doc(reference_doctype, reference_name)
            elif reference_doctype == "Pharmacy Order":
                sales_invoice_name = getattr(doc, "sales_invoice", None)
                if not sales_invoice_name:
                    items = getattr(doc, "items", None) or []
                    if not items:
                        raw = getattr(doc, "items_json", None) or "[]"
                        if isinstance(raw, str):
                            try:
                                items = json.loads(raw) if raw else []
                            except Exception:
                                items = []
                        elif isinstance(raw, list):
                            items = raw
                    si = _create_sales_invoice_for_pharmacy(doc, items)
                    if si:
                        sales_invoice_name = si.name
                        if frappe.get_meta("Pharmacy Order").has_field("sales_invoice"):
                            doc.db_set("sales_invoice", sales_invoice_name)
                # Confirm order only after successful Online payment
                if frappe.get_meta("Pharmacy Order").has_field("delivery_status"):
                    current = getattr(doc, "delivery_status", None) or "Pending"
                    if current in ("Pending", "Quote Sent", ""):
                        doc.db_set("delivery_status", "Confirmed")
                doc = frappe.get_doc(reference_doctype, reference_name)
        except Exception:
            frappe.log_error(title="checkout_sales_invoice", message=frappe.get_traceback())

        try:
            payment_entry = _create_payment_entry(
                doc,
                amount,
                razorpay_payment_id,
                sales_invoice=sales_invoice_name or getattr(doc, "sales_invoice", None),
                mode_kind="razorpay",
            )
        except Exception:
            frappe.log_error(title="Razorpay Payment Entry", message=frappe.get_traceback())
        _mark_payment_intent(order_id, razorpay_payment_id, via)
        frappe.db.commit()
    finally:
        frappe.set_user(previous_user)

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_notifications import notify_payment_success

        notify_payment_success(reference_doctype, reference_name, amount=amount)
    except Exception:
        frappe.log_error(title="notify_payment_success", message=frappe.get_traceback())

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase27b import on_payment_confirmed

        on_payment_confirmed(reference_doctype, reference_name)
    except Exception:
        frappe.log_error(title="on_payment_confirmed", message=frappe.get_traceback())

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase75_patient_referral import (
            handle_payment_confirmed,
        )

        handle_payment_confirmed(reference_doctype, reference_name, paid_amount=amount)
    except Exception:
        frappe.log_error(title="phase75_payment_confirmed", message=frappe.get_traceback())

    return {
        "reference": reference_name,
        "payment_entry": payment_entry.name if payment_entry else None,
        "sales_invoice": sales_invoice_name or getattr(doc, "sales_invoice", None),
        "status": "Paid",
    }


def _mark_payment_intent(order_id, payment_id, via):
    if not order_id:
        return
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase121_payment_core import mark_intent_paid

        mark_intent_paid(order_id, payment_id, via)
    except Exception:
        frappe.log_error(title="mark_payment_intent", message=frappe.get_traceback())


def _wallet_stash_from_intent(order_id, scope):
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase121_payment_core import wallet_stash_from_intent

        return wallet_stash_from_intent(order_id, scope)
    except Exception:
        frappe.log_error(title="wallet_stash_from_intent", message=frappe.get_traceback())
        return None


def _record_payment_intent(scope, order_id, amount, **kwargs):
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase121_payment_core import record_intent

        record_intent(scope, order_id, amount, **kwargs)
    except Exception:
        frappe.log_error(title="record_payment_intent", message=frappe.get_traceback())


@frappe.whitelist(allow_guest=True)
def get_followup_system(sid=None):
    """Capability probe for Flutter — follow-ups live on Doctor Appointment (Phase 42/47)."""
    frappe.flags.ignore_csrf = True
    return _success(
        {
            "available": True,
            "system": "Doctor Appointment follow-up",
            "apis": {
                "list_queue": "list_consult_followup_queue",
                "schedule": "schedule_consult_followup",
                "schedule_from_tele": "schedule_appointment_followup",
                "my_appointments": "get_my_appointments",
            },
            "fields": ["follow_up_date", "follow_up_notes", "consultation_mode", "meeting_link"],
        },
        message="Follow-up system ready",
    )


@frappe.whitelist(allow_guest=True)
def list_followups(limit=50, sid=None):
    """Alias → list_consult_followup_queue."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase47_complete_care import (
        list_consult_followup_queue,
    )

    return list_consult_followup_queue(limit=limit, sid=sid)


@frappe.whitelist(allow_guest=True)
def schedule_followup(
    appointment_id=None,
    follow_up_date=None,
    follow_up_notes=None,
    book_slot=None,
    appointment_time=None,
    sid=None,
):
    """Alias → schedule_consult_followup / schedule_appointment_followup."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase47_complete_care import (
        schedule_consult_followup,
    )

    return schedule_consult_followup(
        appointment_id=appointment_id,
        follow_up_date=follow_up_date,
        follow_up_notes=follow_up_notes,
        book_slot=book_slot,
        appointment_time=appointment_time,
        sid=sid,
    )


@frappe.whitelist(allow_guest=True)
def get_pharmacy_order_invoice(order_id=None, sid=None):
    """Return invoice payload for a paid Pharmacy Order (view/download from order details)."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    order_id = (_parse_request_value("order_id", order_id) or "").strip()
    if not order_id or not frappe.db.exists("Pharmacy Order", order_id):
        return _error(_("Pharmacy order not found"), 404)

    doc = frappe.get_doc("Pharmacy Order", order_id)
    pay_status = getattr(doc, "razorpay_payment_status", None) or "Pending"
    if pay_status != "Paid":
        return _error(_("Invoice available only after successful payment"))

    items = []
    raw = getattr(doc, "items_json", None) or "[]"
    if isinstance(raw, str):
        try:
            items = json.loads(raw) if raw else []
        except Exception:
            items = []
    elif isinstance(raw, list):
        items = raw

    si = getattr(doc, "sales_invoice", None)
    invoice_url = None
    if si and frappe.db.exists("Sales Invoice", si):
        invoice_url = f"/api/method/frappe.utils.print_format.download_pdf?doctype=Sales%20Invoice&name={si}&format=Standard&no_letterhead=0"

    return _success(
        {
            "order_id": doc.name,
            "invoice_date": str(getattr(doc, "modified", None) or today())[:10],
            "customer_name": doc.customer_name,
            "customer_phone": getattr(doc, "customer_phone", None),
            "delivery_address": doc.delivery_address,
            "items": items,
            "order_total": flt(doc.order_total),
            "discount_amount": flt(getattr(doc, "discount_amount", 0) or 0),
            "payment_id": getattr(doc, "payment_id", None),
            "payment_mode": getattr(doc, "payment_method", None) or "Online",
            "razorpay_payment_status": pay_status,
            "delivery_status": getattr(doc, "delivery_status", None),
            "sales_invoice": si,
            "invoice_pdf_url": invoice_url,
        }
    )


def _complete_subscription_payment(doc, amount, payment_id):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase43_subscription_checkout import (
        activate_subscription_after_payment,
    )

    previous_user = frappe.session.user
    payment_entry = None
    try:
        frappe.set_user("Administrator")
        subscription = activate_subscription_after_payment(doc.name, payment_id)
        plan = frappe.get_doc("Health Subscription Plan", doc.plan)
        if cint(getattr(plan, "session_pack", 0)) and frappe.get_meta("Health Subscription").has_field("sessions_total"):
            included = cint(getattr(plan, "included_sessions", 0) or 0)
            frappe.db.set_value(
                "Health Subscription",
                doc.name,
                {
                    "sessions_total": included,
                    "sessions_remaining": included if included > 0 else 9999,
                    "wellness_wing": getattr(plan, "wellness_wing", None),
                },
            )
        try:
            doc.patient_name = frappe.db.get_value("User", doc.user, "full_name") or doc.user
            payment_entry = _create_payment_entry(
                doc, amount, payment_id, mode_kind="razorpay", remarks=f"Razorpay subscription payment {payment_id} ({doc.name})"
            )
        except Exception:
            frappe.log_error(title="Subscription Payment Entry", message=frappe.get_traceback())
        frappe.db.commit()
    finally:
        frappe.set_user(previous_user)
    return {
        "reference": doc.name,
        "payment_entry": payment_entry.name if payment_entry else None,
        "subscription": subscription,
        "status": "Paid",
    }


def _payable_amount(doc):
    amount = flt(getattr(doc, "amount", None) or getattr(doc, "order_total", None))
    if amount <= 0 and getattr(doc, "sales_order", None) and frappe.db.exists("Sales Order", doc.sales_order):
        amount = flt(frappe.db.get_value("Sales Order", doc.sales_order, "grand_total"))
    return amount


def _razorpay_receipt(reference_doctype, reference_name):
    return f"{reference_doctype}-{reference_name}"[:40]


MODE_OF_PAYMENT_CANDIDATES = {
    "razorpay": ("Razorpay", "Wire Transfer", "Bank Draft"),
    "cash": ("Cash",),
    "upi": ("UPI", "Wire Transfer"),
    "card": ("Credit Card", "Debit Card", "Wire Transfer"),
    "cheque": ("Cheque",),
    "bank": ("Wire Transfer", "Bank Draft"),
}


def _mode_of_payment(kind):
    for name in MODE_OF_PAYMENT_CANDIDATES.get(kind, ()) + ("Wire Transfer",):
        if frappe.db.exists("Mode of Payment", name):
            return name
    return frappe.db.get_value("Mode of Payment", {"enabled": 1}, "name") or "Cash"


def _create_payment_entry(
    doc,
    amount,
    payment_id,
    sales_invoice=None,
    mode_kind="razorpay",
    remarks=None,
    posting_date=None,
    collection_ref=None,
    collected_by=None,
):
    """Submitted Receive Payment Entry (one per payment id); an invoice is allocated before submit."""
    from erpnext.accounts.party import get_party_account
    from erpnext.accounts.utils import get_account_currency

    payment_key = f"PAY-{payment_id}"[:140]
    keyed = frappe.get_meta("Payment Entry").has_field("hec_payment_key")
    existing = keyed and frappe.db.get_value("Payment Entry", {"hec_payment_key": payment_key, "docstatus": 1}, "name")
    if existing:
        return frappe.get_doc("Payment Entry", existing)

    company = _company_name()
    invoice = None
    if sales_invoice and frappe.db.exists("Sales Invoice", sales_invoice):
        invoice = frappe.db.get_value(
            "Sales Invoice", sales_invoice, ["name", "customer", "company", "outstanding_amount", "docstatus"], as_dict=True
        )
        if not invoice or invoice.docstatus != 1:
            invoice = None
    if invoice:
        customer = invoice.customer
        company = invoice.company or company
    else:
        customer_name = getattr(doc, "patient_name", None) or getattr(doc, "customer_name", None)
        customer = _ensure_customer(customer_name)
    amount = flt(amount)
    if amount <= 0 and getattr(doc, "sales_order", None):
        amount = flt(frappe.db.get_value("Sales Order", doc.sales_order, "grand_total"))
    if amount <= 0:
        amount = flt(getattr(doc, "amount", None) or getattr(doc, "order_total", None))

    mode_of_payment = _mode_of_payment(mode_kind)
    paid_from = get_party_account("Customer", customer, company)
    paid_to = frappe.db.get_value(
        "Mode of Payment Account",
        {"parent": mode_of_payment, "company": company},
        "default_account",
    ) or frappe.db.get_value("Company", company, "default_bank_account")
    if not paid_to:
        paid_to = frappe.db.get_value(
            "Account",
            {"company": company, "account_type": "Bank", "is_group": 0},
            "name",
        )
    if not paid_from or not paid_to:
        frappe.throw(_("Payment accounts are not configured for {0}").format(company))

    paid_from_currency = get_account_currency(paid_from)
    paid_to_currency = get_account_currency(paid_to)

    pe = frappe.get_doc(
        {
            "doctype": "Payment Entry",
            "payment_type": "Receive",
            "party_type": "Customer",
            "party": customer,
            "company": company,
            "paid_from": paid_from,
            "paid_to": paid_to,
            "paid_from_account_currency": paid_from_currency,
            "paid_to_account_currency": paid_to_currency,
            "paid_amount": amount,
            "received_amount": amount,
            "source_exchange_rate": 1,
            "target_exchange_rate": 1,
            "posting_date": posting_date or today(),
            "reference_no": payment_id,
            "reference_date": posting_date or today(),
            "mode_of_payment": mode_of_payment,
            "remarks": remarks or f"Razorpay payment {payment_id}",
        }
    )
    if keyed:
        pe.hec_payment_key = payment_key
    pe_meta = frappe.get_meta("Payment Entry")
    if collection_ref and pe_meta.has_field("hec_collection_ref"):
        pe.hec_collection_ref = collection_ref
    if collected_by and pe_meta.has_field("hec_collected_by"):
        pe.hec_collected_by = collected_by
    if invoice and flt(invoice.outstanding_amount) > 0:
        pe.append(
            "references",
            {
                "reference_doctype": "Sales Invoice",
                "reference_name": invoice.name,
                "allocated_amount": min(amount, flt(invoice.outstanding_amount)),
            },
        )
    pe.set_missing_values()
    pe.set_amounts()
    pe.flags.ignore_permissions = True
    pe.insert()
    pe.submit()
    return pe


# ---------------------------------------------------------------------------
# LIS machine integration
# ---------------------------------------------------------------------------

LIS_BRIDGE_STATUSES = ("Unknown", "Online", "Offline", "Error")


@frappe.whitelist(allow_guest=True)
def lis_bridge_heartbeat(analyzer_id=None, status=None, machine_reference=None):
    """Record analyzer liveness reported by the LIS bridge.

    Best-effort by design: the bridge must never stall on a heartbeat, so an
    unknown analyzer is reported back as unregistered rather than raised.
    """
    _validate_machine_auth()

    analyzer_id = _parse_request_value("analyzer_id", analyzer_id)
    status = _parse_request_value("status", status) or "Online"
    machine_reference = _parse_request_value("machine_reference", machine_reference)

    if not analyzer_id and not machine_reference:
        return _error(_("analyzer_id or machine_reference is required"))

    status = str(status).strip().title()
    if status not in LIS_BRIDGE_STATUSES:
        status = "Unknown"

    if not frappe.db.exists("DocType", "Lab Equipment"):
        return _success({"recorded": False, "reason": "Lab Equipment not installed"})

    meta = frappe.get_meta("Lab Equipment")
    if not meta.has_field("lis_last_seen"):
        return _success({"recorded": False, "reason": "Liveness fields not migrated"})

    equipment = None
    for field, value in (
        ("lis_machine_reference", machine_reference),
        ("lis_machine_reference", analyzer_id),
        ("machine_name_alias", analyzer_id),
        ("equipment_name", analyzer_id),
    ):
        if not value:
            continue
        equipment = frappe.db.get_value("Lab Equipment", {field: value}, "name")
        if equipment:
            break

    if not equipment:
        return _success(
            {
                "recorded": False,
                "reason": "No Lab Equipment matches this analyzer",
                "analyzer_id": analyzer_id or "",
            }
        )

    updates = {"lis_last_seen": now_datetime()}
    if meta.has_field("lis_bridge_status"):
        updates["lis_bridge_status"] = status
    frappe.db.set_value("Lab Equipment", equipment, updates, update_modified=False)
    frappe.db.commit()

    return _success({"recorded": True, "equipment": equipment, "status": status})


def _analyzer_runs_test(item_code, machine_reference):
    """Decide whether an analyzer should receive a given test in its worklist.

    Returns (include, mapped). mapped is False when the test master carries no
    analyzer assignment, in which case we still include the test so an
    unconfigured site keeps working, but report it so the mapping gets finished.
    """
    if not machine_reference:
        return True, True
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import find_test_master_for_item

    master = find_test_master_for_item(item_code)
    if not master:
        return True, False
    try:
        if not frappe.get_meta("Diagnostic Test Master").has_field("lis_machine_reference"):
            return True, False
    except Exception:
        return True, False
    assigned = frappe.db.get_value("Diagnostic Test Master", master, "lis_machine_reference")
    if not assigned:
        return True, False
    return str(assigned).strip().lower() == str(machine_reference).strip().lower(), True


def _pf_trf_for_barcode(barcode):
    """PhleboFirst universal (PF-) barcode or a lab LIS barcode mapped to one -> Customer TRF (phase 133)."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase133_phlebofirst import resolve_trf_for_code
    except ImportError:
        return None
    try:
        return resolve_trf_for_code(barcode)
    except Exception:
        frappe.log_error(title="pf_trf_for_barcode", message=frappe.get_traceback())
        return None


@frappe.whitelist(allow_guest=True)
def get_barcode_tests(barcode=None, analyzer_id=None, machine_reference=None):
    """HTTP GET for LIS bridge: return tests assigned to a barcode.

    When the caller identifies itself with machine_reference, the worklist is
    filtered to tests that analyzer actually runs. Without it, every test is
    returned, which is correct for a single-analyzer install.
    """
    _validate_machine_auth()

    if not barcode:
        return _error(_("Barcode is required"))

    analyzer_id = _parse_request_value("analyzer_id", analyzer_id)
    machine_reference = _parse_request_value("machine_reference", machine_reference)

    trf_fields = [
        "name",
        "patient_name",
        "test_required",
        "order_status",
        "age",
        "gender",
        "razorpay_payment_status",
    ]
    trf = frappe.db.get_value("Customer TRF", {"unique_barcode": barcode}, trf_fields, as_dict=True)
    if not trf:
        pf_trf = _pf_trf_for_barcode(barcode)
        if pf_trf:
            trf = frappe.db.get_value("Customer TRF", pf_trf, trf_fields, as_dict=True)

    if not trf:
        return _error(_("Barcode not found"), 404)

    if trf.razorpay_payment_status != "Paid":
        from health_ecosystem_core.health_ecosystem_core.clinical_secrets import lis_requires_payment

        if lis_requires_payment():
            return _error(_("Payment pending for this barcode"), 402)

    if trf.order_status == "Cancelled":
        return _error(_("Order cancelled"), 410)

    if trf.order_status in ("Booked", "Sample Collected"):
        frappe.db.set_value("Customer TRF", trf.name, "order_status", "In Lab")
        trf.order_status = "In Lab"
        from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
            on_sample_received_at_lab,
        )

        on_sample_received_at_lab(trf.name)
        frappe.db.commit()

    from health_ecosystem_core.health_ecosystem_core.clinical_journey import sync_journey_from_trf

    sync_journey_from_trf(trf.name, trf.order_status)
    frappe.db.commit()

    from health_ecosystem_core.health_ecosystem_core.clinical_utils import get_trf_test_lines

    trf_doc = frappe.get_doc("Customer TRF", trf.name)
    test_payload = []
    skipped = []
    unmapped = []
    for line in get_trf_test_lines(trf_doc):
        item_name = line["item_name"]
        include, mapped = _analyzer_runs_test(line["item_code"], machine_reference)
        if not mapped:
            unmapped.append(item_name)
        if not include:
            skipped.append(item_name)
            continue
        machine_code = _machine_test_code(line["item_code"])
        test_payload.append(
            {
                "test_id": machine_code,
                "test_name": item_name,
                "erp_item_code": line["item_code"],
                "priority": "R",
            }
        )

    return _success(
        {
            "barcode": barcode,
            "trf_id": trf.name,
            "patient_name": trf.patient_name,
            "age": trf.age,
            "gender": trf.gender,
            "tests": test_payload,
            "order_status": trf.order_status,
            "analyzer_id": analyzer_id or "",
            "machine_reference": machine_reference or "",
            # Diagnostics for the bridge debug UI: what this analyzer will not run,
            # and which tests still need an analyzer assigned on their master.
            "skipped_for_analyzer": skipped,
            "unmapped_tests": unmapped,
        }
    )


def _normalize_machine_reference(reference):
    """machine_reference is a Select; an unlisted analyzer must not cost us the result."""
    fallback = "EM 200"
    if not reference:
        return fallback
    raw = str(reference).strip()
    if not raw:
        return fallback
    try:
        options = [
            opt.strip()
            for opt in (
                frappe.get_meta("Lab Test Result").get_field("machine_reference").options
                or ""
            ).split("\n")
            if opt.strip()
        ]
    except Exception:
        return raw
    if not options:
        return raw
    for option in options:
        if option.lower() == raw.lower():
            return option
    if "Other Analyzer" in options:
        frappe.log_error(
            f"Unlisted machine_reference {raw!r} stored as Other Analyzer",
            "LIS machine reference",
        )
        return "Other Analyzer"
    return fallback


@frappe.whitelist(allow_guest=True)
def log_machine_result(
    barcode=None,
    analyte_test_name=None,
    numeric_result_value=None,
    unit_of_measure=None,
    machine_reference=None,
    reference_range=None,
    abnormal_flag=None,
    erp_item_code=None,
    result_value_text=None,
):
    """Authorized LIS endpoint to push machine results.

    Accepts either a numeric value or a qualitative text value. CLIA analyzers
    report Reactive / Non-Reactive, which has no numeric form.
    """
    _validate_machine_auth()

    result_value_text = _parse_request_value("result_value_text", result_value_text)
    if isinstance(result_value_text, str):
        result_value_text = result_value_text.strip() or None
    if numeric_result_value in ("", "None"):
        numeric_result_value = None

    if not barcode or not analyte_test_name:
        return _error(_("Missing required result fields"))
    if numeric_result_value is None and not result_value_text:
        return _error(_("Result must carry either a numeric or a text value"))

    trf_name = frappe.db.get_value("Customer TRF", {"unique_barcode": barcode}, "name") or _pf_trf_for_barcode(barcode)
    if not trf_name:
        return _error(_("Barcode not linked to any TRF"), 404)

    from health_ecosystem_core.health_ecosystem_core.clinical_utils import (
        abnormal_flag_for_value,
        find_test_master_for_trf_result,
        normalize_abnormal_flag,
        parameter_reference_range,
    )

    trf = frappe.get_doc("Customer TRF", trf_name)
    erp_item_code = _parse_request_value("erp_item_code", erp_item_code)
    test_master, resolved_item = find_test_master_for_trf_result(
        trf, erp_item_code=erp_item_code, analyte_test_name=analyte_test_name
    )
    if not reference_range and test_master:
        reference_range = parameter_reference_range(test_master, analyte_test_name)
    if not abnormal_flag and test_master and numeric_result_value is not None:
        abnormal_flag = abnormal_flag_for_value(test_master, analyte_test_name, numeric_result_value)
    abnormal_flag = normalize_abnormal_flag(abnormal_flag)

    existing = frappe.db.get_value(
        "Lab Test Result",
        {"barcode_link": barcode, "analyte_test_name": analyte_test_name},
        "name",
    )
    if existing:
        return _success(
            {
                "result_id": existing,
                "trf_id": trf_name,
                "barcode": barcode,
                "order_status": frappe.db.get_value("Customer TRF", trf_name, "order_status"),
                "duplicate": True,
            },
            message="Result already logged",
        )

    result_data = {
        "doctype": "Lab Test Result",
        "barcode_link": barcode,
        "analyte_test_name": analyte_test_name,
        "numeric_result_value": (
            flt(numeric_result_value) if numeric_result_value is not None else None
        ),
        "unit_of_measure": unit_of_measure,
        "machine_reference": _normalize_machine_reference(machine_reference),
        "verification_timestamp": now_datetime(),
        "customer_trf": trf_name,
        "reference_range": reference_range,
        "abnormal_flag": abnormal_flag,
    }
    result_meta = frappe.get_meta("Lab Test Result")
    if result_value_text and result_meta.has_field("result_value_text"):
        result_data["result_value_text"] = result_value_text
    if resolved_item and result_meta.has_field("erp_item_code"):
        result_data["erp_item_code"] = resolved_item
    result = frappe.get_doc(result_data)
    result.insert(ignore_permissions=True)

    from health_ecosystem_core.health_ecosystem_core.clinical_phase8 import (
        _ensure_lab_report_for_trf,
        maybe_advance_trf_after_machine_result,
    )

    if frappe.db.exists("DocType", "Lab Report"):
        _ensure_lab_report_for_trf(trf_name)

    advanced = maybe_advance_trf_after_machine_result(trf_name)
    order_status = frappe.db.get_value("Customer TRF", trf_name, "order_status")

    frappe.db.commit()

    return _success(
        {
            "result_id": result.name,
            "trf_id": trf_name,
            "barcode": barcode,
            "order_status": order_status,
            "all_results_complete": advanced,
        },
        message="Result logged",
    )


# ---------------------------------------------------------------------------
# Franchisee dashboard data
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_franchisee_dashboard(franchisee_id=None):
    """Return dashboard metrics for franchisee admin pane."""
    if not franchisee_id:
        franchisee_id = frappe.db.get_value(
            "Franchisee Profile", {"linked_user": frappe.session.user}, "name"
        )

    if not franchisee_id or not frappe.db.exists("Franchisee Profile", franchisee_id):
        return _error(_("Franchisee profile not found"), 403)

    profile = frappe.get_doc("Franchisee Profile", franchisee_id)
    commission_rate = flt(profile.commission_percentage_rate) / 100

    todays_trfs = frappe.get_all(
        "Customer TRF",
        filters={
            "franchisee_id": franchisee_id,
            "creation": [">=", f"{today()} 00:00:00"],
        },
        fields=[
            "name",
            "patient_name",
            "unique_barcode",
            "order_status",
            "razorpay_payment_status",
            "amount",
            "creation",
        ],
        order_by="creation desc",
    )

    total_bookings = len(todays_trfs)
    paid_trfs = [t for t in todays_trfs if t.razorpay_payment_status == "Paid"]
    total_revenue = sum(flt(t.amount) for t in paid_trfs)
    commission_earned = total_revenue * commission_rate

    pipeline = {
        "Booked": 0,
        "Sample Collected": 0,
        "In Lab": 0,
        "Completed": 0,
    }
    for t in todays_trfs:
        if t.order_status in pipeline:
            pipeline[t.order_status] += 1

    all_trfs = frappe.get_all(
        "Customer TRF",
        filters={"franchisee_id": franchisee_id},
        fields=[
            "name",
            "patient_name",
            "unique_barcode",
            "order_status",
            "razorpay_payment_status",
            "amount",
            "modified",
        ],
        order_by="modified desc",
        limit=100,
    )

    wallet_entries = []
    if frappe.db.exists("DocType", "Franchisee Wallet Transaction"):
        wallet_entries = frappe.get_all(
            "Franchisee Wallet Transaction",
            filters={"franchisee": franchisee_id},
            fields=[
                "name",
                "transaction_type",
                "amount",
                "balance_after",
                "payment_reference",
                "remarks",
                "creation",
            ],
            order_by="creation desc",
            limit=20,
    )

    return _success(
        {
            "franchisee": {
                "name": profile.name,
                "franchise_name": profile.franchise_name,
                "branch_code": profile.branch_code,
                "commission_rate": profile.commission_percentage_rate,
                "category": getattr(profile, "category", None),
                "address": profile.address,
                "latitude": getattr(profile, "latitude", None),
                "longitude": getattr(profile, "longitude", None),
                "contact_phone": profile.contact_phone,
                "contact_email": profile.contact_email,
                "deposit_amount": getattr(profile, "deposit_amount", None),
                "franchisee_fee": getattr(profile, "franchisee_fee", None),
                "wallet_balance": getattr(profile, "wallet_balance", None),
                "due_amount": getattr(profile, "due_amount", None),
            },
            "wallet_balance": flt(getattr(profile, "wallet_balance", 0)),
            "wallet_entries": wallet_entries,
            "today_total_bookings": total_bookings,
            "today_revenue": total_revenue,
            "today_commission": commission_earned,
            "logistics_pipeline": pipeline,
            "todays_trfs": todays_trfs,
            "all_trfs": all_trfs,
        }
    )


# ---------------------------------------------------------------------------
# Booking lifecycle + mobile integration
# ---------------------------------------------------------------------------


def _serialize_trf(trf_row):
    if isinstance(trf_row, str):
        trf_row = frappe.db.get_value(
            "Customer TRF",
            trf_row,
            [
                "name",
                "patient_name",
                "patient_phone",
                "unique_barcode",
                "test_required",
                "order_status",
                "razorpay_payment_status",
                "payment_method",
                "amount",
                "collection_slot",
                "collection_address",
                "collection_latitude",
                "collection_longitude",
                "creation",
                "modified",
                "franchisee_id",
            ],
            as_dict=True,
        )
    if not trf_row:
        return None

    test_name = frappe.db.get_value("Item", trf_row.test_required, "item_name") or trf_row.test_required
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import get_trf_test_lines

    trf_key = trf_row if isinstance(trf_row, str) else getattr(trf_row, "name", None) or trf_row.get("name")
    tests = get_trf_test_lines(trf_key)
    test_labels = [t["item_name"] for t in tests]
    return {
        "trf_id": trf_row.name,
        "patient_name": trf_row.patient_name,
        "patient_phone": trf_row.patient_phone,
        "barcode": trf_row.unique_barcode,
        "test_required": trf_row.test_required,
        "test_name": test_name,
        "test_labels": test_labels,
        "tests": tests,
        "order_status": trf_row.order_status,
        "razorpay_payment_status": trf_row.razorpay_payment_status,
        "payment_method": getattr(trf_row, "payment_method", None) or "Online",
        "amount": flt(trf_row.amount),
        "collection_slot": str(trf_row.collection_slot) if trf_row.collection_slot else None,
        "collection_address": trf_row.collection_address,
        "collection_latitude": flt(getattr(trf_row, "collection_latitude", None)) or None,
        "collection_longitude": flt(getattr(trf_row, "collection_longitude", None)) or None,
        "creation": str(trf_row.creation),
        "modified": str(trf_row.modified),
        "franchisee_id": trf_row.franchisee_id,
    }


@frappe.whitelist(allow_guest=True)
def validate_session(sid=None):
    """Check whether the current session cookie is valid."""
    user = _ensure_mobile_session(sid)
    if not user:
        return _error(_("Not authenticated"), 401)

    if not frappe.db.get_value("User", user, "enabled"):
        return _error(_("User account is disabled. Contact your administrator."), 401)

    roles = frappe.get_roles(user)
    franchisee = None
    if "Franchisee Operator" in roles:
        franchisee = frappe.db.get_value(
            "Franchisee Profile",
            {"linked_user": user, "active_status": "Active"},
            [
                "name",
                "branch_code",
                "franchise_name",
                "territory_region",
                "address",
                "contact_phone",
                "contact_email",
                "commission_percentage_rate",
            ],
            as_dict=True,
        )

    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

    patient = patient_profile_for_user(user)

    return _success(
        {
            "user": user,
            "full_name": frappe.db.get_value("User", user, "full_name"),
            "roles": roles,
            "franchisee": franchisee,
            "patient": patient,
        }
    )


@frappe.whitelist(allow_guest=True)
def get_app_settings():
    """Expose client-safe settings for Flutter bootstrap."""
    creds = _get_site_api_credentials()
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import lis_requires_payment

    from health_ecosystem_core.health_ecosystem_core.clinical_email import (
        email_configured,
        email_signup_enabled,
        portal_base_url,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_phase18b import oauth_status

    oauth = oauth_status()

    return _success(
        {
            "site_name": frappe.local.site,
            "razorpay_key_id": creds.get("razorpay_key_id"),
            "razorpay_test_mode": _razorpay_test_mode(),
            "otp_test_mode": _otp_test_mode(),
            "lis_requires_payment": lis_requires_payment(),
            "supported_order_statuses": list(ORDER_STATUS_FLOW.keys()),
            "email_signup_enabled": email_signup_enabled(),
            "email_configured": email_configured(),
            "portal_base_url": portal_base_url(),
            "oauth_enabled": oauth.get("enabled"),
            "oauth_providers": oauth.get("providers") or [],
        }
    )


@frappe.whitelist(allow_guest=True)
def create_subscription_checkout(plan_code=None, sid=None):
    """Phase 43 / 121 — Pending Health Subscription for Razorpay checkout; activated only by verify_razorpay_payment."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase43_subscription_checkout import (
        create_subscription_checkout as _create_checkout,
    )

    plan_code = _parse_request_value("plan_code", plan_code)
    try:
        subscription = _create_checkout(frappe.session.user, plan_code)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    if not subscription or flt(subscription.get("amount")) <= 0:
        return _error(_("This plan has no payable amount"))
    return _success(
        {
            "subscription": subscription,
            "reference_doctype": "Health Subscription",
            "reference_name": subscription["name"],
            "amount": flt(subscription["amount"]),
        }
    )


def _subscription_owner_ok(doc):
    return doc.user == frappe.session.user or "System Manager" in _user_roles() or "Health System Admin" in _user_roles()


@frappe.whitelist(allow_guest=True)
def create_razorpay_order(reference_doctype=None, reference_name=None, amount=None, sid=None):
    """Create a Razorpay order for TRF, pharmacy, appointment or subscription checkout."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if reference_doctype not in ("Customer TRF", "Pharmacy Order", "Doctor Appointment", "Health Subscription"):
        return _error(
            _(
                "Invalid payment reference DocType. Use Customer TRF, Pharmacy Order, Doctor Appointment or "
                "Health Subscription (Payment Gateway is not used). Received: {0}"
            ).format(reference_doctype or "")
        )

    if not frappe.db.exists(reference_doctype, reference_name):
        return _error(_("Reference document not found"))

    doc = frappe.get_doc(reference_doctype, reference_name)
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import (
        PAYMENT_METHOD_ONLINE,
        normalize_payment_method,
    )

    if reference_doctype == "Health Subscription":
        if not _subscription_owner_ok(doc):
            return _error(_("Not permitted"), 403)
        if doc.status != "Pending":
            return _error(_("This subscription is not awaiting payment"))
    else:
        payment_method = normalize_payment_method(getattr(doc, "payment_method", None))
        if payment_method != PAYMENT_METHOD_ONLINE:
            return _error(_("This order uses offline payment. Pay at collection or on delivery."))

    if (getattr(doc, "razorpay_payment_status", None) or "") == "Paid":
        return _error(_("This order is already paid"))
    order_amount = _payable_amount(doc)
    if order_amount <= 0:
        return _error(_("Invalid payment amount"))
    if amount is not None and abs(flt(amount) - order_amount) >= 1:
        frappe.log_error(
            title="create_razorpay_order amount differs",
            message=f"{reference_doctype} {reference_name}: client {amount} vs server {order_amount}",
        )

    amount_paise = int(round(order_amount * 100))
    receipt = _razorpay_receipt(reference_doctype, reference_name)

    if _razorpay_test_mode():
        creds = _get_site_api_credentials()
        order_id = f"order_{reference_name}"
        return _success(
            {
                "order_id": order_id,
                "amount": order_amount,
                "amount_paise": amount_paise,
                "currency": "INR",
                "razorpay_key_id": creds.get("razorpay_key_id"),
                "test_mode": True,
            },
            message="Test payment order created",
        )

    creds = _get_site_api_credentials()
    key_id = creds.get("razorpay_key_id")
    key_secret = creds.get("razorpay_key_secret")
    if not (key_id and key_secret):
        return _error(_("Online payment is not configured on server"))
    auth_header = base64.b64encode(f"{key_id}:{key_secret}".encode("utf-8")).decode("ascii")
    payload = json.dumps(
        {
            "amount": amount_paise,
            "currency": "INR",
            "receipt": receipt,
            "payment_capture": 1,
            "notes": {"reference_doctype": reference_doctype, "reference_name": reference_name},
        }
    ).encode("utf-8")

    req = Request(
        "https://api.razorpay.com/v1/orders",
        data=payload,
        headers={
            "Authorization": f"Basic {auth_header}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(req, timeout=20) as resp:
            order_data = json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        frappe.log_error(title="create_razorpay_order", message=body)
        return _error(_("Razorpay order creation failed"))

    _record_payment_intent(
        "subscriptions" if reference_doctype == "Health Subscription" else "patient_checkout",
        order_data.get("id"),
        order_amount,
        reference_doctype=reference_doctype,
        reference_name=reference_name,
    )
    return _success(
        {
            "order_id": order_data.get("id"),
            "amount": order_amount,
            "amount_paise": amount_paise,
            "currency": order_data.get("currency", "INR"),
            "razorpay_key_id": key_id,
            "test_mode": False,
        },
        message="Razorpay order created",
    )


@frappe.whitelist(allow_guest=True)
def get_my_bookings(patient_phone=None, limit=50, sid=None):
    """Return bookings for the logged-in user or staff scope."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    roles = _user_roles()
    limit = cint(limit) or 50
    trf_fields = [
        "name",
        "patient_name",
        "patient_phone",
        "unique_barcode",
        "test_required",
        "order_status",
        "razorpay_payment_status",
        "payment_method",
        "amount",
        "collection_slot",
        "collection_address",
        "creation",
        "modified",
        "franchisee_id",
    ]

    from health_ecosystem_core.health_ecosystem_core.clinical_iam import (
        franchisee_id_for_user,
        is_franchisee,
        is_phlebotomist,
        is_staff,
        trf_list_filters_for_user,
    )

    if is_staff(roles):
        trfs = frappe.get_all(
            "Customer TRF",
            filters={},
            fields=trf_fields,
            order_by="modified desc",
            limit=limit,
        )
        return _success({"bookings": [_serialize_trf(t) for t in trfs]})

    if is_franchisee(roles):
        franchisee_id = franchisee_id_for_user()
        if not franchisee_id:
            return _success({"bookings": []})
        trfs = frappe.get_all(
            "Customer TRF",
            filters={"franchisee_id": franchisee_id},
            fields=trf_fields,
            order_by="modified desc",
            limit=limit,
        )
        return _success({"bookings": [_serialize_trf(t) for t in trfs]})

    scoped_filters = trf_list_filters_for_user()
    if is_phlebotomist(roles):
        if scoped_filters.get("name") == ("=", ""):
            return _success({"bookings": []})
        trfs = frappe.get_all(
            "Customer TRF",
            filters=scoped_filters,
            fields=trf_fields,
            order_by="modified desc",
            limit=limit,
        )
        return _success({"bookings": [_serialize_trf(t) for t in trfs]})

    from health_ecosystem_core.health_ecosystem_core.patient_bridge import (
        patient_profile_for_user,
        patient_scope_or_filters,
    )

    profile = patient_profile_for_user()
    if profile and profile.get("patient_id"):
        meta = frappe.get_meta("Customer TRF")
        patient_field = "health_patient" if meta.has_field("health_patient") else (
            "patient" if meta.has_field("patient") else None
        )
        if patient_field:
            trfs = frappe.get_all(
                "Customer TRF",
                filters={patient_field: profile["patient_id"]},
                fields=trf_fields,
                order_by="modified desc",
                limit=limit,
            )
            return _success({"bookings": [_serialize_trf(t) for t in trfs]})

    or_filters = patient_scope_or_filters(
        phone_field="patient_phone",
        name_field="patient_name",
    )
    phone = _parse_request_value("patient_phone", patient_phone)
    if phone:
        or_filters.append(["patient_phone", "=", phone])
    or_filters.append(["owner", "=", frappe.session.user])
    if not or_filters:
        return _success({"bookings": []})

    trfs = frappe.get_all(
        "Customer TRF",
        or_filters=or_filters,
        fields=trf_fields,
        order_by="modified desc",
        limit=limit,
    )
    return _success({"bookings": [_serialize_trf(t) for t in trfs]})


@frappe.whitelist()
def get_trf_detail(trf_id=None, barcode=None):
    """Return TRF details with linked lab results."""
    if not trf_id and not barcode:
        return _error(_("TRF ID or barcode is required"))

    if not trf_id and barcode:
        trf_id = frappe.db.get_value("Customer TRF", {"unique_barcode": barcode}, "name")

    if not trf_id or not frappe.db.exists("Customer TRF", trf_id):
        return _error(_("TRF not found"), 404)

    trf = _serialize_trf(trf_id)
    result_fields = [
        "name",
        "analyte_test_name",
        "numeric_result_value",
        "unit_of_measure",
        "reference_range",
        "abnormal_flag",
        "machine_reference",
        "verification_timestamp",
    ]
    if frappe.get_meta("Lab Test Result").has_field("result_value_text"):
        result_fields.append("result_value_text")
    results = frappe.get_all(
        "Lab Test Result",
        filters={"customer_trf": trf_id},
        fields=result_fields,
        order_by="creation asc",
    )

    return _success({"trf": trf, "results": results})


@frappe.whitelist()
def update_order_status(trf_id=None, order_status=None, barcode=None):
    """Advance TRF through lab logistics pipeline."""
    if frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)

    if not _is_staff_user():
        return _error(_("Not authorized to update order status"), 403)

    if not trf_id and barcode:
        trf_id = frappe.db.get_value("Customer TRF", {"unique_barcode": barcode}, "name")

    return _apply_order_status(trf_id, order_status)


def _apply_order_status(trf_id, order_status):
    if not trf_id or not order_status:
        return _error(_("TRF ID and order status are required"))

    if order_status not in ORDER_STATUS_FLOW:
        return _error(_("Invalid order status"))

    current_status = frappe.db.get_value("Customer TRF", trf_id, "order_status")
    if not current_status:
        return _error(_("TRF not found"), 404)

    allowed = ORDER_STATUS_FLOW.get(current_status, set())
    if order_status not in allowed and order_status != current_status:
        return _error(_(f"Cannot move from {current_status} to {order_status}"))

    frappe.db.set_value("Customer TRF", trf_id, "order_status", order_status)

    if order_status == "Completed":
        from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import (
            maybe_consume_reagents_on_trf_complete,
        )

        maybe_consume_reagents_on_trf_complete(trf_id)

    from health_ecosystem_core.health_ecosystem_core.clinical_journey import sync_journey_from_trf

    sync_journey_from_trf(trf_id, order_status)
    if order_status != current_status:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
            on_trf_status_change,
        )

        on_trf_status_change(trf_id, order_status)
    frappe.db.commit()

    return _success(
        {"trf_id": trf_id, "order_status": order_status},
        message="Order status updated",
    )


@frappe.whitelist(allow_guest=True)
def get_phlebotomist_collection_queue(limit=50, sid=None):
    """Home-collection orders for the phlebotomist's franchise hub."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.clinical_iam import (
        exclude_pf_trfs,
        franchise_for_phlebotomist,
        is_phlebotomist,
        is_staff,
        phlebotomist_trf_ids,
    )

    roles = _user_roles()
    if not is_phlebotomist(roles) and not is_staff(roles):
        return _error(_("Not permitted"), 403)

    limit = cint(limit) or 50
    fields = [
        "name",
        "patient_name",
        "patient_phone",
        "collection_address",
        "collection_latitude",
        "collection_longitude",
        "collection_slot",
        "unique_barcode",
        "test_required",
        "order_status",
        "razorpay_payment_status",
        "payment_method",
        "amount",
        "franchisee_id",
        "creation",
        "modified",
        "gender",
        "age",
        "age_months",
        "age_days",
    ]

    hub = franchise_for_phlebotomist()
    queue_statuses = ["Booked", "Sample Collected", "Cancelled"]
    if hub and is_phlebotomist(roles) and not is_staff(roles):
        filters = {"franchisee_id": hub, "order_status": ("in", queue_statuses)}
    elif is_phlebotomist(roles):
        trf_ids = phlebotomist_trf_ids()
        if not trf_ids:
            return _success({"orders": [], "franchisee": None, "in_route_trf": None})
        filters = {"name": ("in", trf_ids), "order_status": ("in", queue_statuses)}
    else:
        filters = {"order_status": ("in", queue_statuses)}

    trfs = frappe.get_all(
        "Customer TRF",
        filters=exclude_pf_trfs(filters),
        fields=fields,
        order_by="creation desc",
        limit=limit,
    )

    franchisee = None
    if hub:
        franchisee = frappe.db.get_value(
            "Franchisee Profile",
            hub,
            [
                "name",
                "franchise_name",
                "branch_code",
                "address",
                "contact_phone",
                "hub_latitude",
                "hub_longitude",
                "geofence_radius_m",
            ],
            as_dict=True,
        )

    orders = []
    for row in trfs:
        item = _serialize_trf(row)
        item["barcode"] = row.get("unique_barcode")
        item["collection_address"] = row.get("collection_address")
        item["gender"] = row.get("gender")
        item["age"] = row.get("age")
        item["age_months"] = row.get("age_months")
        item["age_days"] = row.get("age_days")
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_utils import format_patient_age

            item["age_label"] = format_patient_age(row.get("age"), row.get("age_months"), row.get("age_days"))
        except Exception:
            item["age_label"] = ""
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession import (
                get_trf_draw_plan_payload,
            )

            item["collection_tubes"] = get_trf_draw_plan_payload(row.get("name"))
        except Exception:
            item["collection_tubes"] = []
        orders.append(item)

    from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import get_phlebotomist_location

    loc = get_phlebotomist_location(frappe.session.user) or {}
    return _success(
        {
            "orders": orders,
            "franchisee": franchisee,
            "in_route_trf": loc.get("in_route_trf"),
        }
    )


@frappe.whitelist(allow_guest=True)
def get_phlebotomist_my_collections(limit=100, sid=None):
    """Collected samples plus live report / delivery status for the collector hub."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.clinical_iam import (
        exclude_pf_trfs,
        franchise_for_phlebotomist,
        is_phlebotomist,
        is_staff,
        phlebotomist_trf_ids,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import ensure_phase20_custom_fields
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import format_patient_age

    roles = _user_roles()
    if not is_phlebotomist(roles) and not is_staff(roles):
        return _error(_("Not permitted"), 403)

    ensure_phase20_custom_fields()
    limit = cint(limit) or 100
    collected_statuses = ["Sample Collected", "In Lab", "Completed"]
    fields = [
        "name",
        "patient_name",
        "patient_phone",
        "collection_address",
        "collection_latitude",
        "collection_longitude",
        "collection_slot",
        "unique_barcode",
        "test_required",
        "order_status",
        "franchisee_id",
        "creation",
        "modified",
        "gender",
        "age",
        "age_months",
        "age_days",
        "report_delivered_on",
    ]

    hub = franchise_for_phlebotomist()
    if hub and is_phlebotomist(roles) and not is_staff(roles):
        filters = {"franchisee_id": hub, "order_status": ("in", collected_statuses)}
    elif is_phlebotomist(roles):
        trf_ids = phlebotomist_trf_ids()
        extra = frappe.get_all(
            "Customer TRF",
            filters={"name": ("in", trf_ids or ["__none__"]), "order_status": ("in", collected_statuses)},
            pluck="name",
        ) if trf_ids else []
        if hub:
            extra.extend(
                frappe.get_all(
                    "Customer TRF",
                    filters={"franchisee_id": hub, "order_status": ("in", collected_statuses)},
                    pluck="name",
                )
            )
        extra = list(dict.fromkeys(extra))
        if not extra:
            return _success({"orders": []})
        filters = {"name": ("in", extra)}
    else:
        filters = {"order_status": ("in", collected_statuses)}
    exclude_pf_trfs(filters)

    try:
        rows = frappe.get_all(
            "Customer TRF",
            filters=filters,
            fields=fields,
            order_by="modified desc",
            limit=limit,
        )
    except Exception:
        fields = [f for f in fields if f != "report_delivered_on"]
        rows = frappe.get_all(
            "Customer TRF",
            filters=filters,
            fields=fields,
            order_by="modified desc",
            limit=limit,
        )
        for row in rows:
            row["report_delivered_on"] = None
    names = [row.name for row in rows]
    journeys = {}
    if names:
        for j in frappe.get_all(
            "Patient Care Journey",
            filters={"customer_trf": ("in", names)},
            fields=["name", "customer_trf", "status", "report_pdf", "authorized_on"],
        ):
            journeys[j.customer_trf] = j

    orders = []
    for row in rows:
        item = _serialize_trf(row)
        item["barcode"] = row.get("unique_barcode")
        item["collection_address"] = row.get("collection_address")
        item["gender"] = row.get("gender")
        item["age"] = row.get("age")
        item["age_months"] = row.get("age_months")
        item["age_days"] = row.get("age_days")
        item["age_label"] = format_patient_age(row.get("age"), row.get("age_months"), row.get("age_days"))
        delivered = row.get("report_delivered_on")
        item["report_delivered_on"] = str(delivered) if delivered else None
        journey = journeys.get(row.name)
        item["journey_id"] = journey.name if journey else None
        item["journey_status"] = journey.status if journey else None
        item["report_pdf"] = bool(journey.report_pdf) if journey else False
        item["authorized_on"] = str(journey.authorized_on) if journey and journey.authorized_on else None
        ready = bool(journey and journey.report_pdf and journey.status in ("Authorized", "Dispatched"))
        item["report_ready"] = ready
        if delivered:
            item["delivery_status"] = "delivered"
        elif ready:
            item["delivery_status"] = "pending_delivery"
        else:
            item["delivery_status"] = "pending_report"
        orders.append(item)

    return _success({"orders": orders})


@frappe.whitelist(allow_guest=True)
def phlebotomist_deliver_report(trf_id=None, sid=None):
    """Mark an authorized report as delivered to the patient by the collector."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.clinical_iam import (
        is_phlebotomist,
        is_staff,
        phlebotomist_trf_ids,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import ensure_phase20_custom_fields
    from frappe.utils import now_datetime

    roles = _user_roles()
    if not is_phlebotomist(roles) and not is_staff(roles):
        return _error(_("Not permitted"), 403)

    trf_id = _parse_request_value("trf_id", trf_id)
    if not trf_id:
        return _error(_("TRF ID is required"))
    if not frappe.db.exists("Customer TRF", trf_id):
        return _error(_("Order not found"))
    from health_ecosystem_core.health_ecosystem_core.clinical_iam import franchise_for_phlebotomist

    hub = franchise_for_phlebotomist()
    if is_phlebotomist(roles) and not is_staff(roles):
        if hub:
            if frappe.db.get_value("Customer TRF", trf_id, "franchisee_id") != hub:
                return _error(_("This order is not in your collection queue"), 403)
        elif trf_id not in (phlebotomist_trf_ids() or []):
            return _error(_("This order is not in your collection queue"), 403)

    journey = frappe.db.get_value(
        "Patient Care Journey",
        {"customer_trf": trf_id},
        ["name", "status", "report_pdf"],
        as_dict=True,
    )
    if not journey or not journey.report_pdf or journey.status not in ("Authorized", "Dispatched"):
        return _error(_("Report is not ready to deliver"))

    ensure_phase20_custom_fields()
    stamp = now_datetime()
    frappe.db.set_value("Customer TRF", trf_id, "report_delivered_on", stamp)
    frappe.db.commit()
    return _success(
        {"trf_id": trf_id, "report_delivered_on": str(stamp), "journey_id": journey.name},
        message=_("Report marked as delivered"),
    )


@frappe.whitelist(allow_guest=True)
def phlebotomist_update_location(latitude=None, longitude=None, on_duty=1, sid=None):
    """Phase 20 — ping phlebotomist GPS while on duty (call every ~60s)."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_phlebotomist, is_staff
    from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import update_phlebotomist_location

    roles = _user_roles()
    if not is_phlebotomist(roles) and not is_staff(roles):
        return _error(_("Not permitted"), 403)

    latitude = _parse_request_value("latitude", latitude)
    longitude = _parse_request_value("longitude", longitude)
    on_duty = cint(_parse_request_value("on_duty", on_duty))
    if on_duty and (latitude is None or longitude is None):
        return _error(_("latitude and longitude are required"))

    user = frappe.session.user
    if not on_duty:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import (
            get_phlebotomist_location,
            update_phlebotomist_location,
        )

        existing = get_phlebotomist_location(user) or {}
        lat = flt(latitude) or flt(existing.get("latitude"))
        lng = flt(longitude) or flt(existing.get("longitude"))
        if lat and lng:
            payload = update_phlebotomist_location(user, lat, lng, on_duty=False)
            return _success({"location": payload})
        return _success({"location": {"on_duty": 0}})

    payload = update_phlebotomist_location(user, latitude, longitude, on_duty=True)
    return _success({"location": payload})


@frappe.whitelist(allow_guest=True)
def phlebotomist_start_visit(trf_id=None, sid=None):
    """Mark a booked collection as in-route and keep it on the live map."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.clinical_iam import (
        PF_ORDER_MESSAGE,
        is_pf_trf,
        is_phlebotomist,
        is_staff,
        phlebotomist_trf_ids,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import mark_phlebotomist_visit_started

    roles = _user_roles()
    if not is_phlebotomist(roles) and not is_staff(roles):
        return _error(_("Not permitted"), 403)

    trf_id = _parse_request_value("trf_id", trf_id)
    if not trf_id:
        return _error(_("TRF ID is required"))
    if not frappe.db.exists("Customer TRF", trf_id):
        return _error(_("Order not found"))
    if is_pf_trf(trf_id):
        return _error(_(PF_ORDER_MESSAGE), 409)
    if is_phlebotomist(roles) and not is_staff(roles):
        if trf_id not in phlebotomist_trf_ids():
            return _error(_("This order is not in your collection queue"), 403)
    if frappe.db.get_value("Customer TRF", trf_id, "order_status") != "Booked":
        return _error(_("Only booked collections can be started"))

    payload = mark_phlebotomist_visit_started(frappe.session.user, trf_id)
    return _success({"in_route_trf": payload.get("in_route_trf"), "location": payload}, message=_("Visit started"))


@frappe.whitelist(allow_guest=True)
def get_phlebotomist_map_data(sid=None):
    """Phase 20 — hub, collection stops, live collector location, Google/OSRM route."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_phlebotomist, is_staff
    from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import build_map_payload

    roles = _user_roles()
    if not is_phlebotomist(roles) and not is_staff(roles):
        return _error(_("Not permitted"), 403)

    return _success(build_map_payload(frappe.session.user, roles))


@frappe.whitelist(allow_guest=True)
def get_approximate_location(sid=None):
    """Fallback location from client IP when browser GPS is unavailable (HTTP sites)."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import approximate_location_from_ip

    loc = approximate_location_from_ip()
    if not loc:
        return _error(_("Could not determine approximate location from IP"))
    return _success({"location": loc})


@frappe.whitelist(allow_guest=True)
def phlebotomist_hub_checkin(latitude=None, longitude=None, sid=None):
    """Phase 20 — geo-fenced check-in at franchise hub."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_phlebotomist, is_staff
    from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import phlebotomist_hub_checkin as _checkin

    roles = _user_roles()
    if not is_phlebotomist(roles) and not is_staff(roles):
        return _error(_("Not permitted"), 403)

    latitude = _parse_request_value("latitude", latitude)
    longitude = _parse_request_value("longitude", longitude)
    if latitude is None or longitude is None:
        return _error(_("latitude and longitude are required"))

    try:
        result = _checkin(frappe.session.user, latitude, longitude)
        return _success(result, message=result.get("message"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


def _require_hr_access(sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import is_hr_eligible

    roles = _user_roles()
    if not is_hr_eligible(roles):
        return _error(_("Not permitted"), 403)
    return None


@frappe.whitelist(allow_guest=True)
def get_hr_self_service(sid=None):
    """Phase 21 — leave types, expense types, and my submissions."""
    denied = _require_hr_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import get_hr_self_service_payload

    return _success(get_hr_self_service_payload(frappe.session.user))


def _require_people_hrms_access(sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_eligible

    roles = _user_roles()
    if not is_people_eligible(roles):
        return _error(_("Not permitted for People HRMS"), 403)
    return None


@frappe.whitelist(allow_guest=True)
def get_people_hrms_dashboard(sid=None):
    """Phase 90 — People HRMS home KPIs, attendance, leave, payslips, org monitor."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        get_people_hrms_dashboard as _dashboard,
    )

    try:
        return _success(_dashboard(frappe.session.user, _user_roles()))
    except Exception:
        frappe.log_error(title="get_people_hrms_dashboard", message=frappe.get_traceback())
        return _error(_("Could not load People dashboard. Please refresh and try again."))


@frappe.whitelist(allow_guest=True)
def update_my_employee_profile(sid=None):
    """Phase 90 — employee can update their own contact fields from My Profile."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    payload = {}
    for key in (
        "phone",
        "personal_email",
        "current_address",
        "permanent_address",
        "blood_group",
        "emergency_phone",
    ):
        value = _parse_request_value(key)
        if value is None and key in (frappe.form_dict or {}):
            value = cstr(frappe.form_dict.get(key) or "")
        if value is not None:
            payload[key] = value

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        update_my_employee_profile as _update,
    )

    try:
        return _success(_update(frappe.session.user, payload))
    except Exception as exc:
        return _error(cstr(exc) or _("Could not update profile"))


@frappe.whitelist(allow_guest=True)
def update_my_employee_photo(file_name=None, file_data=None, sid=None):
    """Attach a photo to the signed-in employee's live HRMS Employee.image field."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    file_name = _parse_request_value("file_name", file_name)
    file_data = _parse_request_value("file_data", file_data)
    if not file_name or not file_data:
        return _error(_("File name and file data are required"))

    raw = str(file_data)
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        content = base64.b64decode(raw)
    except Exception:
        return _error(_("Invalid file data"))
    if len(content) > 2 * 1024 * 1024:
        return _error(_("Photo must be 2 MB or less"))

    ext = (str(file_name).rsplit(".", 1)[-1] or "").lower()
    if ext not in ("jpg", "jpeg", "png", "webp"):
        return _error(_("Use a JPG or PNG photo"))

    from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import ensure_employee_for_user

    employee = ensure_employee_for_user(frappe.session.user)
    if not employee:
        return _error(_("No employee profile is linked to this login"))
    if not frappe.get_meta("Employee").has_field("image"):
        return _error(_("Employee photo field is not available"))

    file_doc = frappe.get_doc(
        {
            "doctype": "File",
            "file_name": f"emp-photo-{employee}.{ext}",
            "content": content,
            "is_private": 0,
            "attached_to_doctype": "Employee",
            "attached_to_name": employee,
            "attached_to_field": "image",
        }
    )
    file_doc.insert(ignore_permissions=True)
    frappe.db.set_value("Employee", employee, "image", file_doc.file_url)
    frappe.db.commit()
    return _success(
        {"photo": file_doc.file_url, "employee": employee},
        message=_("Photo updated"),
    )


@frappe.whitelist(allow_guest=True)
def submit_employee_checkin(log_type=None, latitude=None, longitude=None, sid=None):
    """Phase 90 — mark attendance IN/OUT via Employee Checkin (geofenced)."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        submit_employee_checkin as _checkin,
    )

    log_type = _parse_request_value("log_type", log_type) or "IN"
    latitude = _parse_request_value("latitude", latitude)
    longitude = _parse_request_value("longitude", longitude)
    try:
        row = _checkin(
            frappe.session.user,
            log_type,
            latitude=latitude,
            longitude=longitude,
        )
        return _success({"checkin": row}, message=_("Attendance recorded"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def list_people_employees(limit=None, department=None, q=None, sid=None):
    """Phase 90 — manager employee directory (supports q search)."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        list_people_employees as _list,
    )

    limit = _parse_request_value("limit", limit) or 100
    department = _parse_request_value("department", department)
    q = _parse_request_value("q", q)
    try:
        return _success(_list(_user_roles(), limit=limit, department=department, q=q))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)


@frappe.whitelist(allow_guest=True)
def list_employee_geofences(limit=None, sid=None):
    """Phase 90 — manager view of employee work geofences."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        list_employee_geofences as _list,
    )

    limit = _parse_request_value("limit", limit) or 200
    try:
        return _success(_list(_user_roles(), limit=limit))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)


@frappe.whitelist(allow_guest=True)
def seed_employee_geofences(force=None, radius_m=None, sid=None):
    """Phase 90 — assign HQ geofence to all active employees."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        is_people_manager,
        seed_employee_geofences as _seed,
    )

    if not is_people_manager(_user_roles()):
        return _error(_("HR manager access required"), 403)
    force = cint(_parse_request_value("force", force) or 0)
    radius_m = _parse_request_value("radius_m", radius_m)
    try:
        return _success(_seed(force=bool(force), radius_m=radius_m), message=_("Geofences seeded"))
    except Exception as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_people_geofences(sid=None):
    """Phase 90 — geofence locations + employee assignment board."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        get_people_geofences as _board,
    )

    try:
        return _success(_board(_user_roles()))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_geofence(geofence=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_geofence as _save,
    )

    data = _people_json_arg(_parse_request_value("geofence", geofence))
    try:
        return _success(_save(_user_roles(), data), message=_("Geofence saved"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def assign_people_geofence(geofence=None, employees=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        assign_people_geofence as _asg,
    )

    emps = _parse_request_value("employees", employees)
    try:
        return _success(
            _asg(_user_roles(), _parse_request_value("geofence", geofence), employees=emps),
            message=_("Employees assigned"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_employee_geofence(employee=None, settings=None, sid=None):
    """HR-only — set one employee's geofence site, address, point and radius."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_employee_geofence as _save,
    )

    data = _people_json_arg(_parse_request_value("settings", settings))
    try:
        return _success(
            _save(_user_roles(), _parse_request_value("employee", employee), data),
            message=_("Employee geofence saved"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def set_employee_geofence_override(employee=None, enabled=None, reason=None, until=None, sid=None):
    """HR-only — temporarily allow punches outside the employee's geofence."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        set_employee_geofence_override as _set,
    )

    on = cint(_parse_request_value("enabled", enabled) or 0)
    try:
        return _success(
            _set(
                _user_roles(),
                _parse_request_value("employee", employee),
                enabled=on,
                reason=_parse_request_value("reason", reason),
                until=_parse_request_value("until", until) or None,
            ),
            message=_("Geofencing temporarily disabled") if on else _("Geofencing re-enabled"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def geocode_people_geofence_address(address=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        geocode_people_geofence_address as _geo,
    )

    try:
        return _success(_geo(_user_roles(), _parse_request_value("address", address)))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_people_roles(sid=None):
    """Phase 90 — role catalog, users, portals, and access audit."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        get_people_roles as _board,
    )

    try:
        return _success(_board(_user_roles()))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_role(role=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_role as _save,
    )

    data = _people_json_arg(_parse_request_value("role", role))
    try:
        return _success(_save(_user_roles(), data), message=_("Role saved"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def assign_people_access(access=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        assign_people_access as _asg,
    )

    data = _people_json_arg(_parse_request_value("access", access))
    try:
        return _success(_asg(_user_roles(), data), message=_("Access assigned"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def export_people_roles(kind=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        export_people_roles as _exp,
    )

    try:
        return _success(_exp(_user_roles(), kind=_parse_request_value("kind", kind)))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_people_payroll_workflow(sid=None):
    """Phase 72/90 — HR Manager payroll workflow status + steps."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import (
        get_people_payroll_workflow as _wf,
    )

    try:
        return _success(_wf(_user_roles()))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)


@frappe.whitelist(allow_guest=True)
def ensure_people_payroll_assignments(base=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import (
        ensure_people_payroll_assignments as _fn,
    )

    base = _parse_request_value("base", base) or 35000
    try:
        return _success(_fn(_user_roles(), base=base), message=_("Salary structure assignments ensured"))
    except (frappe.PermissionError, frappe.ValidationError) as exc:
        return _error(str(exc), 403 if isinstance(exc, frappe.PermissionError) else 400)


@frappe.whitelist(allow_guest=True)
def create_people_payroll_entry(start_date=None, end_date=None, payroll_frequency=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import (
        create_people_payroll_entry as _fn,
    )

    try:
        return _success(
            _fn(
                _user_roles(),
                start_date=_parse_request_value("start_date", start_date),
                end_date=_parse_request_value("end_date", end_date),
                payroll_frequency=_parse_request_value("payroll_frequency", payroll_frequency)
                or "Monthly",
            ),
            message=_("Payroll Entry created"),
        )
    except (frappe.PermissionError, frappe.ValidationError) as exc:
        return _error(str(exc), 403 if isinstance(exc, frappe.PermissionError) else 400)


@frappe.whitelist(allow_guest=True)
def generate_people_salary_slips(payroll_entry=None, employee=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import (
        generate_people_salary_slips as _fn,
    )

    try:
        return _success(
            _fn(
                _user_roles(),
                payroll_entry=_parse_request_value("payroll_entry", payroll_entry),
                employee=_parse_request_value("employee", employee),
            ),
            message=_("Salary slips generated"),
        )
    except (frappe.PermissionError, frappe.ValidationError) as exc:
        return _error(str(exc), 403 if isinstance(exc, frappe.PermissionError) else 400)


@frappe.whitelist(allow_guest=True)
def submit_people_payroll(payroll_entry=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import (
        submit_people_payroll as _fn,
    )

    try:
        return _success(
            _fn(_user_roles(), payroll_entry=_parse_request_value("payroll_entry", payroll_entry)),
            message=_("Payroll submitted"),
        )
    except (frappe.PermissionError, frappe.ValidationError) as exc:
        return _error(str(exc), 403 if isinstance(exc, frappe.PermissionError) else 400)


@frappe.whitelist(allow_guest=True)
def list_org_salary_slips(limit=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import (
        list_org_salary_slips as _fn,
    )

    try:
        return _success(_fn(_user_roles(), limit=_parse_request_value("limit", limit) or 50))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)


@frappe.whitelist(allow_guest=True)
def run_people_payroll_full(start_date=None, end_date=None, sid=None):
    """One-click HR Manager payroll: assign → entry → slips → submit."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase72_payroll import (
        run_people_payroll_full as _fn,
    )

    try:
        return _success(
            _fn(
                _user_roles(),
                start_date=_parse_request_value("start_date", start_date),
                end_date=_parse_request_value("end_date", end_date),
            ),
            message=_("Payroll run completed"),
        )
    except (frappe.PermissionError, frappe.ValidationError) as exc:
        return _error(str(exc), 403 if isinstance(exc, frappe.PermissionError) else 400)


@frappe.whitelist(allow_guest=True)
def create_people_employee(
    application=None,
    full_name=None,
    email=None,
    mobile=None,
    dob=None,
    gender=None,
    department=None,
    designation=None,
    joining_date=None,
    salary_offered=None,
    franchisee=None,
    sid=None,
):
    """Phase 90 — create employee from manual hire or finalize hired Job Applicant."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        create_people_employee as _create,
    )

    try:
        row = _create(
            _user_roles(),
            application=_parse_request_value("application", application),
            full_name=_parse_request_value("full_name", full_name),
            email=_parse_request_value("email", email),
            mobile=_parse_request_value("mobile", mobile),
            dob=_parse_request_value("dob", dob),
            gender=_parse_request_value("gender", gender),
            department=_parse_request_value("department", department),
            designation=_parse_request_value("designation", designation),
            joining_date=_parse_request_value("joining_date", joining_date),
            salary_offered=_parse_request_value("salary_offered", salary_offered),
            franchisee=_parse_request_value("franchisee", franchisee),
        )
        return _success(row, message=_("Employee record created"))
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)


@frappe.whitelist(allow_guest=True)
def list_people_departments(sid=None):
    """Phase 90 — manager department headcounts."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        list_people_departments as _list,
    )

    try:
        return _success(_list(_user_roles()))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)


@frappe.whitelist(allow_guest=True)
def get_people_attendance_register(from_date=None, to_date=None, sid=None):
    """Phase 90 — manager attendance register (daily status, hours, leave) for a date range."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        get_people_attendance_register as _register,
    )

    try:
        return _success(_register(_user_roles(), from_date=from_date, to_date=to_date))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)


@frappe.whitelist(allow_guest=True)
def list_people_leave(from_date=None, to_date=None, sid=None):
    """Phase 90 — manager leave register (applications, review stages, balances) for a date range."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        list_people_leave as _list,
    )

    try:
        return _success(_list(_user_roles(), from_date=from_date, to_date=to_date))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)


@frappe.whitelist(allow_guest=True)
def act_people_leave(
    name=None,
    action=None,
    remark=None,
    from_date=None,
    to_date=None,
    half_day=None,
    half_day_date=None,
    sid=None,
):
    """Phase 90 — forward / return / approve / reject a leave application (optional date revise)."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        act_people_leave as _act,
    )

    name = _parse_request_value("name", name)
    action = _parse_request_value("action", action)
    remark = _parse_request_value("remark", remark)
    from_date = _parse_request_value("from_date", from_date)
    to_date = _parse_request_value("to_date", to_date)
    half_day = _parse_request_value("half_day", half_day)
    half_day_date = _parse_request_value("half_day_date", half_day_date)
    try:
        return _success(
            _act(
                _user_roles(),
                name,
                action,
                remark=remark,
                from_date=from_date,
                to_date=to_date,
                half_day=half_day,
                half_day_date=half_day_date,
            )
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def create_people_leave_request(
    employee=None,
    leave_type=None,
    from_date=None,
    to_date=None,
    half_day=0,
    half_day_date=None,
    reason=None,
    sid=None,
):
    """Phase 90 — HR raises a leave application on behalf of an employee."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        create_people_leave_request as _create,
    )

    try:
        row = _create(
            _user_roles(),
            employee,
            leave_type,
            from_date,
            to_date,
            half_day=half_day,
            half_day_date=half_day_date,
            reason=reason,
        )
        return _success(row, message=_("Leave request created"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_people_payroll_register(month=None, sid=None):
    """Phase 90 — manager payroll register for one month (slips, KPIs, steps, statutory)."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        get_people_payroll_register as _register,
    )

    try:
        return _success(_register(_user_roles(), month=month))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def process_people_payroll(month=None, employees=None, sid=None):
    """Phase 90 — calculate draft salary slips for a batch of employees."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        process_people_payroll as _process,
    )

    try:
        return _success(_process(_user_roles(), month=month, employees=employees))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def approve_people_payroll(month=None, slips=None, sid=None):
    """Phase 90 — approve (submit) a batch of draft salary slips."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        approve_people_payroll as _approve,
    )

    try:
        return _success(_approve(_user_roles(), month=month, slips=slips))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_people_performance(from_date=None, to_date=None, sid=None):
    """Phase 90 — manager performance board (hours, attendance, manager rating)."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        get_people_performance as _performance,
    )

    try:
        return _success(_performance(_user_roles(), from_date=from_date, to_date=to_date))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_performance_review(employee=None, period=None, rating=None, remarks=None, recommendation=None, sid=None):
    """Phase 90 — save the monthly manager rating for an employee."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_performance_review as _save,
    )

    try:
        row = _save(
            _user_roles(),
            employee,
            period=period,
            rating=rating,
            remarks=remarks,
            recommendation=recommendation,
        )
        return _success(row, message=_("Rating saved"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_people_onboarding(from_date=None, to_date=None, sid=None):
    """Phase 90 — manager new-hire onboarding board."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        get_people_onboarding as _board,
    )

    try:
        return _success(_board(_user_roles(), from_date=from_date, to_date=to_date))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


def _people_json_arg(value):
    if value in (None, ""):
        return {}
    if isinstance(value, (dict, list)):
        return value
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, (dict, list)) else {}


@frappe.whitelist(allow_guest=True)
def get_people_training(sid=None):
    """Phase 90 — manager training & development board."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        get_people_training as _board,
    )

    try:
        return _success(_board(_user_roles()))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_training_material(material=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_training_material as _save,
    )

    data = _people_json_arg(_parse_request_value("material", material))
    try:
        return _success(_save(_user_roles(), data), message=_("Training material saved"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_training_plan(plan=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_training_plan as _save,
    )

    data = _people_json_arg(_parse_request_value("plan", plan))
    try:
        return _success(_save(_user_roles(), data), message=_("Learning plan saved"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_training_category(title=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_training_category as _save,
    )

    try:
        return _success(_save(_user_roles(), title), message=_("Category saved"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def assign_people_training(material=None, plan=None, scope=None, department=None, designation=None, employees=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        assign_people_training as _assign,
    )

    emps = _parse_request_value("employees", employees)
    try:
        result = _assign(
            _user_roles(),
            material=_parse_request_value("material", material),
            plan=_parse_request_value("plan", plan),
            scope=_parse_request_value("scope", scope) or "employees",
            department=_parse_request_value("department", department),
            designation=_parse_request_value("designation", designation),
            employees=emps,
        )
        return _success(result, message=_("Training assigned"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_people_career(sid=None):
    """Phase 90 — manager career & growth board."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        get_people_career as _board,
    )

    try:
        return _success(_board(_user_roles()))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_manpower_request(manpower=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_manpower_request as _save,
    )

    data = _people_json_arg(_parse_request_value("manpower", manpower))
    try:
        return _success(_save(_user_roles(), data), message=_("Manpower request saved"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def update_people_manpower_request(manpower=None, status=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        update_people_manpower_request as _upd,
    )

    try:
        return _success(
            _upd(_user_roles(), _parse_request_value("manpower", manpower), _parse_request_value("status", status)),
            message=_("Request updated"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_people_documents(sid=None):
    """Phase 90 — manager documents vault."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        get_people_documents as _board,
    )

    try:
        return _success(_board(_user_roles()))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_document(document=None, file_name=None, file_data=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_document as _save,
    )

    data = _people_json_arg(_parse_request_value("document", document))
    try:
        return _success(
            _save(
                _user_roles(),
                data,
                file_name=_parse_request_value("file_name", file_name),
                file_data=_parse_request_value("file_data", file_data),
            ),
            message=_("Document saved"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def update_people_document(document=None, status=None, touch=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        update_people_document as _upd,
    )

    try:
        return _success(
            _upd(
                _user_roles(),
                _parse_request_value("document", document),
                status=_parse_request_value("status", status),
                touch=_parse_request_value("touch", touch),
            ),
            message=_("Document updated"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_document_folder(folder=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_document_folder as _save,
    )

    data = _people_json_arg(_parse_request_value("folder", folder))
    try:
        return _success(_save(_user_roles(), data), message=_("Folder created"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def generate_people_letter(template=None, employee=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        generate_people_letter as _gen,
    )

    try:
        return _success(
            _gen(_user_roles(), _parse_request_value("template", template), _parse_request_value("employee", employee)),
            message=_("Letter generated"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_document_request(doc_request=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_document_request as _save,
    )

    data = _people_json_arg(_parse_request_value("doc_request", doc_request))
    try:
        return _success(_save(_user_roles(), data), message=_("Request submitted"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def update_people_document_request(doc_request=None, status=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        update_people_document_request as _upd,
    )

    try:
        return _success(
            _upd(_user_roles(), _parse_request_value("doc_request", doc_request), _parse_request_value("status", status)),
            message=_("Request updated"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_people_policies(sid=None):
    """Phase 90 — HR policies handbook."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        get_people_policies as _board,
    )

    try:
        return _success(_board(_user_roles()))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_policy(policy=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_policy as _save,
    )

    data = _people_json_arg(_parse_request_value("policy", policy))
    try:
        return _success(_save(_user_roles(), data), message=_("Policy saved"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def update_people_policy(policy=None, status=None, touch=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        update_people_policy as _upd,
    )

    try:
        return _success(
            _upd(
                _user_roles(),
                _parse_request_value("policy", policy),
                status=_parse_request_value("status", status),
                touch=_parse_request_value("touch", touch),
            ),
            message=_("Policy updated"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_policy_category(category=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_policy_category as _save,
    )

    data = _people_json_arg(_parse_request_value("category", category))
    try:
        return _success(_save(_user_roles(), data), message=_("Category created"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_people_assets(sid=None):
    """Phase 90 — employee assets desk."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        get_people_assets as _board,
    )

    try:
        return _success(_board(_user_roles()))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_asset(asset=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_asset as _save,
    )

    data = _people_json_arg(_parse_request_value("asset", asset))
    try:
        return _success(_save(_user_roles(), data), message=_("Asset saved"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def update_people_asset(asset=None, status=None, action=None, employee=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        update_people_asset as _upd,
    )

    emp = _people_json_arg(_parse_request_value("employee", employee)) if employee else {}
    try:
        return _success(
            _upd(
                _user_roles(),
                _parse_request_value("asset", asset),
                status=_parse_request_value("status", status),
                action=_parse_request_value("action", action),
                employee=emp,
            ),
            message=_("Asset updated"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_asset_category(category=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_asset_category as _save,
    )

    data = _people_json_arg(_parse_request_value("category", category))
    try:
        return _success(_save(_user_roles(), data), message=_("Category created"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_asset_request(asset_request=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_asset_request as _save,
    )

    data = _people_json_arg(_parse_request_value("asset_request", asset_request))
    try:
        return _success(_save(_user_roles(), data), message=_("Request submitted"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def update_people_asset_request(asset_request=None, status=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        update_people_asset_request as _upd,
    )

    try:
        return _success(
            _upd(
                _user_roles(),
                _parse_request_value("asset_request", asset_request),
                _parse_request_value("status", status),
            ),
            message=_("Request updated"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_people_announcements(sid=None):
    """Phase 90 — HR announcements board."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        get_people_announcements as _board,
    )

    try:
        return _success(_board(_user_roles()))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_announcement(announcement=None, file_name=None, file_data=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_announcement as _save,
    )

    data = _people_json_arg(_parse_request_value("announcement", announcement))
    try:
        return _success(
            _save(
                _user_roles(),
                data,
                file_name=_parse_request_value("file_name", file_name),
                file_data=_parse_request_value("file_data", file_data),
            ),
            message=_("Announcement saved"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def update_people_announcement(announcement=None, status=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        update_people_announcement as _upd,
    )

    try:
        return _success(
            _upd(_user_roles(), _parse_request_value("announcement", announcement), _parse_request_value("status", status)),
            message=_("Announcement updated"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_people_calendar(sid=None):
    """Phase 90 — HR calendar board."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        get_people_calendar as _board,
    )

    try:
        return _success(_board(_user_roles()))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def save_people_calendar_event(event=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        save_people_calendar_event as _save,
    )

    data = _people_json_arg(_parse_request_value("event", event))
    try:
        return _success(_save(_user_roles(), data), message=_("Event saved"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def update_people_calendar_event(event=None, status=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        update_people_calendar_event as _upd,
    )

    try:
        return _success(
            _upd(_user_roles(), _parse_request_value("event", event), _parse_request_value("status", status)),
            message=_("Event updated"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_people_reports(from_date=None, to_date=None, department=None, sid=None):
    """Phase 90 — HR reports board."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        get_people_reports as _board,
    )

    try:
        return _success(
            _board(
                _user_roles(),
                from_date=_parse_request_value("from_date", from_date),
                to_date=_parse_request_value("to_date", to_date),
                department=_parse_request_value("department", department),
            )
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def export_people_report(report=None, from_date=None, to_date=None, department=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        export_people_report as _exp,
    )

    try:
        return _success(
            _exp(
                _user_roles(),
                _parse_request_value("report", report),
                from_date=_parse_request_value("from_date", from_date),
                to_date=_parse_request_value("to_date", to_date),
                department=_parse_request_value("department", department),
            ),
            message=_("Report ready"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_people_analytics(from_date=None, to_date=None, department=None, sid=None):
    """Phase 90 — HR analytics board."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        get_people_analytics as _board,
    )

    try:
        return _success(
            _board(
                _user_roles(),
                from_date=_parse_request_value("from_date", from_date),
                to_date=_parse_request_value("to_date", to_date),
                department=_parse_request_value("department", department),
            )
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def export_people_analytics(kind=None, from_date=None, to_date=None, department=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        export_people_analytics as _exp,
    )

    try:
        return _success(
            _exp(
                _user_roles(),
                _parse_request_value("kind", kind),
                from_date=_parse_request_value("from_date", from_date),
                to_date=_parse_request_value("to_date", to_date),
                department=_parse_request_value("department", department),
            ),
            message=_("Analytics ready"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def update_people_training_assignment(assignment=None, status=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        update_people_training_assignment as _upd,
    )

    try:
        return _success(
            _upd(_user_roles(), _parse_request_value("assignment", assignment), _parse_request_value("status", status)),
            message=_("Progress updated"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def list_people_designations(sid=None):
    """Phase 90 — manager designation headcounts."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        list_people_designations as _list,
    )

    try:
        return _success(_list(_user_roles()))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)


@frappe.whitelist(allow_guest=True)
def setup_phase92_hr_policy_masters(sid=None):
    """Phase 92 — grades, components, structures, print formats (admin)."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

    if not is_people_manager(_user_roles()):
        return _error(_("HR manager access required"), 403)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase92_hr_policy_masters import (
        setup_phase92,
    )

    return _success(setup_phase92())


@frappe.whitelist(allow_guest=True)
def list_hr_policy_snippets(sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase92_hr_policy_masters import (
        list_hr_policies,
    )

    return _success({"policies": list_hr_policies()})


@frappe.whitelist(allow_guest=True)
def list_hr_grades_master(sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase92_hr_policy_masters import (
        list_hr_grades,
    )

    return _success(list_hr_grades())


@frappe.whitelist(allow_guest=True)
def list_hr_designations_master(sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase92_hr_policy_masters import (
        list_hr_designations_master as _list,
    )

    return _success(_list())


@frappe.whitelist(allow_guest=True)
def get_appointment_letter_html(employee=None, letter_type=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

    if not is_people_manager(_user_roles()):
        return _error(_("HR manager access required"), 403)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase92_hr_policy_masters import (
        get_appointment_letter_html as _html,
    )

    employee = _parse_request_value("employee", employee)
    letter_type = _parse_request_value("letter_type", letter_type) or "field"
    try:
        return _success(_html(employee, letter_type))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def list_employee_checklists(employee=None, kind=None, limit=None, sid=None):
    """Phase 73 — list HEC Onboarding / Offboarding ToDos."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import (
        is_people_manager,
        _employee_for_user,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_phase73_talent import (
        list_employee_checklists as _list,
    )

    employee = _parse_request_value("employee", employee)
    kind = _parse_request_value("kind", kind)
    limit = _parse_request_value("limit", limit) or 100
    roles = _user_roles()
    if not is_people_manager(roles):
        mine = _employee_for_user(frappe.session.user, create=False)
        if not mine:
            return _success({"todos": [], "count": 0})
        employee = mine
    try:
        return _success(_list(employee=employee or None, kind=kind or None, limit=limit))
    except Exception as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def start_employee_checklist(employee=None, kind=None, sid=None):
    """Phase 73 — seed onboarding or offboarding checklist ToDos."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

    if not is_people_manager(_user_roles()):
        return _error(_("HR manager access required"), 403)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase73_talent import (
        api_start_employee_checklist as _start,
    )

    employee = _parse_request_value("employee", employee)
    kind = _parse_request_value("kind", kind) or "onboarding"
    try:
        return _success(_start(employee=employee, kind=kind))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def start_employee_separation(employee=None, relieving_date=None, mark_left=None, sid=None):
    """Phase 73 — set relieving date + offboarding checklist (optional Left)."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

    if not is_people_manager(_user_roles()):
        return _error(_("HR manager access required"), 403)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase73_talent import (
        start_employee_separation as _sep,
    )

    employee = _parse_request_value("employee", employee)
    relieving_date = _parse_request_value("relieving_date", relieving_date)
    mark_left_raw = _parse_request_value("mark_left", mark_left)
    mark_left_flag = str(mark_left_raw or "0").lower() in ("1", "true", "yes")
    try:
        return _success(
            _sep(
                employee,
                relieving_date=relieving_date,
                disable_user=mark_left_flag,
                mark_left=mark_left_flag,
            )
        )
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def complete_checklist_todo(todo_name=None, sid=None):
    """Phase 73 — close an onboarding/offboarding ToDo."""
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

    if not is_people_manager(_user_roles()):
        return _error(_("HR manager access required"), 403)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase73_talent import (
        complete_checklist_todo as _close,
    )

    todo_name = _parse_request_value("todo_name", todo_name)
    try:
        return _success(_close(todo_name))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_franchise_team_attendance(sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase92_hr_policy_masters import (
        get_franchise_team_attendance as _fn,
    )

    try:
        return _success(_fn(frappe.session.user))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)


@frappe.whitelist(allow_guest=True)
def get_franchise_team_leave(sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase92_hr_policy_masters import (
        get_franchise_team_leave as _fn,
    )

    try:
        return _success(_fn(frappe.session.user))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)


@frappe.whitelist(allow_guest=True)
def assign_employee_hr_band(employee=None, designation=None, grade=None, franchisee=None, sid=None):
    denied = _require_people_hrms_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase90_people_hrms import is_people_manager

    if not is_people_manager(_user_roles()):
        return _error(_("HR manager access required"), 403)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase92_hr_policy_masters import (
        assign_employee_band,
    )

    employee = _parse_request_value("employee", employee)
    designation = _parse_request_value("designation", designation)
    grade = _parse_request_value("grade", grade)
    franchisee = _parse_request_value("franchisee", franchisee)
    return _success(
        assign_employee_band(employee, designation=designation, grade=grade, franchisee=franchisee)
    )


@frappe.whitelist(allow_guest=True)
def submit_leave_application(
    leave_type=None,
    from_date=None,
    to_date=None,
    description=None,
    sid=None,
):
    """Phase 21 — apply for leave."""
    denied = _require_hr_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import submit_leave_application as _submit

    leave_type = _parse_request_value("leave_type", leave_type)
    from_date = _parse_request_value("from_date", from_date)
    to_date = _parse_request_value("to_date", to_date)
    description = _parse_request_value("description", description)
    if not all([leave_type, from_date, to_date]):
        return _error(_("leave_type, from_date, and to_date are required"))

    try:
        row = _submit(frappe.session.user, leave_type, from_date, to_date, description)
        return _success({"leave_application": row}, message=_("Leave application submitted"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def submit_expense_claim(
    expense_type=None,
    amount=None,
    description=None,
    expense_date=None,
    sid=None,
):
    """Phase 21 — submit expense claim."""
    denied = _require_hr_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import submit_expense_claim as _submit

    expense_type = _parse_request_value("expense_type", expense_type)
    amount = _parse_request_value("amount", amount)
    description = _parse_request_value("description", description)
    expense_date = _parse_request_value("expense_date", expense_date)
    if not expense_type or amount is None:
        return _error(_("expense_type and amount are required"))

    try:
        row = _submit(frappe.session.user, expense_type, amount, description, expense_date)
        return _success({"expense_claim": row}, message=_("Expense claim submitted"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def attach_expense_receipt(
    expense_claim=None,
    filename=None,
    file_content=None,
    sid=None,
):
    """Phase 21 — attach receipt image/PDF to expense claim (base64)."""
    denied = _require_hr_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import attach_receipt_to_expense_claim

    expense_claim = _parse_request_value("expense_claim", expense_claim)
    filename = _parse_request_value("filename", filename) or "receipt.jpg"
    file_content = _parse_request_value("file_content", file_content)
    if not expense_claim or not file_content:
        return _error(_("expense_claim and file_content are required"))

    try:
        result = attach_receipt_to_expense_claim(
            expense_claim, frappe.session.user, filename, file_content
        )
        return _success(result, message=_("Receipt attached"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_staff_performance_hub(sid=None):
    """Phase 74 — training programs/events, KRAs, and appraisals for staff."""
    denied = _require_hr_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase74_performance import (
        get_performance_hub_payload,
    )

    return _success(get_performance_hub_payload(frappe.session.user))


@frappe.whitelist(allow_guest=True)
def submit_appraisal_self_review(
    appraisal=None,
    reflections=None,
    ratings=None,
    sid=None,
):
    """Phase 74 — employee self-reflection and criteria ratings on an appraisal."""
    denied = _require_hr_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase74_performance import (
        submit_appraisal_self_review as _submit,
    )

    appraisal = _parse_request_value("appraisal", appraisal)
    reflections = _parse_request_value("reflections", reflections)
    ratings = _parse_request_value("ratings", ratings)
    if not appraisal:
        return _error(_("appraisal is required"))

    try:
        row = _submit(frappe.session.user, appraisal, reflections, ratings)
        return _success({"appraisal": row}, message=_("Self review saved"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def submit_training_feedback(
    training_event=None,
    rating=None,
    feedback=None,
    sid=None,
):
    """Phase 74 — post-training feedback from staff."""
    denied = _require_hr_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase74_performance import (
        submit_training_feedback as _submit,
    )

    training_event = _parse_request_value("training_event", training_event)
    rating = _parse_request_value("rating", rating)
    feedback = _parse_request_value("feedback", feedback)
    if not training_event:
        return _error(_("training_event is required"))

    try:
        result = _submit(frappe.session.user, training_event, rating, feedback)
        return _success(result, message=_("Training feedback submitted"))
    except (frappe.ValidationError, frappe.DoesNotExistError) as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="submit_training_feedback", message=frappe.get_traceback())
        return _error(str(exc)[:200] or _("Training feedback failed"))


@frappe.whitelist(allow_guest=True)
def get_health_subscription_plans(sid=None):
    """Phase 19 — list active subscription plans."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase19 import list_subscription_plans

    return _success(
        {
            "plans": list_subscription_plans(),
            "subscriptions_available": bool(list_subscription_plans()),
        }
    )


@frappe.whitelist(allow_guest=True)
def get_my_health_subscription(sid=None):
    """Phase 19 — current user's active subscription."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.clinical_phase19 import (
        get_active_subscription,
        get_entitlements,
    )

    return _success(
        {
            "subscription": get_active_subscription(frappe.session.user),
            "entitlements": get_entitlements(frappe.session.user),
        }
    )


@frappe.whitelist(allow_guest=True)
def subscribe_health_plan(plan_code=None, sid=None):
    """Phase 19 — subscribe to a health plan (test mode activates immediately)."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.clinical_phase19 import subscribe_user

    plan_code = _parse_request_value("plan_code", plan_code)
    if not plan_code:
        return _error(_("plan_code is required"))

    try:
        sub = subscribe_user(frappe.session.user, plan_code)
        msg = _("Subscription activated") if sub.get("status") == "Active" else _("Subscription recorded — pending payment")
        return _success({"subscription": sub}, message=msg)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_circle_landing(sid=None):
    """Phase 26 — Health Circle marketing payload (Apollo Circle–style)."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase26 import circle_landing_payload

    payload = circle_landing_payload()
    if _require_mobile_auth(sid):
        from health_ecosystem_core.health_ecosystem_core.clinical_phase19 import get_entitlements

        payload["entitlements"] = get_entitlements(frappe.session.user)
    return _success(payload)


@frappe.whitelist(allow_guest=True)
def preview_checkout_price(subtotal=None, context=None, promo_code=None, use_wallet=None, sid=None):
    """Phase 26 — membership + coupon + optional wallet pricing preview for checkout."""
    subtotal = flt(_parse_request_value("subtotal", subtotal) or 0)
    context = _parse_request_value("context", context) or "lab"
    promo_code = _parse_request_value("promo_code", promo_code)
    use_wallet = cint(_parse_request_value("use_wallet", use_wallet) or 0)
    if subtotal <= 0:
        return _error(_("Order total must be greater than zero"))
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase26 import preview_checkout

        user = frappe.session.user if _require_mobile_auth(sid) else None
        data = preview_checkout(user, subtotal, context, promo_code, use_wallet=use_wallet)
        return _success(data)
    except frappe.ValidationError as exc:
        return _error(str(exc))


def _require_b2b_access(sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import resolve_franchisee_for_user

    if not resolve_franchisee_for_user(frappe.session.user):
        return _error(_("Franchisee operator access required"), 403)
    return None


@frappe.whitelist(allow_guest=True)
def get_b2b_portal(sid=None):
    """Phase 23 — B2B franchise portal summary."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import get_b2b_portal_payload

    return _success(get_b2b_portal_payload(frappe.session.user))


@frappe.whitelist(allow_guest=True)
def get_b2b_catalog(sid=None):
    """Phase 23 — dual-price lab catalog for franchisee."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import (
        get_b2b_catalog as _catalog,
        resolve_franchisee_for_user,
    )

    franchisee_id = resolve_franchisee_for_user(frappe.session.user)
    return _success({"items": _catalog(franchisee_id), "franchisee_id": franchisee_id})


@frappe.whitelist(allow_guest=True)
def get_b2b_statements(sid=None, limit=None):
    """Phase 23 — retail vs wholesale statement lines."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import (
        get_b2b_statements as _statements,
        resolve_franchisee_for_user,
    )

    franchisee_id = resolve_franchisee_for_user(frappe.session.user)
    return _success(_statements(franchisee_id, limit=limit or 50))


@frappe.whitelist(allow_guest=True)
def get_b2b_foco_centres(sid=None):
    """Phase 111 — mapped FOFO centres for the logged-in FOCO partner."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import resolve_franchisee_for_user
    from health_ecosystem_core.health_ecosystem_core.clinical_phase111_foco_fofo_upsell import (
        foco_centre_tab,
    )

    franchisee_id = resolve_franchisee_for_user(frappe.session.user)
    return _success(foco_centre_tab(franchisee_id))


@frappe.whitelist(allow_guest=True)
def get_b2b_fofo_commission(sid=None, limit=None):
    """Phase 111 — FOFO commission statement for the logged-in FOCO partner."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import resolve_franchisee_for_user
    from health_ecosystem_core.health_ecosystem_core.clinical_phase111_foco_fofo_upsell import (
        foco_fofo_commission_statement,
    )

    franchisee_id = resolve_franchisee_for_user(frappe.session.user)
    return _success(foco_fofo_commission_statement(franchisee_id, limit=limit or 200))


@frappe.whitelist(allow_guest=True)
def get_partner_circuit(sid=None):
    """Phase 126 — my partner tier, mapped Master FOCO / lab and services."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import resolve_franchisee_for_user
    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        partner_circuit,
        vector_bill_to_options,
        vector_entry_public,
    )

    fid = resolve_franchisee_for_user(frappe.session.user)
    payload = partner_circuit(fid)
    payload["vector_entry"] = vector_entry_public(fid)
    payload["bill_to_vectors"] = vector_bill_to_options(fid)
    return _success(payload)


@frappe.whitelist(allow_guest=True)
def get_partner_vector_bills(sid=None):
    """Phase 126 — Vector B2B bills: receivable (as entry partner) and payable (as Vector), settled offline."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import resolve_franchisee_for_user
    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        partner_vector_bills_payload,
    )

    return _success(partner_vector_bills_payload(resolve_franchisee_for_user(frappe.session.user)))


@frappe.whitelist(allow_guest=True)
def settle_partner_vector_bill(bill=None, remarks=None, sid=None):
    """Phase 126 — entry partner marks a Vector B2B bill settled (paid offline)."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import resolve_franchisee_for_user
    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        settle_partner_vector_bill as _settle,
    )

    try:
        return _success(
            _settle(
                resolve_franchisee_for_user(frappe.session.user),
                _parse_request_value("bill", bill),
                roles=_user_roles(),
                remarks=_parse_request_value("remarks", remarks),
            ),
            message=_("Vector bill settled"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def list_mapped_vectors(sid=None):
    """Phase 126 — Vectors that enter the circuit through the logged-in FOCO (Bill to Vector choices)."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import resolve_franchisee_for_user
    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import vector_bill_to_options

    return _success({"vectors": vector_bill_to_options(resolve_franchisee_for_user(frappe.session.user))})


@frappe.whitelist(allow_guest=True)
def map_vector_entry(vector=None, entry_partner=None, sid=None):
    """Phase 126 — admin: map a Vector to its FOCO / Master FOCO / lab entry partner (empty clears)."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        map_vector_entry as _map,
    )

    try:
        return _success(
            _map(_user_roles(), _parse_request_value("vector", vector), _parse_request_value("entry_partner", entry_partner)),
            message=_("Vector mapping saved"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_partner_earnings(sid=None, limit=None):
    """Phase 126 — business earnings: deposit debits and pending / posted MF and lab shares."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import resolve_franchisee_for_user
    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        partner_earnings_payload,
    )

    franchisee_id = resolve_franchisee_for_user(frappe.session.user)
    return _success(partner_earnings_payload(franchisee_id, limit=cint(limit) or 200))


@frappe.whitelist(allow_guest=True)
def get_partner_shipments(sid=None):
    """Phase 126 — samples awaiting accession, outgoing icebox shipments and incoming shipments to my lab."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import resolve_franchisee_for_user
    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        partner_shipments_payload,
    )

    return _success(partner_shipments_payload(resolve_franchisee_for_user(frappe.session.user)))


@frappe.whitelist(allow_guest=True)
def create_partner_shipment(shipment=None, sid=None):
    """Phase 126 — Master / Orange FOCO accessions circuit samples and records the icebox shipment."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import resolve_franchisee_for_user
    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        create_partner_shipment as _create,
    )

    data = _parse_request_value("shipment", shipment)
    if isinstance(data, str):
        data = json.loads(data or "{}")
    try:
        return _success(
            _create(resolve_franchisee_for_user(frappe.session.user), data or {}),
            message=_("Shipment recorded"),
        )
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def receive_partner_shipment(shipment=None, sid=None):
    """Phase 126 — receiving lab confirms the icebox arrived (credits the Master FOCO share)."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import resolve_franchisee_for_user
    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        receive_partner_shipment as _receive,
    )

    try:
        return _success(
            _receive(
                resolve_franchisee_for_user(frappe.session.user),
                _parse_request_value("shipment", shipment),
                roles=_user_roles(),
            ),
            message=_("Shipment received"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def map_partner_circuit(circuit=None, sid=None):
    """Phase 126 — admin / onboarding: set tier, mapping, own-lab and service flags."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        map_partner_circuit as _map,
    )

    data = _parse_request_value("circuit", circuit)
    if isinstance(data, str):
        data = json.loads(data or "{}")
    try:
        return _success(_map(_user_roles(), data or {}), message=_("Partner circuit saved"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


def _pricing_chart_call(fn, *args, **kwargs):
    try:
        return _success(fn(_user_roles(), *args, **kwargs))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_partner_pricing_chart(configured_only=None, q=None, sid=None):
    """Phase 127 — master pricing chart: tests × (FOCO / Master FOCO / Orange FOCO billing + fee) + MRP."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase127_pricing_chart import pricing_chart

    return _pricing_chart_call(
        pricing_chart,
        configured_only=cint(_parse_request_value("configured_only", configured_only) or 0),
        q=_parse_request_value("q", q),
    )


@frappe.whitelist(allow_guest=True)
def save_partner_pricing_rows(rows=None, sid=None):
    """Phase 127 — save edited chart rows (all six tier values or none, plus MRP)."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase127_pricing_chart import apply_pricing_rows

    data = _parse_request_value("rows", rows)
    if isinstance(data, str):
        data = json.loads(data or "[]")
    return _pricing_chart_call(apply_pricing_rows, data or [], dry_run=0)


@frappe.whitelist(allow_guest=True)
def export_partner_pricing(fmt=None, configured_only=None, sid=None):
    """Phase 127 — download the chart as Excel (xlsx) or PDF (base64 payload)."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase127_pricing_chart import export_pricing

    return _pricing_chart_call(
        export_pricing,
        fmt=_parse_request_value("fmt", fmt) or "xlsx",
        configured_only=cint(_parse_request_value("configured_only", configured_only) or 0),
    )


@frappe.whitelist(allow_guest=True)
def import_partner_pricing(filename=None, content=None, dry_run=None, sid=None):
    """Phase 127 — import the chart from an Excel / CSV file in the export layout (dry_run=1 validates only)."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase127_pricing_chart import import_pricing

    return _pricing_chart_call(
        import_pricing,
        _parse_request_value("filename", filename),
        _parse_request_value("content", content),
        dry_run=cint(_parse_request_value("dry_run", dry_run) or 0),
    )


@frappe.whitelist(allow_guest=True)
def save_partner_tier_rate(rate=None, sid=None):
    """Phase 126 — admin: upsert a per-test tier billing rate / platform fee."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        save_partner_tier_rate as _save,
    )

    data = _parse_request_value("rate", rate)
    if isinstance(data, str):
        data = json.loads(data or "{}")
    try:
        return _success(_save(_user_roles(), data or {}), message=_("Tier rate saved"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def list_partner_tier_rates(item_code=None, sid=None):
    """Phase 126 — tier rates (all partners may read)."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
        list_partner_tier_rates as _list,
    )

    return _success({"rates": _list(_parse_request_value("item_code", item_code) or None)})


@frappe.whitelist(allow_guest=True)
def list_active_foco_centres(sid=None):
    """Active FOCO centres for FOFO onboarding (Under Which FOCO)."""
    denied = _require_b2b_access(sid)
    if denied:
        # Desk / System Manager may also list FOCOs without a hub login.
        if "System Manager" not in frappe.get_roles() and "Health System Admin" not in frappe.get_roles():
            return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase111_foco_fofo_upsell import (
        list_active_foco_centres as _list,
    )

    return _success({"centres": _list()})


@frappe.whitelist(allow_guest=True)
def get_b2b_wallet(sid=None, limit=None):
    """Phase 23 — franchisee prepaid wallet balance and ledger."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import (
        get_b2b_wallet_payload,
        resolve_franchisee_for_user,
    )

    franchisee_id = resolve_franchisee_for_user(frappe.session.user)
    payload = get_b2b_wallet_payload(franchisee_id, limit=limit or 30)
    payload["topup_requests"] = _wallet_topup_requests(franchisee_id)
    return _success(payload)


def _wallet_topup_requests(franchisee_id, limit=10):
    if not franchisee_id or not frappe.db.exists("DocType", "Franchisee Wallet Topup Request"):
        return []
    return frappe.get_all(
        "Franchisee Wallet Topup Request",
        filters={"franchisee": franchisee_id},
        fields=["name", "amount", "payment_reference", "payment_mode", "status", "creation", "review_remarks"],
        order_by="creation desc",
        limit_page_length=limit,
    )


@frappe.whitelist(allow_guest=True)
def recharge_b2b_wallet(sid=None, amount=None, payment_reference=None, payment_mode=None, remarks=None):
    """Phase 23 / 121 — offline bank/UPI top-up: files a request that finance approves before the wallet is credited."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import (
        MIN_WALLET_RECHARGE,
        resolve_franchisee_for_user,
    )

    amount = _parse_request_value("amount", amount)
    payment_reference = (_parse_request_value("payment_reference", payment_reference) or "").strip()
    payment_mode = (_parse_request_value("payment_mode", payment_mode) or "Bank Transfer").strip()
    remarks = (_parse_request_value("remarks", remarks) or "").strip()
    try:
        amount_f = float(amount)
    except (TypeError, ValueError):
        return _error(_("Valid recharge amount is required"))
    if amount_f < MIN_WALLET_RECHARGE:
        return _error(_("Minimum wallet recharge is ₹{0}").format(MIN_WALLET_RECHARGE))
    if len(payment_reference) < 6:
        return _error(_("Enter the bank / UPI transaction reference (UTR) of your transfer"))
    if payment_mode not in ("Bank Transfer", "UPI", "Cheque", "Cash"):
        payment_mode = "Bank Transfer"

    franchisee_id = resolve_franchisee_for_user(frappe.session.user)
    if not franchisee_id:
        return _error(_("No franchisee profile linked to this account"), 403)
    if frappe.db.exists(
        "Franchisee Wallet Topup Request",
        {"payment_reference": payment_reference, "status": ("in", ("Pending", "Approved"))},
    ) or frappe.db.exists(
        "Franchisee Wallet Transaction",
        {"payment_reference": payment_reference, "transaction_type": "Recharge"},
    ):
        return _error(_("This transaction reference has already been submitted"))

    previous_user = frappe.session.user
    try:
        frappe.set_user("Administrator")
        request_doc = frappe.get_doc(
            {
                "doctype": "Franchisee Wallet Topup Request",
                "franchisee": franchisee_id,
                "amount": amount_f,
                "payment_reference": payment_reference,
                "payment_mode": payment_mode,
                "requested_by": previous_user,
                "remarks": remarks,
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
    finally:
        frappe.set_user(previous_user)

    return _success(
        {
            "request_id": request_doc.name,
            "status": "Pending",
            "amount": amount_f,
            "pending_review": True,
        },
        message=_("Top-up request submitted. Your wallet is credited once finance confirms the transfer."),
    )


@frappe.whitelist(allow_guest=True)
def create_b2b_wallet_razorpay_order(sid=None, amount=None):
    """Phase 23 — create a Razorpay order for a franchisee wallet top-up."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import (
        prepare_wallet_recharge,
        stash_wallet_razorpay_order,
    )

    amount = _parse_request_value("amount", amount)
    try:
        recharge = prepare_wallet_recharge(frappe.session.user, amount)
    except frappe.ValidationError as exc:
        return _error(str(exc))

    franchisee_id = recharge["franchisee_id"]
    amount_value = recharge["amount"]
    amount_paise = recharge["amount_paise"]

    if _razorpay_test_mode():
        creds = _get_site_api_credentials()
        order_id = f"order_wallet_{frappe.generate_hash(length=10)}"
        stash_wallet_razorpay_order(order_id, franchisee_id, amount_value)
        return _success(
            {
                "order_id": order_id,
                "amount": amount_value,
                "amount_paise": amount_paise,
                "currency": "INR",
                "razorpay_key_id": creds.get("razorpay_key_id"),
                "test_mode": True,
            },
            message="Test wallet top-up order created",
        )

    creds = _get_site_api_credentials()
    key_id = creds.get("razorpay_key_id")
    key_secret = creds.get("razorpay_key_secret")
    if not (key_id and key_secret):
        return _error(_("Razorpay is not configured on server"))

    auth_header = base64.b64encode(f"{key_id}:{key_secret}".encode("utf-8")).decode("ascii")
    payload = json.dumps(
        {
            "amount": amount_paise,
            "currency": "INR",
            "receipt": f"wallet-{franchisee_id}-{frappe.generate_hash(length=6)}",
            "payment_capture": 1,
        }
    ).encode("utf-8")
    req = Request(
        "https://api.razorpay.com/v1/orders",
        data=payload,
        headers={
            "Authorization": f"Basic {auth_header}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=20) as resp:
            order_data = json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        frappe.log_error(
            title="create_b2b_wallet_razorpay_order",
            message=exc.read().decode("utf-8", errors="replace"),
        )
        return _error(_("Razorpay order creation failed"))
    except URLError as exc:
        frappe.log_error(title="create_b2b_wallet_razorpay_order", message=str(exc))
        return _error(_("Razorpay is unreachable"))

    order_id = order_data.get("id")
    stash_wallet_razorpay_order(order_id, franchisee_id, amount_value)
    _record_payment_intent("b2b_wallet", order_id, amount_value, party_type="Franchisee Profile", party=franchisee_id)
    return _success(
        {
            "order_id": order_id,
            "amount": amount_value,
            "amount_paise": amount_paise,
            "currency": order_data.get("currency", "INR"),
            "razorpay_key_id": key_id,
            "test_mode": False,
        },
        message="Razorpay wallet order created",
    )


def _confirm_wallet_razorpay_payment(razorpay_order_id, razorpay_payment_id, razorpay_signature, amount):
    """Signature + Razorpay lookup for server-created wallet orders. Returns an error response or None."""
    if _razorpay_test_mode():
        return None
    from health_ecosystem_core.health_ecosystem_core.clinical_razorpay import confirm_payment, signature_valid

    if not razorpay_signature:
        return _error(_("Missing payment signature"))
    if not signature_valid(razorpay_order_id, razorpay_payment_id, razorpay_signature):
        return _error(_("Payment signature verification failed"), 403)
    check = confirm_payment(
        razorpay_order_id,
        razorpay_payment_id,
        expected_amount_paise=int(round(flt(amount) * 100)),
    )
    if not check.get("ok"):
        frappe.log_error(
            title="wallet razorpay verify rejected",
            message=f"{razorpay_order_id} {razorpay_payment_id}: {check.get('reason')}",
        )
        return _error(_("This payment does not match the wallet top-up. Please contact support."), 403)
    return None


@frappe.whitelist(allow_guest=True)
def verify_b2b_wallet_razorpay_payment(
    sid=None,
    razorpay_payment_id=None,
    razorpay_order_id=None,
    razorpay_signature=None,
):
    """Phase 23 — verify a Razorpay wallet top-up and credit the franchisee wallet."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import (
        complete_wallet_razorpay_credit,
        load_wallet_razorpay_order,
        resolve_franchisee_for_user,
    )

    razorpay_payment_id = _parse_request_value("razorpay_payment_id", razorpay_payment_id)
    razorpay_order_id = _parse_request_value("razorpay_order_id", razorpay_order_id)
    razorpay_signature = _parse_request_value("razorpay_signature", razorpay_signature)

    if not razorpay_order_id or not razorpay_payment_id:
        return _error(_("Missing payment verification fields"))

    stashed = load_wallet_razorpay_order(razorpay_order_id) or _wallet_stash_from_intent(razorpay_order_id, "b2b_wallet")
    if not stashed:
        return _error(_("Wallet order expired or not found"))

    franchisee_id = stashed.get("franchisee_id")
    amount = stashed.get("amount")

    # The wallet top-up must belong to the authenticated franchisee.
    if franchisee_id != resolve_franchisee_for_user(frappe.session.user):
        return _error(_("This wallet order does not belong to you"), 403)

    denied = _confirm_wallet_razorpay_payment(razorpay_order_id, razorpay_payment_id, razorpay_signature, amount)
    if denied:
        return denied

    previous_user = frappe.session.user
    try:
        frappe.set_user("Administrator")
        row = complete_wallet_razorpay_credit(
            franchisee_id, amount, razorpay_payment_id, order_id=razorpay_order_id
        )
        _mark_payment_intent(razorpay_order_id, razorpay_payment_id, "Checkout")
        frappe.db.commit()
    finally:
        frappe.set_user(previous_user)

    return _success(row, message=_("Wallet recharged"))


@frappe.whitelist(allow_guest=True)
def create_b2b_walk_in_order(
    patient_name=None,
    patient_phone=None,
    age=None,
    age_months=None,
    age_days=None,
    gender=None,
    item_code=None,
    item_codes=None,
    discount_amount=None,
    payment_method=None,
    sid=None,
):
    """Phase 23 — franchisee walk-in lab order (patient pays MRP at hub). Supports multi-test bills."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import create_b2b_walk_in_order as _create

    patient_name = _parse_request_value("patient_name", patient_name)
    patient_phone = _parse_request_value("patient_phone", patient_phone)
    age = _parse_request_value("age", age)
    age_months = _parse_request_value("age_months", age_months)
    age_days = _parse_request_value("age_days", age_days)
    gender = _parse_request_value("gender", gender)
    item_code = _parse_request_value("item_code", item_code)
    item_codes = _parse_request_value("item_codes", item_codes)
    discount_amount = _parse_request_value("discount_amount", discount_amount)
    payment_method = _parse_request_value("payment_method", payment_method)

    has_items = bool(item_codes or item_code)
    if not all([patient_name, patient_phone, gender, has_items]):
        return _error(_("patient_name, patient_phone, gender, and at least one lab test are required"))

    try:
        row = _create(
            frappe.session.user,
            patient_name,
            patient_phone,
            age,
            gender,
            item_code,
            payment_method=payment_method,
            item_codes=item_codes,
            discount_amount=discount_amount,
            age_months=age_months,
            age_days=age_days,
        )
        return _success(row, message=_("Walk-in order created"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


def _require_lab_ops_access(sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import is_lab_ops_user

    if not is_lab_ops_user(frappe.session.user):
        return _error(_("Lab operations access required"), 403)
    return None


@frappe.whitelist(allow_guest=True)
def get_lab_reagent_dashboard(sid=None):
    """Phase 24 — open batches, reorder alerts, reagent + consumable inventory."""
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import get_reagent_dashboard_payload

    return _success(get_reagent_dashboard_payload(frappe.session.user))


@frappe.whitelist(allow_guest=True)
def create_mapped_reagent(
    sid=None,
    reagent_name=None,
    lab_test_item=None,
    parameter_code=None,
    tests_per_consumption=None,
    safety_stock=None,
    reagent_item=None,
):
    """Create a reagent Item mapped to a test parameter (Lab Test Reagent Rule)."""
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import create_mapped_reagent as _create

    try:
        row = _create(
            frappe.session.user,
            _parse_request_value("reagent_name", reagent_name),
            _parse_request_value("lab_test_item", lab_test_item),
            _parse_request_value("parameter_code", parameter_code),
            tests_per_consumption=_parse_request_value("tests_per_consumption", tests_per_consumption) or 1,
            safety_stock=_parse_request_value("safety_stock", safety_stock) or 10,
            reagent_item=_parse_request_value("reagent_item", reagent_item),
        )
        return _success(row, message=_("Reagent mapped to parameter"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def register_lab_reagent_batch(
    sid=None,
    reagent_item=None,
    lot_number=None,
    tests_per_pack=None,
    expiry_date=None,
    franchisee_id=None,
    remarks=None,
):
    """Phase 24 — register a sealed reagent pack."""
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import register_reagent_batch

    reagent_item = _parse_request_value("reagent_item", reagent_item)
    lot_number = _parse_request_value("lot_number", lot_number)
    tests_per_pack = _parse_request_value("tests_per_pack", tests_per_pack)
    expiry_date = _parse_request_value("expiry_date", expiry_date)
    franchisee_id = _parse_request_value("franchisee_id", franchisee_id)
    remarks = _parse_request_value("remarks", remarks)

    if not all([reagent_item, lot_number, tests_per_pack]):
        return _error(_("reagent_item, lot_number, and tests_per_pack are required"))

    try:
        row = register_reagent_batch(
            frappe.session.user,
            reagent_item,
            lot_number,
            tests_per_pack,
            expiry_date=expiry_date,
            franchisee_id=franchisee_id,
            remarks=remarks,
        )
        return _success(row, message=_("Reagent batch registered"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def open_lab_reagent_batch(sid=None, batch_id=None):
    """Phase 24 — open a sealed pack and set test quota."""
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import open_reagent_batch

    batch_id = _parse_request_value("batch_id", batch_id)
    if not batch_id:
        return _error(_("batch_id is required"))

    try:
        row = open_reagent_batch(frappe.session.user, batch_id)
        return _success(row, message=_("Reagent pack opened"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def register_lab_consumable_batch(
    sid=None,
    consumable_item=None,
    lot_number=None,
    units_per_pack=None,
    expiry_date=None,
    franchisee_id=None,
    remarks=None,
):
    """Register a sealed consumable pack (vials, pads, gloves, …)."""
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import register_consumable_batch

    consumable_item = _parse_request_value("consumable_item", consumable_item)
    lot_number = _parse_request_value("lot_number", lot_number)
    units_per_pack = _parse_request_value("units_per_pack", units_per_pack)
    expiry_date = _parse_request_value("expiry_date", expiry_date)
    franchisee_id = _parse_request_value("franchisee_id", franchisee_id)
    remarks = _parse_request_value("remarks", remarks)

    if not all([consumable_item, lot_number, units_per_pack]):
        return _error(_("consumable_item, lot_number, and units_per_pack are required"))

    try:
        row = register_consumable_batch(
            frappe.session.user,
            consumable_item,
            lot_number,
            units_per_pack,
            expiry_date=expiry_date,
            franchisee_id=franchisee_id,
            remarks=remarks,
        )
        return _success(row, message=_("Consumable batch registered"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def open_lab_consumable_batch(sid=None, batch_id=None):
    """Open a sealed consumable pack."""
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import open_consumable_batch

    batch_id = _parse_request_value("batch_id", batch_id)
    if not batch_id:
        return _error(_("batch_id is required"))

    try:
        row = open_consumable_batch(frappe.session.user, batch_id)
        return _success(row, message=_("Consumable pack opened"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


def _require_sales_access(sid=None):
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import is_sales_user

    if not is_sales_user(frappe.session.user):
        return _error(_("Sales field force access required"), 403)
    return None


@frappe.whitelist(allow_guest=True)
def get_sales_portal(sid=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import (
            ensure_hec_module_def,
            get_sales_portal_payload,
        )

        ensure_hec_module_def()
        return _success(get_sales_portal_payload(frappe.session.user))
    except Exception as exc:
        frappe.log_error(title="get_sales_portal", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load sales portal"))


@frappe.whitelist(allow_guest=True)
def get_sales_profile_dashboard(sid=None, seed_if_missing=1):
    """REACH user Profile dashboard — KPIs, ERP employee, CTC/target/expenses."""
    denied = _require_sales_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import ensure_hec_module_def
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25_sales_profile import (
            get_sales_profile_dashboard as _dashboard,
        )

        ensure_hec_module_def()
        seed = str(seed_if_missing or "1").lower() not in ("0", "false", "no")
        return _success(_dashboard(frappe.session.user, seed_if_missing=seed))
    except Exception as exc:
        frappe.log_error(title="get_sales_profile_dashboard", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load sales profile dashboard"))


@frappe.whitelist(allow_guest=True)
def ensure_reach_sales_profiles_seed(sid=None):
    """Admin/HMAC-friendly seed for all active REACH sales profiles."""
    denied = _require_sales_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25_sales_profile import (
            ensure_reach_profiles_seed_all,
        )
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import is_sales_manager

        if not is_sales_manager(frappe.session.user) and "System Manager" not in frappe.get_roles(frappe.session.user):
            return _error(_("Only sales managers can seed all REACH profiles"), 403)
        return _success(ensure_reach_profiles_seed_all(), message=_("REACH profiles seeded"))
    except Exception as exc:
        frappe.log_error(title="ensure_reach_sales_profiles_seed", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to seed REACH profiles"))


@frappe.whitelist(allow_guest=True)
def get_sales_leads(sid=None, limit=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import list_sales_leads

    return _success({"leads": list_sales_leads(frappe.session.user, limit=limit or 50)})


@frappe.whitelist(allow_guest=True)
def create_sales_lead(sid=None, **kwargs):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import create_sales_lead as _create

    data = {k: _parse_request_value(k, kwargs.get(k)) for k in (
        "lead_name", "company_name", "contact_person", "phone", "email",
        "address", "city", "district", "subdivision", "pincode", "state",
        "latitude", "longitude", "status", "notes", "lead_source",
    )}
    if not data.get("lead_name") or not data.get("phone"):
        return _error(_("lead_name and phone are required"))
    try:
        lead_id = _create(frappe.session.user, data)
        return _success({"lead_id": lead_id}, message=_("Lead created"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def update_sales_lead(sid=None, lead_id=None, **kwargs):
    """REACH Flutter / web: update lead status and contact fields."""
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import update_sales_lead as _update

    lead_id = _parse_request_value("lead_id", lead_id) or _parse_request_value("name", kwargs.get("name"))
    data = {k: _parse_request_value(k, kwargs.get(k)) for k in (
        "lead_name", "company_name", "contact_person", "phone", "email",
        "address", "city", "district", "subdivision", "pincode", "state",
        "latitude", "longitude", "status", "notes", "lead_source",
    )}
    try:
        row = _update(frappe.session.user, lead_id, data)
        return _success(row, message=_("Lead updated"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="update_sales_lead", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to update lead"))


@frappe.whitelist(allow_guest=True)
def log_sales_visit(sid=None, **kwargs):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import log_field_visit

    data = {k: _parse_request_value(k, kwargs.get(k)) for k in (
        "lead_id", "franchisee_id", "visit_date", "visit_time", "latitude", "longitude",
        "purpose", "outcome", "duration_minutes", "notes", "lead_status",
        "visit_id", "photo_base64", "photo_filename",
    )}
    try:
        visit_id = log_field_visit(frappe.session.user, data)
        return _success({"visit_id": visit_id}, message=_("Visit logged"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_sales_visits(sid=None, limit=None, all_team=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import list_field_visits

    team = str(_parse_request_value("all_team", all_team) or "").lower() in ("1", "true", "yes")
    return _success({"visits": list_field_visits(frappe.session.user, limit=limit or 50, all_team=team)})


@frappe.whitelist(allow_guest=True)
def list_reach_sales_reps(sid=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import list_sales_reps_for_manager

    try:
        return _success({"reps": list_sales_reps_for_manager(frappe.session.user)})
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def assign_reach_sales_lead(sid=None, lead_id=None, sales_rep_id=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import assign_sales_lead_rep

    lead_id = _parse_request_value("lead_id", lead_id)
    sales_rep_id = _parse_request_value("sales_rep_id", sales_rep_id)
    if not lead_id or not sales_rep_id:
        return _error(_("lead_id and sales_rep_id are required"))
    try:
        row = assign_sales_lead_rep(frappe.session.user, lead_id, sales_rep_id)
        return _success(row, message=_("REACH user assigned"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def ffms_list_reach_reps(**kwargs):
    """FFMS HMAC bridge — list active REACH / Sales Rep Profiles."""
    frappe.flags.ignore_csrf = True
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            _check_webhook_secret,
        )
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import ffms_list_reach_reps as _list

        _check_webhook_secret()
        return _success({"reps": _list()})
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except Exception as exc:
        frappe.log_error(title="ffms_list_reach_reps", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to list REACH users"))


@frappe.whitelist(allow_guest=True)
def ffms_assign_reach_lead(**kwargs):
    """FFMS HMAC bridge — assign lead to REACH user (creates pending Log Visit)."""
    frappe.flags.ignore_csrf = True
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            _check_webhook_secret,
        )
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import ffms_assign_reach_lead as _assign
        import json as _json

        _check_webhook_secret()
        create_visit_raw = _parse_request_value("create_visit", kwargs.get("create_visit"))
        create_visit = str(create_visit_raw or "1").lower() not in ("0", "false", "no")

        lead_payload = {}
        lead_json = _parse_request_value("lead_json", kwargs.get("lead_json"))
        if lead_json:
            try:
                parsed = _json.loads(lead_json) if isinstance(lead_json, str) else lead_json
                if isinstance(parsed, dict):
                    lead_payload = parsed
            except Exception:
                lead_payload = {}
        for key in (
            "name", "lead_name", "email", "phone", "mobile", "territory_query", "address",
            "notes", "stage", "source", "campaign_name", "franchise_model", "city", "district", "pincode",
        ):
            value = _parse_request_value(f"lead_{key}", kwargs.get(f"lead_{key}"))
            if value is not None and str(value).strip() != "":
                lead_payload[key] = value

        row = _assign(
            hec_lead_id=_parse_request_value("hec_lead_id", kwargs.get("hec_lead_id")),
            rfms_lead_id=_parse_request_value("rfms_lead_id", kwargs.get("rfms_lead_id")),
            sales_rep_id=_parse_request_value("sales_rep_id", kwargs.get("sales_rep_id")),
            assigned_to_name=_parse_request_value("assigned_to_name", kwargs.get("assigned_to_name")),
            assignee_role=_parse_request_value("assignee_role", kwargs.get("assignee_role")) or "reach",
            create_visit=create_visit,
            assigned_from=_parse_request_value("assigned_from", kwargs.get("assigned_from")) or "FFMS Admin",
            lead=lead_payload,
        )
        return _success(row, message=_("Lead assignment synced to REACH"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="ffms_assign_reach_lead", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to assign REACH lead"))


@frappe.whitelist(allow_guest=True)
def ffms_update_lead_status(**kwargs):
    """FFMS HMAC bridge — push CRM stage back to REACH Franchise Sales Lead."""
    frappe.flags.ignore_csrf = True
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            _check_webhook_secret,
        )
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import ffms_update_lead_status as _update

        _check_webhook_secret()
        row = _update(
            hec_lead_id=_parse_request_value("hec_lead_id", kwargs.get("hec_lead_id")),
            rfms_lead_id=_parse_request_value("rfms_lead_id", kwargs.get("rfms_lead_id")),
            stage=_parse_request_value("stage", kwargs.get("stage")),
            status=_parse_request_value("status", kwargs.get("status")),
        )
        return _success(row, message=_("Lead status synced to REACH"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="ffms_update_lead_status", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to sync lead status"))


@frappe.whitelist(allow_guest=True)
def ffms_archive_reach_lead(**kwargs):
    frappe.flags.ignore_csrf = True
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            _check_webhook_secret,
        )
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import ffms_archive_reach_lead as _archive

        _check_webhook_secret()
        row = _archive(
            hec_lead_id=_parse_request_value("hec_lead_id", kwargs.get("hec_lead_id")),
            rfms_lead_id=_parse_request_value("rfms_lead_id", kwargs.get("rfms_lead_id")),
            reason=_parse_request_value("reason", kwargs.get("reason")),
        )
        return _success(row, message=_("REACH lead archived"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except Exception as exc:
        frappe.log_error(title="ffms_archive_reach_lead", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to archive REACH lead"))


@frappe.whitelist(allow_guest=True)
def ffms_archive_field_visit(**kwargs):
    frappe.flags.ignore_csrf = True
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            _check_webhook_secret,
        )
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import ffms_archive_field_visit as _archive

        _check_webhook_secret()
        row = _archive(
            hec_visit_id=_parse_request_value("hec_visit_id", kwargs.get("hec_visit_id")),
            reason=_parse_request_value("reason", kwargs.get("reason")),
        )
        return _success(row, message=_("Field visit archived"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except Exception as exc:
        frappe.log_error(title="ffms_archive_field_visit", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to archive field visit"))


def _require_crm_reach_access(sid=None):
    """CRM Staff/Manager or sales roles may assign leads into REACH."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = set(_user_roles())
    allowed = {
        "CRM Staff",
        "CRM Manager",
        "Sales Representative",
        "Sales Manager",
        "System Manager",
        "Health System Admin",
        "HR Manager",
    }
    if not (roles & allowed):
        return _error(_("CRM Backend or REACH access required"), 403)
    return None


@frappe.whitelist(allow_guest=True)
def list_crm_reach_reps(sid=None):
    """Smilecure CRM — list REACH managers / portal users for lead assignment."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import crm_list_reach_reps

        return _success({"reps": crm_list_reach_reps()})
    except Exception as exc:
        frappe.log_error(title="list_crm_reach_reps", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to list REACH users"))


def _list_crm_portal_assignees_rows():
    """Employees / users who can own CRM work: Portal Access → CRM, or CRM Staff/Manager roles."""
    import json as _json

    ACCESS_DT = "People Portal Access"
    out = []
    seen = set()

    def _add(emp, name, user, designation=""):
        key = cstr(emp or "") or f"user:{cstr(user)}"
        if not name or key in seen:
            return
        seen.add(key)
        out.append(
            {
                "employee": cstr(emp or ""),
                "employee_name": cstr(name),
                "user": cstr(user or ""),
                "full_name": cstr(name),
                "designation": cstr(designation or ""),
            }
        )

    if frappe.db.exists("DocType", ACCESS_DT):
        for r in frappe.get_all(
            ACCESS_DT,
            filters={"active": 1},
            fields=["employee", "login_user", "permissions", "portal"],
            limit_page_length=2000,
        ):
            portal = cstr(r.get("portal") or "").strip().lower().replace(" ", "")
            if portal not in ("crm", "crmportal", "smilecurecrm"):
                continue
            emp = cstr(r.get("employee") or "").strip()
            if not emp:
                continue
            emp_row = frappe.db.get_value(
                "Employee",
                emp,
                ["employee_name", "user_id", "status", "designation"],
                as_dict=True,
            ) or {}
            if emp_row.get("status") and emp_row.status != "Active":
                continue
            user = cstr(r.get("login_user") or emp_row.get("user_id") or "").strip()
            name = cstr(emp_row.get("employee_name") or "").strip()
            if not name and user:
                name = cstr(frappe.db.get_value("User", user, "full_name") or user.split("@")[0]).strip()
            if not name:
                name = emp
            # Skip explicit all-none module grants
            try:
                raw = r.get("permissions") or "{}"
                data = _json.loads(raw) if isinstance(raw, str) else (raw or {})
                if isinstance(data, dict) and data and not any(
                    v and str(v).lower() != "none" for v in data.values()
                ):
                    continue
            except Exception:
                pass
            _add(emp, name, user, emp_row.get("designation") or "")

    for role in ("CRM Staff", "CRM Manager"):
        if not frappe.db.exists("DocType", "Has Role"):
            break
        for has in frappe.get_all(
            "Has Role",
            filters={"role": role, "parenttype": "User"},
            fields=["parent"],
            limit_page_length=500,
        ):
            user = cstr(has.parent or "").strip()
            if not user or user in ("Guest", "Administrator"):
                continue
            if frappe.db.get_value("User", user, "enabled") in (0, "0"):
                continue
            emp = frappe.db.get_value("Employee", {"user_id": user, "status": "Active"}, "name") or frappe.db.get_value(
                "Employee", {"user_id": user}, "name"
            )
            if emp:
                emp_row = frappe.db.get_value(
                    "Employee",
                    emp,
                    ["employee_name", "status", "designation"],
                    as_dict=True,
                ) or {}
                if emp_row.get("status") and emp_row.status != "Active":
                    continue
                name = cstr(emp_row.get("employee_name") or "").strip() or cstr(
                    frappe.db.get_value("User", user, "full_name") or user.split("@")[0]
                ).strip()
                _add(emp, name, user, emp_row.get("designation") or role)
            else:
                name = cstr(frappe.db.get_value("User", user, "full_name") or user.split("@")[0]).strip()
                _add("", name, user, role)

    out.sort(key=lambda x: (x.get("employee_name") or "").lower())
    return {"users": out, "count": len(out)}


@frappe.whitelist(allow_guest=True)
def list_crm_portal_assignees(sid=None):
    """Smilecure CRM — employees with active People Portal Access → CRM Portal (or CRM roles)."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    try:
        return _success(_list_crm_portal_assignees_rows())
    except Exception as exc:
        frappe.log_error(title="list_crm_portal_assignees", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to list CRM portal assignees"))


@frappe.whitelist(allow_guest=True)
def list_crm_ownership(sid=None):
    """Shared CRM ownership map (leads / follow-ups) for all portal logins."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking import list_crm_ownership as _list

        return _success(_list())
    except Exception as exc:
        frappe.log_error(title="list_crm_ownership", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load CRM ownership"))


@frappe.whitelist(allow_guest=True)
def transfer_crm_ownership(
    sid=None,
    from_owner=None,
    to_owner=None,
    lead_ids=None,
    activity_ids=None,
    deal_ids=None,
    contact_ids=None,
    note=None,
    lead_meta=None,
    transferred_by_name=None,
    snapshots=None,
):
    """Persist CRM ownership transfer so Avik / other logins see the new owner."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    roles = set(_user_roles())
    if not (roles & {"CRM Manager", "Sales Manager", "System Manager", "Administrator", "Health System Admin", "HR Manager"}):
        return _error(_("Only CRM Managers can transfer ownership"), 403)
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking import (
            ensure_crm_ownership_doctype,
            ensure_crm_record_snapshot_doctype,
            ensure_crm_transfer_history_doctype,
            ensure_crm_transfer_notice_doctype,
            transfer_crm_ownership as _xfer,
        )

        ensure_crm_ownership_doctype()
        ensure_crm_transfer_history_doctype()
        ensure_crm_transfer_notice_doctype()
        ensure_crm_record_snapshot_doctype()
        return _success(
            _xfer(
                from_owner=_parse_request_value("from_owner", from_owner),
                to_owner=_parse_request_value("to_owner", to_owner),
                lead_ids=_parse_request_value("lead_ids", lead_ids),
                activity_ids=_parse_request_value("activity_ids", activity_ids),
                deal_ids=_parse_request_value("deal_ids", deal_ids),
                contact_ids=_parse_request_value("contact_ids", contact_ids),
                note=_parse_request_value("note", note),
                lead_meta=_parse_request_value("lead_meta", lead_meta),
                transferred_by_name=_parse_request_value("transferred_by_name", transferred_by_name),
                snapshots=_parse_request_value("snapshots", snapshots),
            ),
            message=_("Ownership transferred"),
        )
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="transfer_crm_ownership", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to transfer CRM ownership"))


def _crm_is_manager():
    roles = set(_user_roles())
    return bool(
        roles
        & {
            "CRM Manager",
            "Sales Manager",
            "System Manager",
            "Administrator",
            "Health System Admin",
            "HR Manager",
        }
    )


def _crm_session_display_name():
    user = frappe.session.user
    full = cstr(frappe.db.get_value("User", user, "full_name") or "").strip()
    emp = ""
    try:
        emp = cstr(frappe.db.get_value("Employee", {"user_id": user}, "employee_name") or "").strip()
    except Exception:
        emp = ""
    return emp or full or cstr(user or "").split("@")[0]


@frappe.whitelist(allow_guest=True)
def list_crm_record_snapshots(sid=None, owner=None, record_type=None, limit=2000, include_all=0):
    """Pull CRM lead/follow-up payloads for the current (or named) owner after transfer."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking import (
            ensure_crm_record_snapshot_doctype,
            list_crm_record_snapshots as _list,
        )

        ensure_crm_record_snapshot_doctype()
        is_mgr = _crm_is_manager()
        who = cstr(_parse_request_value("owner", owner) or "").strip()
        me = _crm_session_display_name()
        # Executives may only pull their own snapshots (ignore spoofed owner / include_all).
        if not is_mgr:
            who = me
            include_all = 0
        elif who and who.lower() not in {me.lower(), cstr(frappe.session.user).lower()} and not cint(include_all):
            # Named owner for managers is allowed; include_all still requires manager role.
            pass
        return _success(
            _list(
                owner=who or None,
                record_type=_parse_request_value("record_type", record_type),
                limit=min(cint(limit) or 2000, 2000),
                include_all=1 if is_mgr and cint(include_all) else 0,
            )
        )
    except Exception as exc:
        frappe.log_error(title="list_crm_record_snapshots", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load CRM record snapshots"))


@frappe.whitelist(allow_guest=True)
def upsert_crm_record_snapshots(sid=None, snapshots=None, default_owner=None):
    """Publish local CRM lead/follow-up payloads so other logins can pull them."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking import (
            ensure_crm_record_snapshot_doctype,
            upsert_crm_record_snapshots as _upsert,
        )

        ensure_crm_record_snapshot_doctype()
        dst = cstr(_parse_request_value("default_owner", default_owner) or "").strip()
        # Non-managers cannot republish as another owner.
        if not _crm_is_manager():
            dst = _crm_session_display_name()
        return _success(
            _upsert(
                snapshots=_parse_request_value("snapshots", snapshots),
                default_owner=dst or None,
            ),
            message=_("CRM snapshots saved"),
        )
    except Exception as exc:
        frappe.log_error(title="upsert_crm_record_snapshots", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to save CRM record snapshots"))


@frappe.whitelist(allow_guest=True)
def list_crm_transfer_history(sid=None, lead_id=None, limit=100):
    """Append-only ownership transfer log for Smilecure CRM."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking import (
            list_crm_transfer_history as _list,
        )

        return _success(_list(lead_id=_parse_request_value("lead_id", lead_id), limit=limit))
    except Exception as exc:
        frappe.log_error(title="list_crm_transfer_history", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load transfer history"))


@frappe.whitelist(allow_guest=True)
def list_crm_transfer_notices(sid=None, recipient=None, limit=30):
    """In-app transfer notifications for the current CRM user."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking import (
            list_crm_transfer_notices as _list,
        )

        who = cstr(_parse_request_value("recipient", recipient) or "").strip()
        # Always scope to the logged-in user (ignore client recipient spoof).
        who = _crm_session_display_name()
        return _success(
            _list(recipient=who or None, limit=min(cint(limit) or 30, 100))
        )
    except Exception as exc:
        frappe.log_error(title="list_crm_transfer_notices", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load transfer notices"))


@frappe.whitelist(allow_guest=True)
def mark_crm_transfer_notice_read(sid=None, notice_id=None):
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking import (
            mark_crm_transfer_notice_read as _mark,
        )

        return _success(_mark(notice_id=_parse_request_value("notice_id", notice_id)))
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="mark_crm_transfer_notice_read", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to update notice"))


@frappe.whitelist(allow_guest=True)
def assign_crm_lead_to_reach(sid=None, **kwargs):
    """Smilecure CRM → REACH: upsert lead + follow-up notes and assign to REACH user."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import crm_assign_lead_to_reach as _assign
        import json as _json

        crm_lead_id = _parse_request_value("crm_lead_id", kwargs.get("crm_lead_id"))
        sales_rep_id = _parse_request_value("sales_rep_id", kwargs.get("sales_rep_id"))
        create_visit_raw = _parse_request_value("create_visit", kwargs.get("create_visit"))
        create_visit = str(create_visit_raw or "1").lower() not in ("0", "false", "no")

        lead_payload = {}
        lead_json = _parse_request_value("lead_json", kwargs.get("lead_json"))
        if lead_json:
            try:
                parsed = _json.loads(lead_json) if isinstance(lead_json, str) else lead_json
                if isinstance(parsed, dict):
                    lead_payload = parsed
            except Exception:
                lead_payload = {}
        for key in (
            "name", "lead_name", "email", "phone", "mobile", "city", "territory", "address",
            "notes", "status", "source", "campaign_name", "franchise_model", "district", "pincode", "state",
        ):
            value = _parse_request_value(key, kwargs.get(key)) or _parse_request_value(f"lead_{key}", kwargs.get(f"lead_{key}"))
            if value is not None and str(value).strip() != "":
                lead_payload[key] = value

        followups = None
        followups_json = _parse_request_value("followups_json", kwargs.get("followups_json"))
        if followups_json:
            try:
                followups = _json.loads(followups_json) if isinstance(followups_json, str) else followups_json
            except Exception:
                followups = None

        row = _assign(
            crm_lead_id=crm_lead_id,
            sales_rep_id=sales_rep_id,
            lead=lead_payload,
            followups=followups,
            create_visit=create_visit,
            assigned_from=_parse_request_value("assigned_from", kwargs.get("assigned_from"))
            or f"Smilecure CRM ({frappe.session.user})",
            assigned_to_name=_parse_request_value("assigned_to_name", kwargs.get("assigned_to_name")),
        )
        return _success(row, message=_("Lead assigned to REACH"))
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="assign_crm_lead_to_reach", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to assign lead to REACH"))


@frappe.whitelist(allow_guest=True)
def get_crm_reach_lead(sid=None, crm_lead_id=None, hec_lead_id=None):
    """Smilecure CRM — pull REACH status for a previously assigned CRM lead."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import crm_get_reach_lead

        row = crm_get_reach_lead(
            crm_lead_id=_parse_request_value("crm_lead_id", crm_lead_id),
            hec_lead_id=_parse_request_value("hec_lead_id", hec_lead_id),
        )
        if not row:
            return _error(_("Lead not yet synced to REACH"), 404)
        return _success(row)
    except Exception as exc:
        frappe.log_error(title="get_crm_reach_lead", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load REACH lead"))


@frappe.whitelist(allow_guest=True)
def sync_crm_lead_status_to_reach(sid=None, crm_lead_id=None, status=None):
    """Smilecure CRM → REACH status push for an already-linked lead."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import crm_sync_lead_status_to_reach

        row = crm_sync_lead_status_to_reach(
            crm_lead_id=_parse_request_value("crm_lead_id", crm_lead_id),
            status=_parse_request_value("status", status),
        )
        return _success(row, message=_("REACH status updated"))
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="sync_crm_lead_status_to_reach", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to sync status to REACH"))


def _require_crm_sales_close_access(sid=None):
    """Care / Aesthetic / lab billers OR CRM / HR staff may record a portal sales close."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = set(_user_roles())
    allowed = {
        "CRM Staff",
        "CRM Manager",
        "Sales Representative",
        "Sales Manager",
        "Care Staff",
        "Care Manager",
        "Aesthetic Staff",
        "Aesthetic Manager",
        "Lab Technician",
        "Franchisee Operator",
        "System Manager",
        "Health System Admin",
        "Administrator",
        "HR Manager",
    }
    if not (roles & allowed):
        return _error(_("Not permitted to record CRM sales closes"), 403)
    return None


@frappe.whitelist(allow_guest=True)
def record_crm_sales_close(sid=None, **kwargs):
    """Care / Aesthetic / lab bill generation records the close; CRM reads it back for telecaller credit."""
    denied = _require_crm_sales_close_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking import record_crm_sales_close as _record
        import json as _json

        data = {}
        raw = _parse_request_value("data", kwargs.get("data"))
        if raw:
            try:
                data = _json.loads(raw) if isinstance(raw, str) else dict(raw)
            except Exception:
                data = {}
        for key in (
            "tracking_tag", "booking_id", "executive", "executive_code", "amount", "total",
            "bill_ref", "invoice_number", "number", "portal", "patient_name", "patient",
            "mobile", "notes", "referred_by", "closed_at",
        ):
            value = _parse_request_value(key, kwargs.get(key))
            if value is not None and str(value).strip() != "":
                data[key] = value
        portal = str(data.get("portal") or "").strip().lower()
        if portal in ("", "crm"):
            return _error(_("Portal bill source is required (care / aesthetic / lab)"), 403)
        if portal not in ("care", "aesthetic", "lab", "franchise"):
            return _error(_("Unrecognized bill portal"), 403)
        row = _record(data)
        return _success(row, message=_("CRM sales close recorded"))
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="record_crm_sales_close", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to record CRM sales close"))


@frappe.whitelist(allow_guest=True)
def list_crm_sales_closes(sid=None, limit=100, executive=None, tracking_tag=None):
    """Smilecure CRM — executive sales closes from portal bills."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking import list_crm_sales_closes as _list

        exec_filter = cstr(_parse_request_value("executive", executive) or "").strip()
        # Non-managers only see their own closes (ignore client executive spoof).
        if not _crm_is_manager():
            exec_filter = _crm_session_display_name()
        return _success(
            _list(
                limit=min(cint(_parse_request_value("limit", limit) or 100), 300),
                executive=exec_filter or None,
                tracking_tag=_parse_request_value("tracking_tag", tracking_tag),
            )
        )
    except Exception as exc:
        frappe.log_error(title="list_crm_sales_closes", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to list CRM sales closes"))


@frappe.whitelist(allow_guest=True)
def get_crm_target_achievement(sid=None, period=None, employee=None):
    """CRM dashboard — monthly target (My Team) vs achievement (synced portal bills)."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking import get_crm_target_achievement as _get

        emp = cstr(_parse_request_value("employee", employee) or "").strip()
        if not _crm_is_manager():
            emp = _crm_session_display_name()
        return _success(
            _get(
                period=_parse_request_value("period", period),
                employee=emp or None,
            )
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except Exception as exc:
        frappe.log_error(title="get_crm_target_achievement", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load CRM target achievement"))


@frappe.whitelist(allow_guest=True)
def set_crm_sales_target(sid=None, employee=None, period=None, target_amount=None, notes=None):
    """Reporting manager sets a CRM sales ₹ target from My Team (or CRM Manager / HR)."""
    denied = _require_crm_reach_access(sid)
    if denied:
        # Also allow HR-only sessions that manage teams but aren't CRM roles
        if not _require_mobile_auth(sid):
            return _error(_("Not authenticated"), 401)
        roles = set(_user_roles())
        if not (roles & {"HR Manager", "HR User", "System Manager", "Administrator", "Health System Admin", "CRM Manager", "Sales Manager"}):
            return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_crm_tracking import set_crm_sales_target as _set

        return _success(
            _set(
                employee=_parse_request_value("employee", employee),
                period=_parse_request_value("period", period),
                target_amount=_parse_request_value("target_amount", target_amount),
                notes=_parse_request_value("notes", notes),
            ),
            message=_("CRM sales target saved"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="set_crm_sales_target", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to save CRM sales target"))


@frappe.whitelist(allow_guest=True)
def ffms_disable_partner_portal(**kwargs):
    frappe.flags.ignore_csrf = True
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            _check_webhook_secret,
        )
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import ffms_disable_partner_portal as _disable

        _check_webhook_secret()
        row = _disable(
            franchisee_profile=_parse_request_value("franchisee_profile", kwargs.get("franchisee_profile")),
            user_id=_parse_request_value("user_id", kwargs.get("user_id")),
            franchisee_id=_parse_request_value("franchisee_id", kwargs.get("franchisee_id")),
            reason=_parse_request_value("reason", kwargs.get("reason")),
        )
        return _success(row, message=_("Partner portal disabled"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except Exception as exc:
        frappe.log_error(title="ffms_disable_partner_portal", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to disable partner portal"))


@frappe.whitelist(allow_guest=True)
def ffms_deboard_franchisee(**kwargs):
    frappe.flags.ignore_csrf = True
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            _check_webhook_secret,
        )
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import ffms_deboard_franchisee as _deboard

        _check_webhook_secret()
        row = _deboard(
            franchisee_profile=_parse_request_value("franchisee_profile", kwargs.get("franchisee_profile")),
            franchisee_id=_parse_request_value("franchisee_id", kwargs.get("franchisee_id")),
            reason=_parse_request_value("reason", kwargs.get("reason")),
        )
        return _success(row, message=_("Franchisee deboarded on ERP"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except Exception as exc:
        frappe.log_error(title="ffms_deboard_franchisee", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to deboard franchisee"))


@frappe.whitelist(allow_guest=True)
def list_b2b_collection_centres(sid=None, limit=100):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_b2b_sales import list_b2b_collection_centres as _list

        centres = _list(frappe.session.user, limit=limit)
        return _success(
            {"centres": centres, "b2b_centres": centres, "count": len(centres)},
            message=_("B2B collection centres"),
        )
    except Exception as exc:
        frappe.log_error(title="list_b2b_collection_centres", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to list B2B collection centres"))


@frappe.whitelist(allow_guest=True)
def get_b2b_centre(sid=None, limit=100):
    """REACH Flutter alias for list_b2b_collection_centres (was HTTP 417 with wrong name)."""
    return list_b2b_collection_centres(sid=sid, limit=limit)


@frappe.whitelist(allow_guest=True)
def create_b2b_collection_centre(sid=None, **kwargs):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_b2b_sales import create_b2b_collection_centre as _create

        data = {k: _parse_request_value(k, kwargs.get(k)) for k in (
            "centre_name", "wallet_amount", "total_deposit", "contact_number", "manual_address",
            "google_map_location", "trade_licence", "approved_rate_chart", "remarks", "status",
            "logistics_assignments", "logistics",
        )}
        row = _create(frappe.session.user, **data)
        return _success(row, message=_("B2B collection centre registered"))
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="create_b2b_collection_centre", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to create B2B collection centre"))


@frappe.whitelist(allow_guest=True)
def list_b2b_sales_entries(sid=None, limit=100, sales_date=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_b2b_sales import list_b2b_sales_entries as _list

        entries = _list(frappe.session.user, limit=limit, sales_date=sales_date)
        return _success(
            {
                "entries": entries,
                "sales": entries,
                "daily_sales": entries,
                "count": len(entries),
            },
            message=_("B2B sales entries"),
        )
    except Exception as exc:
        frappe.log_error(title="list_b2b_sales_entries", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to list B2B sales entries"))


@frappe.whitelist(allow_guest=True)
def get_daily_sales_entry(sid=None, limit=100, sales_date=None):
    """REACH Flutter alias for list_b2b_sales_entries (was HTTP 417 with wrong name)."""
    return list_b2b_sales_entries(sid=sid, limit=limit, sales_date=sales_date)


@frappe.whitelist(allow_guest=True)
def submit_b2b_sales_entry(sid=None, **kwargs):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_b2b_sales import submit_b2b_sales_entry as _submit

        data = {k: _parse_request_value(k, kwargs.get(k)) for k in (
            "b2b_collection_centre", "centre_id", "number_of_samples", "samples", "business_value",
            "total_b2b_business_value", "assigned_logistics_person", "sales_date", "date", "remarks",
        )}
        row = _submit(frappe.session.user, **data)
        return _success(row, message=_("B2B sales entry submitted"))
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="submit_b2b_sales_entry", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to submit B2B sales entry"))


@frappe.whitelist(allow_guest=True)
def submit_daily_sales(sid=None, **kwargs):
    """REACH Flutter alias for submit_b2b_sales_entry (was HTTP 417 with wrong name)."""
    return submit_b2b_sales_entry(sid=sid, **kwargs)


@frappe.whitelist(allow_guest=True)
def get_b2b_closing_summary(sid=None, period_date=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_b2b_sales import b2b_closing_summary_for_draft

        return _success(
            b2b_closing_summary_for_draft(frappe.session.user, period_date=period_date),
            message=_("B2B closing summary"),
        )
    except Exception as exc:
        frappe.log_error(title="get_b2b_closing_summary", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load B2B closing summary"))


@frappe.whitelist(allow_guest=True)
def ffms_update_b2b_sales_status(**kwargs):
    frappe.flags.ignore_csrf = True
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            _check_webhook_secret,
        )
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_b2b_sales import (
            ffms_update_b2b_sales_status as _update,
        )

        _check_webhook_secret()
        row = _update(
            hec_sales_id=_parse_request_value("hec_sales_id", kwargs.get("hec_sales_id")),
            status=_parse_request_value("status", kwargs.get("status")),
            assigned_logistics_person=_parse_request_value(
                "assigned_logistics_person", kwargs.get("assigned_logistics_person")
            ),
            remarks=_parse_request_value("remarks", kwargs.get("remarks")),
        )
        return _success(row, message=_("B2B sales updated"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except Exception as exc:
        frappe.log_error(title="ffms_update_b2b_sales_status", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to update B2B sales"))


@frappe.whitelist(allow_guest=True)
def ffms_update_b2b_centre(**kwargs):
    frappe.flags.ignore_csrf = True
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            _check_webhook_secret,
        )
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_b2b_sales import (
            ffms_update_b2b_centre as _update,
        )

        _check_webhook_secret()
        row = _update(
            hec_centre_id=_parse_request_value("hec_centre_id", kwargs.get("hec_centre_id")),
            status=_parse_request_value("status", kwargs.get("status")),
            logistics_assignments=_parse_request_value(
                "logistics_assignments", kwargs.get("logistics_assignments")
            ),
        )
        return _success(row, message=_("B2B centre updated"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except Exception as exc:
        frappe.log_error(title="ffms_update_b2b_centre", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to update B2B centre"))


@frappe.whitelist(allow_guest=True)
def ffms_delete_b2b_sales_entry(**kwargs):
    frappe.flags.ignore_csrf = True
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            _check_webhook_secret,
        )
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_b2b_sales import (
            ffms_delete_b2b_sales_entry as _delete,
        )

        _check_webhook_secret()
        row = _delete(
            hec_sales_id=_parse_request_value("hec_sales_id", kwargs.get("hec_sales_id")),
            reason=_parse_request_value("reason", kwargs.get("reason")),
        )
        return _success(row, message=_("B2B sales deleted"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except Exception as exc:
        frappe.log_error(title="ffms_delete_b2b_sales_entry", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to delete B2B sales"))


@frappe.whitelist(allow_guest=True)
def ffms_delete_b2b_centre(**kwargs):
    frappe.flags.ignore_csrf = True
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            _check_webhook_secret,
        )
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_b2b_sales import (
            ffms_delete_b2b_centre as _delete,
        )

        _check_webhook_secret()
        row = _delete(
            hec_centre_id=_parse_request_value("hec_centre_id", kwargs.get("hec_centre_id")),
            reason=_parse_request_value("reason", kwargs.get("reason")),
            cascade_sales=_parse_request_value("cascade_sales", kwargs.get("cascade_sales")),
        )
        return _success(row, message=_("B2B centre deleted"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except Exception as exc:
        frappe.log_error(title="ffms_delete_b2b_centre", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to delete B2B centre"))


@frappe.whitelist(allow_guest=True)
def submit_sales_onboarding(sid=None, **kwargs):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import submit_franchise_onboarding

    data = {k: _parse_request_value(k, kwargs.get(k)) for k in (
        "lead_id", "franchise_name", "owner_name", "proposed_branch_code",
        "territory_region", "address", "phone", "email", "commission_percentage_rate", "notes",
    )}
    if not all([data.get("franchise_name"), data.get("owner_name"), data.get("proposed_branch_code"), data.get("territory_region")]):
        return _error(_("franchise_name, owner_name, proposed_branch_code, territory_region required"))
    try:
        row = submit_franchise_onboarding(frappe.session.user, data)
        return _success(row, message=_("Franchisee onboarded"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_sales_onboarding(sid=None, limit=None):
    """REACH Flutter alias: list franchise onboarding requests for the signed-in rep."""
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import list_sales_onboarding

    rows = list_sales_onboarding(frappe.session.user, limit=limit or 50)
    return _success(
        {
            "onboardings": rows,
            "applications": rows,
            "count": len(rows),
        },
        message=_("Sales onboarding list"),
    )


@frappe.whitelist(allow_guest=True)
def get_sales_franchisee_list(sid=None, period=None):
    """REACH Flutter alias: franchisee list + onboarding rows."""
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import list_sales_franchisees

    period = _parse_request_value("period", period) or "month"
    stats = list_sales_franchisees(frappe.session.user, period=period)
    return _success(
        {
            **stats,
            "franchisee_list": stats.get("franchisees") or [],
        },
        message=_("Sales franchisee list"),
    )


@frappe.whitelist(allow_guest=True)
def create_onboarding_session(sid=None, franchisee_id=None, lead_id=None, ttl_seconds=None):
    """Sales/ops: mint HMAC one-time URL for FFMS applicant portal (/onboard/hec-session)."""
    denied = _require_sales_access(sid)
    if denied:
        roles = set(frappe.get_roles())
        if not roles.intersection({"System Manager", "Health System Admin", "Sales Manager"}):
            return denied
    franchisee_id = (_parse_request_value("franchisee_id", franchisee_id) or "").strip()
    lead_id = (_parse_request_value("lead_id", lead_id) or "").strip()
    ttl_raw = _parse_request_value("ttl_seconds", ttl_seconds)
    ttl_seconds = cint(ttl_raw) if ttl_raw not in (None, "") else None
    if not franchisee_id:
        return _error(_("franchisee_id is required"))
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase80_onboarding_bridge import (
            mint_onboarding_token,
        )

        row = mint_onboarding_token(
            franchisee_id=franchisee_id,
            lead_id=lead_id,
            ttl_seconds=ttl_seconds,
        )
        return _success(row, message=_("Onboarding session created"))
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="create_onboarding_session", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to create onboarding session"))


@frappe.whitelist(allow_guest=True)
def ingest_onboarding_result(hec_payload=None, **kwargs):
    """FFMS callback: HMAC-signed agreement/onboarding completion onto Franchisee Profile."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase80_onboarding_bridge import (
            _parse_ingest_payload,
            ingest_onboarding_result_payload,
        )

        payload = _parse_ingest_payload(hec_payload, **kwargs)
        row = ingest_onboarding_result_payload(payload)
        return _success(row, message=_("Onboarding result ingested"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="ingest_onboarding_result", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to ingest onboarding result"))


@frappe.whitelist(allow_guest=True)
def get_rfms_integration_config(hec_payload=None, **kwargs):
    """RFMS HMAC bridge: public Razorpay key_id, OTP flags, Google Maps browser key."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase83_rfms_bridge import (
            _parse_hec_payload,
            get_rfms_integration_config_payload,
        )

        payload = _parse_hec_payload(hec_payload=hec_payload, **kwargs)
        row = get_rfms_integration_config_payload(payload)
        return _success(row, message=_("RFMS integration config"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except Exception as exc:
        frappe.log_error(title="get_rfms_integration_config", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load RFMS integration config"))


@frappe.whitelist(allow_guest=True)
def create_rfms_razorpay_order(hec_payload=None, **kwargs):
    """RFMS HMAC bridge: create Razorpay order for franchise payment (secret stays on ERP)."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase83_rfms_bridge import (
            _parse_hec_payload,
            create_rfms_razorpay_order_payload,
        )

        payload = _parse_hec_payload(hec_payload=hec_payload, **kwargs)
        row = create_rfms_razorpay_order_payload(payload)
        return _success(row, message=_("RFMS Razorpay order created"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="create_rfms_razorpay_order", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to create RFMS Razorpay order"))


@frappe.whitelist(allow_guest=True)
def verify_rfms_razorpay_payment(hec_payload=None, **kwargs):
    """RFMS HMAC bridge: verify Razorpay checkout signature using ERP secret."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase83_rfms_bridge import (
            _parse_hec_payload,
            verify_rfms_razorpay_payment_payload,
        )

        payload = _parse_hec_payload(hec_payload=hec_payload, **kwargs)
        row = verify_rfms_razorpay_payment_payload(payload)
        return _success(row, message=_("RFMS Razorpay payment verified"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="verify_rfms_razorpay_payment", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to verify RFMS Razorpay payment"))


@frappe.whitelist(allow_guest=True)
def activate_rfms_paid_franchisee(hec_payload=None, **kwargs):
    """Phase 85c: RFMS HMAC bridge — create/update Franchisee Profile + opening wallet after paid milestone."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase83_rfms_bridge import _parse_hec_payload
        from health_ecosystem_core.health_ecosystem_core.clinical_phase85_rfms_activation import (
            activate_rfms_paid_franchisee_payload,
        )

        payload = _parse_hec_payload(hec_payload=hec_payload, **kwargs)
        row = activate_rfms_paid_franchisee_payload(payload)
        return _success(row, message=_("RFMS franchisee hub activated"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="activate_rfms_paid_franchisee", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to activate RFMS franchisee hub"))


@frappe.whitelist(allow_guest=True)
def map_fofo_parent_foco(hec_payload=None, **kwargs):
    """RFMS HMAC bridge — permanently map a FOFO hub under a FOCO."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase83_rfms_bridge import _parse_hec_payload
        from health_ecosystem_core.health_ecosystem_core.clinical_phase111_foco_fofo_upsell import (
            map_fofo_parent_foco_payload,
        )

        payload = _parse_hec_payload(hec_payload=hec_payload, **kwargs)
        row = map_fofo_parent_foco_payload(payload)
        return _success(row, message=_("FOFO mapped under FOCO"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="map_fofo_parent_foco", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to map FOFO under FOCO"))


@frappe.whitelist()
def setup_phase111_foco_fofo_upsell():
    """Install ledger + Franchisee Profile mapping / override-upsell fields."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase111_foco_fofo_upsell import (
        ensure_phase111_fields,
    )

    return _success(ensure_phase111_fields())


@frappe.whitelist(allow_guest=True)
def provision_partner_portal_credentials(hec_payload=None, **kwargs):
    """RFMS HMAC bridge — create Partner Portal user + password when manager marks Onboarded."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase83_rfms_bridge import _parse_hec_payload
        from health_ecosystem_core.health_ecosystem_core.clinical_phase85_rfms_activation import (
            provision_partner_portal_credentials_payload,
        )

        payload = _parse_hec_payload(hec_payload=hec_payload, **kwargs)
        row = provision_partner_portal_credentials_payload(payload)
        return _success(row, message=_("Partner Portal credentials provisioned"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="provision_partner_portal_credentials", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to provision Partner Portal credentials"))


@frappe.whitelist(allow_guest=True)
def sync_rfms_hub_from_directory(hec_payload=None, **kwargs):
    """RFMS HMAC bridge — refresh Franchisee Profile hub name/branch details from Franchise Directory."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase83_rfms_bridge import _parse_hec_payload
        from health_ecosystem_core.health_ecosystem_core.clinical_phase85_rfms_activation import (
            sync_rfms_hub_from_directory_payload,
        )

        payload = _parse_hec_payload(hec_payload=hec_payload, **kwargs)
        row = sync_rfms_hub_from_directory_payload(payload)
        return _success(row, message=_("Franchise hub synced from directory"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="sync_rfms_hub_from_directory", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to sync franchise hub from directory"))


@frappe.whitelist(allow_guest=True)
def schedule_franchise_onboard_campaigns(hec_payload=None, **kwargs):
    """Phase 93: RFMS HMAC — schedule Meta/WA hiring + booking campaigns on franchise onboard."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase83_rfms_bridge import _parse_hec_payload
        from health_ecosystem_core.health_ecosystem_core.clinical_phase93_franchise_go_live import (
            schedule_franchise_onboard_campaigns_payload,
        )

        payload = _parse_hec_payload(hec_payload=hec_payload, **kwargs)
        row = schedule_franchise_onboard_campaigns_payload(payload)
        return _success(row, message=_("Franchise onboard campaigns scheduled"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="schedule_franchise_onboard_campaigns", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to schedule franchise campaigns"))


@frappe.whitelist(allow_guest=True)
def create_reach_foco_b2b_on_phase1(hec_payload=None, **kwargs):
    """Phase 93: RFMS HMAC — create Reach B2B FOCO code when Phase-1 payment is done."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase83_rfms_bridge import _parse_hec_payload
        from health_ecosystem_core.health_ecosystem_core.clinical_phase93_franchise_go_live import (
            create_reach_foco_b2b_on_phase1_payload,
        )

        payload = _parse_hec_payload(hec_payload=hec_payload, **kwargs)
        row = create_reach_foco_b2b_on_phase1_payload(payload)
        return _success(row, message=_("Reach FOCO B2B code created"))
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="create_reach_foco_b2b_on_phase1", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to create Reach FOCO B2B code"))


@frappe.whitelist(allow_guest=True)
def ingest_franchise_ad_lead(**kwargs):
    """Phase 86: Meta/Google franchise lead webhook → Reach + RFMS dual-write."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            ingest_franchise_ad_lead as _ingest,
        )

        return _ingest(**kwargs)
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="ingest_franchise_ad_lead", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to ingest franchise ad lead"))


@frappe.whitelist(allow_guest=True)
def franchise_ads_status(**kwargs):
    """Phase 86: lightweight franchise ads webhook status (secret-gated)."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            franchise_ads_status as _status,
        )

        return _status(**kwargs)
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except Exception as exc:
        frappe.log_error(title="franchise_ads_status", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to read franchise ads status"))


def _ensure_crm_whatsapp_channel_settings():
    """Single DocType for CRM Service WhatsApp Meta Cloud credentials."""
    name = "CRM WhatsApp Channel Settings"
    if frappe.db.exists("DocType", name):
        return name
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import ensure_hec_module_def

        ensure_hec_module_def()
    except Exception:
        pass
    doc = frappe.get_doc(
        {
            "doctype": "DocType",
            "name": name,
            "module": "Health Ecosystem Core",
            "custom": 1,
            "issingle": 1,
            "engine": "InnoDB",
            "fields": [
                {"fieldname": "service_section", "fieldtype": "Section Break", "label": "Service WhatsApp (Meta Cloud)"},
                {"fieldname": "service_enabled", "fieldtype": "Check", "label": "Enable Service WhatsApp", "default": "0"},
                {
                    "fieldname": "service_provider",
                    "fieldtype": "Select",
                    "label": "Provider",
                    "options": "meta\ninterakt\naisensy\ncustom",
                    "default": "meta",
                },
                {"fieldname": "service_api_url", "fieldtype": "Data", "label": "API Base URL", "default": "https://graph.facebook.com/v26.0"},
                {"fieldname": "service_access_token", "fieldtype": "Password", "label": "Access Token"},
                {"fieldname": "service_phone_number_id", "fieldtype": "Data", "label": "Phone Number ID"},
                {"fieldname": "service_waba_id", "fieldtype": "Data", "label": "WABA ID"},
                {"fieldname": "service_sender_number", "fieldtype": "Data", "label": "Sender Number"},
                {"fieldname": "service_webhook_verify_token", "fieldtype": "Data", "label": "Webhook Verify Token"},
            ],
            "permissions": [
                {"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1},
                {"role": "CRM Manager", "read": 1, "write": 1, "create": 1},
            ],
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return name


@frappe.whitelist(allow_guest=True)
def get_crm_whatsapp_api(sid=None, channel=None):
    """Smilecure CRM Settings — Franchise (AI Workforce) or Service Meta Cloud WhatsApp."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    if not _crm_is_manager():
        return _error(_("Only CRM Managers can load WhatsApp API settings"), 403)
    ch = cstr(channel or "franchise").strip().lower() or "franchise"
    try:
        if ch == "service":
            from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
                get_crm_service_whatsapp_settings,
            )

            _ensure_crm_whatsapp_channel_settings()
            data = get_crm_service_whatsapp_settings()
            data["channel"] = "service"
            data["serviceFollowUp"] = True
            return _success(data)

        from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
            get_meta_whatsapp_access_token,
            get_whatsapp_business_account_id,
            get_whatsapp_phone_number_id,
            get_whatsapp_provider,
            get_whatsapp_source_number,
            get_whatsapp_webhook_verify_token,
        )

        phone = cstr(get_whatsapp_phone_number_id() or "").strip()
        token = cstr(get_meta_whatsapp_access_token() or "").strip()
        waba = cstr(get_whatsapp_business_account_id() or "").strip()
        verify = cstr(get_whatsapp_webhook_verify_token() or "").strip()
        sender = cstr(get_whatsapp_source_number() or "").strip()
        provider = cstr(get_whatsapp_provider() or "").strip() or "Meta"
        configured = bool(phone and token)
        return _success(
            {
                "configured": configured,
                "enabled": configured,
                "provider": "meta" if provider.lower() == "meta" else "custom",
                "apiUrl": "https://graph.facebook.com/v26.0",
                "apiKey": token,
                "phoneNumberId": phone,
                "wabaId": waba,
                "senderNumber": sender if sender.startswith("+") else (f"+{sender}" if sender else ""),
                "webhookVerifyToken": verify,
                "franchiseFollowUp": True,
                "channel": "franchise",
            }
        )
    except Exception as exc:
        frappe.log_error(title="get_crm_whatsapp_api", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load WhatsApp API settings"))


@frappe.whitelist(allow_guest=True)
def save_crm_service_whatsapp_api(
    sid=None,
    enabled=None,
    provider=None,
    api_url=None,
    api_key=None,
    phone_number_id=None,
    waba_id=None,
    sender_number=None,
    webhook_verify_token=None,
):
    """CRM Managers — save Service Meta Cloud WhatsApp (separate from Franchise AI number)."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    if not _crm_is_manager():
        return _error(_("Only CRM Managers can save Service WhatsApp API"), 403)
    try:
        _ensure_crm_whatsapp_channel_settings()
        doc = frappe.get_single("CRM WhatsApp Channel Settings")
        doc.service_enabled = 1 if cstr(enabled or "").strip().lower() in ("1", "true", "yes", "on") else 0
        doc.service_provider = cstr(provider or "meta").strip().lower() or "meta"
        doc.service_api_url = cstr(api_url or "https://graph.facebook.com/v26.0").strip()
        phone = cstr(phone_number_id or "").strip()
        if phone:
            doc.service_phone_number_id = phone
        waba = cstr(waba_id or "").strip()
        if waba:
            doc.service_waba_id = waba
        sender = cstr(sender_number or "").strip()
        if sender:
            doc.service_sender_number = sender
        verify = cstr(webhook_verify_token or "").strip()
        if verify:
            doc.service_webhook_verify_token = verify
        token = cstr(api_key or "").strip()
        if token:
            doc.service_access_token = token
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
            get_crm_service_whatsapp_settings,
        )

        data = get_crm_service_whatsapp_settings()
        # Never echo full token back after save unless already returned by getter for managers.
        return _success({"ok": True, "channel": "service", **{k: v for k, v in data.items() if k != "apiKey"}, "configured": data.get("configured")})
    except Exception as exc:
        frappe.log_error(title="save_crm_service_whatsapp_api", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to save Service WhatsApp API"))


@frappe.whitelist(allow_guest=True)
def list_crm_whatsapp_conversations(sid=None, wing=None, q=None, limit=100, channel=None):
    """Smilecure CRM WhatsApp Centre — inbox for all wings or one wing (Franchise/Service channel)."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import (
            list_crm_whatsapp_conversations as _list,
        )

        return _success(_list(wing=wing, q=q, limit=limit, channel=channel))
    except Exception as exc:
        frappe.log_error(title="list_crm_whatsapp_conversations", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to list WhatsApp conversations"))


@frappe.whitelist(allow_guest=True)
def get_crm_whatsapp_thread(
    sid=None, conversation_id=None, phone=None, wing=None, crm_lead_id=None, contact_name=None, channel=None
):
    """Smilecure CRM WhatsApp Centre — open one chat thread."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import (
            get_crm_whatsapp_thread as _get,
        )

        return _success(
            _get(
                conversation_id=conversation_id,
                phone=phone,
                crm_wing=wing,
                crm_lead_id=crm_lead_id,
                contact_name=contact_name,
                channel=channel,
            )
        )
    except Exception as exc:
        frappe.log_error(title="get_crm_whatsapp_thread", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load WhatsApp thread"))


@frappe.whitelist(allow_guest=True)
def mark_crm_whatsapp_conversation_read(sid=None, conversation_id=None):
    """Shared WhatsApp inbox — mark conversation read for all CRM executives."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import (
            mark_crm_whatsapp_conversation_read as _mark,
        )

        return _success(_mark(conversation_id=conversation_id))
    except Exception as exc:
        frappe.log_error(title="mark_crm_whatsapp_conversation_read", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to mark WhatsApp conversation read"))


@frappe.whitelist(allow_guest=True)
def send_crm_whatsapp(
    sid=None,
    phone=None,
    message=None,
    contact_name=None,
    crm_lead_id=None,
    wing=None,
    conversation_id=None,
    template=None,
    language=None,
    use_template=None,
    channel=None,
):
    """Smilecure CRM — send Meta Cloud WhatsApp (Franchise AI number or Service number)."""
    denied = _require_crm_reach_access(sid)
    if denied:
        return denied
    mobile = cstr(phone or "").strip()
    body = cstr(message or "").strip()
    cid = cstr(conversation_id or "").strip()
    crm_wing = cstr(wing or "franchise").strip().lower() or "franchise"
    ch = cstr(channel or "").strip().lower()
    if ch not in ("franchise", "service"):
        # Default Franchise (WA Centre Lab/Care/Aesthetic tabs). Callers must pass channel=service explicitly.
        ch = "franchise"
    tpl = cstr(template or "").strip()
    want_tpl = cstr(use_template or "").strip().lower() in ("1", "true", "yes") or bool(tpl)
    if not body and not want_tpl:
        return _error(_("Message is required"))
    if len(body) > 4096:
        return _error(_("Message is too long (max 4096 characters)"))
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import (
            get_or_create_conversation,
            send_whatsapp,
        )
        from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
            get_crm_service_whatsapp_sender_number,
            get_crm_service_whatsapp_settings,
            get_meta_whatsapp_access_token,
            get_whatsapp_phone_number_id,
            get_whatsapp_provider,
            get_whatsapp_source_number,
        )

        meta_token = None
        meta_phone = None
        sender_label = ""
        if ch == "service":
            svc = get_crm_service_whatsapp_settings()
            if not svc.get("enabled") or not svc.get("configured"):
                return _error(_("Service WhatsApp is not configured — set it under CRM Settings → WhatsApp API → Service"))
            meta_token = cstr(svc.get("apiKey") or "").strip()
            meta_phone = cstr(svc.get("phoneNumberId") or "").strip()
            sender_label = cstr(svc.get("senderNumber") or "").strip() or get_crm_service_whatsapp_sender_number() or ""
        else:
            provider = cstr(get_whatsapp_provider() or "").strip() or "Meta"
            if provider.lower() != "meta":
                return _error(_("CRM Franchise WhatsApp expects Meta Cloud API"))
            if not get_meta_whatsapp_access_token() or not get_whatsapp_phone_number_id():
                return _error(_("Franchise Meta WhatsApp is not configured on the server"))
            sender_label = cstr(get_whatsapp_source_number() or "").strip() or "+91 81001 49229"
            if sender_label and not sender_label.startswith("+"):
                sender_label = f"+{sender_label}"

        conv = None
        if cid and frappe.db.exists("HEC WhatsApp Conversation", cid):
            conv = frappe.get_doc("HEC WhatsApp Conversation", cid)
            mobile = cstr(conv.phone or mobile).strip()
        if not mobile:
            return _error(_("Phone is required"))
        if not conv:
            conv = get_or_create_conversation(
                mobile,
                contact_name=contact_name,
                crm_wing=crm_wing,
                crm_lead_id=crm_lead_id,
                franchise=ch == "franchise",
                channel=ch,
            )

        # Only use a Meta template when explicitly requested (Start chat / use_template).
        # Free-text must go as free-text so the client sees what the telecaller typed.
        # Meta often accepts free-text (returns wamid) then fails async with 131047 outside the
        # 24h customer window — so we pre-check recent inbound and block before sending.
        contact = cstr(contact_name or getattr(conv, "contact_name", "") or "")[:120]
        first_name = (contact.split() or ["there"])[0][:60] or "there"
        recent_inbound = False
        if conv and not want_tpl:
            try:
                from frappe.utils import add_to_date, now_datetime

                cutoff = add_to_date(now_datetime(), hours=-24, as_datetime=True)
                recent_inbound = bool(
                    frappe.get_all(
                        "HEC WhatsApp Message",
                        filters={
                            "conversation": conv.name,
                            "direction": "In",
                            "creation": [">=", cutoff],
                        },
                        limit=1,
                        pluck="name",
                    )
                )
            except Exception:
                recent_inbound = False
            sender_hint = sender_label or ("Service WhatsApp" if ch == "service" else "Remedium Labs (+91 81001 49229)")
            if not recent_inbound:
                return _error(
                    _(
                        "Custom text can only be sent after the client replies to {0} within the last 24 hours. Use New chat → Start chat to send the approved template first, then wait for their reply."
                    ).format(sender_hint)
                )
        if want_tpl:
            cached_tpl = ""
            try:
                cached_tpl = cstr(frappe.cache().get_value("hec_crm_wa_default_template") or "").strip()
            except Exception:
                cached_tpl = ""
            tpl = tpl or cached_tpl or "crm_lead_hello"

        ctx = {
            "conversation": conv,
            "franchise": ch == "franchise",
            "persist": True,
            "force_live": True,
            "contact_name": contact,
            "crm_lead_id": cstr(crm_lead_id or getattr(conv, "crm_lead_id", "") or "")[:80],
            "crm_wing": crm_wing,
            "wing": crm_wing,
            "source": "crm_portal",
            "channel": ch,
            "template": tpl if want_tpl else "",
            "language": cstr(language or "en").strip() or "en",
            "template_params": [first_name] if want_tpl and tpl else None,
        }
        if ch == "service" and meta_token and meta_phone:
            ctx["meta_token"] = meta_token
            ctx["meta_phone_id"] = meta_phone
        send_body = body or (f"Template {tpl}" if want_tpl and tpl else "")
        if not send_body:
            return _error(_("Message is required"))
        result = send_whatsapp(mobile, send_body, context=ctx)
        if not result and want_tpl and ctx.get("template"):
            # Explicit template failed (missing/rejected) — do not silently send free-text.
            detail = cstr(ctx.get("last_error") or "").strip()
            return _error(
                _("WhatsApp template failed: {0}").format(detail or _("unknown Meta error"))
            )
        if not result:
            detail = cstr(ctx.get("last_error") or "").strip()
            low = detail.lower()
            window_blocked = any(
                x in low
                for x in (
                    "24 hour",
                    "24-hour",
                    "outside",
                    "131047",
                    "re-engage",
                    "customer care",
                    "session",
                )
            )
            if window_blocked:
                sender_hint = sender_label or ("Service WhatsApp" if ch == "service" else "Remedium Labs (+91 81001 49229)")
                return _error(
                    _(
                        "Custom text cannot be delivered until the client replies in WhatsApp to {0}. Use Start chat to send the approved template first."
                    ).format(sender_hint)
                )
            if detail:
                return _error(_("WhatsApp was not delivered: {0}").format(detail))
            return _error(_("WhatsApp could not be sent — check Meta Cloud credentials / number"))
        return _success(
            {
                "ok": True,
                "message_id": result if isinstance(result, str) else cstr(result),
                "phone": mobile,
                "conversation_id": conv.name if conv else "",
                "crm_wing": crm_wing,
                "channel": ch,
                "live": True,
                "template": ctx.get("template") or "",
                "sender": sender_label or ("+91 81001 49229" if ch == "franchise" else ""),
            }
        )
    except Exception as exc:
        frappe.log_error(title="send_crm_whatsapp", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to send WhatsApp"))


@frappe.whitelist(allow_guest=True)
def ingest_whatsapp_cloud_webhook(**kwargs):
    """Phase 87: Meta WhatsApp Cloud webhook (verify + inbound messages)."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import (
            ingest_whatsapp_cloud_webhook as _ingest,
        )

        return _ingest(**kwargs)
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="ingest_whatsapp_cloud_webhook", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to ingest WhatsApp Cloud webhook"))


@frappe.whitelist(allow_guest=True)
def get_franchise_whatsapp_thread(**kwargs):
    """Phase 87: RFMS proxy — conversation thread."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import (
            get_franchise_whatsapp_thread as _get,
        )

        return _get(**kwargs)
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except Exception as exc:
        frappe.log_error(title="get_franchise_whatsapp_thread", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load WhatsApp thread"))


@frappe.whitelist(allow_guest=True)
def send_franchise_whatsapp_reply(**kwargs):
    """Phase 87: RFMS proxy — officer reply via Meta/Gupshup adapter."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import (
            send_franchise_whatsapp_reply as _send,
        )

        return _send(**kwargs)
    except frappe.AuthenticationError as exc:
        return _error(str(exc), 401)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="send_franchise_whatsapp_reply", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to send WhatsApp reply"))


@frappe.whitelist(allow_guest=True)
def get_wb_geo_hierarchy():
    """West Bengal district → subdivision → block/PIN hierarchy (Phase 84)."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase84_wb_geo import get_wb_geo_hierarchy_payload

        return _success(get_wb_geo_hierarchy_payload(), message=_("WB geo hierarchy"))
    except Exception as exc:
        frappe.log_error(title="get_wb_geo_hierarchy", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load WB geo hierarchy"))


@frappe.whitelist(allow_guest=True)
def resolve_wb_pincode(pincode=None):
    """Resolve a PIN code to WB postal localities."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase84_wb_geo import resolve_wb_pincode_payload

        return _success(resolve_wb_pincode_payload(pincode or frappe.form_dict.get("pincode")), message=_("WB pincode resolved"))
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="resolve_wb_pincode", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to resolve pincode"))


@frappe.whitelist(allow_guest=True)
def get_territorial_sales_summary(sid=None, period=None):
    """Reach: leads/visits/franchisees rolled up by district."""
    denied = _require_sales_access(sid)
    if denied:
        return denied
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase84_wb_geo import (
            get_territorial_sales_summary_payload,
        )

        return _success(
            get_territorial_sales_summary_payload(frappe.session.user, period or "month"),
            message=_("Territorial sales summary"),
        )
    except Exception as exc:
        frappe.log_error(title="get_territorial_sales_summary", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load territorial sales summary"))


@frappe.whitelist(allow_guest=True)
def get_sales_franchisee_stats(sid=None, period=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import (
        _franchisee_ids_for_reps,
        _franchisee_stats,
        scoped_rep_ids,
    )
    from frappe.utils import getdate, today

    rep_ids = scoped_rep_ids(frappe.session.user)
    fids = _franchisee_ids_for_reps(rep_ids)
    if period == "month":
        month_end = getdate(today())
        start = month_end.replace(day=1)
        stats = _franchisee_stats(fids, start, month_end)
    else:
        stats = _franchisee_stats(fids)
    return _success(stats)


@frappe.whitelist(allow_guest=True)
def get_sales_catalog(sid=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import get_sales_catalog_payload

    return _success(get_sales_catalog_payload())


@frappe.whitelist(allow_guest=True)
def get_sales_commissions(sid=None, limit=None, status=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase27b import (
        get_commission_summary,
        list_commission_ledger,
    )

    return _success(
        {
            "summary": get_commission_summary(frappe.session.user),
            "entries": list_commission_ledger(frappe.session.user, limit=limit or 50, status=status),
        }
    )


@frappe.whitelist(allow_guest=True)
def get_sales_closing_reports(sid=None, limit=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import list_closing_reports

    reports = list_closing_reports(frappe.session.user, limit=limit or 30)
    return _success({"reports": reports, "closings": reports})


@frappe.whitelist(allow_guest=True)
def get_sales_closing(sid=None, limit=None):
    """REACH Flutter alias for get_sales_closing_reports."""
    return get_sales_closing_reports(sid=sid, limit=limit)


@frappe.whitelist(allow_guest=True)
def draft_sales_closing_report(sid=None, report_type=None, period_date=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import build_closing_report_draft

    report_type = _parse_request_value("report_type", report_type) or "Daily"
    period_date = _parse_request_value("period_date", period_date)
    return _success(build_closing_report_draft(frappe.session.user, report_type, period_date))


@frappe.whitelist(allow_guest=True)
def submit_sales_closing_report(sid=None, **kwargs):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import submit_closing_report

    data = {k: _parse_request_value(k, kwargs.get(k)) for k in (
        "report_type", "period_date", "visits_count", "new_leads", "qualified_leads",
        "onboardings", "franchise_revenue", "km_traveled", "notes",
        "other_expenses", "total_expenses", "expenses_json", "attachments_json",
    )}
    try:
        report_id = submit_closing_report(frappe.session.user, data)
        return _success({"report_id": report_id}, message=_("Closing report submitted"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def submit_sales_closing(sid=None, **kwargs):
    """REACH Flutter alias for submit_sales_closing_report."""
    return submit_sales_closing_report(sid=sid, **kwargs)


@frappe.whitelist(allow_guest=True)
def sales_rep_update_location(sid=None, latitude=None, longitude=None, on_duty=1):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import update_sales_rep_location

    latitude = _parse_request_value("latitude", latitude)
    longitude = _parse_request_value("longitude", longitude)
    on_duty = _parse_request_value("on_duty", on_duty)
    if latitude is None or longitude is None:
        return _error(_("latitude and longitude are required"))
    try:
        row = update_sales_rep_location(frappe.session.user, latitude, longitude, on_duty=on_duty)
        return _success(row)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_sales_team_map(sid=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import get_sales_team_map as _map

    return _success(_map(frappe.session.user))


@frappe.whitelist(allow_guest=True)
def get_sales_team_performance_reports(
    sid=None, limit=None, activity_date=None, date_from=None, date_to=None, sales_rep=None
):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import list_team_performance_reports

    activity_date = _parse_request_value("activity_date", activity_date)
    date_from = _parse_request_value("date_from", date_from)
    date_to = _parse_request_value("date_to", date_to)
    sales_rep = _parse_request_value("sales_rep", sales_rep)
    return _success(
        list_team_performance_reports(
            frappe.session.user,
            limit=limit or 50,
            activity_date=activity_date,
            date_from=date_from,
            date_to=date_to,
            sales_rep=sales_rep,
        )
    )


@frappe.whitelist(allow_guest=True)
def get_sales_team_portal_activity(
    sid=None,
    activity_date=None,
    date_from=None,
    date_to=None,
    limit=None,
    sales_rep=None,
):
    """Team performance check: day-by-day lead / visit / onboarding uploads per employee."""
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import get_team_portal_activity

    activity_date = _parse_request_value("activity_date", activity_date)
    date_from = _parse_request_value("date_from", date_from)
    date_to = _parse_request_value("date_to", date_to)
    sales_rep = _parse_request_value("sales_rep", sales_rep)
    return _success(
        get_team_portal_activity(
            frappe.session.user,
            activity_date=activity_date,
            date_from=date_from,
            date_to=date_to,
            limit=limit or 500,
            sales_rep=sales_rep,
        )
    )


@frappe.whitelist(allow_guest=True)
def download_sales_team_portal_activity_csv(sid=None, activity_date=None, date_from=None, date_to=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import team_portal_activity_csv

    activity_date = _parse_request_value("activity_date", activity_date)
    date_from = _parse_request_value("date_from", date_from)
    date_to = _parse_request_value("date_to", date_to)
    try:
        return _success(
            team_portal_activity_csv(
                frappe.session.user,
                activity_date=activity_date,
                date_from=date_from,
                date_to=date_to,
            )
        )
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def download_sales_team_employee_pack(
    sid=None, sales_rep=None, activity_date=None, date_from=None, date_to=None
):
    """ZIP for one employee: all lead/visit/onboarding fields + visit photographs."""
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import download_team_employee_pack

    sales_rep = _parse_request_value("sales_rep", sales_rep)
    activity_date = _parse_request_value("activity_date", activity_date)
    date_from = _parse_request_value("date_from", date_from)
    date_to = _parse_request_value("date_to", date_to)
    try:
        return _success(
            download_team_employee_pack(
                frappe.session.user,
                sales_rep,
                activity_date=activity_date,
                date_from=date_from,
                date_to=date_to,
            )
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def submit_sales_team_performance_report(sid=None, **kwargs):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import submit_team_performance_report

    keys = (
        "activity_date",
        "title",
        "activity_summary",
        "notes",
        "doctors_met",
        "visits_done",
        "samples_collected",
        "km_traveled",
        "location_note",
        "attachments_json",
    )
    data = {k: _parse_request_value(k, kwargs.get(k)) for k in keys}
    try:
        report = submit_team_performance_report(frappe.session.user, data)
        return _success(report, message=_("Daily activity submitted"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def download_sales_team_performance_csv(sid=None, activity_date=None, sales_rep=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import team_performance_reports_csv

    activity_date = _parse_request_value("activity_date", activity_date)
    sales_rep = _parse_request_value("sales_rep", sales_rep)
    try:
        return _success(
            team_performance_reports_csv(
                frappe.session.user,
                activity_date=activity_date,
                sales_rep=sales_rep,
            )
        )
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def download_sales_team_performance_file(sid=None, report_name=None, file_name=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import get_team_performance_attachment

    report_name = _parse_request_value("report_name", report_name)
    file_name = _parse_request_value("file_name", file_name)
    try:
        return _success(get_team_performance_attachment(frappe.session.user, report_name, file_name))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def phlebotomist_mark_sample_collected(trf_id=None, sid=None):
    """Phlebotomist confirms sample collection at patient address."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.clinical_iam import (
        PF_ORDER_MESSAGE,
        is_pf_trf,
        is_phlebotomist,
        is_staff,
        phlebotomist_trf_ids,
    )

    roles = _user_roles()
    if not is_phlebotomist(roles) and not is_staff(roles):
        return _error(_("Not permitted"), 403)

    trf_id = _parse_request_value("trf_id", trf_id)
    if not trf_id:
        return _error(_("TRF ID is required"))
    if is_pf_trf(trf_id):
        return _error(_(PF_ORDER_MESSAGE), 409)

    if is_phlebotomist(roles) and not is_staff(roles):
        if trf_id not in phlebotomist_trf_ids():
            return _error(_("This order is not in your collection queue"), 403)

    current = frappe.db.get_value("Customer TRF", trf_id, "order_status")
    if current != "Booked":
        return _error(_(f"Cannot collect sample — order is already {current}"))

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase89_vial_accession import (
            mark_trf_tubes_drawn,
        )

        mark_trf_tubes_drawn(trf_id)
    except Exception:
        frappe.log_error(title="phase89_mark_drawn", message=frappe.get_traceback())

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import clear_phlebotomist_visit

        clear_phlebotomist_visit(frappe.session.user, trf_id)
    except Exception:
        pass

    return _apply_order_status(trf_id, "Sample Collected")


@frappe.whitelist(allow_guest=True)
def mark_offline_payment_collected(
    reference_doctype=None,
    reference_name=None,
    collection_mode=None,
    collection_reference=None,
    sid=None,
):
    """Record cash/hub payment for COD or Pay at Hub orders (collection_mode: cash | upi | card | cheque).

    collection_reference: UPI UTR / card approval code / cheque number, used to reconcile collection reports.
    """
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    collection_mode = (_parse_request_value("collection_mode", collection_mode) or "cash").strip().lower()
    if collection_mode not in ("cash", "upi", "card", "cheque"):
        collection_mode = "cash"
    collection_reference = re.sub(
        r"\s+", "", cstr(_parse_request_value("collection_reference", collection_reference) or "")
    )[:140]
    if collection_mode == "cheque" and not collection_reference:
        return _error(_("Enter the cheque number"))

    reference_doctype = _parse_request_value("reference_doctype", reference_doctype)
    reference_name = _parse_request_value("reference_name", reference_name)
    if reference_doctype not in ("Customer TRF", "Pharmacy Order", "Doctor Appointment"):
        return _error(_("Invalid reference doctype"))
    if not reference_name or not frappe.db.exists(reference_doctype, reference_name):
        return _error(_("Reference document not found"))

    from health_ecosystem_core.health_ecosystem_core.clinical_iam import (
        FRANCHISEE_ROLE,
        is_phlebotomist,
        is_staff,
        phlebotomist_trf_ids,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import (
        PAYMENT_METHOD_COD,
        PAYMENT_METHOD_HUB,
        PAYMENT_METHOD_ONLINE,
        normalize_payment_method,
    )

    doc = frappe.get_doc(reference_doctype, reference_name)
    payment_method = normalize_payment_method(getattr(doc, "payment_method", None))
    if payment_method == PAYMENT_METHOD_ONLINE:
        return _error(_("Online orders must be paid through Razorpay"))
    if getattr(doc, "razorpay_payment_status", None) == "Paid":
        return _error(_("Payment already recorded"))

    roles = _user_roles()
    franchisee_id = getattr(doc, "franchisee_id", None)
    allowed = is_staff(roles)
    if not allowed and reference_doctype == "Customer TRF":
        if payment_method == PAYMENT_METHOD_COD and is_phlebotomist(roles):
            allowed = reference_name in phlebotomist_trf_ids()
        if not allowed and payment_method in (PAYMENT_METHOD_HUB, PAYMENT_METHOD_COD) and FRANCHISEE_ROLE in roles:
            hub = frappe.db.get_value(
                "Franchisee Profile",
                {"linked_user": frappe.session.user, "active_status": "Active"},
                "name",
            )
            allowed = bool(hub) and hub == franchisee_id
    if not allowed and reference_doctype == "Pharmacy Order":
        allowed = bool(getattr(doc, "delivery_user", None)) and doc.delivery_user == frappe.session.user
    if not allowed and reference_doctype == "Doctor Appointment":
        if "Nurse" in roles:
            allowed = True
        elif "Physician" in roles and getattr(doc, "doctor", None):
            allowed = frappe.db.get_value("Doctor", doc.doctor, "user") == frappe.session.user
    if not allowed:
        return _error(_("Not permitted to record this payment"), 403)

    amount = flt(getattr(doc, "amount", None) or getattr(doc, "order_total", None))
    payment_id = f"offline-{reference_name}-{frappe.utils.now_datetime().strftime('%Y%m%d%H%M%S')}"

    from health_ecosystem_core.health_ecosystem_core.clinical_phase121_hub_receipts import (
        bill_hub_collection,
        hub_owns_collection,
    )

    previous_user = frappe.session.user
    payment_entry = None
    hub_billing = None
    try:
        frappe.set_user("Administrator")
        doc.db_set("razorpay_payment_status", "Paid")
        doc.db_set("payment_id", payment_id)
        if hub_owns_collection(doc):
            frappe.db.commit()
            try:
                hub_billing = bill_hub_collection(reference_name)
            except Exception:
                frappe.db.rollback()
                frappe.log_error(title="Hub collection platform billing", message=frappe.get_traceback())
                hub_billing = {"status": "pending", "reason": "error"}
        else:
            try:
                payment_entry = _create_payment_entry(
                    doc,
                    amount,
                    payment_id,
                    sales_invoice=getattr(doc, "sales_invoice", None),
                    mode_kind=collection_mode,
                    remarks=(
                        f"Offline {collection_mode} collection {payment_id}"
                        + (f" ref {collection_reference}" if collection_reference else "")
                        + f" by {previous_user}"
                    ),
                    collection_ref=collection_reference,
                    collected_by=previous_user,
                )
            except Exception:
                frappe.log_error(title="Offline Payment Entry", message=frappe.get_traceback())
        frappe.db.commit()
    finally:
        frappe.set_user(previous_user)

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_notifications import notify_payment_success

        notify_payment_success(reference_doctype, reference_name, amount=amount)
    except Exception:
        frappe.log_error(title="notify_payment_success offline", message=frappe.get_traceback())

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase27b import on_payment_confirmed

        on_payment_confirmed(reference_doctype, reference_name)
    except Exception:
        frappe.log_error(title="on_payment_confirmed offline", message=frappe.get_traceback())

    return _success(
        {
            "reference": reference_name,
            "reference_doctype": reference_doctype,
            "payment_entry": payment_entry.name if payment_entry else None,
            "hub_billing": hub_billing,
            "status": "Paid",
            "payment_method": payment_method,
        },
        message="Payment recorded",
    )


@frappe.whitelist(allow_guest=True)
def get_phlebotomist_reports(limit=200, sid=None):
    """Collected-sample reports for the collector: processing, ready, delivered, failed."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.clinical_iam import (
        exclude_pf_trfs,
        franchise_for_phlebotomist,
        is_phlebotomist,
        is_staff,
        phlebotomist_trf_ids,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import ensure_phase20_custom_fields
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import format_patient_age

    roles = _user_roles()
    if not is_phlebotomist(roles) and not is_staff(roles):
        return _error(_("Not permitted"), 403)

    ensure_phase20_custom_fields()
    limit = cint(limit) or 200
    collected_statuses = ["Sample Collected", "In Lab", "Completed", "Cancelled"]
    fields = [
        "name",
        "patient_name",
        "patient_phone",
        "unique_barcode",
        "test_required",
        "order_status",
        "collection_slot",
        "creation",
        "modified",
        "gender",
        "age",
        "age_months",
        "age_days",
        "report_delivered_on",
        "franchisee_id",
    ]

    hub = franchise_for_phlebotomist()
    if hub and is_phlebotomist(roles) and not is_staff(roles):
        filters = {"franchisee_id": hub, "order_status": ("in", collected_statuses)}
    elif is_phlebotomist(roles):
        trf_ids = phlebotomist_trf_ids()
        extra = frappe.get_all(
            "Customer TRF",
            filters={"name": ("in", trf_ids or ["__none__"]), "order_status": ("in", collected_statuses)},
            pluck="name",
        ) if trf_ids else []
        if hub:
            extra.extend(
                frappe.get_all(
                    "Customer TRF",
                    filters={"franchisee_id": hub, "order_status": ("in", collected_statuses)},
                    pluck="name",
                )
            )
        extra = list(dict.fromkeys(extra))
        if not extra:
            return _success({"reports": []})
        filters = {"name": ("in", extra)}
    else:
        filters = {"order_status": ("in", collected_statuses)}
    exclude_pf_trfs(filters)

    try:
        rows = frappe.get_all(
            "Customer TRF",
            filters=filters,
            fields=fields,
            order_by="modified desc",
            limit=limit,
        )
    except Exception:
        fields = [f for f in fields if f != "report_delivered_on"]
        rows = frappe.get_all(
            "Customer TRF",
            filters=filters,
            fields=fields,
            order_by="modified desc",
            limit=limit,
        )
        for row in rows:
            row["report_delivered_on"] = None

    names = [row.name for row in rows]
    journeys = {}
    if names:
        for journey in frappe.get_all(
            "Patient Care Journey",
            filters={"customer_trf": ("in", names)},
            fields=["name", "customer_trf", "status", "report_pdf", "authorized_on"],
        ):
            journeys[journey.customer_trf] = journey

    failed_journey = {"Cancelled", "Rejected", "Failed"}
    reports = []
    for row in rows:
        item = _serialize_trf(row) or {}
        journey = journeys.get(row.name)
        delivered = row.get("report_delivered_on")
        ready = bool(journey and journey.report_pdf and journey.status in ("Authorized", "Dispatched"))
        jstatus = journey.status if journey else None
        ostatus = row.get("order_status") or ""
        if delivered:
            ui_status = "delivered"
        elif ostatus == "Cancelled" or (jstatus in failed_journey):
            ui_status = "failed"
        elif ready:
            ui_status = "ready"
        else:
            ui_status = "processing"
        reports.append(
            {
                "journey_id": journey.name if journey else None,
                "trf_id": row.name,
                "patient_name": row.get("patient_name") or item.get("patient_name"),
                "patient_phone": row.get("patient_phone") or item.get("patient_phone"),
                "gender": row.get("gender"),
                "age": row.get("age"),
                "age_months": row.get("age_months"),
                "age_days": row.get("age_days"),
                "age_label": format_patient_age(row.get("age"), row.get("age_months"), row.get("age_days")),
                "barcode": row.get("unique_barcode") or item.get("barcode"),
                "status": jstatus or ostatus,
                "report_ui_status": ui_status,
                "report_pdf": journey.report_pdf if journey else None,
                "authorized_on": str(journey.authorized_on) if journey and journey.authorized_on else None,
                "report_delivered_on": str(delivered) if delivered else None,
                "collection_slot": str(row.collection_slot) if row.get("collection_slot") else None,
                "creation": str(row.creation) if row.get("creation") else None,
                "test_name": item.get("test_name"),
                "test_labels": item.get("test_labels") or [],
                "report_no": row.get("unique_barcode") or row.name,
            }
        )

    return _success({"reports": reports})


def _resolve_file_doc(file_url):
    if not file_url:
        return None
    file_url = (file_url or "").strip()
    docname = frappe.db.get_value("File", {"file_url": file_url}, "name")
    if docname:
        return frappe.get_doc("File", docname)
    fname = file_url.rsplit("/", 1)[-1]
    docname = frappe.db.get_value(
        "File",
        {"file_name": fname},
        "name",
        order_by="creation desc",
    )
    if docname:
        return frappe.get_doc("File", docname)
    return None


def _can_download_journey_report(journey_id, roles):
    if not journey_id or not frappe.db.exists("Patient Care Journey", journey_id):
        return False, None

    from health_ecosystem_core.health_ecosystem_core.clinical_iam import (
        is_phlebotomist,
        is_staff,
        phlebotomist_trf_ids,
    )

    journey = frappe.db.get_value(
        "Patient Care Journey",
        journey_id,
        ["name", "patient", "customer_trf", "status", "report_pdf", "patient_name"],
        as_dict=True,
    )
    if not journey or journey.status not in ("Authorized", "Dispatched"):
        return False, journey

    if is_staff(roles):
        return True, journey
    if is_phlebotomist(roles):
        return journey.customer_trf in phlebotomist_trf_ids(), journey

    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

    profile = patient_profile_for_user()
    if profile and profile.get("patient_id") and profile["patient_id"] == journey.patient:
        return True, journey
    return False, journey


@frappe.whitelist(allow_guest=True)
def download_journey_report_pdf(journey_id=None, sid=None):
    """Stream authorized journey PDF for patient or phlebotomist (session via sid)."""
    frappe.flags.ignore_csrf = True
    if not _require_mobile_auth(sid):
        frappe.throw(_("Not authenticated"), frappe.AuthenticationError)

    journey_id = _parse_request_value("journey_id", journey_id)
    if not journey_id:
        frappe.throw(_("Journey ID is required"))

    allowed, journey = _can_download_journey_report(journey_id, _user_roles())
    if not allowed:
        frappe.throw(_("Not permitted to download this report"), frappe.PermissionError)

    file_doc = _resolve_file_doc(journey.report_pdf) if journey.report_pdf else None
    if not file_doc:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase125_report_share import (
            build_authorized_report_pdf,
        )

        pdf_content, fname, _, _ = build_authorized_report_pdf(journey_id, chrome_mode="nabl")
        frappe.local.response.filename = fname
        frappe.local.response.filecontent = pdf_content
        frappe.local.response.type = "download"
        frappe.local.response["content_type"] = "application/pdf"
        return

    frappe.local.response.filename = file_doc.file_name
    frappe.local.response.filecontent = file_doc.get_content()
    frappe.local.response.type = "download"
    frappe.local.response["content_type"] = "application/pdf"


@frappe.whitelist()
def upload_prescription(file_name=None, file_data=None):
    """Upload prescription image from mobile app and return its file URL (private when hec_private_rx_uploads=1)."""
    if frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)

    if not file_name or not file_data:
        return _error(_("File name and file data are required"))

    try:
        content = base64.b64decode(file_data)
    except Exception:
        return _error(_("Invalid file data"))

    if len(content) > 5 * 1024 * 1024:
        return _error(_("File too large (max 5 MB)"))

    file_doc = frappe.get_doc(
        {
            "doctype": "File",
            "file_name": file_name,
            "content": content,
            "is_private": 1 if cint(frappe.conf.get("hec_private_rx_uploads")) else 0,
            "folder": "Home/Attachments",
        }
    )
    file_doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return _success(
        {
            "file_url": file_doc.file_url,
            "file_name": file_doc.file_name,
        },
        message="Prescription uploaded",
    )


@frappe.whitelist()
def get_lab_results(barcode=None, trf_id=None):
    """Fetch lab results for patient app or staff tools."""
    if not barcode and not trf_id:
        return _error(_("Barcode or TRF ID is required"))

    if not trf_id and barcode:
        trf_id = frappe.db.get_value("Customer TRF", {"unique_barcode": barcode}, "name")

    if not trf_id:
        return _error(_("TRF not found"), 404)

    if frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)

    detail = get_trf_detail(trf_id=trf_id)
    if detail.get("status") != "success":
        return detail

    return _success(
        {
            "trf": detail["data"]["trf"],
            "results": detail["data"]["results"],
        }
    )


@frappe.whitelist(allow_guest=True)
def validate_coupon(promo_code=None, subtotal=None, context=None, sid=None):
    """Validate a promo code and return discount breakdown for cart/checkout."""
    promo_code = _parse_request_value("promo_code", promo_code)
    subtotal = flt(_parse_request_value("subtotal", subtotal) or 0)
    context = _parse_request_value("context", context) or "all"
    if not promo_code:
        return _error(_("Enter a coupon code"))
    if subtotal <= 0:
        return _error(_("Cart total must be greater than zero"))
    try:
        if _require_mobile_auth(sid):
            from health_ecosystem_core.health_ecosystem_core.clinical_phase26 import preview_checkout

            data = preview_checkout(frappe.session.user, subtotal, context, promo_code)
            return _success(
                {
                    "promo_code": data.get("promo_code") or promo_code,
                    "title": "Coupon applied",
                    "subtotal": data["subtotal"],
                    "discount_amount": data["discount_amount"],
                    "final_total": data["final_total"],
                    "membership_discount": data.get("membership_discount", 0),
                    "coupon_discount": data.get("coupon_discount", 0),
                    "membership_plan_title": data.get("membership_plan_title"),
                },
                message="Coupon applied",
            )
        from health_ecosystem_core.health_ecosystem_core.clinical_coupons import validate_promo_code

        data = validate_promo_code(promo_code, subtotal, context)
        return _success(data, message="Coupon applied")
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception:
        frappe.log_error(title="validate_coupon", message=frappe.get_traceback())
        return _error(_("Could not validate coupon"))


@frappe.whitelist()
def create_pharmacy_quote_request(
    customer_name=None,
    customer_phone=None,
    delivery_address=None,
    uploaded_prescription_url=None,
    duration_months=None,
    desired_discount_slab=None,
    latitude=None,
    longitude=None,
    sid=None,
):
    """Chronic medicine pack quote request — pharmacist confirms items and sends quotation."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    customer_name = _parse_request_value("customer_name", customer_name)
    customer_phone = _parse_request_value("customer_phone", customer_phone)
    delivery_address = _parse_request_value("delivery_address", delivery_address)
    uploaded_prescription_url = _parse_request_value(
        "uploaded_prescription_url", uploaded_prescription_url
    )
    duration_months = cint(_parse_request_value("duration_months", duration_months) or 0)
    desired_discount_slab = _parse_request_value("desired_discount_slab", desired_discount_slab) or ""
    latitude = _parse_request_value("latitude", latitude)
    longitude = _parse_request_value("longitude", longitude)

    if not all([customer_name, customer_phone, delivery_address, uploaded_prescription_url]):
        return _error(_("Name, phone, address, and prescription are required"))
    if duration_months < 1:
        return _error(_("Select pack duration in months"))

    from health_ecosystem_core.health_ecosystem_core.patient_bridge import (
        ensure_patient,
        patient_doctype_available,
    )

    patient_id = None
    if patient_doctype_available():
        patient_id = ensure_patient(
            patient_name=customer_name,
            phone=customer_phone,
            user=frappe.session.user if frappe.session.user != "Guest" else None,
        )

    from health_ecosystem_core.health_ecosystem_core.clinical_utils import set_patient_link

    order_data = {
        "doctype": "Pharmacy Order",
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "delivery_address": delivery_address,
        "uploaded_prescription_url": uploaded_prescription_url,
        "duration_months": duration_months,
        "desired_discount_slab": desired_discount_slab or None,
        "order_total": 0,
        "order_kind": "Chronic quote",
        "delivery_status": "Quotation Pending",
        "razorpay_payment_status": "Pending",
        "items_json": json.dumps([]),
    }
    if latitude not in (None, "") and longitude not in (None, ""):
        order_data["request_latitude"] = flt(latitude)
        order_data["request_longitude"] = flt(longitude)
    if patient_id and frappe.get_meta("Pharmacy Order").has_field("patient"):
        order_data["patient"] = patient_id
    set_patient_link(order_data, patient_id, "Pharmacy Order")

    order = frappe.get_doc(order_data)
    order.insert(ignore_permissions=True)
    frappe.db.commit()

    return _success(
        {
            "order_id": order.name,
            "delivery_status": order.delivery_status,
            "duration_months": duration_months,
            "patient": patient_id,
        },
        message=_("Quote request submitted — our pharmacist will confirm medicines and send a quotation"),
    )


@frappe.whitelist(allow_guest=True)
def create_pharmacy_order(
    customer_name=None,
    delivery_address=None,
    uploaded_prescription_url=None,
    order_total=None,
    customer_phone=None,
    items_json=None,
    latitude=None,
    longitude=None,
    payment_method=None,
    promo_code=None,
    sid=None,
):
    """Create pharmacy order from mobile app."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    customer_name = _parse_request_value("customer_name", customer_name)
    delivery_address = _parse_request_value("delivery_address", delivery_address)
    uploaded_prescription_url = _parse_request_value(
        "uploaded_prescription_url", uploaded_prescription_url
    )
    order_total = _parse_request_value("order_total", order_total)
    customer_phone = _parse_request_value("customer_phone", customer_phone)
    items_json = _parse_request_value("items_json", items_json)
    latitude = _parse_request_value("latitude", latitude)
    longitude = _parse_request_value("longitude", longitude)
    payment_method = _parse_request_value("payment_method", payment_method)
    promo_code = _parse_request_value("promo_code", promo_code)

    if not all([customer_name, delivery_address, uploaded_prescription_url]):
        return _error(_("Missing required pharmacy order fields"))

    if isinstance(items_json, str):
        try:
            items_json = json.loads(items_json)
        except Exception:
            items_json = []

    subtotal = sum(flt(i.get("rate", 0)) * flt(i.get("qty", 1)) for i in (items_json or []))
    if not subtotal:
        subtotal = flt(order_total)
    if not subtotal:
        return _error(_("Order total must be greater than zero"))

    discount_amount = 0.0
    applied_code = ""
    pricing = None
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase26 import (
            apply_checkout_pricing,
            persist_membership_on_doc,
        )

        pricing = apply_checkout_pricing(frappe.session.user, subtotal, "pharmacy", promo_code)
        order_total = pricing["final_total"]
        discount_amount = pricing["discount_amount"]
        applied_code = pricing.get("promo_code") or ""
    except frappe.ValidationError as exc:
        return _error(str(exc))

    if latitude and longitude:
        delivery_address = f"{delivery_address}\n[Location: {latitude}, {longitude}]"

    from health_ecosystem_core.health_ecosystem_core.patient_bridge import (
        ensure_patient,
        patient_doctype_available,
    )

    if not customer_phone and frappe.session.user != "Guest":
        customer_phone = frappe.db.get_value("User", frappe.session.user, "mobile_no")

    patient_id = None
    if patient_doctype_available():
        patient_id = ensure_patient(
            patient_name=customer_name,
            phone=customer_phone,
            user=frappe.session.user if frappe.session.user != "Guest" else None,
        )
        if patient_id and not customer_phone:
            customer_phone = frappe.db.get_value("Health Patient", patient_id, "mobile")

    from health_ecosystem_core.health_ecosystem_core.clinical_utils import (
        normalize_payment_method,
        set_patient_link,
    )

    payment_method = normalize_payment_method(payment_method)

    order_data = {
        "doctype": "Pharmacy Order",
        "customer_name": customer_name,
        "delivery_address": delivery_address,
        "uploaded_prescription_url": uploaded_prescription_url,
        "order_total": flt(order_total),
        "customer_phone": customer_phone,
        "items_json": json.dumps(items_json or []),
        "razorpay_payment_status": "Pending",
        "payment_method": payment_method,
        "delivery_status": "Pending",
    }
    if applied_code or discount_amount:
        order_data["promo_code"] = applied_code
        order_data["discount_amount"] = discount_amount
    if pricing:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase26 import persist_membership_on_doc

        persist_membership_on_doc(order_data, pricing, "Pharmacy Order")
    if patient_id and frappe.get_meta("Pharmacy Order").has_field("patient"):
        order_data["patient"] = patient_id

    set_patient_link(order_data, patient_id, "Pharmacy Order")

    order = frappe.get_doc(order_data)
    order.insert(ignore_permissions=True)

    sales_order = _create_sales_order_for_pharmacy(order, items_json or [], patient_id=patient_id)
    if sales_order:
        order.db_set("sales_order", sales_order.name)

    frappe.db.commit()

    return _success(
        {
            "order_id": order.name,
            "amount": order.order_total,
            "subtotal": subtotal,
            "discount_amount": discount_amount,
            "promo_code": applied_code or None,
            "payment_method": payment_method,
            "sales_order": order.sales_order,
            "patient": patient_id,
            "razorpay_payment_status": "Pending",
            "delivery_status": "Pending",
            "requires_payment": payment_method == "Online",
        },
        message="Pharmacy order created — complete payment to confirm",
    )


def _create_sales_order_for_pharmacy(order, items, patient_id=None):
    """Create submitted Sales Order for pharmacy (invoice after delivery)."""
    try:
        from health_ecosystem_core.health_ecosystem_core.patient_bridge import ensure_customer_for_patient

        company = _company_name()

        if not patient_id and frappe.get_meta("Pharmacy Order").has_field("patient"):
            patient_id = order.get("patient")

        customer = ensure_customer_for_patient(patient_id, order.customer_name, order.customer_phone)

        so_items = []
        for row in items:
            item_code = row.get("item_code") or row.get("code") or row.get("name")
            if not item_code:
                medicine = row.get("medicine")
                if isinstance(medicine, dict):
                    item_code = medicine.get("code") or medicine.get("name")
            qty = flt(row.get("quantity") or row.get("qty") or 1)
            rate = flt(row.get("rate") or row.get("price"))
            if not rate and item_code and frappe.db.exists("Item", item_code):
                rate = flt(frappe.db.get_value("Item", item_code, "standard_rate"))
            if item_code:
                so_items.append(
                    {"item_code": item_code, "qty": qty, "rate": rate or flt(order.order_total), "delivery_date": today()}
                )

        if not so_items:
            return None

        so = frappe.get_doc(
            {
                "doctype": "Sales Order",
                "customer": customer,
                "company": company,
                "transaction_date": today(),
                "delivery_date": today(),
                "order_type": "Sales",
                "items": so_items,
                "remarks": f"Mobile pharmacy order {order.name} — invoice on delivery",
            }
        )
        so.insert(ignore_permissions=True)
        so.submit()
        return so
    except Exception:
        frappe.log_error(title="pharmacy_sales_order", message=frappe.get_traceback())
        return None


def _create_sales_invoice_for_pharmacy(order, items):
    """Create ERP Sales Invoice for pharmacy order line items."""
    try:
        _ensure_healthcare_invoice_fields()
        company = _company_name()
        customer = _ensure_customer(order.customer_name, order.customer_phone)

        si_items = []
        for row in items:
            item_code = row.get("item_code") or row.get("code") or row.get("name")
            if not item_code:
                medicine = row.get("medicine")
                if isinstance(medicine, dict):
                    item_code = medicine.get("code") or medicine.get("name")
            qty = flt(row.get("quantity") or row.get("qty") or 1)
            rate = flt(row.get("rate") or row.get("price"))
            if not rate and item_code and frappe.db.exists("Item", item_code):
                rate = flt(frappe.db.get_value("Item", item_code, "standard_rate"))
            if item_code:
                si_items.append(
                    {"item_code": item_code, "qty": qty, "rate": rate or flt(order.order_total)}
                )

        if not si_items:
            return None

        invoice_data = {
            "doctype": "Sales Invoice",
            "customer": customer,
            "company": company,
            "due_date": today(),
            "items": si_items,
            "remarks": f"Auto-generated from Pharmacy Order {order.name}",
        }
        if frappe.get_meta("Sales Invoice").has_field("service_unit"):
            invoice_data["service_unit"] = None

        si = frappe.get_doc(invoice_data)
        si.insert(ignore_permissions=True)
        si.submit()
        return si
    except Exception:
        frappe.log_error(title="pharmacy_sales_invoice", message=frappe.get_traceback())
        return None


@frappe.whitelist(allow_guest=True)
def get_lab_test_catalog(item_group=None, q=None):
    """Return published lab test items for mobile catalog (Lab Tests only — no reagents)."""
    _set_no_cache_headers()
    filters = {"is_sales_item": 1, "disabled": 0, "item_group": ["in", LAB_ITEM_GROUPS]}
    item_group = (_parse_request_value("item_group", item_group) or "").strip()
    if item_group:
        if item_group in EXCLUDED_LAB_CATALOG_GROUPS or item_group not in LAB_ITEM_GROUPS:
            return _success({"items": [], "item_groups": list(LAB_ITEM_GROUPS)})
        filters["item_group"] = item_group
    or_filters = _catalog_search_filters(q)

    items = frappe.get_all(
        "Item",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "item_name", "description", "standard_rate", "image", "item_group"],
        order_by="item_name asc",
        limit=1200,
    )
    items = _filter_public_lab_items(items)

    groups = frappe.get_all(
        "Item Group",
        filters={"name": ["in", LAB_ITEM_GROUPS]},
        fields=["name"],
        order_by="name asc",
    )
    return _success({"items": _enrich_catalog_items(items), "item_groups": [g.name for g in groups]})


@frappe.whitelist(allow_guest=True)
def get_pharmacy_catalog(item_group=None, q=None):
    """Return medicine items for e-commerce gallery."""
    _set_no_cache_headers()
    filters = {"is_sales_item": 1, "disabled": 0, "item_group": ["in", PHARMACY_ITEM_GROUPS]}
    item_group = (_parse_request_value("item_group", item_group) or "").strip()
    if item_group:
        filters["item_group"] = item_group
    or_filters = _catalog_search_filters(q)

    items = frappe.get_all(
        "Item",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "item_name", "description", "standard_rate", "image", "item_group"],
        order_by="modified desc",
        limit=500,
    )

    groups = frappe.get_all(
        "Item Group",
        filters={"name": ["in", PHARMACY_ITEM_GROUPS]},
        fields=["name"],
        order_by="name asc",
    )
    return _success({"items": _enrich_catalog_items(items), "item_groups": [g.name for g in groups]})


def _catalog_search_filters(q):
    q = (_parse_request_value("q", q) or "").strip()
    if not q:
        return None
    return [
        ["name", "like", f"%{q}%"],
        ["item_name", "like", f"%{q}%"],
        ["description", "like", f"%{q}%"],
    ]


@frappe.whitelist(allow_guest=True)
def get_item_detail(item_code=None):
    """Live item price and metadata (for booking/checkout refresh)."""
    _set_no_cache_headers()
    item_code = _parse_request_value("item_code", item_code)
    if not item_code or not frappe.db.exists("Item", item_code):
        return _error(_("Item not found"), 404)

    item = frappe.get_value(
        "Item",
        item_code,
        ["name", "item_name", "description", "standard_rate", "image", "disabled", "is_sales_item", "item_group"],
        as_dict=True,
    )
    if item.get("disabled") or not item.get("is_sales_item"):
        return _error(_("Item not available"), 404)

    rate = _resolve_selling_rate(item_code)
    offer = _patient_offer_pricing(item_code)
    mrp = offer["mrp"]
    item["rate"] = rate
    item["standard_rate"] = rate
    item["mrp"] = mrp if mrp > rate else None
    item["discount_percent"] = round((1 - rate / mrp) * 100) if mrp and mrp > rate else 0
    item["price_basis"] = offer["price_basis"]
    item["foco_rate"] = offer.get("foco_rate")
    item["wallet_earn_percent"] = int(WALLET_EARN_ON_PURCHASE * 100)
    item["wallet_earn_amount"] = round(rate * WALLET_EARN_ON_PURCHASE, 2) if rate else 0
    item["coupon_label"] = _coupon_for_item_group(item.get("item_group"), _load_mobile_promotions())
    item["member_tag"] = _subscription_coupon_tag(
        item.get("item_group"), frappe.session.user if getattr(frappe, "session", None) else None
    )
    item["description"] = _strip_catalog_description(item.get("description"))
    if _is_lab_item_group(item.get("item_group")):
        item.update(_public_lab_item_profile(item_code))
        item["rate"] = rate
        item["standard_rate"] = rate
        item["mrp"] = mrp if mrp > rate else None
        item["discount_percent"] = round((1 - rate / mrp) * 100) if mrp and mrp > rate else 0
        item["price_basis"] = offer["price_basis"]
        item["foco_rate"] = offer.get("foco_rate")
    return _success({"item": item})


# ---------------------------------------------------------------------------
# Mobile home, franchisee search, pharmacy order history
# ---------------------------------------------------------------------------

MOBILE_HOME_BANNERS = [
    {
        "title": "Home Sample Collection",
        "subtitle": "Certified phlebotomists at your doorstep",
        "color": "#0D9488",
        "icon": "home_health",
    },
    {
        "title": "Full Body Checkup",
        "subtitle": "Up to 30% off on health packages",
        "color": "#2563EB",
        "icon": "favorite",
    },
    {
        "title": "Medicines in 30 mins",
        "subtitle": "Upload prescription & order online",
        "color": "#7C3AED",
        "icon": "medication",
    },
]

MOBILE_HOME_PROMOTIONS = [
    {"label": "FIRST10", "title": "10% off first lab booking", "description": "Use at checkout"},
    {"label": "HEALTH25", "title": "₹25 off pharmacy", "description": "Min order ₹299"},
    {"label": "FAMILY", "title": "Family health packages", "description": "CBC + LFT combo deals"},
]


def _public_file_url(path):
    if not path:
        return None
    if str(path).startswith("http"):
        return path
    return frappe.utils.get_url(path)


def _load_portal_banners(placements, fallback=None):
    """Load enabled Mobile Home Banner rows for the given portal placement(s)."""
    if not frappe.db.exists("DocType", "Mobile Home Banner"):
        return list(fallback or [])

    filters = {"enabled": 1}
    meta = frappe.get_meta("Mobile Home Banner")
    fields = [
        "banner_title",
        "subtitle",
        "color",
        "icon",
        "banner_image",
        "display_order",
    ]
    if meta.has_field("banner_placement"):
        filters["banner_placement"] = ["in", list(placements)]
        fields.append("banner_placement")

    rows = frappe.get_all(
        "Mobile Home Banner",
        filters=filters,
        fields=fields,
        order_by="display_order asc, modified desc",
    )
    if not rows:
        return list(fallback or [])

    banners = []
    for row in rows:
        item = {
            "title": row.banner_title,
            "subtitle": row.subtitle or "",
            "color": row.color or "#0D9488",
            "icon": row.icon or "campaign",
        }
        image_url = _public_file_url(row.banner_image)
        if image_url:
            item["image_url"] = image_url
        banners.append(item)
    return banners


def _load_mobile_banners():
    return _load_portal_banners(["Home", "Both"], MOBILE_HOME_BANNERS)


def _load_wellness_promo_banners():
    return _load_portal_banners(["Wellness", "Both"], [])


def _load_mobile_promotions():
    if not frappe.db.exists("DocType", "Mobile Promotion"):
        return MOBILE_HOME_PROMOTIONS

    rows = frappe.get_all(
        "Mobile Promotion",
        filters={"enabled": 1},
        fields=["promo_label", "title", "description", "display_order"],
        order_by="display_order asc, modified desc",
    )
    if not rows:
        return MOBILE_HOME_PROMOTIONS

    return [
        {
            "label": row.promo_label,
            "title": row.title,
            "description": row.description or "",
        }
        for row in rows
    ]


def _load_mobile_headers():
    from health_ecosystem_core.health_ecosystem_core.clinical_homepage import load_home_headers

    return load_home_headers()


def _load_quick_actions():
    from health_ecosystem_core.health_ecosystem_core.clinical_homepage import load_quick_links

    return load_quick_links()


def _load_trust_badges():
    from health_ecosystem_core.health_ecosystem_core.clinical_homepage import load_trust_badges

    return load_trust_badges()


def _load_health_categories():
    from health_ecosystem_core.health_ecosystem_core.clinical_homepage import load_health_categories

    return load_health_categories()


def _load_collection_steps():
    from health_ecosystem_core.health_ecosystem_core.clinical_homepage import load_collection_steps

    return load_collection_steps()


@frappe.whitelist(allow_guest=True)
def get_patient_profile(sid=None):
    """Return Marley Patient profile linked to the logged-in mobile user."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.patient_bridge import (
        patient_doctype_available,
        patient_profile_for_user,
    )

    if not patient_doctype_available():
        return _success(
            {
                "linked": False,
                "healthcare_installed": False,
                "message": _("Healthcare app not installed"),
            }
        )

    profile = patient_profile_for_user() or {"linked": False}
    profile["healthcare_installed"] = True
    return _success(profile)


@frappe.whitelist(allow_guest=True)
def get_patient_wallet(sid=None, limit=None):
    """Phase 75 — Refer & Earn wallet + referral code for logged-in patient."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user
    from health_ecosystem_core.health_ecosystem_core.clinical_phase75_patient_referral import (
        get_patient_wallet_payload,
        setup_phase75,
    )

    setup_phase75()
    profile = patient_profile_for_user() or {}
    patient_id = profile.get("patient_id") or profile.get("name")
    if not patient_id:
        return _error(_("No patient profile linked to this account"))
    return _success(get_patient_wallet_payload(patient_id, limit=limit or 30))


@frappe.whitelist(allow_guest=True)
def create_patient_wallet_razorpay_order(sid=None, amount=None):
    """Phase 75 — create a Razorpay order for patient wallet top-up."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user
    from health_ecosystem_core.health_ecosystem_core.clinical_phase75_patient_referral import (
        prepare_patient_wallet_topup,
        setup_phase75,
        stash_patient_wallet_razorpay_order,
    )

    setup_phase75()
    profile = patient_profile_for_user() or {}
    patient_id = profile.get("patient_id") or profile.get("name")
    if not patient_id:
        return _error(_("No patient profile linked to this account"))

    amount = _parse_request_value("amount", amount)
    try:
        topup = prepare_patient_wallet_topup(patient_id, amount)
    except frappe.ValidationError as exc:
        return _error(str(exc))

    amount_value = topup["amount"]
    amount_paise = topup["amount_paise"]

    if _razorpay_test_mode():
        creds = _get_site_api_credentials()
        order_id = f"order_pwallet_{frappe.generate_hash(length=10)}"
        stash_patient_wallet_razorpay_order(order_id, patient_id, amount_value)
        return _success(
            {
                "order_id": order_id,
                "amount": amount_value,
                "amount_paise": amount_paise,
                "currency": "INR",
                "razorpay_key_id": creds.get("razorpay_key_id"),
                "test_mode": True,
            },
            message="Test patient wallet top-up order created",
        )

    creds = _get_site_api_credentials()
    key_id = creds.get("razorpay_key_id")
    key_secret = creds.get("razorpay_key_secret")
    if not (key_id and key_secret):
        return _error(_("Razorpay is not configured on server"))

    auth_header = base64.b64encode(f"{key_id}:{key_secret}".encode("utf-8")).decode("ascii")
    payload = json.dumps(
        {
            "amount": amount_paise,
            "currency": "INR",
            "receipt": f"pwallet-{patient_id}-{frappe.generate_hash(length=6)}",
            "payment_capture": 1,
        }
    ).encode("utf-8")
    req = Request(
        "https://api.razorpay.com/v1/orders",
        data=payload,
        headers={
            "Authorization": f"Basic {auth_header}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=20) as resp:
            order_data = json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        frappe.log_error(
            title="create_patient_wallet_razorpay_order",
            message=exc.read().decode("utf-8", errors="replace"),
        )
        return _error(_("Razorpay order creation failed"))
    except URLError as exc:
        frappe.log_error(title="create_patient_wallet_razorpay_order", message=str(exc))
        return _error(_("Razorpay is unreachable"))

    order_id = order_data.get("id")
    stash_patient_wallet_razorpay_order(order_id, patient_id, amount_value)
    _record_payment_intent("patient_wallet", order_id, amount_value, party_type="Health Patient", party=patient_id)
    return _success(
        {
            "order_id": order_id,
            "amount": amount_value,
            "amount_paise": amount_paise,
            "currency": order_data.get("currency", "INR"),
            "razorpay_key_id": key_id,
            "test_mode": False,
        },
        message="Razorpay patient wallet order created",
    )


@frappe.whitelist(allow_guest=True)
def verify_patient_wallet_razorpay_payment(
    sid=None,
    razorpay_payment_id=None,
    razorpay_order_id=None,
    razorpay_signature=None,
):
    """Phase 75 — verify Razorpay patient wallet top-up and credit the wallet."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user
    from health_ecosystem_core.health_ecosystem_core.clinical_phase75_patient_referral import (
        complete_patient_wallet_razorpay_credit,
        load_patient_wallet_razorpay_order,
        setup_phase75,
    )

    setup_phase75()
    profile = patient_profile_for_user() or {}
    patient_id = profile.get("patient_id") or profile.get("name")
    if not patient_id:
        return _error(_("No patient profile linked to this account"))

    razorpay_payment_id = _parse_request_value("razorpay_payment_id", razorpay_payment_id)
    razorpay_order_id = _parse_request_value("razorpay_order_id", razorpay_order_id)
    razorpay_signature = _parse_request_value("razorpay_signature", razorpay_signature)

    if not razorpay_order_id or not razorpay_payment_id:
        return _error(_("Missing payment verification fields"))

    stashed = load_patient_wallet_razorpay_order(razorpay_order_id) or _wallet_stash_from_intent(
        razorpay_order_id, "patient_wallet"
    )
    if not stashed:
        return _error(_("Wallet order expired or not found"))

    stash_patient_id = stashed.get("patient_id")
    amount = stashed.get("amount")
    if stash_patient_id != patient_id:
        return _error(_("This wallet order does not belong to you"), 403)

    denied = _confirm_wallet_razorpay_payment(razorpay_order_id, razorpay_payment_id, razorpay_signature, amount)
    if denied:
        return denied

    previous_user = frappe.session.user
    try:
        frappe.set_user("Administrator")
        row = complete_patient_wallet_razorpay_credit(
            patient_id, amount, razorpay_payment_id, order_id=razorpay_order_id
        )
        _mark_payment_intent(razorpay_order_id, razorpay_payment_id, "Checkout")
        frappe.db.commit()
    finally:
        frappe.set_user(previous_user)

    return _success(row, message=_("Wallet topped up"))


@frappe.whitelist(allow_guest=True)
def get_my_referral(sid=None):
    """Compact referral summary for home / account chips."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user
    from health_ecosystem_core.health_ecosystem_core.clinical_phase75_patient_referral import (
        get_patient_wallet_payload,
        setup_phase75,
    )

    setup_phase75()
    profile = patient_profile_for_user() or {}
    patient_id = profile.get("patient_id") or profile.get("name")
    if not patient_id:
        return _success({"linked": False})
    payload = get_patient_wallet_payload(patient_id, limit=5)
    return _success(
        {
            "linked": True,
            "referral_code": payload.get("referral_code"),
            "wallet_balance": payload.get("wallet_balance"),
            "referred_count": payload.get("referred_count"),
            "share_text": payload.get("share_text"),
            "share_url": payload.get("share_url"),
            "signup_credit": payload.get("signup_credit"),
            "first_order_bonus": payload.get("first_order_bonus"),
        }
    )


@frappe.whitelist(allow_guest=True)
def update_patient_profile(
    sid=None,
    patient_name=None,
    mobile=None,
    email=None,
    dob=None,
    gender=None,
    city=None,
    profile_image=None,
    profile_image_filename=None,
    new_password=None,
):
    """Phase 75 — update Health Patient + linked User profile fields.

    Auto-creates and links a Health Patient when the account was never linked
    (common after Google / email signup).
    """
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    from health_ecosystem_core.health_ecosystem_core.patient_bridge import (
        ensure_healthcare_patient_fields,
        ensure_patient_for_user,
        patient_profile_for_user,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_phase75_patient_referral import (
        setup_phase75,
        update_patient_profile_fields,
    )
    from frappe.utils.password import update_password

    setup_phase75()
    ensure_healthcare_patient_fields()

    patient_name = _parse_request_value("patient_name", patient_name)
    mobile = _parse_request_value("mobile", mobile)
    email = _parse_request_value("email", email)
    dob = _parse_request_value("dob", dob)
    gender = _parse_request_value("gender", gender)
    city = _parse_request_value("city", city)
    profile_image = _parse_request_value("profile_image", profile_image)
    profile_image_filename = _parse_request_value("profile_image_filename", profile_image_filename)
    new_password = _parse_request_value("new_password", new_password)

    profile = patient_profile_for_user() or {}
    patient_id = profile.get("patient_id") or profile.get("name")
    if not patient_id:
        patient_id = ensure_patient_for_user(
            user=frappe.session.user,
            patient_name=patient_name,
            phone=mobile,
            email=email,
            gender=gender,
        )
    if not patient_id:
        return _error(_("Could not create patient profile. Provide name and mobile or email."))

    try:
        data = update_patient_profile_fields(
            patient_id,
            patient_name=patient_name,
            mobile=mobile,
            email=email,
            dob=dob,
            gender=gender,
            city=city,
            profile_image_b64=profile_image,
            profile_image_filename=profile_image_filename,
        )
        if new_password:
            pwd = (new_password or "").strip()
            if len(pwd) < 8:
                return _error(_("Password must be at least 8 characters"))
            update_password(frappe.session.user, pwd, logout_all_sessions=False)
        frappe.db.commit()
        refreshed = patient_profile_for_user() or {}
        refreshed["wallet"] = data
        return _success(refreshed, message=_("Profile updated"))
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="update_patient_profile", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to update profile"))


@frappe.whitelist(allow_guest=True)
def apply_patient_wallet_credit(reference_doctype=None, reference_name=None, amount=None, sid=None):
    """Debit patient wallet against a booking/TRF before or with payment."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    reference_doctype = _parse_request_value("reference_doctype", reference_doctype)
    reference_name = _parse_request_value("reference_name", reference_name)
    amount = flt(_parse_request_value("amount", amount) or 0)
    if reference_doctype not in ("Customer TRF", "Doctor Appointment", "Pharmacy Order"):
        return _error(_("Invalid reference doctype"))
    if not reference_name or not frappe.db.exists(reference_doctype, reference_name):
        return _error(_("Reference document not found"))
    if amount <= 0:
        return _error(_("Amount must be positive"))

    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user
    from health_ecosystem_core.health_ecosystem_core.clinical_phase75_patient_referral import (
        debit_wallet_for_order,
        setup_phase75,
    )

    setup_phase75()
    profile = patient_profile_for_user() or {}
    patient_id = profile.get("patient_id") or profile.get("name")
    if not patient_id:
        return _error(_("No patient profile linked"))
    try:
        result = debit_wallet_for_order(patient_id, amount, reference_doctype, reference_name)
        meta = frappe.get_meta(reference_doctype)
        if meta.has_field("wallet_credit_applied"):
            prev = flt(frappe.db.get_value(reference_doctype, reference_name, "wallet_credit_applied"))
            frappe.db.set_value(
                reference_doctype,
                reference_name,
                "wallet_credit_applied",
                prev + amount,
                update_modified=False,
            )
        if meta.has_field("amount"):
            cur = flt(frappe.db.get_value(reference_doctype, reference_name, "amount"))
            frappe.db.set_value(
                reference_doctype,
                reference_name,
                "amount",
                max(0, round(cur - amount, 2)),
                update_modified=False,
            )
        frappe.db.commit()
        return _success(result or {}, message=_("Wallet credit applied"))
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="apply_patient_wallet_credit", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to apply wallet credit"))


@frappe.whitelist(allow_guest=True)
def get_home_content():
    """Banners, promotions, and popular tests for mobile home screen."""
    popular_tests = frappe.get_all(
        "Item",
        filters={"is_sales_item": 1, "disabled": 0, "item_group": ["in", LAB_ITEM_GROUPS]},
        fields=["name", "item_name", "description", "standard_rate", "image", "item_group"],
        order_by="modified desc",
        limit=24,
    )
    popular_tests = _filter_public_lab_items(popular_tests)[:8]

    return _success(
        {
            "banners": _load_mobile_banners(),
            "promotions": _load_mobile_promotions(),
            "popular_tests": _enrich_catalog_items(popular_tests),
            **_home_content_sections(),
        }
    )


def _home_content_sections():
    from health_ecosystem_core.health_ecosystem_core.clinical_homepage import home_content_extras

    return home_content_extras()


@frappe.whitelist(allow_guest=True)
def get_site_footer():
    """Public www footer — social links + ERP-managed home collection helpline."""
    from health_ecosystem_core.health_ecosystem_core.clinical_homepage import build_site_footer

    return _success(build_site_footer())


@frappe.whitelist(allow_guest=True)
def forgot_password(email=None):
    """Send ERPNext password reset email."""
    email = (_parse_request_value("email", email) or "").strip()
    if not email:
        return _error(_("Email is required"))

    user = frappe.db.get_value("User", {"email": email}, "name") or frappe.db.get_value(
        "User", {"username": email}, "name"
    )
    if user:
        try:
            from frappe.core.doctype.user.user import reset_password

            reset_password(user)
        except Exception:
            frappe.log_error(title="forgot_password", message=frappe.get_traceback())

    return _success({}, message=_("If the account exists, a password reset email was sent."))


@frappe.whitelist(allow_guest=True)
def get_oauth_providers(redirect_to=None):
    """List enabled social login providers (delegates to Phase 18b)."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase18b import get_oauth_providers as _oauth_providers

    return _oauth_providers(redirect_to=redirect_to)


@frappe.whitelist(allow_guest=True)
def search_franchisees(q=None, limit=200):
    """Search active collection centres (franchisee branches) for booking."""
    return _search_franchisees_impl(q=q, limit=limit)


def _search_franchisees_impl(q=None, limit=200):
    _set_no_cache_headers()
    q = (_parse_request_value("q", q) or "").strip()
    limit = cint(limit) or 200

    filters = {"active_status": "Active"}
    or_filters = None
    if q:
        or_filters = [
            ["franchise_name", "like", f"%{q}%"],
            ["branch_code", "like", f"%{q}%"],
            ["territory_region", "like", f"%{q}%"],
            ["address", "like", f"%{q}%"],
            ["owner_name", "like", f"%{q}%"],
            ["contact_phone", "like", f"%{q}%"],
        ]

    franchisees = frappe.get_all(
        "Franchisee Profile",
        filters=filters,
        or_filters=or_filters,
        fields=[
            "name",
            "franchise_name",
            "branch_code",
            "territory_region",
            "address",
            "contact_phone",
            "latitude",
            "longitude",
            "category",
            "wallet_balance",
        ],
        order_by="franchise_name asc",
        limit=limit,
    )

    return _success({"franchisees": franchisees, "count": len(franchisees)})


@frappe.whitelist(allow_guest=True)
def get_collection_centers(q=None, limit=200):
    """Alias for search_franchisees (collection centre picker)."""
    return _search_franchisees_impl(q=q, limit=limit)


@frappe.whitelist(allow_guest=True)
def get_my_pharmacy_orders(customer_phone=None, limit=50, sid=None):
    """Return pharmacy orders for the logged-in customer or staff scope."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_phlebotomist, is_staff

    roles = _user_roles()
    limit = cint(limit) or 50
    order_fields = [
        "name",
        "customer_name",
        "customer_phone",
        "delivery_address",
        "order_total",
        "delivery_status",
        "razorpay_payment_status",
        "payment_method",
        "sales_invoice",
        "creation",
        "modified",
        "owner",
    ]

    if "Franchisee Operator" in roles:
        filters = {}
    elif is_staff(roles):
        filters = {}
    elif is_phlebotomist(roles):
        from health_ecosystem_core.health_ecosystem_core.patient_bridge import (
            patient_profile_for_user,
            patient_scope_or_filters,
        )

        profile = patient_profile_for_user()
        or_filters = patient_scope_or_filters(
            phone_field="customer_phone",
            name_field="customer_name",
        )
        or_filters.append(["owner", "=", frappe.session.user])
        orders = frappe.get_all(
            "Pharmacy Order",
            or_filters=or_filters,
            fields=order_fields,
            order_by="modified desc",
            limit=limit,
        )
        return _success({"orders": _enrich_pharmacy_order_items(orders)})
    else:
        from health_ecosystem_core.health_ecosystem_core.patient_bridge import (
            patient_profile_for_user,
            patient_scope_or_filters,
        )

        profile = patient_profile_for_user()
        if profile and profile.get("patient_id"):
            meta = frappe.get_meta("Pharmacy Order")
            patient_field = None
            for candidate in ("patient", "health_patient"):
                if meta.has_field(candidate):
                    patient_field = candidate
                    break
            if patient_field:
                orders = frappe.get_all(
                    "Pharmacy Order",
                    filters={patient_field: profile["patient_id"]},
                    fields=order_fields,
                    order_by="modified desc",
                    limit=limit,
                )
                return _success({"orders": _enrich_pharmacy_order_items(orders)})

        or_filters = patient_scope_or_filters(
            phone_field="customer_phone",
            name_field="customer_name",
        )
        phone = _parse_request_value("customer_phone", customer_phone)
        if phone:
            or_filters.append(["customer_phone", "=", phone])
        or_filters.append(["owner", "=", frappe.session.user])

        orders = frappe.get_all(
            "Pharmacy Order",
            or_filters=or_filters,
            fields=order_fields,
            order_by="modified desc",
            limit=limit,
        )
        return _success({"orders": _enrich_pharmacy_order_items(orders)})

    orders = frappe.get_all(
        "Pharmacy Order",
        filters=filters,
        fields=order_fields,
        order_by="modified desc",
        limit=limit,
    )
    return _success({"orders": _enrich_pharmacy_order_items(orders)})


def _enrich_pharmacy_order_items(orders):
    for order in orders:
        raw_items = frappe.db.get_value("Pharmacy Order", order.name, "items_json")
        try:
            order["items"] = json.loads(raw_items or "[]")
        except Exception:
            order["items"] = []
    return orders


@frappe.whitelist(allow_guest=True)
def book_lab_test(
    patient_name=None,
    age=None,
    gender=None,
    test_required=None,
    test_items=None,
    panel_id=None,
    franchisee_id=None,
    patient_phone=None,
    collection_address=None,
    collection_latitude=None,
    collection_longitude=None,
    collection_slot=None,
    amount=None,
    unique_barcode=None,
    payment_method=None,
    promo_code=None,
    sid=None,
):
    """Mobile lab booking endpoint."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    if panel_id:
        from health_ecosystem_core.health_ecosystem_core.clinical_diagnostics import _panel_test_items

        test_items = _panel_test_items(panel_id)
        if not test_items:
            return _error(_("Lab panel not found or empty"), 404)

    return _create_customer_trf_impl(
        patient_name=patient_name,
        age=age,
        gender=gender,
        test_required=test_required,
        test_items=test_items,
        franchisee_id=franchisee_id,
        patient_phone=patient_phone,
        collection_address=collection_address,
        collection_latitude=collection_latitude,
        collection_longitude=collection_longitude,
        collection_slot=collection_slot,
        amount=amount,
        unique_barcode=unique_barcode,
        payment_method=payment_method,
        promo_code=promo_code,
    )


@frappe.whitelist(allow_guest=True)
def find_nearby_collection_centers(latitude=None, longitude=None, radius_km=None, limit=None):
    """Phase 66 — hubs near patient GPS for AI physician journey."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase66_ai_physician import (
        find_nearby_collection_centers as _nearby,
    )

    latitude = _parse_request_value("latitude", latitude)
    longitude = _parse_request_value("longitude", longitude)
    radius_km = _parse_request_value("radius_km", radius_km) or 40
    limit = _parse_request_value("limit", limit) or 5
    try:
        centers = _nearby(latitude, longitude, radius_km=radius_km, limit=limit)
        return _success({"centers": centers, "count": len(centers)})
    except Exception as exc:
        frappe.log_error(title="find_nearby_collection_centers", message=frappe.get_traceback())
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def start_ai_physician_journey(symptoms=None, latitude=None, longitude=None):
    """Phase 66 — open AI physician chat from symptom text/voice."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase66_ai_physician import (
        start_ai_physician_journey as _start,
    )

    symptoms = _parse_request_value("symptoms", symptoms)
    latitude = _parse_request_value("latitude", latitude)
    longitude = _parse_request_value("longitude", longitude)
    try:
        return _success(_start(symptoms, latitude=latitude, longitude=longitude))
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="start_ai_physician_journey", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to start care chat"))


@frappe.whitelist(allow_guest=True)
def ai_physician_turn(session_id=None, message=None, latitude=None, longitude=None):
    """Phase 66 — continue AI physician Q&A / get suggestions."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase66_ai_physician import (
        continue_ai_physician_journey,
    )

    session_id = _parse_request_value("session_id", session_id)
    message = _parse_request_value("message", message)
    latitude = _parse_request_value("latitude", latitude)
    longitude = _parse_request_value("longitude", longitude)
    if not session_id:
        return _error(_("session_id is required"))
    try:
        return _success(
            continue_ai_physician_journey(
                session_id, message, latitude=latitude, longitude=longitude
            )
        )
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        frappe.log_error(title="ai_physician_turn", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to continue care chat"))


@frappe.whitelist()
def check_openai_status(force_probe=None):
    """Ops: OpenAI key/model readiness. Optional live probe when force_probe=1."""
    from health_ecosystem_core.health_ecosystem_core.clinical_openai import (
        openai_runtime_status,
        probe_openai,
    )

    force = cint(_parse_request_value("force_probe", force_probe) or 0)
    if force:
        return _success(probe_openai(force=True))
    return _success(openai_runtime_status())


# ---------------------------------------------------------------------------
# Lazy re-exports of guest/portal handlers that live in phase modules.
#
# Those phase modules import helpers from this module, so importing them
# eagerly here creates a circular import that fails whenever a phase module is
# loaded before ``api`` (bench execute, smokes, or any alternate import order).
# Resolving them lazily via PEP 562 module ``__getattr__`` keeps the
# ``...api.<fn>`` call paths working while breaking the import cycle.
# ---------------------------------------------------------------------------
_LAZY_REEXPORTS = {
    "book_allied_health_appointment": "clinical_phase31_allied_health",
    "get_allied_health_service": "clinical_phase31_allied_health",
    "get_allied_health_services": "clinical_phase31_allied_health",
    "get_allied_health_wings": "clinical_phase31_allied_health",
    "get_insurance_landing": "clinical_phase44_insurance",
    "get_my_insurance_requests": "clinical_phase44_insurance",
    "submit_insurance_quote_request": "clinical_phase44_insurance",
    "accept_pharmacy_quote": "clinical_phase32_pharmacy_quote",
    "list_pharmacy_quote_queue": "clinical_phase32_pharmacy_quote",
    "send_pharmacy_quote": "clinical_phase32_pharmacy_quote",
    "complete_oauth_login": "clinical_phase18b",
    "get_masked_call_context": "clinical_phase65_number_masking",
    "start_masked_call": "clinical_phase65_number_masking",
    # Follow-up aliases for Flutter / older clients (not a separate DocType)
    "list_consult_followup_queue": "clinical_phase47_complete_care",
    "schedule_consult_followup": "clinical_phase47_complete_care",
    "schedule_appointment_followup": "clinical_phase42_telemedicine",
    "get_teleconsult_session": "clinical_phase42_telemedicine",
    "join_video_session": "clinical_phase42_telemedicine",
}


def __getattr__(name):
    module = _LAZY_REEXPORTS.get(name)
    if module:
        import importlib

        mod = importlib.import_module(
            f"health_ecosystem_core.health_ecosystem_core.{module}"
        )
        return getattr(mod, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

@frappe.whitelist(allow_guest=True)
def get_labtech_settings(sid=None):
    """Lab Technician Settings — reporting pad, WhatsApp, pathologist signatures."""
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_labtech_settings import (
        get_labtech_settings as _get,
    )

    try:
        data = _get(frappe.session.user)
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_report_page_layout import (
                get_report_page_management,
            )

            data["report_page"] = get_report_page_management(frappe.session.user)
        except Exception:
            frappe.log_error(title="get_labtech_settings_report_page", message=frappe.get_traceback())
            data["report_page"] = None
        return _success(data)
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except Exception:
        frappe.log_error(title="get_labtech_settings", message=frappe.get_traceback())
        return _error(_("Could not load lab settings"))


@frappe.whitelist(allow_guest=True)
def get_report_page_management(sid=None, brand=None, format=None, branch=None):
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_report_page_layout import (
        get_report_page_management as _get,
    )

    try:
        return _success(_get(frappe.session.user, brand=brand, fmt=format, branch=branch))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except Exception:
        frappe.log_error(title="get_report_page_management", message=frappe.get_traceback())
        return _error(_("Could not load report page management"))


@frappe.whitelist(allow_guest=True)
def save_report_page_layout(
    sid=None,
    brand=None,
    format=None,
    layout=None,
    branch=None,
    as_branch_override=None,
    file_name=None,
    file_data=None,
    image_field=None,
):
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    import base64

    from health_ecosystem_core.health_ecosystem_core.clinical_report_page_layout import (
        save_report_page_layout as _save,
    )

    # Prefer raw multipart file from the browser (reliable for large letterheads).
    # FormData base64 in file_data often arrives empty after proxies — that used to
    # silently keep the old header while the UI said "saved".
    try:
        req = getattr(frappe.local, "request", None)
        files = getattr(req, "files", None) if req is not None else None
        uploaded = files.get("file") if files else None
        if uploaded and getattr(uploaded, "filename", None):
            raw = uploaded.stream.read() if hasattr(uploaded, "stream") else uploaded.read()
            if raw:
                file_name = file_name or uploaded.filename
                mime = "image/png"
                lower = str(file_name or "").lower()
                if lower.endswith(".jpg") or lower.endswith(".jpeg"):
                    mime = "image/jpeg"
                elif lower.endswith(".webp"):
                    mime = "image/webp"
                file_data = f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")
    except Exception:
        frappe.log_error(title="save_report_page_layout_multipart", message=frappe.get_traceback())

    try:
        return _success(
            _save(
                frappe.session.user,
                brand=brand,
                fmt=format,
                layout=layout,
                branch=branch,
                as_branch_override=as_branch_override,
                file_name=file_name,
                file_data=file_data,
                image_field=image_field,
            ),
            message=_("Report page layout saved"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception:
        frappe.log_error(title="save_report_page_layout", message=frappe.get_traceback())
        return _error(_("Could not save report page layout"))


@frappe.whitelist(allow_guest=True)
def reset_report_page_layout(sid=None, brand=None, format=None, branch=None):
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_report_page_layout import (
        reset_report_page_layout as _reset,
    )

    try:
        return _success(
            _reset(frappe.session.user, brand=brand, fmt=format, branch=branch),
            message=_("Layout reset to defaults"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except Exception:
        frappe.log_error(title="reset_report_page_layout", message=frappe.get_traceback())
        return _error(_("Could not reset layout"))


@frappe.whitelist(allow_guest=True)
def apply_report_page_layout_to_branches(sid=None, brand=None, format=None, branches=None):
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_report_page_layout import (
        apply_report_page_layout_to_branches as _apply,
    )

    try:
        return _success(
            _apply(frappe.session.user, brand=brand, fmt=format, branches=branches),
            message=_("Layout applied to selected branches"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception:
        frappe.log_error(title="apply_report_page_layout_to_branches", message=frappe.get_traceback())
        return _error(_("Could not apply layout to branches"))


@frappe.whitelist(allow_guest=True)
def preview_report_page_pdf(sid=None, brand=None, format=None, branch=None):
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_report_page_layout import (
        preview_report_page_pdf as _preview,
    )

    try:
        return _success(_preview(frappe.session.user, brand=brand, fmt=format, branch=branch))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except Exception:
        frappe.log_error(title="preview_report_page_pdf", message=frappe.get_traceback())
        return _error(_("Could not build layout preview PDF"))


@frappe.whitelist(allow_guest=True)
def get_report_page_editor_template(sid=None, brand=None, format=None, template_id=None, branch=None):
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_report_page_layout import (
        get_report_page_editor_template as _get,
    )

    try:
        return _success(
            _get(frappe.session.user, brand=brand, fmt=format, template_id=template_id, branch=branch)
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except Exception:
        frappe.log_error(title="get_report_page_editor_template", message=frappe.get_traceback())
        return _error(_("Could not load page editor template"))


@frappe.whitelist(allow_guest=True)
def save_report_page_editor_template(
    sid=None,
    brand=None,
    format=None,
    name=None,
    canvas_json=None,
    meta=None,
    header_image=None,
    footer_image=None,
    set_active=None,
    template_id=None,
):
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_report_page_layout import (
        save_report_page_editor_template as _save,
    )

    try:
        return _success(
            _save(
                frappe.session.user,
                brand=brand,
                fmt=format,
                name=name,
                canvas_json=canvas_json,
                meta=meta,
                header_image=header_image,
                footer_image=footer_image,
                set_active=set_active,
                template_id=template_id,
            ),
            message=_("Page design saved"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception:
        frappe.log_error(title="save_report_page_editor_template", message=frappe.get_traceback())
        return _error(_("Could not save page design"))


@frappe.whitelist(allow_guest=True)
def delete_report_page_editor_template(sid=None, template_id=None):
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_report_page_layout import (
        delete_report_page_editor_template as _delete,
    )

    try:
        return _success(_delete(frappe.session.user, template_id=template_id), message=_("Design deleted"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception:
        frappe.log_error(title="delete_report_page_editor_template", message=frappe.get_traceback())
        return _error(_("Could not delete design"))


@frappe.whitelist(allow_guest=True)
def save_labtech_reporting_pad(sid=None, identity=None, images=None):
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_labtech_settings import (
        save_labtech_reporting_pad as _save,
    )

    try:
        return _success(_save(frappe.session.user, identity=identity, images=images), message=_("Reporting pad saved"))
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception:
        frappe.log_error(title="save_labtech_reporting_pad", message=frappe.get_traceback())
        return _error(_("Could not save reporting pad"))


@frappe.whitelist(allow_guest=True)
def save_labtech_whatsapp(sid=None, report_enabled=None, report_message=None):
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_labtech_settings import (
        save_labtech_whatsapp as _save,
    )

    try:
        return _success(
            _save(frappe.session.user, report_enabled=report_enabled, report_message=report_message),
            message=_("WhatsApp settings saved"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except Exception:
        frappe.log_error(title="save_labtech_whatsapp", message=frappe.get_traceback())
        return _error(_("Could not save WhatsApp settings"))


@frappe.whitelist(allow_guest=True)
def save_pathologist_signature(sid=None, employee=None, file_name=None, file_data=None, clear=None):
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_labtech_settings import (
        save_pathologist_signature as _save,
    )

    try:
        return _success(
            _save(
                frappe.session.user,
                employee=employee,
                file_name=file_name,
                file_data=file_data,
                clear=clear,
            ),
            message=_("Signature updated"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception:
        frappe.log_error(title="save_pathologist_signature", message=frappe.get_traceback())
        return _error(_("Could not save signature"))


@frappe.whitelist(allow_guest=True)
def save_department_signature_default(
    sid=None,
    department_key=None,
    name=None,
    qualification=None,
    file_name=None,
    file_data=None,
    clear_image=None,
):
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_labtech_settings import (
        save_department_signature_default as _save,
    )

    try:
        return _success(
            _save(
                frappe.session.user,
                department_key=department_key,
                name=name,
                qualification=qualification,
                file_name=file_name,
                file_data=file_data,
                clear_image=clear_image,
            ),
            message=_("Department signature saved"),
        )
    except frappe.PermissionError as exc:
        return _error(str(exc), 403)
    except frappe.ValidationError as exc:
        return _error(str(exc))
    except Exception:
        frappe.log_error(title="save_department_signature_default", message=frappe.get_traceback())
        return _error(_("Could not save department signature"))
