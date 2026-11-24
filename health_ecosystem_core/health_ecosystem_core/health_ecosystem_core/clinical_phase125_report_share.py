"""Phase 125 — Authorized report generation, template download, and secure WhatsApp share.

Technician actions activate only after testing, verification, authorization
(and optional dispatch). PDFs are generated from live authorized data.
WhatsApp carries a Patient Portal login link — never a public report file.
"""

from __future__ import annotations

import os
import re

import frappe
from frappe import _
from frappe.utils import cint, cstr, now_datetime

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)

CHROME_TEMPLATES = {
    "with_header": {
        "label": "With Header",
        "chrome_mode": "with_header",
        "brand": "remedium",
        "format": "with_header",
    },
    "without_header": {
        "label": "Without Header",
        "chrome_mode": "without_header",
        "brand": "remedium",
        "format": "without_header",
    },
    "nabl": {"label": "With Header (NABL pad)", "chrome_mode": "nabl", "brand": "remedium", "format": "with_header"},
    "non_nabl": {
        "label": "With Header (Non-NABL pad)",
        "chrome_mode": "non_nabl",
        "brand": "remedium",
        "format": "non_nabl",
    },
    "none": {
        "label": "Without Header",
        "chrome_mode": "none",
        "brand": "remedium",
        "format": "without_header",
    },
    "remedium_with_header": {
        "label": "Remedium Lab · With Header & Footer",
        "chrome_mode": "remedium_with_header",
        "brand": "remedium",
        "format": "with_header",
    },
    "remedium_without_header": {
        "label": "Remedium Lab · Without Header & Footer",
        "chrome_mode": "remedium_without_header",
        "brand": "remedium",
        "format": "without_header",
    },
    "slpl_with_header": {
        "label": "SLPL Lab · With Header & Footer",
        "chrome_mode": "slpl_with_header",
        "brand": "slpl",
        "format": "with_header",
    },
    "slpl_non_nabl": {
        "label": "SLPL Lab · With Non-NABL Header",
        "chrome_mode": "slpl_non_nabl",
        "brand": "slpl",
        "format": "non_nabl",
    },
    "slpl_without_header": {
        "label": "SLPL Lab · Without Header & Footer",
        "chrome_mode": "slpl_without_header",
        "brand": "slpl",
        "format": "without_header",
    },
}

DEFAULT_PATIENT_PORTAL = "https://www.remediumlabs.in"

ASSET_FILES = (
    ("nabl-header.png", "nabl_header_banner", "remedium-nabl-header.png"),
    ("non-nabl-header.png", "non_nabl_header_banner", "remedium-non-nabl-header.png"),
    ("report-footer.png", "footer_banner", "remedium-report-footer.png"),
)


def normalize_chrome_mode(value=None):
    from health_ecosystem_core.health_ecosystem_core.clinical_report_format import (
        normalize_report_chrome_mode,
    )

    return normalize_report_chrome_mode(value, 0)


def patient_portal_origin():
    for source in (
        lambda: frappe.conf.get("hec_patient_portal_url"),
        lambda: frappe.db.get_single_value("Health Ecosystem Settings", "hec_patient_portal_url")
        if frappe.db.exists("DocType", "Health Ecosystem Settings")
        else None,
    ):
        try:
            val = cstr(source() or "").strip().rstrip("/")
        except Exception:
            val = ""
        if val.startswith("http"):
            host = val.split("/")[2].lower() if "://" in val else ""
            if host.startswith("labtech.") or host.startswith("collect.") or host.startswith("partners."):
                continue
            return val
    return DEFAULT_PATIENT_PORTAL


def patient_portal_reports_url():
    return f"{patient_portal_origin()}/reports"


def _digits(value):
    return re.sub(r"\D", "", cstr(value or ""))


def _is_share_staff(roles=None):
    from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_phlebotomist, is_staff

    roles = roles if roles is not None else _user_roles()
    return is_staff(roles) or is_phlebotomist(roles)


def _load_journey(journey_id):
    if not journey_id or not frappe.db.exists("Patient Care Journey", journey_id):
        return None
    return frappe.db.get_value(
        "Patient Care Journey",
        journey_id,
        ["name", "patient", "patient_name", "customer_trf", "status", "report_pdf", "authorized_on"],
        as_dict=True,
    )


def _lab_report_for_trf(trf_id):
    if not trf_id or not frappe.db.exists("DocType", "Lab Report"):
        return None
    return frappe.db.get_value("Lab Report", {"customer_trf": trf_id}, "name")


def assert_report_share_ready(journey):
    """Gate: testing + verification + authorization must already be complete."""
    if not journey:
        frappe.throw(_("Journey not found"), frappe.DoesNotExistError)
    if journey.status not in ("Authorized", "Dispatched"):
        frappe.throw(_("Report must be authorized before it can be generated or sent"), frappe.PermissionError)
    trf_id = journey.customer_trf
    if trf_id and frappe.db.exists("DocType", "Lab Report"):
        lab_status = frappe.db.get_value("Lab Report", {"customer_trf": trf_id}, "report_status")
        if lab_status and lab_status not in ("Authorized", "Printed"):
            frappe.throw(
                _("Lab report is still {0}. Complete verification and authorization first.").format(lab_status),
                frappe.PermissionError,
            )
    return True


def _patient_owns_journey(journey):
    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

    profile = patient_profile_for_user() or {}
    patient_id = profile.get("patient_id")
    if patient_id and journey.patient and patient_id == journey.patient:
        return True
    if patient_id and journey.customer_trf:
        trf_patient = frappe.db.get_value("Customer TRF", journey.customer_trf, "patient")
        if trf_patient and trf_patient == patient_id:
            return True
    user_mobile = frappe.db.get_value("User", frappe.session.user, "mobile_no")
    digits = _digits(user_mobile)[-10:]
    if digits and journey.customer_trf and frappe.db.exists("Customer TRF", journey.customer_trf):
        fields = []
        try:
            meta = frappe.get_meta("Customer TRF")
            fields = [f for f in ("patient_phone", "mobile", "phone", "customer_phone") if meta.has_field(f)]
        except Exception:
            fields = ["patient_phone"]
        if fields:
            trf = frappe.db.get_value(
                "Customer TRF",
                journey.customer_trf,
                fields,
                as_dict=True,
            )
            if trf:
                for field in fields:
                    if _digits(trf.get(field))[-10:] == digits:
                        return True
    return False


def _can_share_report(journey, *, staff_only=False):
    roles = _user_roles()
    if _is_share_staff(roles):
        return True
    if staff_only:
        return False
    return _patient_owns_journey(journey)


def _audit(journey_id, message, lab_report=None):
    from health_ecosystem_core.health_ecosystem_core.clinical_journey import _log_journey_activity

    _log_journey_activity(journey_id, message)
    if lab_report and frappe.db.exists("Lab Report", lab_report):
        try:
            frappe.get_doc(
                {
                    "doctype": "Comment",
                    "comment_type": "Info",
                    "reference_doctype": "Lab Report",
                    "reference_name": lab_report,
                    "content": message,
                }
            ).insert(ignore_permissions=True)
        except Exception:
            frappe.log_error(title="phase125_lab_report_audit", message=frappe.get_traceback())


def build_authorized_report_pdf(journey_id, chrome_mode="nabl"):
    """Render a fresh PDF from authorized patient/test data and the selected chrome.

    With Header: Page Management letterhead (Remedium with_header = NABL pad,
    Remedium non_nabl = Non-NABL pad) chosen from Test Master ``is_nabl``.
    Without Header: blank bands for pre-printed paper.
    """

    from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import render_branded_lab_report_html
    from health_ecosystem_core.health_ecosystem_core.clinical_phase8 import (
        _existing_lab_report,
        journey_pdf_payload,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_report_format import (
        html_to_lab_report_pdf,
        render_remedium_lab_report_html,
        resolve_remedium_report_chrome,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_report_page_layout import (
        parse_chrome_to_layout,
    )

    payload = journey_pdf_payload(journey_id)
    lab_report = None
    trf_id = payload.get("trf_id")
    if trf_id:
        lab_report = _existing_lab_report(trf_id)
    mode = resolve_remedium_report_chrome(
        requested=chrome_mode,
        lab_report=lab_report,
        payload=payload.get("nabl_report") or payload,
    )
    # HTML body chrome only understands classic modes; PDF uses Page Management layouts.
    html_mode = mode
    if mode.endswith("_without_header") or mode == "none":
        html_mode = "remedium_without_header"
    elif mode == "non_nabl" or mode.endswith("_non_nabl"):
        html_mode = "non_nabl"
    elif mode in ("nabl", "with_header") or mode.endswith("_with_header"):
        html_mode = "nabl"
    letterhead_plain = 1 if html_mode.endswith("_without_header") or html_mode == "none" else 0
    if payload.get("nabl_report"):
        html = render_remedium_lab_report_html(
            payload["nabl_report"],
            letterhead_plain=letterhead_plain,
            chrome_mode=html_mode,
            for_pdf=1,
        )
    else:
        html = render_branded_lab_report_html(payload, chrome_mode=html_mode)
    if not html:
        frappe.throw(_("Could not generate report HTML"))
    brand = "slpl" if str(mode).startswith("slpl") else "remedium"
    # Always stamp from Report Page Management for the resolved chrome (NABL / Non-NABL / blank).
    page_layout = parse_chrome_to_layout(mode, brand=brand)
    pdf_content = html_to_lab_report_pdf(
        html, chrome_mode=mode, page_layout=page_layout, brand=brand
    )
    if not pdf_content:
        frappe.throw(_("PDF generation returned empty output"))
    if mode == "non_nabl":
        label = "With Header · Non-NABL pad (Test Master)"
    elif mode == "nabl":
        label = "With Header · NABL pad (Test Master)"
    else:
        label = CHROME_TEMPLATES.get(mode, {}).get("label") or mode
    fname = f"Lab_Report_{journey_id}_{mode}.pdf"
    return pdf_content, fname, mode, label


def _save_private_generation(journey_id, pdf_content, fname, mode):
    file_doc = frappe.get_doc(
        {
            "doctype": "File",
            "file_name": fname,
            "content": pdf_content,
            "is_private": 1,
            "attached_to_doctype": "Patient Care Journey",
            "attached_to_name": journey_id,
            "folder": "Home/Attachments",
        }
    )
    file_doc.insert(ignore_permissions=True)
    return file_doc


def _resolve_patient_phone(journey):
    from health_ecosystem_core.health_ecosystem_core.clinical_notifications import (
        _resolve_patient_phone as resolve_trf_phone,
    )

    return resolve_trf_phone(trf_id=journey.customer_trf, patient=journey.patient)


@frappe.whitelist(allow_guest=True)
def download_authorized_report_pdf(journey_id=None, template=None, chrome_mode=None, sid=None):
    """Staff or matching patient: stream a dynamically generated private PDF."""
    frappe.flags.ignore_csrf = True
    if not _require_mobile_auth(sid):
        frappe.throw(_("Not authenticated"), frappe.AuthenticationError)

    journey_id = _parse_request_value("journey_id", journey_id)
    # Operator picks only with/without header. NABL vs Non-NABL pad is resolved
    # from Test Master inside build_authorized_report_pdf → resolve_remedium_report_chrome.
    requested = normalize_chrome_mode(
        _parse_request_value("template", template) or chrome_mode or "with_header"
    )
    if requested in ("none", "plain", "without_header", "no_header", "without_header_footer", "headerless"):
        mode = "remedium_without_header"
    elif requested.endswith("_without_header"):
        mode = "remedium_without_header"
    elif requested in (
        "with_header",
        "nabl",
        "non_nabl",
        "remedium_non_nabl",
        "with_nabl",
        "remedium_with_header",
        "slpl_with_header",
        "slpl_non_nabl",
    ) or requested.endswith("_with_header") or requested.endswith("_non_nabl"):
        mode = "with_header"
    else:
        mode = "with_header"
    journey = _load_journey(journey_id)
    if not journey:
        frappe.throw(_("Journey not found"), frappe.DoesNotExistError)
    assert_report_share_ready(journey)
    if not _can_share_report(journey, staff_only=False):
        frappe.throw(_("Not permitted to download this report"), frappe.PermissionError)

    try:
        pdf_content, fname, mode, label = build_authorized_report_pdf(journey.name, chrome_mode=mode)
    except Exception:
        frappe.log_error(title="phase125_pdf_generate", message=frappe.get_traceback())
        frappe.throw(_("PDF generation failed. Please retry."))

    lab_report = _lab_report_for_trf(journey.customer_trf)
    actor = frappe.session.user
    _audit(
        journey.name,
        (
            f"[report_share] action=download status=success template={mode} ({label}) "
            f"user={actor} ts={now_datetime()}"
        ),
        lab_report=lab_report,
    )
    try:
        _save_private_generation(journey.name, pdf_content, fname, mode)
        frappe.db.commit()
    except Exception:
        frappe.log_error(title="phase125_pdf_store", message=frappe.get_traceback())

    frappe.local.response.filename = fname
    frappe.local.response.filecontent = pdf_content
    frappe.local.response.type = "download"
    frappe.local.response["content_type"] = "application/pdf"


@frappe.whitelist()
def send_authorized_report_whatsapp(journey_id=None):
    """Create/activate Patient Portal if needed and send a secure Reports link on WhatsApp."""
    if frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)
    if not _is_share_staff():
        return _error(_("Not authorized to send reports"), 403)

    journey_id = _parse_request_value("journey_id", journey_id)
    journey = _load_journey(journey_id)
    if not journey:
        return _error(_("Journey not found"), 404)
    try:
        assert_report_share_ready(journey)
    except Exception as exc:
        return _error(cstr(exc) or _("Report is not ready to send"), 400)

    try:
        phone = _resolve_patient_phone(journey)
    except Exception:
        frappe.log_error(title="phase125_resolve_phone", message=frappe.get_traceback())
        return _error(_("Could not read the patient’s mobile number. Please retry."), 500)

    from health_ecosystem_core.health_ecosystem_core.clinical_otp import (
        ensure_patient_user_for_mobile,
        normalize_mobile,
    )

    mobile_norm = normalize_mobile(phone)
    if not phone:
        return _error(
            _("No registered mobile number on this booking. Add a 10-digit mobile on the TRF and retry."),
            400,
        )
    if not mobile_norm:
        return _error(
            _("The mobile number on this booking is invalid. Update it to a 10-digit Indian mobile (starting 6–9) and retry."),
            400,
        )
    phone = mobile_norm

    portal_user = None
    portal_created = False
    try:
        otp_email = f"p{phone}@otp.health.local"
        existed = bool(frappe.db.exists("User", otp_email))
        portal_user = ensure_patient_user_for_mobile(phone)
        if not portal_user:
            return _error(_("Could not create or activate the Patient Portal account. Please retry."), 500)
        portal_created = bool(portal_user) and not existed
        trf_patient = None
        if journey.customer_trf and frappe.db.exists("Customer TRF", journey.customer_trf):
            try:
                trf_patient = frappe.db.get_value("Customer TRF", journey.customer_trf, "patient")
            except Exception:
                trf_patient = None
        if trf_patient and portal_user:
            try:
                if frappe.get_meta("Health Patient").has_field("linked_user"):
                    linked = frappe.db.get_value("Health Patient", trf_patient, "linked_user")
                    if not linked:
                        frappe.db.set_value("Health Patient", trf_patient, "linked_user", portal_user)
            except Exception:
                pass
            if not journey.patient:
                frappe.db.set_value("Patient Care Journey", journey.name, "patient", trf_patient)
        if portal_user and journey.patient_name:
            try:
                user_doc = frappe.get_doc("User", portal_user)
                if (user_doc.first_name or "").startswith("Patient") and journey.patient_name:
                    user_doc.first_name = cstr(journey.patient_name)[:60]
                    user_doc.save(ignore_permissions=True)
            except Exception:
                pass
    except Exception:
        frappe.log_error(title="phase125_ensure_patient", message=frappe.get_traceback())
        return _error(_("Could not create or activate the Patient Portal account. Please retry."), 500)

    portal_url = patient_portal_reports_url()
    patient_name = cstr(journey.patient_name or "Patient")
    trf_id = cstr(journey.customer_trf or journey.name)
    message = (
        f"Remedium Labs: Hello {patient_name}, your lab report for {trf_id} is authorized. "
        f"Sign in with your registered mobile number at {portal_url} to view it in Reports. "
        "Do not share this login. The report is not sent as a public file."
    )

    sent = False
    provider_id = ""
    not_configured = False
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import (
            send_whatsapp,
            whatsapp_delivery_ready,
        )

        if not whatsapp_delivery_ready():
            not_configured = True
        else:
            result = send_whatsapp(
                phone,
                message,
                context={
                    "persist": True,
                    "contact_name": patient_name,
                    "journey": journey.name,
                    "trf": trf_id,
                },
            )
            sent = bool(result)
            provider_id = cstr(result) if result and result is not True else ""
            try:
                frappe.clear_messages()
            except Exception:
                pass
    except Exception:
        frappe.log_error(title="phase125_whatsapp_send", message=frappe.get_traceback())
        sent = False

    lab_report = _lab_report_for_trf(journey.customer_trf)
    status = "sent" if sent else "failed"
    _audit(
        journey.name,
        (
            f"[report_share] action=whatsapp status={status} template=portal_link "
            f"recipient={phone} portal_user={portal_user or ''} created={int(portal_created)} "
            f"user={frappe.session.user} ts={now_datetime()}"
            + (f" provider_id={provider_id}" if provider_id else "")
        ),
        lab_report=lab_report,
    )
    frappe.db.commit()
    payload = {
        "journey_id": journey.name,
        "trf_id": trf_id,
        "recipient": phone,
        "portal_url": portal_url,
        "portal_user": portal_user,
        "portal_account_created": bool(portal_created),
        "delivery_status": status,
        "sent": sent,
        "retry": not sent,
    }
    if sent:
        created_msg = (
            _(" Patient Portal account created.")
            if portal_created
            else _(" Existing Patient Portal account will be used.")
        )
        return _success(payload, message=_("Report notification sent on WhatsApp.") + created_msg)
    if not_configured:
        fail_msg = _("WhatsApp is not configured. Ask an administrator to set the provider, then retry.")
    else:
        fail_msg = _("WhatsApp could not deliver this message. Confirm the number is on WhatsApp, then retry.")
    err = _error(fail_msg, 502)
    err["data"] = payload
    return err


@frappe.whitelist(allow_guest=True)
def get_my_authorized_reports(limit=50, sid=None):
    """Patient Portal → Reports: authorized journeys for the logged-in mobile user."""
    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.patient_bridge import patient_profile_for_user

    limit = min(cint(limit) or 50, 200)
    profile = patient_profile_for_user() or {}
    patient_id = profile.get("patient_id")
    mobile = frappe.db.get_value("User", frappe.session.user, "mobile_no")
    digits = _digits(mobile)[-10:]

    names = set()
    if patient_id:
        for row in frappe.get_all(
            "Patient Care Journey",
            filters={"patient": patient_id, "status": ("in", ["Authorized", "Dispatched"])},
            pluck="name",
            limit=limit,
        ):
            names.add(row)
        if frappe.db.exists("DocType", "Customer TRF"):
            for trf in frappe.get_all("Customer TRF", filters={"patient": patient_id}, pluck="name", limit=limit):
                for jn in frappe.get_all(
                    "Patient Care Journey",
                    filters={"customer_trf": trf, "status": ("in", ["Authorized", "Dispatched"])},
                    pluck="name",
                    limit=20,
                ):
                    names.add(jn)

    if digits:
        trf_ids = []
        phone_fields = []
        try:
            meta = frappe.get_meta("Customer TRF")
            phone_fields = [f for f in ("patient_phone", "mobile", "phone", "customer_phone") if meta.has_field(f)]
        except Exception:
            phone_fields = ["patient_phone"]
        for field in phone_fields:
            try:
                trf_ids.extend(
                    frappe.get_all(
                        "Customer TRF",
                        filters={field: ("like", f"%{digits}")},
                        pluck="name",
                        limit=limit,
                    )
                )
            except Exception:
                pass
        for trf in set(trf_ids):
            for jn in frappe.get_all(
                "Patient Care Journey",
                filters={"customer_trf": trf, "status": ("in", ["Authorized", "Dispatched"])},
                pluck="name",
                limit=20,
            ):
                names.add(jn)

    reports = []
    if names:
        rows = frappe.get_all(
            "Patient Care Journey",
            filters={"name": ("in", list(names)), "status": ("in", ["Authorized", "Dispatched"])},
            fields=["name", "patient_name", "customer_trf", "status", "authorized_on", "modified"],
            order_by="modified desc",
            limit=limit,
        )
        for row in rows:
            tests = ""
            lab_report = None
            report_status = None
            if row.customer_trf:
                tests = cstr(frappe.db.get_value("Customer TRF", row.customer_trf, "test_required") or "")
                lab_report = _lab_report_for_trf(row.customer_trf)
                if lab_report:
                    report_status = frappe.db.get_value("Lab Report", lab_report, "report_status")
            reports.append(
                {
                    "journey_id": row.name,
                    "trf_id": row.customer_trf,
                    "patient_name": row.patient_name,
                    "status": row.status,
                    "authorized_on": str(row.authorized_on) if row.authorized_on else None,
                    "modified": str(row.modified) if row.modified else None,
                    "tests": tests,
                    "lab_report": lab_report,
                    "report_status": report_status,
                }
            )

    return _success({"reports": reports, "count": len(reports)})


@frappe.whitelist()
def get_report_share_status(journey_id=None):
    if frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)
    journey_id = _parse_request_value("journey_id", journey_id)
    journey = _load_journey(journey_id)
    if not journey:
        return _error(_("Journey not found"), 404)
    if not _can_share_report(journey, staff_only=False):
        return _error(_("Not permitted"), 403)
    ready = False
    try:
        assert_report_share_ready(journey)
        ready = True
    except Exception:
        ready = False
    branding = {}
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import get_report_branding

        b = get_report_branding()
        branding = {
            "nabl_header": bool(b.get("nabl_header_banner") or b.get("header_banner")),
            "non_nabl_header": bool(b.get("non_nabl_header_banner")),
            "footer": bool(b.get("footer_banner")),
        }
    except Exception:
        pass
    return _success(
        {
            "journey_id": journey.name,
            "status": journey.status,
            "ready": ready,
            "recipient": _resolve_patient_phone(journey),
            "templates": list(CHROME_TEMPLATES.keys()),
            "branding": branding,
            "portal_url": patient_portal_reports_url(),
        }
    )


def _report_assets_dir():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, "report_assets")


def _ensure_branding_fields():
    if not frappe.db.exists("DocType", "Lab Report Branding"):
        from health_ecosystem_core.health_ecosystem_core.doctype.lab_report_branding.lab_report_branding import (
            ensure_lab_report_branding,
        )

        ensure_lab_report_branding()
    if not frappe.db.exists("DocType", "Lab Report Branding"):
        return
    meta = frappe.get_meta("Lab Report Branding")
    insert_after = "header_banner" if meta.has_field("header_banner") else "nabl_logo"
    for fieldname, label in (
        ("nabl_header_banner", "NABL Header Banner"),
        ("non_nabl_header_banner", "Non-NABL Header Banner"),
    ):
        if meta.has_field(fieldname):
            continue
        exists = frappe.db.exists("Custom Field", {"dt": "Lab Report Branding", "fieldname": fieldname})
        if exists:
            continue
        frappe.get_doc(
            {
                "doctype": "Custom Field",
                "dt": "Lab Report Branding",
                "fieldname": fieldname,
                "label": label,
                "fieldtype": "Attach Image",
                "insert_after": insert_after,
                "description": "Admin-managed letterhead. Replace in Desk without code changes.",
            }
        ).insert(ignore_permissions=True)
        insert_after = fieldname
    frappe.clear_cache(doctype="Lab Report Branding")


def _seed_branding_asset(filename, fieldname, stored_name, force=False):
    """Install a bundled pad only when that banner is still empty.

    force must stay false on the download path. Rewriting remedium-*-header.png
    on every PDF was putting the old artwork back into Template Management.
    """
    path = os.path.join(_report_assets_dir(), filename)
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as fh:
        content = fh.read()
    if not content:
        return None
    url = "/files/" + stored_name
    public_path = None
    try:
        public_path = frappe.get_site_path("public", "files", stored_name)
    except Exception:
        public_path = None
    current = ""
    try:
        current = cstr(frappe.db.get_single_value("Lab Report Branding", fieldname) or "").strip()
    except Exception:
        current = ""
    file_exists = bool(public_path and os.path.isfile(public_path))
    # A saved Template Management / branding URL wins over the bundled pad.
    if not force and current and current.split("?", 1)[0] != url:
        return current
    if not force and file_exists:
        if not current:
            try:
                frappe.db.set_single_value("Lab Report Branding", fieldname, url)
            except Exception:
                frappe.log_error(title="phase125_set_branding_field", message=frappe.get_traceback())
        return current or url
    try:
        if public_path:
            os.makedirs(os.path.dirname(public_path), exist_ok=True)
            with open(public_path, "wb") as fh:
                fh.write(content)
    except Exception:
        frappe.log_error(title="phase125_write_public_file", message=frappe.get_traceback())

    existing = frappe.db.get_value("File", {"file_name": stored_name}, "name")
    if existing:
        try:
            if force and public_path:
                frappe.db.set_value("File", existing, "file_url", url)
        except Exception:
            pass
    else:
        file_doc = frappe.get_doc(
            {
                "doctype": "File",
                "file_name": stored_name,
                "content": content,
                "is_private": 0,
                "folder": "Home/Attachments",
                "attached_to_doctype": "Lab Report Branding",
                "attached_to_name": "Lab Report Branding",
                "attached_to_field": fieldname,
            }
        )
        file_doc.insert(ignore_permissions=True)
        url = file_doc.file_url or url
    try:
        frappe.db.set_single_value("Lab Report Branding", fieldname, url)
        if fieldname == "nabl_header_banner":
            header = frappe.db.get_single_value("Lab Report Branding", "header_banner")
            if force or not header:
                frappe.db.set_single_value("Lab Report Branding", "header_banner", url)
    except Exception:
        frappe.log_error(title="phase125_set_branding_field", message=frappe.get_traceback())
    return url


def ensure_phase125_report_share(commit=True):
    """Idempotent: branding fields + letterhead assets for NABL / Non-NABL / footer."""
    _ensure_branding_fields()
    seeded = {}
    for filename, fieldname, stored_name in ASSET_FILES:
        try:
            seeded[fieldname] = _seed_branding_asset(filename, fieldname, stored_name)
        except Exception:
            frappe.log_error(title="phase125_seed_asset", message=frappe.get_traceback())
            seeded[fieldname] = None
    if commit:
        frappe.db.commit()
    return {"ok": True, "seeded": seeded}


def setup_phase125():
    return ensure_phase125_report_share()


def smoke_phase125_report_share():
    from health_ecosystem_core.health_ecosystem_core.clinical_report_format import (
        render_remedium_lab_report_html,
    )

    seeded = ensure_phase125_report_share()
    payload = {
        "patient_name": "Phase125 Smoke",
        "gender_age": "30 Y / M",
        "lab_no": "SMOKE-125",
        "test_sections": [],
    }
    nabl = render_remedium_lab_report_html(payload, chrome_mode="nabl", for_pdf=1)
    non = render_remedium_lab_report_html(payload, chrome_mode="non_nabl", for_pdf=1)
    none = render_remedium_lab_report_html(payload, chrome_mode="none", for_pdf=1)
    preview = render_remedium_lab_report_html(payload, chrome_mode="nabl", for_pdf=0)
    from health_ecosystem_core.health_ecosystem_core.clinical_notifications import (
        _existing_fields,
        _resolve_patient_phone as resolve_trf_phone,
    )

    trf_phone_fields = _existing_fields("Customer TRF", ("patient_phone", "customer_phone", "patient"))
    phone_lookup_ok = True
    try:
        resolve_trf_phone(trf_id="__missing_trf__", patient=None)
    except Exception:
        phone_lookup_ok = False
    ok = bool(
        'id="print-toolbar"' not in nabl
        and "letterhead-toggle" not in nabl
        and "letterhead-plain" in none
        and "pdf-mode" in nabl
        and 'class="report-chrome-header"' not in nabl
        and 'class="report-chrome-header"' not in non
        and 'class="report-chrome-header"' not in none
        and 'class="report-chrome-footer"' not in none
        and 'class="footer-banner' not in none
        and "This is a computer-generated report" not in none
        and 'class="report-chrome-header"' in preview
        and "report-chrome-footer" in preview
        and "This is a computer-generated report. Correlation with clinical findings" not in nabl
        and phone_lookup_ok
        and (not trf_phone_fields or "patient_phone" in trf_phone_fields)
    )
    print("RESULT " + ("SMOKE_OK" if ok else "SMOKE_FAIL"))
    return {
        "ok": ok,
        "seeded": seeded,
        "portal": patient_portal_reports_url(),
        "nabl_has_toolbar": "print-toolbar" in nabl,
        "none_plain": 'class="letterhead-plain"' in none,
        "templates": list(CHROME_TEMPLATES),
    }
