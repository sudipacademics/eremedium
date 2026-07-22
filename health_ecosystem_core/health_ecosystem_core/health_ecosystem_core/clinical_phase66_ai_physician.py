"""Phase 66 — AI Physician virtual patient journey (symptom chat → offerings + nearby hubs)."""

from __future__ import annotations

import json
import math
import re
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import frappe
from frappe import _
from frappe.utils import cint, flt

DISCLAIMER = (
    "This is not a medical diagnosis. Suggestions are based on your symptoms and our available "
    "lab tests, packages, and physician services. Seek emergency care for severe chest pain, "
    "breathing difficulty, stroke signs, or uncontrolled bleeding."
)

FOLLOW_UP_QUESTIONS = (
    "How long have you had these symptoms (days / weeks)?",
    "How severe are they on a scale of 1–10?",
    "Any fever, weight loss, or night sweats?",
    "Do you have diabetes, thyroid, heart, or kidney conditions already diagnosed?",
)

# Keyword → lab search hints / specialty hints for rule-based path
SYMPTOM_MAP = (
    (("fever", "temperature", "chills", "flu"), ["CBC", "CRP", "MALARIA", "WIDAL", "URINE"], "General Medicine"),
    (("cough", "cold", "sore throat", "congestion"), ["CBC", "CRP", "CHEST"], "General Medicine"),
    (("diabetes", "sugar", "thirst", "polyuria", "hba1c"), ["GLUCOSE", "FBS", "HBA1C", "LIPID", "KIDNEY"], "Endocrinology"),
    (("thyroid", "fatigue", "weight gain", "hair fall", "tsh"), ["THYROID", "T3", "T4", "TSH"], "Endocrinology"),
    (("chest pain", "palpitation", "bp", "hypertension", "heart"), ["LIPID", "ECG", "TROPONIN", "CBC"], "Cardiology"),
    (("stomach", "abdomen", "nausea", "vomit", "diarrhea", "constipation"), ["LFT", "LIPASE", "STOOL", "CBC"], "Gastroenterology"),
    (("urine", "burning", "uti", "kidney"), ["URINE", "KIDNEY", "CREATININE", "CBC"], "Nephrology"),
    (("joint", "arthritis", "back pain", "knee", "physio", "sprain", "stiff"), ["RA", "URIC", "CRP", "CBC", "VITAMIN D"], "Physiotherapy"),
    (("weakness", "anemia", "pale", "dizziness"), ["CBC", "IRON", "B12", "VITAMIN D"], "General Medicine"),
    (("pregnancy", "antenatal", "pregnant"), ["CBC", "TSH", "GLUCOSE", "URINE", "BLOOD GROUP"], "Obstetrics"),
    (("skin", "rash", "allergy", "itch", "acne", "pigment", "cosmetic", "botox", "filler"), ["CBC", "IGE", "ALLERGY"], "Aesthetic Dermatology"),
    (("headache", "migraine", "vertigo"), ["CBC", "LIPID", "THYROID"], "Neurology"),
    (("liver", "jaundice", "alcohol"), ["LFT", "HEPATITIS", "CBC"], "Gastroenterology"),
    (("anxiety", "depression", "stress", "panic", "therapy", "counselling", "counseling"), ["CBC", "THYROID", "VITAMIN D"], "Psychology"),
    (("yoga", "mindfulness", "meditation", "breathwork"), ["CBC", "VITAMIN D"], "Yoga & Mindfulness"),
    (("full body", "checkup", "annual", "package"), ["FULL BODY", "ESSENTIAL", "COMPREHENSIVE"], "General Medicine"),
)

# Doctor/service bucket priority: wellness wings before generic doctor consult
PRIORITY_WELLNESS_WINGS = (
    "aesthetics",
    "physiotherapy",
    "yoga",
    "psychology",
    "chiropractic",
    "ayurvedic",
)

# Symptom keywords → allied-health wing ids (matched wings ranked first within priority list)
WELLNESS_SYMPTOM_MAP = (
    (
        (
            "acne",
            "pigment",
            "cosmetic",
            "botox",
            "filler",
            "wrinkle",
            "scar",
            "laser",
            "aesthet",
            "skin",
            "rash",
            "itch",
            "hair fall",
            "dermat",
        ),
        "aesthetics",
    ),
    (
        (
            "physio",
            "physiotherapy",
            "rehab",
            "back pain",
            "knee",
            "joint",
            "sprain",
            "stiff",
            "posture",
            "sports injury",
            "muscle pain",
            "shoulder",
            "neck pain",
        ),
        "physiotherapy",
    ),
    (
        (
            "yoga",
            "mindfulness",
            "meditation",
            "breathwork",
            "pranayama",
            "flexibility",
            "relaxation class",
        ),
        "yoga",
    ),
    (
        (
            "anxiety",
            "depression",
            "stress",
            "panic",
            "psychotherapy",
            "counselling",
            "counseling",
            "mental health",
            "burnout",
            "trauma",
            "sleep problem",
            "insomnia",
            "cbt",
            "talk therapy",
        ),
        "psychology",
    ),
    (("chiro", "spine", "alignment", "osteopath"), "chiropractic"),
    (("ayurved", "panchakarma", "naturopath", "dosha"), "ayurvedic"),
)


def _openai_key():
    try:
        s = frappe.get_single("Health Ecosystem Settings")
        # Password field — must use get_password; getattr returns encrypted/masked junk.
        try:
            key = s.get_password("telephony_openai_api_key", raise_exception=False)
        except Exception:
            key = None
        return (key or "").strip()
    except Exception:
        return ""


def _session_key(session_id):
    return f"ai_physician:{session_id}"


def _save_session(session_id, data, ttl=3600):
    frappe.cache().set_value(_session_key(session_id), data, expires_in_sec=ttl)


def _load_session(session_id):
    return frappe.cache().get_value(_session_key(session_id)) or {}


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def find_nearby_collection_centers(latitude, longitude, radius_km=25, limit=5):
    """Return active franchisee hubs sorted by distance (requires hub_latitude/longitude)."""
    latitude, longitude = flt(latitude), flt(longitude)
    if not (latitude and longitude):
        return []

    meta = frappe.get_meta("Franchisee Profile")
    fields = [
        "name",
        "franchise_name",
        "branch_code",
        "territory_region",
        "address",
        "contact_phone",
    ]
    if meta.has_field("hub_latitude"):
        fields += ["hub_latitude", "hub_longitude"]

    rows = frappe.get_all(
        "Franchisee Profile",
        filters={"active_status": "Active"},
        fields=fields,
        limit=200,
    )
    nearby = []
    for row in rows:
        lat = flt(row.get("hub_latitude"))
        lng = flt(row.get("hub_longitude"))
        if not (lat and lng):
            continue
        dist = haversine_km(latitude, longitude, lat, lng)
        if dist <= flt(radius_km) or radius_km <= 0:
            nearby.append(
                {
                    "franchisee_id": row.name,
                    "franchise_name": row.franchise_name,
                    "branch_code": row.branch_code,
                    "territory_region": row.territory_region,
                    "address": row.address,
                    "contact_phone": row.contact_phone,
                    "latitude": lat,
                    "longitude": lng,
                    "distance_km": round(dist, 2),
                    "book_lab_path": f"/diagnostics?hub={row.name}",
                    "book_doctor_path": "/appointments/book",
                }
            )
    nearby.sort(key=lambda x: x["distance_km"])
    return nearby[: cint(limit) or 5]


def _search_lab_items(hints, limit=6):
    from health_ecosystem_core.health_ecosystem_core.api import LAB_ITEM_GROUPS, _item_pricing

    found = []
    seen = set()
    for hint_idx, hint in enumerate(hints):
        hint = (hint or "").strip()
        if not hint:
            continue
        rows = frappe.get_all(
            "Item",
            filters={
                "disabled": 0,
                "is_sales_item": 1,
                "item_group": ("in", list(LAB_ITEM_GROUPS)),
            },
            or_filters=[
                ["item_name", "like", f"%{hint}%"],
                ["name", "like", f"%{hint}%"],
                ["description", "like", f"%{hint}%"],
            ],
            fields=["name", "item_name", "item_group", "description"],
            limit=8,
        )
        for row in rows:
            if row.name in seen:
                continue
            seen.add(row.name)
            rate, mrp = _item_pricing(row.name)
            # Earlier symptom hints → higher prior probability
            prior = max(40, 94 - hint_idx * 8)
            found.append(
                {
                    "kind": "lab_test",
                    "item_code": row.name,
                    "item_name": row.item_name,
                    "item_group": row.item_group,
                    "rate": rate,
                    "mrp": mrp or None,
                    "reason": f"Matched for “{hint}”",
                    "match_hint": hint,
                    "match_rank": hint_idx,
                    "probability": prior,
                    "book_path": f"/diagnostics/book/{row.name}",
                    "detail_path": f"/diagnostics/test/{row.name}",
                }
            )
            if len(found) >= limit:
                return _rank_by_probability(found)
    return _rank_by_probability(found)


def _rank_by_probability(items):
    """Sort by probability desc and re-normalize display probabilities."""
    if not items:
        return []
    ranked = sorted(items, key=lambda x: (-cint(x.get("probability") or 0), x.get("item_name") or ""))
    n = len(ranked)
    out = []
    for i, item in enumerate(ranked):
        base = cint(item.get("probability") or 70)
        # Soft decay by display order so top is most probable
        prob = max(32, min(96, base - i * max(4, int(28 / max(n, 1)))))
        row = dict(item)
        row["probability"] = prob
        row["probability_label"] = f"{prob}% match"
        out.append(row)
    return out


def _search_packages(hints, limit=3):
    if not frappe.db.exists("DocType", "Lab Test Panel"):
        return []
    found = []
    seen = set()
    for hint_idx, hint in enumerate(hints):
        rows = frappe.get_all(
            "Lab Test Panel",
            filters={"show_on_mobile": 1},
            or_filters=[
                ["panel_name", "like", f"%{hint}%"],
                ["name", "like", f"%{hint}%"],
            ],
            fields=["name", "panel_name", "panel_rate", "description"],
            limit=5,
        )
        for row in rows:
            if row.name in seen:
                continue
            seen.add(row.name)
            found.append(
                {
                    "kind": "package",
                    "panel_id": row.name,
                    "item_name": row.panel_name,
                    "rate": flt(row.panel_rate),
                    "reason": f"Health package related to “{hint}”",
                    "probability": max(55, 90 - hint_idx * 6),
                    "book_path": f"/diagnostics/panel/{row.name}",
                }
            )
            if len(found) >= limit:
                return _rank_by_probability(found)

    if not found:
        rows = frappe.get_all(
            "Lab Test Panel",
            filters={"show_on_mobile": 1},
            fields=["name", "panel_name", "panel_rate", "description"],
            limit=limit,
            order_by="panel_rate asc",
        )
        for i, row in enumerate(rows):
            found.append(
                {
                    "kind": "package",
                    "panel_id": row.name,
                    "item_name": row.panel_name,
                    "rate": flt(row.panel_rate),
                    "reason": "Recommended health package",
                    "probability": max(50, 85 - i * 5),
                    "book_path": f"/diagnostics/panel/{row.name}",
                }
            )
    return _rank_by_probability(found[:limit])


def _keyword_in(text, key):
    """Match keyword in text; short tokens require word boundaries (avoid therapy⊂physiotherapy)."""
    key = (key or "").lower().strip()
    if not key:
        return False
    text = text or ""
    if " " in key or len(key) >= 8:
        return key in text
    return re.search(rf"(?<![a-z0-9]){re.escape(key)}(?![a-z0-9])", text) is not None


def _match_wellness_wings(text):
    """Return priority wing ids: symptom-matched first, then remaining priority wings."""
    text_l = (text or "").lower()
    matched = []
    for keys, wing_id in WELLNESS_SYMPTOM_MAP:
        if any(_keyword_in(text_l, k) for k in keys) and wing_id not in matched:
            matched.append(wing_id)
    # Keep global priority order among matches, then fill remaining priority wings
    ordered = [w for w in PRIORITY_WELLNESS_WINGS if w in matched]
    for w in PRIORITY_WELLNESS_WINGS:
        if w not in ordered:
            ordered.append(w)
    return ordered, matched


def _allied_service_suggestions(transcript, limit=4):
    """Prefer aesthetics, physio, yoga, psychotherapy & related wellness services."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase31_allied_health import (
            ALLIED_WINGS,
            WING_BY_ID,
            _load_services,
        )
    except Exception:
        return [], []

    wing_order, matched_wings = _match_wellness_wings(transcript)
    services = _load_services() or []
    if not services:
        # Fallback: wing landing cards when CSV not loaded
        out = []
        for i, wing_id in enumerate(wing_order[:limit]):
            wing = WING_BY_ID.get(wing_id) or next((w for w in ALLIED_WINGS if w["id"] == wing_id), None)
            if not wing:
                continue
            boosted = wing_id in matched_wings
            out.append(
                {
                    "kind": "wellness",
                    "service": wing["title"],
                    "department": wing["department_name"],
                    "wing_id": wing_id,
                    "reason": (
                        f"Priority match for your symptoms — {wing['subtitle']}"
                        if boosted
                        else f"Recommended wellness service — {wing['subtitle']}"
                    ),
                    "book_path": f"/wellness/{wing_id}",
                    "probability": (96 - i * 4) if boosted else (82 - i * 3),
                }
            )
        return out, matched_wings

    text_l = (transcript or "").lower()
    tokens = [t for t in re.split(r"[^a-z0-9]+", text_l) if len(t) >= 4]
    found, seen = [], set()
    per_wing = {w: 0 for w in wing_order}

    def _score_service(svc, wing_idx, boosted):
        name = (svc.get("service_name") or "").lower()
        desc = (svc.get("short_description") or "").lower()
        blob = f"{name} {desc}"
        hit = sum(1 for t in tokens if t in blob)
        # Matched wings + name hits win; aesthetics/physio/yoga/psychotherapy stay on top
        base = 94 - wing_idx * 5
        if boosted:
            base += 6
        base += min(8, hit * 3)
        # Prefer assessment / initial / consultation style entry services
        if any(k in name for k in ("initial", "assessment", "consultation", "session", "therapy")):
            base += 2
        return min(98, base)

    for wing_idx, wing_id in enumerate(wing_order):
        wing_svcs = [s for s in services if s.get("wing_id") == wing_id]
        # Prefer services whose name overlaps symptom text, else catalog order
        scored = []
        for svc in wing_svcs:
            scored.append((_score_service(svc, wing_idx, wing_id in matched_wings), svc))
        scored.sort(key=lambda x: (-x[0], x[1].get("service_name") or ""))
        for score, svc in scored:
            code = svc.get("service_code")
            if not code or code in seen:
                continue
            if per_wing[wing_id] >= 2 and len(found) >= 2:
                # Cap per wing once we already have a couple of suggestions
                continue
            seen.add(code)
            per_wing[wing_id] += 1
            found.append(
                {
                    "kind": "wellness",
                    "service": svc.get("service_name") or svc.get("wing_title"),
                    "department": svc.get("department_name") or svc.get("wing_title"),
                    "wing_id": wing_id,
                    "service_code": code,
                    "rate": flt(svc.get("rate")),
                    "reason": (
                        f"Priority {svc.get('wing_title')} service for your symptoms"
                        if wing_id in matched_wings
                        else f"Recommended {svc.get('wing_title')} offering"
                    ),
                    "book_path": f"/wellness/{wing_id}/book/{code}",
                    "probability": score,
                }
            )
            if len(found) >= limit:
                return found, matched_wings

    return found, matched_wings


def _physician_suggestions(specialty_hint, transcript="", limit=5):
    """
    Doctor / service bucket priority:
    1) Aesthetics / cosmetic dermatology
    2) Physiotherapy
    3) Yoga
    4) Psychotherapy / psychology
    5) Other wellness (chiro, ayurveda)
    then generic doctor / teleconsult as fallback.
    """
    suggestions, matched_wings = _allied_service_suggestions(transcript, limit=max(4, limit))
    # Generic clinical options after priority wellness
    suggestions.extend(
        [
            {
                "kind": "physician",
                "service": "Doctor Consultation",
                "department": specialty_hint or "General Medicine",
                "reason": f"Clinical review for {specialty_hint or 'your symptoms'}",
                "book_path": "/appointments/book",
                "probability": 70 if matched_wings else 78,
            },
            {
                "kind": "teleconsult",
                "service": "Teleconsultation",
                "department": specialty_hint or "General Medicine",
                "reason": "Talk to a doctor online before or after tests",
                "book_path": "/telemedicine",
                "probability": 64 if matched_wings else 72,
            },
        ]
    )
    if frappe.db.exists("DocType", "Healthcare Practitioner"):
        rows = frappe.get_all(
            "Healthcare Practitioner",
            filters={"status": "Active"} if frappe.get_meta("Healthcare Practitioner").has_field("status") else {},
            fields=["name", "practitioner_name", "department"],
            limit=2,
        )
        for row in rows:
            suggestions.append(
                {
                    "kind": "physician",
                    "service": row.practitioner_name or row.name,
                    "department": row.department or specialty_hint or "General Medicine",
                    "practitioner": row.name,
                    "reason": "Available physician on our platform",
                    "book_path": f"/appointments/book?doctor={row.name}",
                    "probability": 58,
                }
            )
    out, seen = [], set()
    for s in suggestions:
        key = (s.get("service"), s.get("department"), s.get("wing_id") or "")
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) >= limit:
            break
    return _rank_by_probability(out)


def _match_symptom_hints(text):
    text_l = (text or "").lower()
    hints, specialty = [], "General Medicine"
    for keys, lab_hints, spec in SYMPTOM_MAP:
        if any(k in text_l for k in keys):
            hints.extend(lab_hints)
            specialty = spec
    if not hints:
        hints = ["CBC", "THYROID", "LIPID", "GLUCOSE"]
    # unique preserve order
    seen, uniq = set(), []
    for h in hints:
        if h not in seen:
            seen.add(h)
            uniq.append(h)
    return uniq, specialty


def build_recommendations(transcript, latitude=None, longitude=None):
    """Ordered for UI: 1) health packages 2) doctor/services 3) individual tests (by probability)."""
    hints, specialty = _match_symptom_hints(transcript)
    health_packages = _search_packages(hints + ["checkup", "package", "full body"], limit=3)
    physicians = _physician_suggestions(specialty, transcript=transcript, limit=5)
    individual_tests = _search_lab_items(hints, limit=6)
    centers = []
    if latitude and longitude:
        centers = find_nearby_collection_centers(latitude, longitude, radius_km=40, limit=4)
    if not centers:
        # Fallback: list a few active hubs without distance
        rows = frappe.get_all(
            "Franchisee Profile",
            filters={"active_status": "Active"},
            fields=["name", "franchise_name", "branch_code", "address", "contact_phone", "territory_region"],
            limit=4,
            order_by="franchise_name asc",
        )
        centers = [
            {
                "franchisee_id": r.name,
                "franchise_name": r.franchise_name,
                "branch_code": r.branch_code,
                "address": r.address,
                "contact_phone": r.contact_phone,
                "territory_region": r.territory_region,
                "distance_km": None,
                "book_lab_path": f"/diagnostics?hub={r.name}",
                "book_doctor_path": "/appointments/book",
            }
            for r in rows
        ]

    return {
        # Canonical ordered buckets
        "health_packages": health_packages,
        "physician_services": physicians,
        "individual_tests": individual_tests,
        "nearby_centers": centers,
        # Back-compat alias (packages + tests) for older clients
        "diagnostic_workup": health_packages + individual_tests,
        "specialty_hint": specialty,
        "matched_hints": hints,
        "suggestion_order": ["health_packages", "physician_services", "individual_tests", "nearby_centers"],
    }


def _openai_journey_turn(messages):
    """Optional LLM refinement; returns assistant text or None."""
    key = _openai_key()
    if not key:
        return None
    payload = json.dumps(
        {
            "model": "gpt-4o-mini",
            "temperature": 0.3,
            "messages": messages,
        }
    ).encode("utf-8")
    req = Request(
        "https://api.openai.com/v1/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return (data.get("choices") or [{}])[0].get("message", {}).get("content")
    except Exception:
        frappe.log_error(title="ai_physician_openai", message=frappe.get_traceback())
        return None


def start_ai_physician_journey(symptoms, latitude=None, longitude=None):
    symptoms = (symptoms or "").strip()
    if not symptoms:
        frappe.throw(_("Please describe your symptoms"))

    session_id = frappe.generate_hash(length=12)
    session = {
        "symptoms": symptoms,
        "answers": [],
        "question_index": 0,
        "latitude": flt(latitude) or None,
        "longitude": flt(longitude) or None,
        "messages": [
            {"role": "user", "content": symptoms},
        ],
    }
    first_q = FOLLOW_UP_QUESTIONS[0]
    bot = (
        f"I’m your Remedium virtual care guide. Thanks for sharing: “{symptoms}”. "
        f"{DISCLAIMER}\n\nTo suggest the right workup from our offerings — {first_q}"
    )
    session["messages"].append({"role": "assistant", "content": bot})
    _save_session(session_id, session)

    return {
        "session_id": session_id,
        "phase": "questions",
        "message": bot,
        "question": first_q,
        "question_index": 0,
        "total_questions": len(FOLLOW_UP_QUESTIONS),
        "suggestions": None,
        "disclaimer": DISCLAIMER,
        "openai_enabled": bool(_openai_key()),
    }


def continue_ai_physician_journey(session_id, message, latitude=None, longitude=None):
    session = _load_session(session_id)
    if not session:
        frappe.throw(_("Chat session expired. Please start again."))

    message = (message or "").strip()
    if not message:
        frappe.throw(_("Please reply to continue"))

    if latitude:
        session["latitude"] = flt(latitude)
    if longitude:
        session["longitude"] = flt(longitude)

    session.setdefault("answers", []).append(message)
    session.setdefault("messages", []).append({"role": "user", "content": message})
    idx = cint(session.get("question_index")) + 1
    session["question_index"] = idx

    # Still asking follow-ups
    if idx < len(FOLLOW_UP_QUESTIONS):
        q = FOLLOW_UP_QUESTIONS[idx]
        bot = f"Got it. {q}"
        # Optional LLM polish
        llm = _openai_journey_turn(
            [
                {
                    "role": "system",
                    "content": (
                        "You are a careful virtual triage assistant for a diagnostics company. "
                        "Ask only the next clarifying question provided; do not diagnose. "
                        f"Next question to ask: {q}"
                    ),
                },
                *[{"role": m["role"], "content": m["content"]} for m in session["messages"][-6:]],
            ]
        )
        if llm:
            bot = llm.strip()
        session["messages"].append({"role": "assistant", "content": bot})
        _save_session(session_id, session)
        return {
            "session_id": session_id,
            "phase": "questions",
            "message": bot,
            "question": q,
            "question_index": idx,
            "total_questions": len(FOLLOW_UP_QUESTIONS),
            "suggestions": None,
            "disclaimer": DISCLAIMER,
        }

    # Enough context → recommendations
    transcript = " | ".join(
        [session.get("symptoms") or ""] + list(session.get("answers") or [])
    )
    suggestions = build_recommendations(
        transcript,
        latitude=session.get("latitude"),
        longitude=session.get("longitude"),
    )

    summary_bits = []
    if suggestions.get("health_packages"):
        summary_bits.append(
            "Packages: " + ", ".join(x["item_name"] for x in suggestions["health_packages"][:3])
        )
    if suggestions.get("physician_services"):
        summary_bits.append(
            "Physician / services: "
            + ", ".join(x["service"] for x in suggestions["physician_services"][:3])
        )
    if suggestions.get("individual_tests"):
        top = suggestions["individual_tests"][0]
        summary_bits.append(
            f"Top test: {top['item_name']} ({top.get('probability_label') or str(top.get('probability')) + '%'})"
        )
    if suggestions["nearby_centers"]:
        c0 = suggestions["nearby_centers"][0]
        dist = f" (~{c0['distance_km']} km)" if c0.get("distance_km") is not None else ""
        summary_bits.append(f"Nearby centre: {c0['franchise_name']}{dist}")

    bot = (
        "Based on what you shared, here are suggested options from our catalogue "
        "(packages first, then priority wellness services — aesthetics, physiotherapy, yoga, "
        "psychotherapy — then individual tests by likelihood). "
        + " ".join(summary_bits)
        + f"\n\n{DISCLAIMER}"
    )
    llm = _openai_journey_turn(
        [
            {
                "role": "system",
                "content": (
                    "Summarize triage suggestions briefly for the patient in 2-3 sentences. "
                    "Order: 1) health packages 2) priority wellness/doctor services "
                    "(aesthetics, physiotherapy, yoga, psychotherapy first) "
                    "3) individual tests with likelihood. "
                    "Do not invent tests not listed. Emphasize this is not a diagnosis. "
                    f"Packages: {[x['item_name'] for x in suggestions.get('health_packages') or []]}. "
                    f"Services: {[x['service'] for x in suggestions.get('physician_services') or []]}. "
                    f"Tests: {[(x['item_name'], x.get('probability')) for x in suggestions.get('individual_tests') or []]}."
                ),
            },
            {"role": "user", "content": transcript},
        ]
    )
    if llm:
        bot = llm.strip() + f"\n\n{DISCLAIMER}"

    session["messages"].append({"role": "assistant", "content": bot})
    session["suggestions"] = suggestions
    session["phase"] = "suggestions"
    _save_session(session_id, session)

    return {
        "session_id": session_id,
        "phase": "suggestions",
        "message": bot,
        "question": None,
        "question_index": idx,
        "total_questions": len(FOLLOW_UP_QUESTIONS),
        "suggestions": suggestions,
        "disclaimer": DISCLAIMER,
    }


def setup_phase66():
    return {"ok": True, "phase": 66, "openai_configured": bool(_openai_key())}


def smoke_phase66():
    result = {"ok": True, "checks": []}

    def check(name, cond, detail=""):
        result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
        if not cond:
            result["ok"] = False

    setup = setup_phase66()
    check("setup", setup.get("ok"))
    start = start_ai_physician_journey("fever and body ache for 2 days")
    check("start_session", bool(start.get("session_id")))
    check("start_phase", start.get("phase") == "questions")
    sid = start["session_id"]
    turn = continue_ai_physician_journey(sid, "3 days")
    check("turn_questions", turn.get("phase") == "questions")
    # Finish remaining questions quickly
    while turn.get("phase") == "questions":
        turn = continue_ai_physician_journey(sid, "5")
    check("suggestions_phase", turn.get("phase") == "suggestions")
    sug = turn.get("suggestions") or {}
    check("health_packages", isinstance(sug.get("health_packages"), list))
    check("physician_services", bool(sug.get("physician_services")))
    check("individual_tests", bool(sug.get("individual_tests")))
    if sug.get("individual_tests"):
        check("test_probability", cint(sug["individual_tests"][0].get("probability")) > 0)
    check("nearby_centers", isinstance(sug.get("nearby_centers"), list))
    check(
        "suggestion_order",
        (sug.get("suggestion_order") or [])[:3]
        == ["health_packages", "physician_services", "individual_tests"],
    )
    # Priority wellness: aesthetics / physio / yoga / psychotherapy surface first
    skin = build_recommendations("acne and pigmentation on face")
    skin_svcs = skin.get("physician_services") or []
    check(
        "priority_aesthetics",
        bool(skin_svcs)
        and (
            (skin_svcs[0].get("wing_id") == "aesthetics")
            or ("aesthetic" in (skin_svcs[0].get("department") or "").lower())
            or ("cosmetic" in (skin_svcs[0].get("service") or "").lower())
            or ("aesthet" in (skin_svcs[0].get("service") or "").lower())
        ),
        detail=str([(x.get("wing_id"), x.get("service"), x.get("service_code")) for x in skin_svcs[:3]]),
    )
    check(
        "allied_catalog_loaded",
        any(x.get("service_code") for x in skin_svcs)
        or any(x.get("kind") == "wellness" for x in skin_svcs),
        detail=str(skin_svcs[:1]),
    )
    back = build_recommendations("lower back pain needing physiotherapy")
    back_svcs = back.get("physician_services") or []
    check(
        "priority_physiotherapy",
        bool(back_svcs)
        and (
            back_svcs[0].get("wing_id") == "physiotherapy"
            or "physio" in (back_svcs[0].get("department") or "").lower()
            or "physio" in (back_svcs[0].get("service") or "").lower()
        ),
        detail=str([(x.get("wing_id"), x.get("service")) for x in back_svcs[:3]]),
    )
    mind = build_recommendations("anxiety and depression needing psychotherapy")
    mind_svcs = mind.get("physician_services") or []
    check(
        "priority_psychotherapy",
        bool(mind_svcs)
        and (
            mind_svcs[0].get("wing_id") == "psychology"
            or "psych" in (mind_svcs[0].get("department") or "").lower()
            or "counsel" in (mind_svcs[0].get("service") or "").lower()
        ),
        detail=str([(x.get("wing_id"), x.get("service")) for x in mind_svcs[:3]]),
    )

    from health_ecosystem_core.health_ecosystem_core import api as api_mod

    check("api_start", hasattr(api_mod, "start_ai_physician_journey"))
    check("api_turn", hasattr(api_mod, "ai_physician_turn"))
    check("api_nearby", hasattr(api_mod, "find_nearby_collection_centers"))
    return result
