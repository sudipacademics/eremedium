"""HTTP redirects for legacy Marley desk slugs -> native HEC clinical routes."""

import re

import frappe

_LEGACY_RE = (
    (re.compile(r"^/app/healthcare-practitioner(?:/([^/]+))?/?$", re.I), "/app/doctor"),
    (re.compile(r"^/app/practitioner(?:/([^/]+))?/?$", re.I), "/app/doctor"),
    (re.compile(r"^/app/patient/?$", re.I), "/app/health-patient"),
    (re.compile(r"^/app/patients(?:/([^/]+))?/?$", re.I), "/app/health-patient"),
    (re.compile(r"^/app/List/Patient/?$", re.I), "/app/health-patient"),
    (re.compile(r"^/app/Healthcare%20Practitioner/?$", re.I), "/app/doctor"),
)


def redirect_broken_desk_routes():
    request = getattr(frappe.local, "request", None)
    if not request or request.method != "GET":
        return

    path = request.path or ""
    if not path.startswith("/app/"):
        return

    for pattern, base in _LEGACY_RE:
        match = pattern.match(path)
        if not match:
            continue
        tail = (match.group(1) or "").strip() if match.lastindex else ""
        if not tail:
            target = base
        elif tail.lower() == "new":
            target = f"{base}/new"
        else:
            target = f"{base}/{tail}"
        frappe.local.response["type"] = "redirect"
        frappe.local.response["location"] = target
        raise frappe.Redirect
