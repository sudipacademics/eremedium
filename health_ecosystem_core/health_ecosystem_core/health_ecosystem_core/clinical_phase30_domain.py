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
    f"labtech.{DOMAIN_ROOT}",
    ERP_HOST,
    DOMAIN_ROOT,
    "www.remediumlabs.in",
    "remediumlabs.in",
    "collect.remediumlabs.in",
    "partners.remediumlabs.in",
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


def register_portal_hosts():
    """Add Frappe Domain rows for portal hosts without changing host_name."""
    added = []
    for host in PORTAL_SUBDOMAINS:
        if _add_site_domain(host):
            added.append(host)
    frappe.db.commit()
    return {"ok": True, "domains_added": added, "all_hosts": list(PORTAL_SUBDOMAINS)}


def set_patient_canonical_url():
    """Point patient portal settings at www.remediumlabs.in without changing ERP host_name."""
    portal_url = "https://www.remediumlabs.in"
    update_site_config("hec_patient_portal_url", portal_url)
    if frappe.db.exists("DocType", "Health Ecosystem Settings"):
        frappe.db.set_single_value("Health Ecosystem Settings", "patient_portal_base_url", portal_url)
    frappe.db.commit()
    frappe.clear_cache()
    return {"ok": True, "hec_patient_portal_url": portal_url}


def ensure_patient_labtech_dns(server_ip="167.233.108.90"):
    """Create GoDaddy A records when API credentials already exist. Never logs secrets."""
    import json
    import os
    import urllib.error
    import urllib.request

    key = frappe.conf.get("godaddy_api_key") or os.environ.get("GODADDY_API_KEY")
    secret = frappe.conf.get("godaddy_api_secret") or os.environ.get("GODADDY_API_SECRET")
    if not key or not secret:
        return {"ok": False, "reason": "no_godaddy_api"}

    records = (
        ("remediumlabs.in", "@", server_ip),
        ("remediumlabs.in", "www", server_ip),
        ("e-remedium.in", "labtech", server_ip),
    )
    updated = []
    errors = []
    for domain, name, ip in records:
        req = urllib.request.Request(
            f"https://api.godaddy.com/v1/domains/{domain}/records/A/{name}",
            data=json.dumps([{"data": ip, "ttl": 600}]).encode(),
            method="PUT",
            headers={
                "Authorization": f"sso-key {key}:{secret}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                updated.append({"domain": domain, "name": name, "status": resp.status})
        except urllib.error.HTTPError as exc:
            errors.append({"domain": domain, "name": name, "status": exc.code})
        except Exception:
            errors.append({"domain": domain, "name": name, "status": "error"})
    return {"ok": not errors, "updated": updated, "errors": errors}


def setup_e_remedium_domain(portal_url=None, https=False):
    portal_url = (portal_url or default_portal_base_url(https=https)).rstrip("/")
    if portal_url.startswith("http://") and "e-remedium.in" in portal_url:
        portal_url = "https://" + portal_url[len("http://") :]

    added = []
    for host in PORTAL_SUBDOMAINS:
        if _add_site_domain(host):
            added.append(host)

    if not frappe.conf.get("host_name"):
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
