"""Shared helpers for the native clinical module."""

import json

import frappe
from frappe.utils import flt, get_datetime


def parse_mysql_datetime(value):
    """Parse client datetime strings into naive datetimes for MySQL DATETIME columns."""
    if not value:
        return None
    dt = get_datetime(value)
    if not dt:
        return None
    if getattr(dt, "tzinfo", None) is not None:
        from frappe.utils.data import convert_utc_to_system_timezone

        dt = convert_utc_to_system_timezone(dt)
        if getattr(dt, "tzinfo", None) is not None:
            dt = dt.replace(tzinfo=None)
    return dt


def set_patient_link(data, patient_id, doctype):
    if not patient_id:
        return data
    meta = frappe.get_meta(doctype)
    if meta.has_field("health_patient"):
        data["health_patient"] = patient_id
    elif meta.has_field("patient"):
        data["patient"] = patient_id
    return data


def get_patient_link(doc):
    meta = frappe.get_meta(doc.doctype)
    if meta.has_field("health_patient"):
        return doc.get("health_patient")
    if meta.has_field("patient"):
        return doc.get("patient")
    return None


def machine_test_code(item_code):
    """Resolve LIS machine code from Diagnostic Test Master or Item description."""
    if not item_code:
        return item_code
    if frappe.db.exists("DocType", "Diagnostic Test Master"):
        lis_code = frappe.db.get_value("Diagnostic Test Master", {"item": item_code}, "lis_code")
        if lis_code:
            return lis_code.strip()
    custom_code = frappe.db.get_value("Item", item_code, "description") or ""
    if custom_code.startswith("LIS:"):
        return custom_code.split(":", 1)[1].strip() or item_code
    return item_code


def parameter_reference_range(test_master, parameter_name, age_years=None, gender=None, parameter_code=None):
    if not test_master or not parameter_name:
        return None
    if not frappe.db.exists("DocType", "Diagnostic Test Master"):
        return None
    doc = frappe.get_doc("Diagnostic Test Master", test_master)
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase88_diagnostic_formats import (
            format_range_label,
            resolve_parameter_bounds,
        )

        for row in doc.parameters or []:
            if (row.parameter_name or "").lower() != parameter_name.lower():
                continue
            if parameter_code and (row.parameter_code or "") and row.parameter_code != parameter_code:
                continue
            bounds = resolve_parameter_bounds(doc, row, age_years=age_years, gender=gender)
            label = format_range_label(bounds, row.unit)
            return label or None
    except Exception:
        pass
    for row in doc.parameters or []:
        if (row.parameter_name or "").lower() == parameter_name.lower():
            low = row.normal_min
            high = row.normal_max
            unit = row.unit or ""
            if low is not None and high is not None:
                return f"{low}-{high} {unit}".strip()
            if low is not None:
                return f">{low} {unit}".strip()
            if high is not None:
                return f"<{high} {unit}".strip()
    return None


def get_master_parameter_bounds(test_master, parameter_name, age_years=None, gender=None, parameter_code=None):
    """Return normal/critical bounds from Diagnostic Test Master (age/gender aware when configured)."""
    if not test_master or not parameter_name:
        return {}
    if not frappe.db.exists("DocType", "Diagnostic Test Master"):
        return {}
    doc = frappe.get_doc("Diagnostic Test Master", test_master)
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase88_diagnostic_formats import (
            resolve_parameter_bounds,
        )

        for row in doc.parameters or []:
            if (row.parameter_name or "").lower() != parameter_name.lower():
                continue
            if parameter_code and (row.parameter_code or "") and row.parameter_code != parameter_code:
                continue
            return resolve_parameter_bounds(doc, row, age_years=age_years, gender=gender)
    except Exception:
        pass
    for row in doc.parameters or []:
        if (row.parameter_name or "").lower() != parameter_name.lower():
            continue
        return {
            "normal_min": row.normal_min,
            "normal_max": row.normal_max,
            "critical_min": getattr(row, "critical_min", None),
            "critical_max": getattr(row, "critical_max", None),
            "unit": row.unit or "",
        }
    return {}


def abnormal_flag_for_value(test_master, parameter_name, value, lower=None, upper=None, age_years=None, gender=None):
    if value is None or value == "":
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None

    if test_master and frappe.db.exists("Diagnostic Test Master", test_master):
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase88_diagnostic_formats import (
                classify_parameter_result,
                reference_range_mode,
            )

            master_doc = frappe.get_doc("Diagnostic Test Master", test_master)
            if reference_range_mode(master_doc) == "Interpretation Bands":
                for row in master_doc.parameters or []:
                    if (row.parameter_name or "").lower() != (parameter_name or "").lower():
                        continue
                    result = classify_parameter_result(master_doc, row, value)
                    if result and result.get("abnormal_flag"):
                        return result["abnormal_flag"]
                    return result.get("abnormal_flag") if result else None
        except Exception:
            pass

    bounds = (
        get_master_parameter_bounds(test_master, parameter_name, age_years=age_years, gender=gender)
        if test_master
        else {}
    )
    low = lower if lower is not None else bounds.get("normal_min")
    high = upper if upper is not None else bounds.get("normal_max")
    # Float child-table defaults often store 0.0 for blank criticals — treat 0 as unset.
    crit_low = bounds.get("critical_min")
    crit_high = bounds.get("critical_max")
    try:
        if crit_low is not None and float(crit_low) == 0:
            crit_low = None
    except (TypeError, ValueError):
        crit_low = None
    try:
        if crit_high is not None and float(crit_high) == 0:
            crit_high = None
    except (TypeError, ValueError):
        crit_high = None

    if crit_low is not None and numeric < float(crit_low):
        return "Critical"
    if crit_high is not None and numeric > float(crit_high):
        return "Critical"
    if low is not None and numeric < float(low):
        return "L"
    if high is not None and numeric > float(high):
        return "H"
    if low is not None or high is not None:
        return "N"
    return None


ABNORMAL_FLAG_ALIASES = {
    "N": "Normal",
    "NORM": "Normal",
    "NORMAL": "Normal",
    "H": "High",
    "HIGH": "High",
    "L": "Low",
    "LOW": "Low",
    "HH": "Critical",
    "LL": "Critical",
    "AA": "Critical",
    "C": "Critical",
    "CRIT": "Critical",
    "CRITICAL": "Critical",
    "A": "Abnormal",
    "ABN": "Abnormal",
    "ABNORMAL": "Abnormal",
    "R": "Abnormal",
    "REACTIVE": "Abnormal",
    "POS": "Abnormal",
    "POSITIVE": "Abnormal",
}


def result_display_value(row):
    """The value to show a human: qualitative text wins, numeric is the fallback."""
    if hasattr(row, "get"):
        getter = row.get
    else:
        def getter(key, default=None):
            return getattr(row, key, default)

    for key in ("display_value", "result_value_text"):
        value = getter(key, None)
        if value not in (None, ""):
            return str(value)
    numeric = getter("numeric_result_value", None)
    if numeric in (None, ""):
        return ""
    return str(numeric)


def normalize_abnormal_flag(flag):
    """Map ASTM codes (N/H/L/HH) onto the Lab Test Result Select vocabulary.

    Analyzers and internal helpers both emit single-letter codes, but the field
    stores words. An unrecognised code is dropped rather than raised, so a stray
    flag never costs us the result value itself.
    """
    if flag is None:
        return None
    raw = str(flag).strip()
    if not raw:
        return None
    mapped = ABNORMAL_FLAG_ALIASES.get(raw.upper())
    if mapped:
        return mapped
    try:
        frappe.log_error(
            f"Unrecognised abnormal flag: {raw!r}", "LIS abnormal flag"
        )
    except Exception:
        pass
    return None


def abnormal_flag_for_lab_row(row):
    """Compute H/L/Critical/N for a Lab Report Parameter row."""
    test_master = getattr(row, "diagnostic_test", None) or (row.get("diagnostic_test") if isinstance(row, dict) else None)
    name = getattr(row, "description", None) or (row.get("description") if isinstance(row, dict) else None)
    value = getattr(row, "result_value", None) if not isinstance(row, dict) else row.get("result_value")
    lower = getattr(row, "lower_range", None) if not isinstance(row, dict) else row.get("lower_range")
    upper = getattr(row, "upper_range", None) if not isinstance(row, dict) else row.get("upper_range")
    if test_master and value not in (None, ""):
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase88_diagnostic_formats import (
                apply_interpretation_to_lab_row,
                reference_range_mode,
            )

            if frappe.db.exists("Diagnostic Test Master", test_master):
                master_doc = frappe.get_doc("Diagnostic Test Master", test_master)
                if reference_range_mode(master_doc) == "Interpretation Bands":
                    classification = apply_interpretation_to_lab_row(row, master_doc=master_doc)
                    if classification and classification.get("abnormal_flag"):
                        return classification["abnormal_flag"]
        except Exception:
            pass
    return abnormal_flag_for_value(test_master, name, value, lower=lower, upper=upper)


def is_alert_worthy_flag(flag):
    return (flag or "").upper() in ("H", "L", "HIGH", "LOW", "CRITICAL")


def find_test_master_for_item(item_code):
    if not item_code or not frappe.db.exists("DocType", "Diagnostic Test Master"):
        return None
    filters = {"item": item_code}
    if frappe.get_meta("Diagnostic Test Master").has_field("disabled"):
        filters["disabled"] = 0
    return frappe.db.get_value("Diagnostic Test Master", filters, "name")


def get_trf_test_lines(trf):
    """Return normalized test lines for a Customer TRF document or name."""
    if isinstance(trf, str):
        trf = frappe.get_doc("Customer TRF", trf)
    lines = []
    for row in trf.get("tests") or []:
        if not row.item:
            continue
        qty = flt(row.qty) or 1
        rate = flt(row.rate) or 0
        lines.append(
            {
                "item_code": row.item,
                "item_name": row.item_name or frappe.db.get_value("Item", row.item, "item_name") or row.item,
                "qty": qty,
                "rate": rate,
                "amount": flt(row.amount) or qty * rate,
            }
        )
    if not lines and trf.get("test_required"):
        from health_ecosystem_core.health_ecosystem_core.api import _resolve_selling_rate

        rate = flt(trf.get("amount")) or _resolve_selling_rate(trf.test_required)
        lines.append(
            {
                "item_code": trf.test_required,
                "item_name": frappe.db.get_value("Item", trf.test_required, "item_name") or trf.test_required,
                "qty": 1,
                "rate": rate,
                "amount": rate,
            }
        )
    return lines


def sync_trf_test_lines(trf):
    """Keep child table, primary test, and amount in sync."""
    from frappe.utils import flt

    from health_ecosystem_core.health_ecosystem_core.api import _resolve_selling_rate

    if not trf.get("tests") and trf.get("test_required"):
        rate = flt(trf.amount) or _resolve_selling_rate(trf.test_required)
        trf.append(
            "tests",
            {
                "item": trf.test_required,
                "item_name": frappe.db.get_value("Item", trf.test_required, "item_name"),
                "qty": 1,
                "rate": rate,
                "amount": rate,
            },
        )

    total = 0
    for row in trf.get("tests") or []:
        if not row.item:
            continue
        if not row.item_name:
            row.item_name = frappe.db.get_value("Item", row.item, "item_name")
        qty = flt(row.qty) or 1
        if not flt(row.rate):
            row.rate = _resolve_selling_rate(row.item)
        row.amount = qty * flt(row.rate)
        total += row.amount

    if trf.get("tests"):
        trf.test_required = trf.tests[0].item
    if total:
        trf.amount = total


def find_test_master_for_trf_result(trf, erp_item_code=None, analyte_test_name=None):
    """Resolve Diagnostic Test Master for an incoming machine result."""
    if erp_item_code:
        master = find_test_master_for_item(erp_item_code)
        if master:
            return master, erp_item_code

    for line in get_trf_test_lines(trf):
        master = find_test_master_for_item(line["item_code"])
        if not master:
            continue
        if not analyte_test_name:
            return master, line["item_code"]
        doc = frappe.get_doc("Diagnostic Test Master", master)
        for param in doc.parameters or []:
            if (param.parameter_name or "").lower() == analyte_test_name.lower():
                return master, line["item_code"]

    if trf.get("test_required"):
        return find_test_master_for_item(trf.test_required), trf.test_required
    return None, erp_item_code


def build_lab_report_json(trf_name):
    trf = frappe.get_doc("Customer TRF", trf_name)
    result_meta = frappe.get_meta("Lab Test Result")
    result_fields = [
        "analyte_test_name",
        "numeric_result_value",
        "unit_of_measure",
        "reference_range",
        "abnormal_flag",
        "erp_item_code",
    ]
    has_text_field = result_meta.has_field("result_value_text")
    if has_text_field:
        result_fields.append("result_value_text")
    all_results = frappe.get_all(
        "Lab Test Result",
        filters={"customer_trf": trf_name},
        fields=result_fields,
        order_by="creation asc",
    )
    # Qualitative results have no numeric value, so give renderers one field to trust.
    for row in all_results:
        text_value = row.get("result_value_text") if has_text_field else None
        if text_value:
            row["display_value"] = text_value
        elif row.get("numeric_result_value") is not None:
            row["display_value"] = row["numeric_result_value"]
        else:
            row["display_value"] = ""
    has_item_field = result_meta.has_field("erp_item_code")
    lines = get_trf_test_lines(trf)
    tests = []
    for line in lines:
        test_master = find_test_master_for_item(line["item_code"])
        master_doc = frappe.get_doc("Diagnostic Test Master", test_master) if test_master else None
        if has_item_field:
            results = [row for row in all_results if row.erp_item_code == line["item_code"]]
            if not results and len(lines) == 1:
                results = all_results
        else:
            results = all_results if len(lines) == 1 else []
        tests.append(
            {
                "test": line["item_code"],
                "test_master": test_master,
                "test_name": master_doc.test_name if master_doc else line["item_name"],
                "description": master_doc.description if master_doc else None,
                "parameters": results,
            }
        )

    return {
        "trf_id": trf_name,
        "tests": tests,
        "test": trf.test_required,
    }


PAYMENT_METHOD_ONLINE = "Online"
PAYMENT_METHOD_COD = "Cash on Delivery"
PAYMENT_METHOD_HUB = "Pay at Hub"
VALID_PAYMENT_METHODS = (PAYMENT_METHOD_ONLINE, PAYMENT_METHOD_COD, PAYMENT_METHOD_HUB)


def normalize_payment_method(raw=None):
    value = (raw or PAYMENT_METHOD_ONLINE).strip()
    aliases = {
        "cod": PAYMENT_METHOD_COD,
        "cash on delivery": PAYMENT_METHOD_COD,
        "cash_on_delivery": PAYMENT_METHOD_COD,
        "franchisee": PAYMENT_METHOD_HUB,
        "pay at hub": PAYMENT_METHOD_HUB,
        "pay_at_hub": PAYMENT_METHOD_HUB,
        "hub": PAYMENT_METHOD_HUB,
        "online": PAYMENT_METHOD_ONLINE,
        "razorpay": PAYMENT_METHOD_ONLINE,
    }
    if value in VALID_PAYMENT_METHODS:
        return value
    return aliases.get(value.lower(), PAYMENT_METHOD_ONLINE)


def create_customer_trf_booking(
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
    referred_doctor=None,
):
    """Create Customer TRF for one or many tests (lives here so panel booking survives stale api.py)."""
    from frappe import _
    from frappe.utils import cint

    from health_ecosystem_core.health_ecosystem_core.api import (
        _create_sales_order_for_trf,
        _error,
        _parse_request_value,
        _success,
    )
    from health_ecosystem_core.health_ecosystem_core.clinical_phase6 import parse_trf_test_items
    from health_ecosystem_core.health_ecosystem_core.patient_bridge import (
        ensure_patient,
        patient_doctype_available,
    )

    patient_name = _parse_request_value("patient_name", patient_name)
    age = _parse_request_value("age", age)
    gender = _parse_request_value("gender", gender)
    test_required = _parse_request_value("test_required", test_required)
    test_items = _parse_request_value("test_items", test_items)
    franchisee_id = _parse_request_value("franchisee_id", franchisee_id)
    patient_phone = _parse_request_value("patient_phone", patient_phone)
    collection_address = _parse_request_value("collection_address", collection_address)
    collection_latitude = _parse_request_value("collection_latitude", collection_latitude)
    collection_longitude = _parse_request_value("collection_longitude", collection_longitude)
    collection_slot = _parse_request_value("collection_slot", collection_slot)
    amount = _parse_request_value("amount", amount)
    unique_barcode = _parse_request_value("unique_barcode", unique_barcode)
    payment_method = normalize_payment_method(_parse_request_value("payment_method", payment_method))
    promo_code = _parse_request_value("promo_code", promo_code)
    referred_doctor = _parse_request_value("referred_doctor", referred_doctor)

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase58_report_signatories import (
            normalize_referred_doctor,
        )

        referred_doctor = normalize_referred_doctor(referred_doctor)
    except Exception:
        referred_doctor = (referred_doctor or "Self").strip() or "Self"

    test_lines = parse_trf_test_items(test_required=test_required, test_items=test_items, amount=amount)
    if not test_lines:
        return _error(_("Missing required TRF fields"))

    if not all([patient_name, age, gender, franchisee_id]):
        return _error(_("Missing required TRF fields"))

    if not frappe.db.exists("Franchisee Profile", franchisee_id):
        return _error(_("Invalid Franchisee ID"))

    for line in test_lines:
        if not frappe.db.exists("Item", line["item"]):
            return _error(_("Invalid test item: {0}").format(line["item"]))

    total_amount = sum(flt(line.get("amount")) for line in test_lines)
    if not flt(amount):
        amount = total_amount

    discount_amount = 0.0
    applied_code = ""
    pricing = None
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase26 import (
            apply_checkout_pricing,
            persist_membership_on_doc,
        )

        user = frappe.session.user if frappe.session.user != "Guest" else None
        pricing = apply_checkout_pricing(user, flt(amount), "lab", promo_code)
        amount = pricing["final_total"]
        discount_amount = pricing["discount_amount"]
        applied_code = pricing.get("promo_code") or ""
    except frappe.ValidationError as exc:
        return _error(str(exc))

    primary_test = test_lines[0]["item"]

    patient_id = None
    if patient_doctype_available():
        patient_id = ensure_patient(
            patient_name=patient_name,
            phone=patient_phone,
            age=age,
            gender=gender,
            user=frappe.session.user if frappe.session.user != "Guest" else None,
        )

    trf_data = {
        "doctype": "Customer TRF",
        "patient_name": patient_name,
        "age": cint(age),
        "gender": gender,
        "test_required": primary_test,
        "tests": test_lines,
        "franchisee_id": franchisee_id,
        "patient_phone": patient_phone,
        "collection_address": collection_address,
        "collection_slot": parse_mysql_datetime(collection_slot),
        "amount": flt(amount),
        "unique_barcode": unique_barcode,
        "razorpay_payment_status": "Pending",
        "payment_method": payment_method,
        "order_status": "Booked",
        "referred_doctor": referred_doctor,
    }
    if applied_code or discount_amount:
        trf_data["promo_code"] = applied_code
        trf_data["discount_amount"] = discount_amount
    if pricing:
        try:
            from health_ecosystem_core.health_ecosystem_core.clinical_phase26 import persist_membership_on_doc

            persist_membership_on_doc(trf_data, pricing, "Customer TRF")
        except Exception:
            pass
    if flt(collection_latitude) and flt(collection_longitude):
        trf_data["collection_latitude"] = flt(collection_latitude)
        trf_data["collection_longitude"] = flt(collection_longitude)
    set_patient_link(trf_data, patient_id, "Customer TRF")

    trf = frappe.get_doc(trf_data)
    trf.insert(ignore_permissions=True)

    if patient_id:
        from health_ecosystem_core.health_ecosystem_core.clinical_journey import (
            ensure_journey_for_patient,
            sync_journey_from_trf,
        )

        journey = ensure_journey_for_patient(patient_id, status="Diagnostics Booked")
        if journey:
            trf.db_set("care_journey", journey)
        sync_journey_from_trf(trf.name, trf.order_status)
        from health_ecosystem_core.health_ecosystem_core.clinical_iam import auto_assign_phlebotomist_for_trf

        auto_assign_phlebotomist_for_trf(trf.name)

    sales_order = _create_sales_order_for_trf(trf, patient_id=patient_id)
    trf.db_set("sales_order", sales_order.name)

    frappe.db.commit()

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_notifications import notify_trf_booked

        notify_trf_booked(trf.name)
    except Exception:
        frappe.log_error(title="notify_trf_booked", message=frappe.get_traceback())

    return _success(
        {
            "trf_id": trf.name,
            "barcode": trf.unique_barcode,
            "sales_order": sales_order.name,
            "patient": patient_id,
            "amount": sales_order.grand_total,
            "payment_method": payment_method,
        },
        message="TRF created",
    )


def journey_report_payload(journey_name):
    journey = frappe.get_doc("Patient Care Journey", journey_name)
    trf = journey.customer_trf
    results = []
    if trf:
        journey_fields = [
            "analyte_test_name",
            "numeric_result_value",
            "unit_of_measure",
            "reference_range",
            "abnormal_flag",
            "machine_reference",
            "verification_timestamp",
        ]
        if frappe.get_meta("Lab Test Result").has_field("result_value_text"):
            journey_fields.append("result_value_text")
        results = frappe.get_all(
            "Lab Test Result",
            filters={"customer_trf": trf},
            fields=journey_fields,
            order_by="creation asc",
        )
    report = {
        "journey_id": journey.name,
        "patient": journey.patient,
        "patient_name": journey.patient_name,
        "status": journey.status,
        "trf_id": trf,
        "prescription": journey.prescription,
        "authorized_on": journey.authorized_on,
        "pathologist_notes": journey.pathologist_notes,
        "report_pdf": journey.report_pdf,
        "results": results,
    }
    if journey.lab_report_json:
        try:
            report["structured"] = json.loads(journey.lab_report_json)
        except Exception:
            report["structured"] = journey.lab_report_json
    elif trf:
        report["structured"] = build_lab_report_json(trf)
    return report


def normalize_patient_age(years=None, months=None, days=None):
    """Return non-negative integer years/months/days. Missing values become 0."""
    from frappe.utils import cint

    def _part(raw):
        try:
            value = cint(raw or 0)
        except Exception:
            value = 0
        return value if value > 0 else 0

    return _part(years), _part(months), _part(days)


def format_patient_age(years=None, months=None, days=None):
    """Human age: '22 Years 2 Months 22 Days', or only the parts that are set."""
    y, m, d = normalize_patient_age(years, months, days)
    parts = []
    if y:
        parts.append(f"{y} Year{'s' if y != 1 else ''}")
    if m:
        parts.append(f"{m} Month{'s' if m != 1 else ''}")
    if d:
        parts.append(f"{d} Day{'s' if d != 1 else ''}")
    return " ".join(parts)


def smoke_walkin_age_parts():
    assert normalize_patient_age(22, 2, 22) == (22, 2, 22)
    assert normalize_patient_age(-3, "x", None) == (0, 0, 0)
    assert format_patient_age(22, 2, 22) == "22 Years 2 Months 22 Days"
    assert format_patient_age(0, 0, 2) == "2 Days"
    assert format_patient_age(0, 2, 5) == "2 Months 5 Days"
    assert format_patient_age(1, 0, 0) == "1 Year"
    print("SMOKE_OK walkin_age_parts")
    return {"ok": True}
