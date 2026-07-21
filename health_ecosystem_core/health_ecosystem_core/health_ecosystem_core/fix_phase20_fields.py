"""Remove Custom Fields that collide with DocType fields; finish Phase 20."""

from collections import defaultdict

import frappe


def run():
    meta = frappe.get_meta("Customer TRF")
    standard = {df.fieldname for df in meta.get("fields", []) if not getattr(df, "is_custom_field", False)}
    # get_meta merges custom fields — check DocType JSON fields vs Custom Field table
    doctype_fields = {
        f.fieldname
        for f in frappe.get_doc("DocType", "Customer TRF").fields
    }
    custom_rows = frappe.get_all(
        "Custom Field",
        filters={"dt": "Customer TRF"},
        fields=["name", "fieldname", "creation"],
        order_by="creation asc",
    )
    deleted = []
    seen = set()
    for row in custom_rows:
        fn = row.fieldname
        # Delete if duplicates a DocType field, or second custom with same fieldname
        if fn in doctype_fields or fn in seen:
            frappe.delete_doc("Custom Field", row.name, force=1, ignore_permissions=True)
            deleted.append(f"{fn}:{row.name}")
            continue
        seen.add(fn)

    frappe.db.commit()
    frappe.clear_cache(doctype="Customer TRF")

    from health_ecosystem_core.health_ecosystem_core.clinical_phase20 import setup_phase20, smoke_phase20

    # Make create_custom_fields resilient: only add missing
    setup = setup_phase20()
    smoke = smoke_phase20()
    return {
        "doctype_has_referred_doctor": "referred_doctor" in doctype_fields,
        "deleted": deleted,
        "setup": setup,
        "smoke": smoke,
    }
