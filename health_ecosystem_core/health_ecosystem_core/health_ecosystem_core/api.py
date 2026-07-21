"""
Secure REST API for Health Ecosystem Core.
All machine-facing endpoints require API key + secret headers.
Mobile app endpoints use Frappe session tokens after authenticate_user.
"""

import base64
import hashlib
import hmac
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import frappe
from frappe import _
from frappe.utils import cint, flt, get_datetime, now_datetime, today


# ---------------------------------------------------------------------------
# Security helpers
# ---------------------------------------------------------------------------

ALLOWED_PUBLIC_METHODS = {
    "authenticate_user",
    "update_password_on_first_login",
    "validate_session",
    "send_otp",
    "verify_otp_and_login",
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
    from health_ecosystem_core.health_ecosystem_core.clinical_secrets import razorpay_test_mode

    return razorpay_test_mode()


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


def _resolve_selling_rate(item_code):
    """Use Item Price (selling price list) when set, else Item.standard_rate."""
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
    rate = _resolve_selling_rate(item_code)
    mrp = flt(frappe.db.get_value("Item", item_code, "standard_rate"))
    if mrp <= rate:
        mrp = 0
    return rate, mrp


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
        profile.pop("foco_rate", None)
        return profile
    except Exception:
        return {}


def _enrich_catalog_items(items):
    promos = _load_mobile_promotions()
    for item in items:
        code = item.get("name")
        rate, mrp = _item_pricing(code)
        item["rate"] = rate
        item["standard_rate"] = rate
        item["mrp"] = mrp or None
        item["discount_percent"] = round((1 - rate / mrp) * 100) if mrp and mrp > rate else 0
        item["coupon_label"] = _coupon_for_item_group(item.get("item_group"), promos)
        desc = item.get("description") or frappe.db.get_value("Item", code, "description") or ""
        item["description"] = _strip_catalog_description(desc)
        if _is_lab_item_group(item.get("item_group")):
            item.update(_public_lab_item_profile(code))
    return items


def _company_name():
    return frappe.defaults.get_global_default("company") or frappe.get_all("Company", limit=1)[0].name


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

DEFAULT_PASSWORDS_BY_USERNAME = {
    "system_admin": "AdminChangeMe@123",
    "franchise_hub": "HubChangeMe@123",
    "lab_tech_core": "TechChangeMe@123",
    "sales_mgr": "SalesMgrChangeMe@123",
    "sales_rep1": "SalesRepChangeMe@123",
    "circle_test": "CircleTestChangeMe@123",
    "patient_demo": "PatientChangeMe@123",
}


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
        roles = [r.role for r in user.roles]
        from health_ecosystem_core.health_ecosystem_core.clinical_email import user_requires_email_verification

        if user_requires_email_verification(user_id):
            frappe.local.login_manager.logout()
            frappe.db.commit()
            return _error(
                _("Please verify your email before signing in. Check your inbox or request a new link."),
                401,
            )

        must_change_password = _user_must_change_password(user_id)

        franchisee = None
        if "Franchisee Operator" in roles:
            franchisee = frappe.db.get_value(
                "Franchisee Profile",
                {"linked_user": user_id, "active_status": "Active"},
                ["name", "branch_code", "franchise_name", "commission_percentage_rate"],
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


def _user_must_change_password(user_id):
    from frappe.utils.password import check_password

    username = frappe.db.get_value("User", user_id, "username") or ""
    default_password = DEFAULT_PASSWORDS_BY_USERNAME.get(username)

    if default_password:
        try:
            if check_password(user_id, default_password):
                return True
        except Exception:
            pass

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
    company = frappe.defaults.get_global_default("company") or frappe.get_all("Company", limit=1)[0].name
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

    if reference_doctype not in ("Customer TRF", "Pharmacy Order", "Doctor Appointment"):
        return _error(_("Invalid reference doctype"))

    if not frappe.db.exists(reference_doctype, reference_name):
        return _error(_("Reference document not found"))

    creds = _get_site_api_credentials()
    key_secret = creds.get("razorpay_key_secret")
    if not key_secret and not _razorpay_test_mode():
        return _error(_("Razorpay secret not configured on server"))

    if not _razorpay_test_mode():
        payload = f"{razorpay_order_id}|{razorpay_payment_id}"
        expected = hmac.new(
            key_secret.encode("utf-8"),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(expected, razorpay_signature):
            return _error(_("Payment signature verification failed"), 403)

    doc = frappe.get_doc(reference_doctype, reference_name)
    amount = flt(getattr(doc, "amount", None) or getattr(doc, "order_total", None))

    previous_user = frappe.session.user
    payment_entry = None
    try:
        frappe.set_user("Administrator")
        doc.db_set("razorpay_payment_status", "Paid")
        doc.db_set("payment_id", razorpay_payment_id)
        try:
            payment_entry = _create_payment_entry(doc, amount, razorpay_payment_id)
            if reference_doctype == "Customer TRF" and doc.sales_invoice and payment_entry:
                _allocate_payment_to_invoice(payment_entry, doc.sales_invoice, amount)
        except Exception:
            frappe.log_error(title="Razorpay Payment Entry", message=frappe.get_traceback())
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

    return _success(
        {
            "reference": reference_name,
            "payment_entry": payment_entry.name if payment_entry else None,
            "status": "Paid",
        },
        message="Payment verified",
    )


def _create_payment_entry(doc, amount, payment_id):
    from erpnext.accounts.party import get_party_account
    from erpnext.accounts.utils import get_account_currency

    company = frappe.defaults.get_global_default("company") or frappe.get_all("Company", limit=1)[0].name
    customer_name = getattr(doc, "patient_name", None) or getattr(doc, "customer_name", None)
    customer = _ensure_customer(customer_name)
    amount = flt(amount)
    if amount <= 0 and getattr(doc, "sales_order", None):
        amount = flt(frappe.db.get_value("Sales Order", doc.sales_order, "grand_total"))
    if amount <= 0:
        amount = flt(getattr(doc, "amount", None) or getattr(doc, "order_total", None))

    mode_of_payment = (
        frappe.db.get_value("Mode of Payment", {"name": "Wire Transfer"}, "name")
        or frappe.db.get_value("Mode of Payment", {"enabled": 1}, "name")
        or "Cash"
    )
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
            "reference_no": payment_id,
            "reference_date": today(),
            "mode_of_payment": mode_of_payment,
            "remarks": f"Razorpay payment {payment_id}",
        }
    )
    pe.set_missing_values()
    pe.set_amounts()
    pe.insert(ignore_permissions=True)
    pe.submit(ignore_permissions=True)
    return pe


def _allocate_payment_to_invoice(payment_entry, sales_invoice, amount):
    pe = frappe.get_doc("Payment Entry", payment_entry.name)
    pe.append(
        "references",
        {
            "reference_doctype": "Sales Invoice",
            "reference_name": sales_invoice,
            "allocated_amount": amount,
            "total_amount": amount,
        },
    )
    pe.set_missing_values()
    pe.set_amounts()
    pe.save(ignore_permissions=True)
    pe.submit(ignore_permissions=True)


# ---------------------------------------------------------------------------
# LIS machine integration
# ---------------------------------------------------------------------------

@frappe.whitelist(allow_guest=True)
def get_barcode_tests(barcode=None):
    """HTTP GET for LIS bridge: return tests assigned to a barcode."""
    _validate_machine_auth()

    if not barcode:
        return _error(_("Barcode is required"))

    trf = frappe.db.get_value(
        "Customer TRF",
        {"unique_barcode": barcode},
        [
            "name",
            "patient_name",
            "test_required",
            "order_status",
            "age",
            "gender",
            "razorpay_payment_status",
        ],
        as_dict=True,
    )

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
        frappe.db.commit()

    from health_ecosystem_core.health_ecosystem_core.clinical_journey import sync_journey_from_trf

    sync_journey_from_trf(trf.name, trf.order_status)
    frappe.db.commit()

    from health_ecosystem_core.health_ecosystem_core.clinical_utils import get_trf_test_lines

    trf_doc = frappe.get_doc("Customer TRF", trf.name)
    test_payload = []
    for line in get_trf_test_lines(trf_doc):
        item_name = line["item_name"]
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
        }
    )


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
):
    """Authorized LIS endpoint to push machine results."""
    _validate_machine_auth()

    if not all([barcode, analyte_test_name, numeric_result_value is not None]):
        return _error(_("Missing required result fields"))

    trf_name = frappe.db.get_value("Customer TRF", {"unique_barcode": barcode}, "name")
    if not trf_name:
        return _error(_("Barcode not linked to any TRF"), 404)

    from health_ecosystem_core.health_ecosystem_core.clinical_utils import (
        abnormal_flag_for_value,
        find_test_master_for_trf_result,
        parameter_reference_range,
    )

    trf = frappe.get_doc("Customer TRF", trf_name)
    erp_item_code = _parse_request_value("erp_item_code", erp_item_code)
    test_master, resolved_item = find_test_master_for_trf_result(
        trf, erp_item_code=erp_item_code, analyte_test_name=analyte_test_name
    )
    if not reference_range and test_master:
        reference_range = parameter_reference_range(test_master, analyte_test_name)
    if not abnormal_flag and test_master:
        abnormal_flag = abnormal_flag_for_value(test_master, analyte_test_name, numeric_result_value)

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
        "numeric_result_value": flt(numeric_result_value),
        "unit_of_measure": unit_of_measure,
        "machine_reference": machine_reference or "EM 200",
        "verification_timestamp": now_datetime(),
        "customer_trf": trf_name,
        "reference_range": reference_range,
        "abnormal_flag": abnormal_flag,
    }
    if resolved_item and frappe.get_meta("Lab Test Result").has_field("erp_item_code"):
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

    return _success(
        {
            "franchisee": {
                "name": profile.name,
                "franchise_name": profile.franchise_name,
                "branch_code": profile.branch_code,
                "commission_rate": profile.commission_percentage_rate,
            },
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
            ["name", "branch_code", "franchise_name", "territory_region", "commission_percentage_rate"],
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
def create_razorpay_order(reference_doctype=None, reference_name=None, amount=None, sid=None):
    """Create a Razorpay order for TRF or pharmacy checkout."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if reference_doctype not in ("Customer TRF", "Pharmacy Order", "Doctor Appointment"):
        return _error(_("Invalid reference doctype"))

    if not frappe.db.exists(reference_doctype, reference_name):
        return _error(_("Reference document not found"))

    doc = frappe.get_doc(reference_doctype, reference_name)
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import (
        PAYMENT_METHOD_ONLINE,
        normalize_payment_method,
    )

    payment_method = normalize_payment_method(getattr(doc, "payment_method", None))
    if payment_method != PAYMENT_METHOD_ONLINE:
        return _error(_("This order uses offline payment. Pay at collection or on delivery."))

    order_amount = flt(amount) or flt(getattr(doc, "amount", None) or getattr(doc, "order_total", None))
    if order_amount <= 0:
        return _error(_("Invalid payment amount"))

    amount_paise = int(order_amount * 100)
    receipt = f"{reference_doctype}-{reference_name}"

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
    auth_header = base64.b64encode(f"{key_id}:{key_secret}".encode("utf-8")).decode("ascii")
    payload = json.dumps(
        {
            "amount": amount_paise,
            "currency": "INR",
            "receipt": receipt,
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
        body = exc.read().decode("utf-8", errors="replace")
        frappe.log_error(title="create_razorpay_order", message=body)
        return _error(_("Razorpay order creation failed"))

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
    results = frappe.get_all(
        "Lab Test Result",
        filters={"customer_trf": trf_id},
        fields=[
            "name",
            "analyte_test_name",
            "numeric_result_value",
            "unit_of_measure",
            "reference_range",
            "abnormal_flag",
            "machine_reference",
            "verification_timestamp",
        ],
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
    ]

    hub = franchise_for_phlebotomist()
    if hub and is_phlebotomist(roles) and not is_staff(roles):
        filters = {"franchisee_id": hub, "order_status": ("in", ["Booked", "Sample Collected"])}
    elif is_phlebotomist(roles):
        trf_ids = phlebotomist_trf_ids()
        if not trf_ids:
            return _success({"orders": [], "franchisee": None})
        filters = {"name": ("in", trf_ids), "order_status": ("in", ["Booked", "Sample Collected"])}
    else:
        filters = {"order_status": ("in", ["Booked", "Sample Collected"])}

    trfs = frappe.get_all(
        "Customer TRF",
        filters=filters,
        fields=fields,
        order_by="creation desc",
        limit=limit,
    )

    franchisee = None
    if hub:
        franchisee = frappe.db.get_value(
            "Franchisee Profile",
            hub,
            ["name", "franchise_name", "branch_code", "address", "contact_phone"],
            as_dict=True,
        )

    orders = []
    for row in trfs:
        item = _serialize_trf(row)
        item["barcode"] = row.get("unique_barcode")
        item["collection_address"] = row.get("collection_address")
        orders.append(item)

    return _success({"orders": orders, "franchisee": franchisee})


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
def get_phlebotomist_map_data(sid=None):
    """Phase 20 — hub, collection stops, live phlebo location, OSRM route."""
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
def preview_checkout_price(subtotal=None, context=None, promo_code=None, sid=None):
    """Phase 26 — membership + coupon pricing preview for checkout."""
    subtotal = flt(_parse_request_value("subtotal", subtotal) or 0)
    context = _parse_request_value("context", context) or "lab"
    promo_code = _parse_request_value("promo_code", promo_code)
    if subtotal <= 0:
        return _error(_("Order total must be greater than zero"))
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase26 import preview_checkout

        user = frappe.session.user if _require_mobile_auth(sid) else None
        data = preview_checkout(user, subtotal, context, promo_code)
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
    return _success(get_b2b_wallet_payload(franchisee_id, limit=limit or 30))


@frappe.whitelist(allow_guest=True)
def recharge_b2b_wallet(sid=None, amount=None, payment_reference=None):
    """Phase 23 — credit franchisee wallet (Razorpay hook can gate this later)."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import (
        credit_b2b_wallet,
        resolve_franchisee_for_user,
    )

    amount = _parse_request_value("amount", amount)
    payment_reference = _parse_request_value("payment_reference", payment_reference)
    try:
        amount_f = float(amount)
    except (TypeError, ValueError):
        return _error(_("Valid recharge amount is required"))

    franchisee_id = resolve_franchisee_for_user(frappe.session.user)
    try:
        row = credit_b2b_wallet(
            franchisee_id,
            amount_f,
            payment_reference=payment_reference,
        )
        return _success(row, message=_("Wallet recharged"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def create_b2b_walk_in_order(
    patient_name=None,
    patient_phone=None,
    age=None,
    gender=None,
    item_code=None,
    payment_method=None,
    sid=None,
):
    """Phase 23 — franchisee walk-in lab order (patient pays MRP at hub)."""
    denied = _require_b2b_access(sid)
    if denied:
        return denied

    from health_ecosystem_core.health_ecosystem_core.clinical_phase23 import create_b2b_walk_in_order as _create

    patient_name = _parse_request_value("patient_name", patient_name)
    patient_phone = _parse_request_value("patient_phone", patient_phone)
    age = _parse_request_value("age", age)
    gender = _parse_request_value("gender", gender)
    item_code = _parse_request_value("item_code", item_code)
    payment_method = _parse_request_value("payment_method", payment_method)

    if not all([patient_name, patient_phone, age, gender, item_code]):
        return _error(_("patient_name, patient_phone, age, gender, and item_code are required"))

    try:
        row = _create(
            frappe.session.user,
            patient_name,
            patient_phone,
            age,
            gender,
            item_code,
            payment_method=payment_method,
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
    """Phase 24 — open batches, low-stock alerts, reagent rules."""
    denied = _require_lab_ops_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase24 import get_reagent_dashboard_payload

    return _success(get_reagent_dashboard_payload(frappe.session.user))


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
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import get_sales_portal_payload

    return _success(get_sales_portal_payload(frappe.session.user))


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
        "address", "city", "state", "latitude", "longitude", "status", "notes",
    )}
    if not data.get("lead_name") or not data.get("phone"):
        return _error(_("lead_name and phone are required"))
    try:
        lead_id = _create(frappe.session.user, data)
        return _success({"lead_id": lead_id}, message=_("Lead created"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def log_sales_visit(sid=None, **kwargs):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import log_field_visit

    data = {k: _parse_request_value(k, kwargs.get(k)) for k in (
        "lead_id", "franchisee_id", "visit_date", "visit_time", "latitude", "longitude",
        "purpose", "outcome", "duration_minutes", "notes", "lead_status",
    )}
    try:
        visit_id = log_field_visit(frappe.session.user, data)
        return _success({"visit_id": visit_id}, message=_("Visit logged"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_sales_visits(sid=None, limit=None):
    denied = _require_sales_access(sid)
    if denied:
        return denied
    from health_ecosystem_core.health_ecosystem_core.clinical_phase25 import list_field_visits

    return _success({"visits": list_field_visits(frappe.session.user, limit=limit or 50)})


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

    return _success({"reports": list_closing_reports(frappe.session.user, limit=limit or 30)})


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
    )}
    try:
        report_id = submit_closing_report(frappe.session.user, data)
        return _success({"report_id": report_id}, message=_("Closing report submitted"))
    except frappe.ValidationError as exc:
        return _error(str(exc))


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
def phlebotomist_mark_sample_collected(trf_id=None, sid=None):
    """Phlebotomist confirms sample collection at patient address."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.clinical_iam import (
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

    if is_phlebotomist(roles) and not is_staff(roles):
        if trf_id not in phlebotomist_trf_ids():
            return _error(_("This order is not in your collection queue"), 403)

    current = frappe.db.get_value("Customer TRF", trf_id, "order_status")
    if current != "Booked":
        return _error(_(f"Cannot collect sample — order is already {current}"))

    return _apply_order_status(trf_id, "Sample Collected")


@frappe.whitelist(allow_guest=True)
def mark_offline_payment_collected(
    reference_doctype=None,
    reference_name=None,
    sid=None,
):
    """Record cash/hub payment for COD or Pay at Hub orders."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

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
        elif payment_method == PAYMENT_METHOD_HUB and FRANCHISEE_ROLE in roles:
            hub = frappe.db.get_value(
                "Franchisee Profile",
                {"linked_user": frappe.session.user, "active_status": "Active"},
                "name",
            )
            allowed = hub and hub == franchisee_id
    if not allowed and reference_doctype == "Pharmacy Order" and FRANCHISEE_ROLE in roles:
        allowed = True
    if not allowed and reference_doctype == "Doctor Appointment":
        clinic_roles = {FRANCHISEE_ROLE, "Physician", "Nurse", "Health System Admin"}
        if payment_method == PAYMENT_METHOD_COD and clinic_roles.intersection(roles):
            allowed = True
        elif payment_method == PAYMENT_METHOD_HUB and (FRANCHISEE_ROLE in roles or is_staff(roles)):
            allowed = True
    if not allowed:
        return _error(_("Not permitted to record this payment"), 403)

    amount = flt(getattr(doc, "amount", None) or getattr(doc, "order_total", None))
    payment_id = f"offline-{reference_name}-{frappe.utils.now_datetime().strftime('%Y%m%d%H%M%S')}"

    previous_user = frappe.session.user
    payment_entry = None
    try:
        frappe.set_user("Administrator")
        doc.db_set("razorpay_payment_status", "Paid")
        doc.db_set("payment_id", payment_id)
        try:
            payment_entry = _create_payment_entry(doc, amount, payment_id)
            if reference_doctype == "Customer TRF" and doc.sales_invoice and payment_entry:
                _allocate_payment_to_invoice(payment_entry, doc.sales_invoice, amount)
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
            "status": "Paid",
            "payment_method": payment_method,
        },
        message="Payment recorded",
    )


@frappe.whitelist(allow_guest=True)
def get_phlebotomist_reports(limit=50, sid=None):
    """Authorized NABL PDF reports for samples collected at the phlebotomist's hub."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.clinical_iam import (
        is_phlebotomist,
        is_staff,
        phlebotomist_trf_ids,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_utils import journey_report_payload

    roles = _user_roles()
    if not is_phlebotomist(roles) and not is_staff(roles):
        return _error(_("Not permitted"), 403)

    limit = cint(limit) or 50
    trf_ids = phlebotomist_trf_ids()
    if not trf_ids:
        return _success({"reports": []})

    journeys = frappe.get_all(
        "Patient Care Journey",
        filters={
            "customer_trf": ("in", trf_ids),
            "status": ("in", ["Authorized", "Dispatched"]),
            "report_pdf": ("is", "set"),
        },
        fields=["name"],
        order_by="modified desc",
        limit=limit,
    )

    reports = []
    for row in journeys:
        payload = journey_report_payload(row.name)
        trf_id = payload.get("trf_id")
        trf_row = frappe.db.get_value(
            "Customer TRF",
            trf_id,
            ["test_required", "patient_phone"],
            as_dict=True,
        ) if trf_id else None
        item = _serialize_trf({"name": trf_id, **(trf_row or {})}) if trf_id else {}
        reports.append(
            {
                "journey_id": payload.get("journey_id"),
                "trf_id": trf_id,
                "patient_name": payload.get("patient_name"),
                "patient_phone": trf_row.get("patient_phone") if trf_row else None,
                "status": payload.get("status"),
                "report_pdf": payload.get("report_pdf"),
                "authorized_on": payload.get("authorized_on"),
                "test_name": item.get("test_name"),
                "test_labels": item.get("test_labels"),
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
    if not journey.report_pdf:
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

    file_doc = _resolve_file_doc(journey.report_pdf)
    if not file_doc:
        frappe.throw(_("Report file not found on server"))

    frappe.local.response.filename = file_doc.file_name
    frappe.local.response.filecontent = file_doc.get_content()
    frappe.local.response.type = "download"
    frappe.local.response["content_type"] = "application/pdf"


@frappe.whitelist()
def upload_prescription(file_name=None, file_data=None):
    """Upload prescription image from mobile app and return a public file URL."""
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
            "is_private": 0,
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
        },
        message="Pharmacy order created",
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
        company = frappe.defaults.get_global_default("company") or frappe.get_all(
            "Company", limit=1
        )[0].name
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
    mrp = flt(frappe.db.get_value("Item", item_code, "standard_rate"))
    item["rate"] = rate
    item["standard_rate"] = rate
    item["mrp"] = mrp if mrp > rate else None
    item["discount_percent"] = round((1 - rate / mrp) * 100) if mrp and mrp > rate else 0
    item["description"] = _strip_catalog_description(item.get("description"))
    if _is_lab_item_group(item.get("item_group")):
        item.update(_public_lab_item_profile(item_code))
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
        ],
        order_by="franchise_name asc",
        limit=limit,
    )

    return _success({"franchisees": franchisees})


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


# Re-export guest wellness / insurance handlers so main api module path works
from health_ecosystem_core.health_ecosystem_core.clinical_phase31_allied_health import (  # noqa: E402
    book_allied_health_appointment,
    get_allied_health_service,
    get_allied_health_services,
    get_allied_health_wings,
)
from health_ecosystem_core.health_ecosystem_core.clinical_phase44_insurance import (  # noqa: E402
    get_insurance_landing,
    get_my_insurance_requests,
    submit_insurance_quote_request,
)
from health_ecosystem_core.health_ecosystem_core.clinical_phase32_pharmacy_quote import (  # noqa: E402
    accept_pharmacy_quote,
    list_pharmacy_quote_queue,
    send_pharmacy_quote,
)
from health_ecosystem_core.health_ecosystem_core.clinical_phase18b import (  # noqa: E402
    complete_oauth_login,
)


# Phase 65 ??? Exotel masked click-to-call
from health_ecosystem_core.health_ecosystem_core.clinical_phase65_number_masking import (  # noqa: E402
    get_masked_call_context,
    start_masked_call,
)
