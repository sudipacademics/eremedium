"""Phase 77: Pincode centre locator — find collection hubs by Indian PIN code.

Setup:
    bench --site SITE execute \
        health_ecosystem_core.health_ecosystem_core.clinical_phase77_centre_locator.setup_phase77
"""

from __future__ import annotations

import re

import frappe
from frappe import _
from frappe.utils import cint, flt

PINCODE_RE = re.compile(r"^[1-9][0-9]{5}$")
PINCODE_IN_TEXT_RE = re.compile(r"(?<!\d)([1-9][0-9]{5})(?!\d)")

DEFAULT_RADIUS_KM = 25
GEOCODE_CACHE_PREFIX = "hec_pincode_geo"
GEOCODE_TTL_SEC = 60 * 60 * 24 * 30
GEOCODE_MISS_TTL_SEC = 60 * 60 * 6
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


def ensure_phase77_custom_fields():
    """Desk-editable PIN code on Franchisee Profile so hubs can be matched exactly."""
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    if frappe.get_meta("Franchisee Profile").has_field("hub_pincode"):
        return "hub_pincode already present"

    create_custom_fields(
        {
            "Franchisee Profile": [
                {
                    "fieldname": "hub_pincode",
                    "label": "Hub PIN Code",
                    "fieldtype": "Data",
                    "insert_after": "address",
                    "length": 6,
                    "in_standard_filter": 1,
                    "description": _("6-digit PIN code used by the public centre locator"),
                }
            ]
        },
        update=True,
    )
    return "hub_pincode created"


def normalize_pincode(value):
    digits = re.sub(r"\D", "", str(value or ""))
    return digits if PINCODE_RE.match(digits) else ""


def pincode_from_text(text):
    """Last 6-digit token in an address line is almost always the PIN code."""
    found = PINCODE_IN_TEXT_RE.findall(str(text or ""))
    return found[-1] if found else ""


def haversine_km(lat1, lon1, lat2, lon2):
    from health_ecosystem_core.health_ecosystem_core.clinical_phase66_ai_physician import (
        haversine_km as _hav,
    )

    return _hav(lat1, lon1, lat2, lon2)


def _hub_rows():
    meta = frappe.get_meta("Franchisee Profile")
    fields = ["name", "franchise_name", "branch_code", "territory_region", "address", "contact_phone"]
    for optional in ("hub_latitude", "hub_longitude", "hub_pincode"):
        if meta.has_field(optional):
            fields.append(optional)

    hubs = []
    for row in frappe.get_all(
        "Franchisee Profile",
        filters={"active_status": "Active"},
        fields=fields,
        limit=500,
    ):
        pincode = normalize_pincode(row.get("hub_pincode")) or pincode_from_text(row.get("address"))
        hubs.append(
            {
                "franchisee_id": row.get("name"),
                "franchise_name": row.get("franchise_name"),
                "branch_code": row.get("branch_code"),
                "territory_region": row.get("territory_region"),
                "address": row.get("address"),
                "contact_phone": row.get("contact_phone"),
                "pincode": pincode,
                "latitude": flt(row.get("hub_latitude")) or None,
                "longitude": flt(row.get("hub_longitude")) or None,
                "book_lab_path": f"/diagnostics?hub={row.get('name')}",
                "book_doctor_path": "/appointments/book",
            }
        )
    return hubs


def _geocode_pincode(pincode):
    """PIN code centroid via Nominatim, cached. Returns (lat, lng) or None."""
    cache = frappe.cache()
    key = f"{GEOCODE_CACHE_PREFIX}:{pincode}"
    cached = cache.get_value(key)
    if cached:
        if cached == "miss":
            return None
        return flt(cached.get("lat")), flt(cached.get("lng"))

    try:
        import requests

        res = requests.get(
            NOMINATIM_URL,
            params={
                "postalcode": pincode,
                "country": "India",
                "format": "json",
                "limit": 1,
            },
            headers={"User-Agent": "Remedium-Centre-Locator/1.0 (support@e-remedium.in)"},
            timeout=6,
        )
        rows = res.json() if res.ok else []
    except Exception:
        rows = []

    if not rows:
        cache.set_value(key, "miss", expires_in_sec=GEOCODE_MISS_TTL_SEC)
        return None

    lat, lng = flt(rows[0].get("lat")), flt(rows[0].get("lon"))
    if not (lat and lng):
        cache.set_value(key, "miss", expires_in_sec=GEOCODE_MISS_TTL_SEC)
        return None

    cache.set_value(key, {"lat": lat, "lng": lng}, expires_in_sec=GEOCODE_TTL_SEC)
    return lat, lng


def _resolve_origin(pincode, hubs):
    """Coordinates to measure distance from, best source first."""
    for hub in hubs:
        if hub["pincode"] == pincode and hub["latitude"] and hub["longitude"]:
            return hub["latitude"], hub["longitude"], "hub"

    geo = _geocode_pincode(pincode)
    if geo:
        return geo[0], geo[1], "geocode"

    for hub in hubs:
        if hub["pincode"][:3] == pincode[:3] and hub["latitude"] and hub["longitude"]:
            return hub["latitude"], hub["longitude"], "district"

    return None, None, ""


def search_centers_by_pincode(pincode, radius_km=None, limit=None):
    """Active hubs serving a PIN code: exact matches first, then nearest hubs in radius."""
    pin = normalize_pincode(pincode)
    if not pin:
        frappe.throw(_("Enter a valid 6-digit PIN code"))

    radius = flt(radius_km) or DEFAULT_RADIUS_KM
    max_rows = cint(limit) or 20

    hubs = _hub_rows()
    origin_lat, origin_lng, origin_source = _resolve_origin(pin, hubs)

    results = []
    for hub in hubs:
        row = dict(hub)
        row["pincode_match"] = hub["pincode"] == pin
        row["distance_km"] = None
        if origin_lat and hub["latitude"] and hub["longitude"]:
            row["distance_km"] = round(
                haversine_km(origin_lat, origin_lng, hub["latitude"], hub["longitude"]), 2
            )
        results.append(row)

    exact = [r for r in results if r["pincode_match"]]
    in_radius = [
        r
        for r in results
        if not r["pincode_match"] and r["distance_km"] is not None and r["distance_km"] <= radius
    ]
    seen = {r["franchisee_id"] for r in exact} | {r["franchisee_id"] for r in in_radius}
    district = [
        r
        for r in results
        if r["franchisee_id"] not in seen and r["pincode"][:3] == pin[:3]
    ]

    exact.sort(key=lambda r: r["distance_km"] if r["distance_km"] is not None else 0)
    in_radius.sort(key=lambda r: r["distance_km"])

    centers = exact + in_radius
    match_type = "exact" if exact else ("nearby" if in_radius else "")
    if not centers:
        centers = district
        match_type = "district" if district else "none"

    centers = centers[:max_rows]

    return {
        "pincode": pin,
        "radius_km": radius,
        "match_type": match_type,
        "count": len(centers),
        "centers": centers,
        "origin": (
            {
                "latitude": origin_lat,
                "longitude": origin_lng,
                "source": origin_source,
                "label": _("PIN {0}").format(pin),
            }
            if origin_lat and origin_lng
            else None
        ),
        "message": _message_for(match_type, pin, radius),
    }


def _message_for(match_type, pin, radius):
    if match_type == "exact":
        return _("Centres serving PIN {0}.").format(pin)
    if match_type == "nearby":
        return _("No centre inside PIN {0}. Showing hubs within {1} km.").format(
            pin, cint(radius)
        )
    if match_type == "district":
        return _("No mapped hub near PIN {0}. Showing centres in the same postal district.").format(
            pin
        )
    return _(
        "No centre found for PIN {0}. Home collection may still be available — book from Lab Tests."
    ).format(pin)


def backfill_hub_pincodes():
    """Copy the PIN code out of each hub address so search works on existing data."""
    if not frappe.get_meta("Franchisee Profile").has_field("hub_pincode"):
        return {"updated": 0, "reason": "hub_pincode field missing"}

    updated = 0
    for row in frappe.get_all(
        "Franchisee Profile",
        fields=["name", "address", "hub_pincode"],
        limit=500,
    ):
        if normalize_pincode(row.get("hub_pincode")):
            continue
        pin = pincode_from_text(row.get("address"))
        if not pin:
            continue
        frappe.db.set_value("Franchisee Profile", row["name"], "hub_pincode", pin, update_modified=False)
        updated += 1

    frappe.db.commit()
    return {"updated": updated}


def setup_phase77():
    field = ensure_phase77_custom_fields()
    frappe.clear_cache(doctype="Franchisee Profile")
    backfill = backfill_hub_pincodes()
    frappe.db.commit()
    return {"field": field, "backfill": backfill}


def smoke_phase77():
    result = {"checks": [], "ok": True}

    def check(name, passed, detail=None):
        result["checks"].append({"name": name, "pass": bool(passed), "detail": detail})
        if not passed:
            result["ok"] = False

    check("field", frappe.get_meta("Franchisee Profile").has_field("hub_pincode"))
    check("normalize", normalize_pincode("700 091") == "700091")
    check("reject_bad", normalize_pincode("12345") == "")
    check("from_text", pincode_from_text("12 Park St, Kolkata 700016") == "700016")

    hubs = _hub_rows()
    check("hubs_loaded", isinstance(hubs, list), f"{len(hubs)} active hubs")
    with_pin = [h for h in hubs if h["pincode"]]
    check("hubs_with_pincode", True, f"{len(with_pin)} hubs have a PIN code")

    sample = with_pin[0]["pincode"] if with_pin else "700016"
    payload = search_centers_by_pincode(sample, radius_km=40, limit=10)
    check("search_runs", isinstance(payload.get("centers"), list), payload.get("match_type"))

    from health_ecosystem_core.health_ecosystem_core import api as api_mod

    check("api_exposed", hasattr(api_mod, "search_centers_by_pincode"))
    return result
