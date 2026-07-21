"""Mobile lab booking — allow_guest whitelist (matches get_home_content pattern)."""

import frappe
from frappe import _


@frappe.whitelist(allow_guest=True)
def book_lab_test(
    patient_name=None,
    age=None,
    gender=None,
    test_required=None,
    franchisee_id=None,
    patient_phone=None,
    collection_address=None,
    collection_slot=None,
    amount=None,
    unique_barcode=None,
    sid=None,
):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _require_mobile_auth

    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)

    from health_ecosystem_core.health_ecosystem_core.api import _create_customer_trf_impl

    return _create_customer_trf_impl(
        patient_name=patient_name,
        age=age,
        gender=gender,
        test_required=test_required,
        franchisee_id=franchisee_id,
        patient_phone=patient_phone,
        collection_address=collection_address,
        collection_slot=collection_slot,
        amount=amount,
        unique_barcode=unique_barcode,
    )
