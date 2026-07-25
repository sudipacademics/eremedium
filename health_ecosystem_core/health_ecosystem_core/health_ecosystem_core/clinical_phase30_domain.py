"""E-Remedium public domain — Frappe site domains + portal base URL."""

from __future__ import annotations

import frappe
from frappe.installer import update_site_config

DOMAIN_ROOT = "e-remedium.in"
PATIENT_PORTAL_HOST = f"www.{DOMAIN_ROOT}"
ERP_HOST = f"erp.{DOMAIN_ROOT}"

PORTAL_SUBDOMAINS = (
    PATIENT_PORTAL_HOST,
    f"partners.{DOMAIN_ROOT}",
    f"collect.{DOMAIN_ROOT}",
    f"reach.{DOMAIN_ROOT}",
    f"career.{DOMAIN_ROOT}",
    ERP_HOST,
    DOMAIN_ROOT,
)


def default_portal_base_url(*, https=False):
    scheme = "https" if https else "http"
    return f"{scheme}://{PATIENT_PORTAL_HOST}"


def _add_site_domain(domain):
    if not domain:
        return False
    if frappe.db.exists("Domain", domain):
        return False
    try:
        frappe.get_doc({"doctype": "Domain", "domain": domain}).insert(ignore_permissions=True)
        return True
    except Exception:
        frappe.log_error(title="add_site_domain", message=frappe.get_traceback())
        return False


def configure_portal_settings(portal_url=None):
    portal_url = (portal_url or default_portal_base_url()).rstrip("/")
    if frappe.db.exists("DocType", "Health Ecosystem Settings"):
        frappe.db.set_single_value("Health Ecosystem Settings", "patient_portal_base_url", portal_url)
    update_site_config("hec_patient_portal_url", portal_url)
    return portal_url


def setup_e_remedium_domain(portal_url=None, https=False):
    portal_url = (portal_url or default_portal_base_url(https=https)).rstrip("/")
    if portal_url.startswith("http://") and "e-remedium.in" in portal_url:
        portal_url = "https://" + portal_url[len("http://") :]

    added = []
    for host in PORTAL_SUBDOMAINS:
        if _add_site_domain(host):
            added.append(host)

    update_site_config("host_name", portal_url)
    update_site_config("hec_patient_portal_url", portal_url)
    configure_portal_settings(portal_url)
    frappe.db.commit()
    frappe.clear_cache()

    return {
        "ok": True,
        "domain_root": DOMAIN_ROOT,
        "portal_base_url": portal_url,
        "erp_host": ERP_HOST,
        "domains_added": added,
        "all_hosts": list(PORTAL_SUBDOMAINS),
        "host_name": PATIENT_PORTAL_HOST,
        "google_oauth_redirect": f"{portal_url}/api/method/frappe.integrations.oauth2_logins.login_via_google",
    }
