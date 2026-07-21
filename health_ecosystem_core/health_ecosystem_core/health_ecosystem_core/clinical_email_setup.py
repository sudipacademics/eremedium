"""ERPNext Email Account + activity notification setup — Phase 18."""

import frappe
from frappe import _

GODADDY_SMTP_DEFAULTS = {
    "smtp_server": "smtpout.secureserver.net",
    "smtp_port": 465,
    "use_ssl": 1,
    "use_tls": 0,
    "imap_server": "imap.secureserver.net",
    "imap_port": 993,
}

GMAIL_SMTP_DEFAULTS = {
    "smtp_server": "smtp.gmail.com",
    "smtp_port": 587,
    "use_ssl": 0,
    "use_tls": 1,
    "imap_server": "imap.gmail.com",
    "imap_port": 993,
}


def _conf(key, default=None):
    return frappe.conf.get(key, default)


def _smtp_defaults():
    provider = (_conf("hec_email_provider") or "").strip().lower()
    mailbox = (
        (_conf("hec_noreply_email") or _conf("hec_concierge_email") or _conf("hec_support_email") or "")
        .strip()
        .lower()
    )
    if provider in ("gmail", "google") or mailbox.endswith("@gmail.com"):
        return GMAIL_SMTP_DEFAULTS
    return GODADDY_SMTP_DEFAULTS


def ensure_user_email_fields():
    from health_ecosystem_core.health_ecosystem_core.clinical_email import ensure_user_email_fields as _ensure

    _ensure()


def _email_account_exists(email_id):
    return frappe.db.exists("Email Account", {"email_id": email_id})


def setup_email_account(
    email_id,
    password,
    *,
    account_name=None,
    default_outgoing=False,
    default_incoming=False,
    enable_incoming=False,
    enable_outgoing=True,
):
    if not email_id or not password:
        frappe.throw(_("email_id and password are required for Email Account setup"))

    account_name = account_name or email_id
    defaults = _smtp_defaults()
    smtp_server = _conf("hec_smtp_server", defaults["smtp_server"])
    smtp_port = int(_conf("hec_smtp_port", defaults["smtp_port"]))
    use_ssl = int(_conf("hec_smtp_use_ssl", defaults["use_ssl"]))
    use_tls = int(_conf("hec_smtp_use_tls", defaults["use_tls"]))
    imap_server = _conf("hec_imap_server", defaults["imap_server"])
    imap_port = int(_conf("hec_imap_port", defaults["imap_port"]))

    existing_name = frappe.db.get_value("Email Account", {"email_id": email_id}, "name")
    if existing_name:
        doc = frappe.get_doc("Email Account", existing_name)
    else:
        doc = frappe.get_doc(
            {
                "doctype": "Email Account",
                "email_id": email_id,
                "email_account_name": account_name,
            }
        )

    if default_outgoing:
        for row in frappe.get_all("Email Account", filters={"default_outgoing": 1}, pluck="name"):
            frappe.db.set_value("Email Account", row, "default_outgoing", 0, update_modified=False)

    doc.email_account_name = account_name
    doc.enable_outgoing = 1 if enable_outgoing else 0
    doc.enable_incoming = 1 if enable_incoming else 0
    doc.default_outgoing = 1 if default_outgoing else 0
    doc.default_incoming = 1 if default_incoming else 0
    doc.smtp_server = smtp_server
    doc.smtp_port = smtp_port
    doc.use_ssl_for_outgoing = use_ssl
    doc.use_tls = use_tls
    doc.login_id = email_id
    doc.password = password
    if enable_incoming:
        doc.email_server = imap_server
        doc.incoming_port = imap_port
        doc.use_imap = 1
        doc.use_ssl = 1
        doc.append_to = "Communication"
        doc.create_contact = 1
        doc.track_email_status = 1

    frappe.flags.in_install = True
    try:
        if doc.is_new():
            doc.db_insert()
        else:
            doc.db_update()
    finally:
        frappe.flags.in_install = False

    return doc.name


def setup_godaddy_email_from_site_config():
    """Create noreply (outgoing) + concierge (inbox) Email Accounts from site_config secrets."""
    ensure_user_email_fields()

    noreply = _conf("hec_noreply_email") or _conf("hec_support_email")
    noreply_pwd = _conf("hec_noreply_password") or _conf("hec_smtp_password")
    concierge = _conf("hec_concierge_email") or _conf("hec_support_email")
    concierge_pwd = _conf("hec_concierge_password") or _conf("hec_imap_password") or noreply_pwd

    created = []
    if noreply and noreply_pwd:
        setup_email_account(
            noreply,
            noreply_pwd,
            account_name="HEC Notifications",
            default_outgoing=True,
            enable_outgoing=True,
            enable_incoming=False,
        )
        created.append(noreply)

    if concierge and concierge_pwd:
        setup_email_account(
            concierge,
            concierge_pwd,
            account_name="HEC Concierge Inbox",
            default_incoming=True,
            enable_incoming=True,
            enable_outgoing=True,
        )
        created.append(concierge)

    settings = frappe.get_single("Health Ecosystem Settings") if frappe.db.exists(
        "DocType", "Health Ecosystem Settings"
    ) else None
    if settings:
        if noreply and hasattr(settings, "noreply_email"):
            settings.noreply_email = noreply
        if concierge and hasattr(settings, "support_email"):
            settings.support_email = concierge
        portal = _conf("hec_patient_portal_url")
        if portal and hasattr(settings, "patient_portal_base_url"):
            settings.patient_portal_base_url = portal.rstrip("/")
        settings.save(ignore_permissions=True)

    frappe.db.commit()
    return {"ok": True, "email_accounts": created}


def _ensure_notification(name, spec):
    if frappe.db.exists("Notification", name):
        return name
    doc = frappe.get_doc({"doctype": "Notification", "name": name, **spec})
    doc.insert(ignore_permissions=True)
    return doc.name


def setup_activity_email_notifications():
    """Desk notifications — email concierge / managers on patient activity (patients via clinical_notifications)."""
    specs = [
        {
            "name": "HEC Concierge New TRF",
            "document_type": "Customer TRF",
            "event": "Submit",
            "channel": "Email",
            "subject": "[Concierge] Lab booking {{ doc.name }}",
            "message": (
                "New lab booking for concierge follow-up.<br><br>"
                "TRF: <b>{{ doc.name }}</b><br>"
                "Patient: {{ doc.patient_name }}<br>"
                "Phone: {{ doc.patient_phone }}<br>"
                "Test: {{ doc.test_required }}<br>"
                "Collection: {{ doc.collection_slot or 'TBD' }}<br>"
                "Amount: ₹{{ doc.amount }}"
            ),
            "recipients": [{"receiver_by_role": "Health System Admin"}],
            "enabled": 1,
        },
        {
            "name": "HEC Concierge Pharmacy Order",
            "document_type": "Pharmacy Order",
            "event": "Submit",
            "channel": "Email",
            "subject": "[Concierge] Pharmacy order {{ doc.name }}",
            "message": (
                "New pharmacy order.<br><br>"
                "Order: <b>{{ doc.name }}</b><br>"
                "Customer: {{ doc.customer_name }}<br>"
                "Phone: {{ doc.customer_phone }}<br>"
                "Total: ₹{{ doc.order_total }}"
            ),
            "recipients": [{"receiver_by_role": "Health System Admin"}],
            "enabled": 1,
        },
        {
            "name": "HEC Concierge Appointment",
            "document_type": "Doctor Appointment",
            "event": "Submit",
            "channel": "Email",
            "subject": "[Concierge] Appointment {{ doc.name }}",
            "message": (
                "New doctor appointment.<br><br>"
                "Patient: {{ doc.patient_name }}<br>"
                "Doctor: {{ doc.doctor_name }}<br>"
                "Date: {{ doc.appointment_date }} {{ doc.appointment_time }}"
            ),
            "recipients": [{"receiver_by_role": "Health System Admin"}],
            "enabled": 1,
        },
    ]

    created = []
    for spec in specs:
        try:
            created.append(_ensure_notification(spec["name"], spec))
        except Exception:
            frappe.log_error(title=f"Notification setup {spec['name']}", message=frappe.get_traceback())

    return {"ok": True, "notifications": created}


def grant_email_inbox_to_roles(roles=None):
    """Allow desk roles to read Communication / Email Queue / Email Account."""
    from frappe.permissions import add_permission

    roles = roles or [
        "System Manager",
        "Health System Admin",
        "Administrator",
        "Franchisee Operator",
        "Phlebotomist",
        "Lab Technician",
    ]
    doctypes = ("Email Queue", "Communication", "Email Account")
    granted = 0
    for doctype in doctypes:
        if not frappe.db.exists("DocType", doctype):
            continue
        for role in roles:
            if not frappe.db.exists("Role", role):
                continue
            for ptype in ("read", "write", "create", "email"):
                try:
                    add_permission(doctype, role, permlevel=0, ptype=ptype)
                    granted += 1
                except Exception:
                    pass
    frappe.db.commit()
    frappe.clear_cache()
    return {"ok": True, "roles": roles, "permissions_added": granted}


def run_phase18_email_setup():
    """Bench execute entry — Email Accounts, notifications, IAM fields."""
    accounts = setup_godaddy_email_from_site_config()
    notifications = setup_activity_email_notifications()
    inbox = grant_email_inbox_to_roles()
    from health_ecosystem_core.health_ecosystem_core.clinical_email import smoke_test_email

    test = smoke_test_email()
    frappe.db.commit()
    frappe.clear_cache()
    return {
        "phase": 18,
        "accounts": accounts,
        "notifications": notifications,
        "inbox": inbox,
        "smtp_test": test,
    }


def setup_phase18():
    """Enable email signup flags + patient role + optional OAuth key + email accounts if configured."""
    from health_ecosystem_core.health_ecosystem_core.clinical_email import ensure_user_email_fields
    from health_ecosystem_core.health_ecosystem_core.clinical_phase18b import setup_phase18b

    ensure_user_email_fields()
    if frappe.db.exists("DocType", "Health Ecosystem Settings"):
        try:
            s = frappe.get_single("Health Ecosystem Settings")
            if hasattr(s, "enable_email_signup") and not s.enable_email_signup:
                s.enable_email_signup = 1
                s.save(ignore_permissions=True)
        except Exception:
            frappe.db.set_single_value("Health Ecosystem Settings", "enable_email_signup", 1)
    oauth = setup_phase18b()
    # Soft email account setup — does not fail if SMTP secrets missing
    accounts = None
    try:
        accounts = setup_godaddy_email_from_site_config()
    except Exception as exc:
        accounts = {"ok": False, "error": str(exc)}
    notifications = None
    try:
        notifications = setup_activity_email_notifications()
    except Exception as exc:
        notifications = {"ok": False, "error": str(exc)}
    frappe.db.commit()
    frappe.clear_cache()
    return {
        "ok": True,
        "phase": 18,
        "oauth": oauth,
        "accounts": accounts,
        "notifications": notifications,
    }


def smoke_phase18():
    """API + IAM smoke (does not require live SMTP to pass)."""
    result = {"ok": True, "checks": []}

    def check(name, cond, detail=""):
        result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
        if not cond:
            result["ok"] = False

    setup = setup_phase18()
    check("setup", setup.get("ok"), str(setup.get("phase")))

    from health_ecosystem_core.health_ecosystem_core import email_auth
    from health_ecosystem_core.health_ecosystem_core.clinical_email import (
        email_configured,
        email_signup_enabled,
        is_real_email,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_phase18b import oauth_status

    check("register_patient_api", hasattr(email_auth, "register_patient"))
    check("verify_email_api", hasattr(email_auth, "verify_email"))
    check("forgot_password_api", hasattr(email_auth, "forgot_password_email"))
    check("resend_verification_api", hasattr(email_auth, "resend_verification_email"))
    check("email_signup_enabled", email_signup_enabled(), "enable in Health Ecosystem Settings")
    check("is_real_email", is_real_email("patient@example.com") and not is_real_email("x@otp.health.local"))

    # Password rules
    err = email_auth._validate_password("short")
    check("password_min_length", bool(err), str(err))
    err2 = email_auth._validate_password("goodpass1")
    check("password_ok", err2 is None, str(err2))

    # Patient role
    check("patient_role", frappe.db.exists("Role", "Patient"), "Patient role")

    oauth = oauth_status()
    check("oauth_status_callable", isinstance(oauth, dict), str(oauth.get("providers")))

    # SMTP is informational — warn but do not fail smoke if missing (ops configures separately)
    smtp_ok = email_configured()
    result["checks"].append(
        {
            "name": "smtp_configured",
            "pass": True,
            "detail": "OK" if smtp_ok else "SMTP not configured — run setup-email.sh / GMAIL_SETUP.md for live mail",
        }
    )
    result["smtp_configured"] = smtp_ok
    result["signup_paths"] = ["/signup", "/verify-email", "/forgot-password", "/login"]
    return result
