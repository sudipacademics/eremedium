"""Phase 20: Phlebotomist GPS — location ping, map pins, OSRM route, hub geofence check-in."""

from __future__ import annotations

import json
import math
import re

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime

LOCATION_TAG_RE = re.compile(r"\[Location:\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\]", re.I)
CACHE_KEY = "hec_phlebo_locations"
DEFAULT_GEOFENCE_M = 100
OSRM_DEFAULT = "https://router.project-osrm.org"


def ensure_phase20_custom_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    def missing(dt, fieldname):
        meta = frappe.get_meta(dt)
        return not meta.has_field(fieldname)

    trf_fields = []
    if missing("Customer TRF", "collection_latitude"):
        trf_fields.append(
            {
                "fieldname": "collection_latitude",
                "label": "Collection Latitude",
                "fieldtype": "Float",
                "insert_after": "collection_address",
                "precision": 8,
            }
        )
    if missing("Customer TRF", "collection_longitude"):
        trf_fields.append(
            {
                "fieldname": "collection_longitude",
                "label": "Collection Longitude",
                "fieldtype": "Float",
                "insert_after": "collection_latitude",
                "precision": 8,
            }
        )

    fr_fields = []
    if missing("Franchisee Profile", "hub_latitude"):
        fr_fields.append(
            {
                "fieldname": "hub_latitude",
                "label": "Hub Latitude",
                "fieldtype": "Float",
                "insert_after": "address",
                "precision": 8,
            }
        )
    if missing("Franchisee Profile", "hub_longitude"):
        fr_fields.append(
            {
                "fieldname": "hub_longitude",
                "label": "Hub Longitude",
                "fieldtype": "Float",
                "insert_after": "hub_latitude",
                "precision": 8,
            }
        )
    if missing("Franchisee Profile", "geofence_radius_m"):
        fr_fields.append(
            {
                "fieldname": "geofence_radius_m",
                "label": "Geofence Radius (m)",
                "fieldtype": "Int",
                "insert_after": "hub_longitude",
                "default": "100",
            }
        )

    payload = {}
    if trf_fields:
        payload["Customer TRF"] = trf_fields
    if fr_fields:
        payload["Franchisee Profile"] = fr_fields
    if payload:
        create_custom_fields(payload, update=True)


def haversine_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in metres."""
    lat1, lon1, lat2, lon2 = map(math.radians, [flt(lat1), flt(lon1), flt(lat2), flt(lon2)])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(a))


def parse_location_from_address(address):
    if not address:
        return None, None
    match = LOCATION_TAG_RE.search(address)
    if match:
        return flt(match.group(1)), flt(match.group(2))
    return None, None


def geocode_address(address):
    """Forward-geocode via Nominatim (best-effort)."""
    if not address:
        return None, None
    lat, lng = parse_location_from_address(address)
    if lat is not None and lng is not None:
        return lat, lng
    try:
        import requests

        response = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": address[:200], "format": "json", "limit": 1},
            headers={"User-Agent": "HealthEcosystem/1.0 (phlebo-gps)"},
            timeout=8,
        )
        response.raise_for_status()
        rows = response.json()
        if rows:
            return flt(rows[0]["lat"]), flt(rows[0]["lon"])
    except Exception:
        frappe.log_error(title="phase20_geocode", message=frappe.get_traceback())
    return None, None


def resolve_trf_coordinates(trf_row):
    """Return (lat, lng) for a TRF row or name; persist when geocoded."""
    if isinstance(trf_row, str):
        trf_row = frappe.db.get_value(
            "Customer TRF",
            trf_row,
            ["name", "collection_address", "collection_latitude", "collection_longitude"],
            as_dict=True,
        )
    if not trf_row:
        return None, None

    lat = flt(trf_row.get("collection_latitude"))
    lng = flt(trf_row.get("collection_longitude"))
    if lat and lng:
        return lat, lng

    lat, lng = parse_location_from_address(trf_row.get("collection_address"))
    if lat is not None and lng is not None:
        _persist_trf_coords(trf_row["name"], lat, lng)
        return lat, lng

    lat, lng = geocode_address(trf_row.get("collection_address"))
    if lat is not None and lng is not None:
        _persist_trf_coords(trf_row["name"], lat, lng)
    return lat, lng


def _persist_trf_coords(trf_name, lat, lng):
    try:
        frappe.db.set_value(
            "Customer TRF",
            trf_name,
            {"collection_latitude": lat, "collection_longitude": lng},
            update_modified=False,
        )
    except Exception:
        pass


def _location_cache():
    return frappe.cache()


def update_phlebotomist_location(user, latitude, longitude, on_duty=True):
    payload = {
        "user": user,
        "latitude": flt(latitude),
        "longitude": flt(longitude),
        "on_duty": 1 if on_duty else 0,
        "updated_at": str(now_datetime()),
    }
    _location_cache().hset(CACHE_KEY, user, json.dumps(payload))
    return payload


def get_phlebotomist_location(user):
    raw = _location_cache().hget(CACHE_KEY, user)
    if not raw:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode()
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None


def get_hub_coordinates(hub_name):
    if not hub_name:
        return None
    row = frappe.db.get_value(
        "Franchisee Profile",
        hub_name,
        ["name", "franchise_name", "branch_code", "address", "hub_latitude", "hub_longitude", "geofence_radius_m"],
        as_dict=True,
    )
    if not row:
        return None
    lat = flt(row.hub_latitude)
    lng = flt(row.hub_longitude)
    if not (lat and lng) and row.address:
        lat, lng = geocode_address(row.address)
        if lat and lng:
            frappe.db.set_value(
                "Franchisee Profile",
                hub_name,
                {"hub_latitude": lat, "hub_longitude": lng},
                update_modified=False,
            )
    row["hub_latitude"] = lat
    row["hub_longitude"] = lng
    row["geofence_radius_m"] = cint(row.geofence_radius_m) or DEFAULT_GEOFENCE_M
    return row


def osrm_route(coordinates):
    """Fetch driving route polyline from OSRM. coordinates: list of (lat, lng)."""
    if len(coordinates) < 2:
        return None
    base = frappe.conf.get("osrm_base_url") or OSRM_DEFAULT
    coord_str = ";".join(f"{flt(lng)},{flt(lat)}" for lat, lng in coordinates)
    url = f"{base.rstrip('/')}/route/v1/driving/{coord_str}?overview=full&geometries=geojson"
    try:
        import requests

        response = requests.get(url, timeout=12)
        response.raise_for_status()
        data = response.json()
        if data.get("code") != "Ok":
            return None
        route = (data.get("routes") or [{}])[0]
        return {
            "distance_m": flt(route.get("distance")),
            "duration_s": flt(route.get("duration")),
            "geometry": (route.get("geometry") or {}).get("coordinates") or [],
        }
    except Exception:
        frappe.log_error(title="phase20_osrm", message=frappe.get_traceback())
        return None


def build_map_payload(user, roles):
    from health_ecosystem_core.health_ecosystem_core.clinical_iam import (
        franchise_for_phlebotomist,
        is_phlebotomist,
        is_staff,
        phlebotomist_trf_ids,
    )

    hub_name = franchise_for_phlebotomist(user)
    hub = get_hub_coordinates(hub_name)

    fields = [
        "name",
        "patient_name",
        "patient_phone",
        "collection_address",
        "collection_latitude",
        "collection_longitude",
        "collection_slot",
        "unique_barcode",
        "test_required",
        "order_status",
        "creation",
    ]
    if hub_name and is_phlebotomist(roles) and not is_staff(roles):
        filters = {"franchisee_id": hub_name, "order_status": ("in", ["Booked", "Sample Collected"])}
    elif is_phlebotomist(roles):
        trf_ids = phlebotomist_trf_ids(user)
        if not trf_ids:
            filters = None
        else:
            filters = {"name": ("in", trf_ids), "order_status": ("in", ["Booked", "Sample Collected"])}
    else:
        filters = {"order_status": ("in", ["Booked", "Sample Collected"])}

    stops = []
    if filters:
        rows = frappe.get_all("Customer TRF", filters=filters, fields=fields, order_by="creation asc", limit=50)
        for row in rows:
            lat, lng = resolve_trf_coordinates(row)
            if lat is None or lng is None:
                continue
            test_name = frappe.db.get_value("Item", row.test_required, "item_name") or row.test_required
            stops.append(
                {
                    "trf_id": row.name,
                    "patient_name": row.patient_name,
                    "patient_phone": row.patient_phone,
                    "collection_address": row.collection_address,
                    "latitude": lat,
                    "longitude": lng,
                    "order_status": row.order_status,
                    "barcode": row.unique_barcode,
                    "test_name": test_name,
                    "collection_slot": str(row.collection_slot) if row.collection_slot else None,
                }
            )

    phlebo_loc = get_phlebotomist_location(user)
    route = None
    if phlebo_loc and phlebo_loc.get("on_duty") and stops:
        booked = [s for s in stops if s["order_status"] == "Booked"]
        waypoints = [(phlebo_loc["latitude"], phlebo_loc["longitude"])]
        waypoints.extend((s["latitude"], s["longitude"]) for s in booked)
        if len(waypoints) >= 2:
            route = osrm_route(waypoints)

    return {
        "hub": hub,
        "phlebotomist": phlebo_loc,
        "stops": stops,
        "route": route,
    }


def phlebotomist_hub_checkin(user, latitude, longitude):
    from health_ecosystem_core.health_ecosystem_core.clinical_iam import franchise_for_phlebotomist

    hub_name = franchise_for_phlebotomist(user)
    if not hub_name:
        frappe.throw(_("No franchise hub linked to your account"))

    hub = get_hub_coordinates(hub_name)
    if not hub or not (flt(hub.get("hub_latitude")) and flt(hub.get("hub_longitude"))):
        frappe.throw(_("Hub GPS coordinates are not set — ask admin to set hub latitude/longitude in Desk"))

    lat = flt(latitude)
    lng = flt(longitude)
    radius = cint(hub.get("geofence_radius_m")) or DEFAULT_GEOFENCE_M
    distance = haversine_m(lat, lng, hub["hub_latitude"], hub["hub_longitude"])
    if distance > radius:
        frappe.throw(
            _(
                "You are {0:.0f}m from the hub — move within {1}m to check in. "
                "Hub is at lat {2}, lng {3}. "
                "If you copied from Google Maps, use latitude first (e.g. 22.57), longitude second (e.g. 88.36) — not swapped."
            ).format(distance, radius, hub["hub_latitude"], hub["hub_longitude"])
        )

    checkin_name = None
    if frappe.db.exists("DocType", "Employee Checkin"):
        employee = frappe.db.get_value("Employee", {"user_id": user, "status": "Active"})
        if employee:
            doc = frappe.get_doc(
                {
                    "doctype": "Employee Checkin",
                    "employee": employee,
                    "log_type": "IN",
                    "latitude": lat,
                    "longitude": lng,
                    "time": now_datetime(),
                }
            )
            doc.insert(ignore_permissions=True)
            checkin_name = doc.name

    update_phlebotomist_location(user, lat, lng, on_duty=True)
    frappe.db.commit()
    return {
        "ok": True,
        "distance_m": round(distance, 1),
        "geofence_radius_m": radius,
        "employee_checkin": checkin_name,
        "message": _("Checked in at {0}").format(hub.get("franchise_name") or hub_name),
    }


def setup_phase20():
    ensure_phase20_custom_fields()
    frappe.clear_cache(doctype="Customer TRF")
    frappe.clear_cache(doctype="Franchisee Profile")
    return {"ok": True, "phase": 20}


def smoke_phase20():
    """GPS helpers + custom fields + OSRM/map payload smoke (no live phlebo required)."""
    result = {"ok": True, "checks": []}

    def check(name, cond, detail=""):
        result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
        if not cond:
            result["ok"] = False

    setup = setup_phase20()
    check("setup", setup.get("ok"))

    # Custom fields
    trf_meta = frappe.get_meta("Customer TRF") if frappe.db.exists("DocType", "Customer TRF") else None
    check(
        "trf_lat_field",
        bool(trf_meta and trf_meta.has_field("collection_latitude")),
        "collection_latitude",
    )
    check(
        "trf_lng_field",
        bool(trf_meta and trf_meta.has_field("collection_longitude")),
        "collection_longitude",
    )
    fr_meta = frappe.get_meta("Franchisee Profile") if frappe.db.exists("DocType", "Franchisee Profile") else None
    check("hub_lat_field", bool(fr_meta and fr_meta.has_field("hub_latitude")))
    check("geofence_field", bool(fr_meta and fr_meta.has_field("geofence_radius_m")))

    # Haversine: ~111km per degree latitude
    d = haversine_m(12.97, 77.59, 12.98, 77.59)
    check("haversine", 1000 < d < 1300, f"d={d:.1f}m")

    # Inside 100m geofence vs outside
    near = haversine_m(12.97, 77.59, 12.9705, 77.59)
    check("geofence_near", near < 100, f"near={near:.1f}m")
    far = haversine_m(12.97, 77.59, 13.0, 77.59)
    check("geofence_far", far > 100, f"far={far:.1f}m")

    # Location tag parse
    lat, lng = parse_location_from_address("Home [Location: 12.9716, 77.5946]")
    check("parse_location_tag", abs(flt(lat) - 12.9716) < 0.001 and abs(flt(lng) - 77.5946) < 0.001, f"{lat},{lng}")

    # Cache location update (Administrator as stand-in)
    user = frappe.session.user if frappe.session.user != "Guest" else "Administrator"
    loc = update_phlebotomist_location(user, 12.9716, 77.5946, on_duty=True)
    check("location_ping", bool(loc.get("latitude")), str(loc))
    update_phlebotomist_location(user, 0, 0, on_duty=False)

    # Map payload callable
    try:
        roles = frappe.get_roles(user)
        payload = build_map_payload(user, roles)
        check(
            "map_payload",
            isinstance(payload, dict) and ("stops" in payload or "hub" in payload or "phlebotomist" in payload),
            str(list(payload.keys())[:10]),
        )
    except Exception as exc:
        check("map_payload", False, str(exc)[:160])

    # OSRM short route (best-effort; don't fail smoke if public OSRM down)
    route = osrm_route([(12.9716, 77.5946), (12.9750, 77.6000)])
    result["checks"].append(
        {
            "name": "osrm_route",
            "pass": True,
            "detail": (
                f"distance_m={route.get('distance_m')}" if route else "OSRM unavailable (non-blocking)"
            ),
        }
    )

    # API whitelists
    from health_ecosystem_core.health_ecosystem_core import api as api_mod

    check("api_update_location", hasattr(api_mod, "phlebotomist_update_location"))
    check("api_hub_checkin", hasattr(api_mod, "phlebotomist_hub_checkin"))
    check("api_map", hasattr(api_mod, "get_phlebotomist_map_data"))

    return result


def _client_ip():
    forwarded = frappe.get_request_header("X-Forwarded-For") or frappe.get_request_header("X-Real-IP")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return frappe.local.request_ip or ""


def approximate_location_from_ip(ip=None):
    """City-level fallback when browser GPS is blocked (e.g. HTTP site)."""
    ip = (ip or _client_ip() or "").strip()
    if not ip or ip in ("127.0.0.1", "::1"):
        return None

    try:
        import requests

        response = requests.get(
            f"http://ip-api.com/json/{ip}",
            params={"fields": "status,lat,lon,city,regionName,country"},
            timeout=6,
        )
        response.raise_for_status()
        data = response.json()
        if data.get("status") != "success":
            return None
        return {
            "latitude": flt(data.get("lat")),
            "longitude": flt(data.get("lon")),
            "city": data.get("city"),
            "region": data.get("regionName"),
            "country": data.get("country"),
            "source": "ip",
        }
    except Exception:
        frappe.log_error(title="approximate_location_from_ip", message=frappe.get_traceback())
        return None
