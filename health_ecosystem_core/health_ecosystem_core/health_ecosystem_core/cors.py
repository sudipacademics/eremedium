"""CORS and session helpers for mobile/web clients calling the REST API."""

import frappe


def ensure_cors_config():
    """Enable Frappe core CORS (required for Flutter web on localhost)."""
    if frappe.conf.get("allow_cors"):
        return {"allow_cors": frappe.conf.allow_cors}

    from frappe.installer import update_site_config

    # Reflect request Origin — needed for Flutter web dev (random localhost ports).
    update_site_config("allow_cors", "*")
    frappe.conf.allow_cors = "*"
    return {"allow_cors": "*"}


def sanitize_broken_session():
    """Downgrade corrupt sessions so Frappe does not throw 'User None is disabled'."""
    if not frappe.request or not frappe.request.path.startswith("/api/"):
        return
    try:
        user = getattr(frappe.session, "user", None)
    except Exception:
        return

    reset = user in (None, "", "None")
    if not reset and user != "Guest":
        if not frappe.db.exists("User", user):
            reset = True
        elif not frappe.db.get_value("User", user, "enabled"):
            reset = True

    if reset:
        frappe.set_user("Guest")
