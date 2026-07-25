"""Phase 66 — AI Physician virtual patient journey (symptom chat → offerings + nearby hubs)."""

from __future__ import annotations

import json
import math
import re

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
    from health_ecosystem_core.health_ecosystem_core.clinical_openai import get_openai_api_key

    return get_openai_api_key()


def _openai_status():
    from health_ecosystem_core.health_ecosystem_core.clinical_openai import openai_runtime_status

    return openai_runtime_status()


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


def _match_wellness_wings(text, preferred_wings=None):
    """Return priority wing ids: symptom-matched first, then remaining priority wings."""
    text_l = (text or "").lower()
    matched = []
    preferred = [w for w in (preferred_wings or []) if w in PRIORITY_WELLNESS_WINGS]
    for w in preferred:
        if w not in matched:
            matched.append(w)
    for keys, wing_id in WELLNESS_SYMPTOM_MAP:
        if any(_keyword_in(text_l, k) for k in keys) and wing_id not in matched:
            matched.append(wing_id)
    # Keep global priority order among matches, then fill remaining priority wings
    ordered = [w for w in PRIORITY_WELLNESS_WINGS if w in matched]
    for w in PRIORITY_WELLNESS_WINGS:
        if w not in ordered:
            ordered.append(w)
    return ordered, matched


def _allied_service_suggestions(transcript, limit=4, preferred_wings=None):
    """Prefer aesthetics, physio, yoga, psychotherapy & related wellness services."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase31_allied_health import (
            ALLIED_WINGS,
            WING_BY_ID,
            _load_services,
        )
    except Exception:
        return [], []

    wing_order, matched_wings = _match_wellness_wings(transcript, preferred_wings=preferred_wings)
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


def _physician_suggestions(specialty_hint, transcript="", limit=5, preferred_wings=None):
    """
    Doctor / service bucket priority:
    1) Aesthetics / cosmetic dermatology
    2) Physiotherapy
    3) Yoga
    4) Psychotherapy / psychology
    5) Other wellness (chiro, ayurveda)
    then generic doctor / teleconsult as fallback.
    """
    suggestions, matched_wings = _allied_service_suggestions(
        transcript, limit=max(4, limit), preferred_wings=preferred_wings
    )
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


def _merge_hints(primary, secondary):
    seen, out = set(), []
    for h in list(primary or []) + list(secondary or []):
        h = (h or "").strip()
        if not h or h in seen:
            continue
        seen.add(h)
        out.append(h)
    return out


def build_recommendations(
    transcript,
    latitude=None,
    longitude=None,
    search_hints=None,
    specialty_hint=None,
    wellness_wings=None,
):
    """Ordered for UI: 1) health packages 2) doctor/services 3) individual tests (by probability)."""
    keyword_hints, keyword_specialty = _match_symptom_hints(transcript)
    hints = _merge_hints(search_hints, keyword_hints) or keyword_hints
    specialty = (specialty_hint or "").strip() or keyword_specialty
    health_packages = _search_packages(hints + ["checkup", "package", "full body"], limit=3)
    physicians = _physician_suggestions(
        specialty, transcript=transcript, limit=5, preferred_wings=wellness_wings
    )
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


MAX_ASK_TURNS = 6

CONDUCTOR_SYSTEM = """You are Remedium's AI care guide for patients in India.
You help people describe symptoms, then point them to Remedium lab packages, tests, doctors, and wellness services.
You are NOT a doctor and must never give a medical diagnosis or prescribe medicines.

Return a single JSON object with keys:
- phase: "ask" | "suggest" | "emergency" | "refine"
- message: warm, specific reply in plain language (1-3 short paragraphs). Speak to THIS patient's words; avoid generic scripts.
- question: one focused follow-up question, or null when phase is suggest/emergency
- quick_replies: 2-4 short tap-friendly answers (strings), or []
- clinical_notes: object with any of onset, severity, associated, history, red_flags (array of strings)
- search_hints: lab/search keywords only (e.g. CBC, CRP, MALARIA, THYROID) — never invent brand/product names
- specialty_hint: e.g. General Medicine, Cardiology, Endocrinology
- wellness_wings: subset of ["aesthetics","physiotherapy","yoga","psychology","chiropractic","ayurvedic"] when relevant

Rules:
- Ask ONE high-yield question at a time, tailored to what they already said. Skip irrelevant canned questions.
- Prefer concrete quick_replies (durations, yes/no, severity bands).
- phase=emergency for: severe chest pain, breathing difficulty, stroke signs, uncontrolled bleeding, suicidal ideation — urge emergency care / nearest ER; still be calm.
- phase=suggest when you have enough to recommend a workup (usually after 2-4 useful answers), or when the user asks for options now.
- phase=refine when suggestions already exist and the user asks why / cheaper / alternatives — update message and hints; do not restart triage.
- Never invent lab test or package names that are not search keywords.
- Keep tone empathetic, concise, and India-aware (fever/dengue/typhoid season, local care pathways).
"""


def _openai_journey_turn(messages):
    """Optional LLM refinement; returns assistant text or None."""
    from health_ecosystem_core.health_ecosystem_core.clinical_openai import openai_chat_completion

    msg = openai_chat_completion(
        messages,
        temperature=0.45,
        timeout=25,
        log_prefix="ai_physician",
    )
    if not msg:
        return None
    return (msg.get("content") or "").strip() or None


def _openai_conductor(session, force_suggest=False, refine=False):
    """Run structured OpenAI turn. Returns parsed dict or None."""
    from health_ecosystem_core.health_ecosystem_core.clinical_openai import openai_json_completion

    turn_count = cint(session.get("turn_count") or 0)
    notes = session.get("clinical_notes") or {}
    extra = []
    if force_suggest:
        extra.append("You must set phase to \"suggest\" now and fill search_hints.")
    if refine:
        extra.append(
            "Suggestions already shown. phase must be \"refine\". Adjust search_hints if the user wants "
            "cheaper / different options; explain using only catalog items we will attach separately."
        )
    elif turn_count >= MAX_ASK_TURNS:
        extra.append(f"Ask-turn limit ({MAX_ASK_TURNS}) reached — set phase to \"suggest\".")

    system = CONDUCTOR_SYSTEM
    if extra:
        system += "\n\n" + " ".join(extra)

    history = [
        {"role": m["role"], "content": m["content"]}
        for m in (session.get("messages") or [])[-12:]
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]
    payload = openai_json_completion(
        [
            {"role": "system", "content": system},
            {
                "role": "system",
                "content": json.dumps(
                    {
                        "turn_count": turn_count,
                        "max_ask_turns": MAX_ASK_TURNS,
                        "prior_clinical_notes": notes,
                        "has_suggestions": bool(session.get("suggestions")),
                    }
                ),
            },
            *history,
        ],
        temperature=0.5,
        timeout=35,
        log_prefix="ai_physician_conductor",
    )
    if not payload:
        return None
    phase = (payload.get("phase") or "ask").strip().lower()
    if phase not in ("ask", "suggest", "emergency", "refine"):
        phase = "ask"
    if force_suggest and phase == "ask":
        phase = "suggest"
    if refine:
        phase = "refine"
    if turn_count >= MAX_ASK_TURNS and phase == "ask":
        phase = "suggest"

    quick = payload.get("quick_replies") or []
    if not isinstance(quick, list):
        quick = []
    quick = [str(x).strip() for x in quick if str(x).strip()][:4]

    hints = payload.get("search_hints") or []
    if not isinstance(hints, list):
        hints = []
    hints = [str(x).strip() for x in hints if str(x).strip()][:10]

    wings = payload.get("wellness_wings") or []
    if not isinstance(wings, list):
        wings = []
    wings = [str(x).strip() for x in wings if str(x).strip() in PRIORITY_WELLNESS_WINGS]

    notes_in = payload.get("clinical_notes") if isinstance(payload.get("clinical_notes"), dict) else {}
    message = (payload.get("message") or "").strip()
    question = payload.get("question")
    if question is not None:
        question = str(question).strip() or None

    return {
        "phase": phase,
        "message": message,
        "question": question,
        "quick_replies": quick,
        "clinical_notes": notes_in,
        "search_hints": hints,
        "specialty_hint": (payload.get("specialty_hint") or "").strip() or None,
        "wellness_wings": wings,
    }


def _merge_clinical_notes(prev, new):
    out = dict(prev or {})
    for k, v in (new or {}).items():
        if v is None or v == "" or v == []:
            continue
        out[k] = v
    return out


def _catalog_snapshot(suggestions):
    """Compact catalog for LLM narration — names/prices only, no invention."""
    return {
        "packages": [
            {"name": x.get("item_name"), "rate": x.get("rate"), "reason": x.get("reason")}
            for x in (suggestions.get("health_packages") or [])[:3]
        ],
        "services": [
            {
                "name": x.get("service"),
                "department": x.get("department"),
                "rate": x.get("rate"),
                "reason": x.get("reason"),
            }
            for x in (suggestions.get("physician_services") or [])[:4]
        ],
        "tests": [
            {
                "name": x.get("item_name"),
                "rate": x.get("rate"),
                "probability": x.get("probability"),
                "reason": x.get("reason"),
            }
            for x in (suggestions.get("individual_tests") or [])[:5]
        ],
        "centres": [
            {
                "name": x.get("franchise_name"),
                "distance_km": x.get("distance_km"),
            }
            for x in (suggestions.get("nearby_centers") or [])[:3]
        ],
    }


def _personalize_suggestions_message(session, suggestions, conductor_message=None):
    catalog = _catalog_snapshot(suggestions)
    llm = _openai_journey_turn(
        [
            {
                "role": "system",
                "content": (
                    "You are Remedium's care guide. Write 2-4 short sentences explaining why these "
                    "Remedium catalogue options fit what the patient shared. "
                    "Use ONLY the names listed in the catalog JSON. Do not invent tests or prices. "
                    "Order: packages, then wellness/doctor services, then individual tests. "
                    "Sound personal, not like a form letter. End without repeating a long legal disclaimer."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "patient_summary": session.get("symptoms"),
                        "answers": session.get("answers") or [],
                        "clinical_notes": session.get("clinical_notes") or {},
                        "conductor_draft": conductor_message or "",
                        "catalog": catalog,
                    }
                ),
            },
        ]
    )
    if llm:
        return llm.strip() + f"\n\n{DISCLAIMER}"
    # Deterministic fallback copy
    bits = []
    if catalog["packages"]:
        bits.append("Packages: " + ", ".join(x["name"] for x in catalog["packages"] if x.get("name")))
    if catalog["services"]:
        bits.append("Services: " + ", ".join(x["name"] for x in catalog["services"] if x.get("name")))
    if catalog["tests"]:
        top = catalog["tests"][0]
        bits.append(f"Top test: {top.get('name')} ({top.get('probability')}% match)")
    body = (conductor_message or "Based on what you shared, here are options from our catalogue.") + " "
    return body + " ".join(bits) + f"\n\n{DISCLAIMER}"


def _rules_fallback_bot(session, idx):
    """Canned question path when OpenAI is unavailable."""
    if idx < len(FOLLOW_UP_QUESTIONS):
        q = FOLLOW_UP_QUESTIONS[idx]
        bot = f"Got it. {q}"
        return {
            "phase": "questions",
            "message": bot,
            "question": q,
            "question_index": idx,
            "quick_replies": [],
            "suggestions": None,
        }
    transcript = " | ".join([session.get("symptoms") or ""] + list(session.get("answers") or []))
    suggestions = build_recommendations(
        transcript,
        latitude=session.get("latitude"),
        longitude=session.get("longitude"),
    )
    bot = _personalize_suggestions_message(session, suggestions)
    return {
        "phase": "suggestions",
        "message": bot,
        "question": None,
        "question_index": idx,
        "quick_replies": ["Something cheaper", "Why these tests?", "Book a doctor"],
        "suggestions": suggestions,
    }


def _turn_response(session_id, session, *, phase, message, question=None, suggestions=None, quick_replies=None):
    openai_status = _openai_status()
    turn_count = cint(session.get("turn_count") or 0)
    return {
        "session_id": session_id,
        "phase": phase,
        "message": message,
        "question": question,
        "question_index": turn_count,
        "total_questions": MAX_ASK_TURNS if session.get("mode") == "openai" else len(FOLLOW_UP_QUESTIONS),
        "turn_count": turn_count,
        "max_turns": MAX_ASK_TURNS if session.get("mode") == "openai" else len(FOLLOW_UP_QUESTIONS),
        "suggestions": suggestions,
        "quick_replies": quick_replies or [],
        "disclaimer": DISCLAIMER,
        "journey_mode": session.get("mode") or "rules",
        "openai_enabled": bool(openai_status.get("ready")),
        "openai_polished": session.get("mode") == "openai",
        "openai_status": openai_status,
    }


def _apply_suggest_phase(session_id, session, conductor=None, response_phase="suggestions"):
    transcript = " | ".join([session.get("symptoms") or ""] + list(session.get("answers") or []))
    hints = (conductor or {}).get("search_hints") if conductor else None
    specialty = (conductor or {}).get("specialty_hint") if conductor else None
    wings = (conductor or {}).get("wellness_wings") if conductor else None
    if session.get("last_search_hints") and not hints:
        hints = session.get("last_search_hints")
    if session.get("last_wellness_wings") and not wings:
        wings = session.get("last_wellness_wings")
    if session.get("last_specialty") and not specialty:
        specialty = session.get("last_specialty")

    suggestions = build_recommendations(
        transcript,
        latitude=session.get("latitude"),
        longitude=session.get("longitude"),
        search_hints=hints,
        specialty_hint=specialty,
        wellness_wings=wings,
    )
    draft = (conductor or {}).get("message") if conductor else None
    bot = _personalize_suggestions_message(session, suggestions, conductor_message=draft)
    session["messages"].append({"role": "assistant", "content": bot})
    session["suggestions"] = suggestions
    session["phase"] = response_phase if response_phase in ("suggestions", "refine") else "suggestions"
    session["last_search_hints"] = suggestions.get("matched_hints") or hints or []
    session["last_specialty"] = suggestions.get("specialty_hint") or specialty
    session["last_wellness_wings"] = wings or []
    session["quick_replies"] = (conductor or {}).get("quick_replies") or [
        "Something cheaper",
        "Why these tests?",
        "I want a doctor consult",
    ]
    _save_session(session_id, session)
    return _turn_response(
        session_id,
        session,
        phase=session["phase"],
        message=bot,
        question=None,
        suggestions=suggestions,
        quick_replies=session["quick_replies"],
    )


def _apply_emergency_phase(session_id, session, conductor):
    bot = (conductor.get("message") or "").strip() or (
        "Your symptoms may need urgent in-person care. Please go to the nearest emergency department "
        "or call local emergency services now. Remedium chat cannot replace emergency care."
    )
    if DISCLAIMER not in bot:
        bot = bot + f"\n\n{DISCLAIMER}"
    centers = []
    if session.get("latitude") and session.get("longitude"):
        centers = find_nearby_collection_centers(
            session["latitude"], session["longitude"], radius_km=40, limit=4
        )
    suggestions = {
        "health_packages": [],
        "physician_services": [
            {
                "kind": "physician",
                "service": "Urgent doctor consult",
                "department": "Emergency / General Medicine",
                "reason": "Seek urgent clinical care now",
                "book_path": "/appointments/book",
                "probability": 99,
                "probability_label": "Urgent",
            }
        ],
        "individual_tests": [],
        "nearby_centers": centers,
        "diagnostic_workup": [],
        "specialty_hint": "Emergency",
        "matched_hints": [],
        "suggestion_order": ["physician_services", "nearby_centers"],
    }
    session["messages"].append({"role": "assistant", "content": bot})
    session["suggestions"] = suggestions
    session["phase"] = "emergency"
    session["quick_replies"] = conductor.get("quick_replies") or ["Find nearby centre", "Book teleconsult"]
    _save_session(session_id, session)
    return _turn_response(
        session_id,
        session,
        phase="emergency",
        message=bot,
        question=None,
        suggestions=suggestions,
        quick_replies=session["quick_replies"],
    )


def start_ai_physician_journey(symptoms, latitude=None, longitude=None):
    symptoms = (symptoms or "").strip()
    if not symptoms:
        frappe.throw(_("Please describe your symptoms"))

    session_id = frappe.generate_hash(length=12)
    openai_ready = bool(_openai_status().get("ready"))
    session = {
        "symptoms": symptoms,
        "answers": [],
        "question_index": 0,
        "turn_count": 0,
        "latitude": flt(latitude) or None,
        "longitude": flt(longitude) or None,
        "messages": [{"role": "user", "content": symptoms}],
        "clinical_notes": {},
        "mode": "openai" if openai_ready else "rules",
        "phase": "questions",
    }

    if openai_ready:
        conductor = _openai_conductor(session)
        if conductor:
            session["clinical_notes"] = _merge_clinical_notes({}, conductor.get("clinical_notes"))
            session["turn_count"] = 1
            phase = conductor["phase"]
            if phase == "emergency":
                session["mode"] = "openai"
                _save_session(session_id, session)
                return _apply_emergency_phase(session_id, session, conductor)
            if phase == "suggest":
                session["mode"] = "openai"
                _save_session(session_id, session)
                return _apply_suggest_phase(session_id, session, conductor)
            bot = conductor.get("message") or ""
            q = conductor.get("question")
            if q and q not in bot:
                bot = f"{bot}\n\n{q}".strip() if bot else q
            if not bot:
                bot = f"Thanks for sharing that. {DISCLAIMER}\n\n{FOLLOW_UP_QUESTIONS[0]}"
                q = FOLLOW_UP_QUESTIONS[0]
            elif DISCLAIMER.split(".")[0] not in bot:
                # Soft reminder once at start, keep short
                bot = f"{bot}\n\n(Not a diagnosis — seek emergency care for severe chest pain, breathing difficulty, or stroke signs.)"
            session["messages"].append({"role": "assistant", "content": bot})
            session["quick_replies"] = conductor.get("quick_replies") or []
            session["last_search_hints"] = conductor.get("search_hints") or []
            session["last_specialty"] = conductor.get("specialty_hint")
            session["last_wellness_wings"] = conductor.get("wellness_wings") or []
            _save_session(session_id, session)
            return _turn_response(
                session_id,
                session,
                phase="questions",
                message=bot,
                question=q,
                quick_replies=session["quick_replies"],
            )
        session["mode"] = "rules"

    # Rules fallback opener
    first_q = FOLLOW_UP_QUESTIONS[0]
    bot = (
        f"I’m your Remedium virtual care guide. Thanks for sharing: “{symptoms}”. "
        f"{DISCLAIMER}\n\nTo suggest the right workup from our offerings — {first_q}"
    )
    session["messages"].append({"role": "assistant", "content": bot})
    session["mode"] = "rules"
    session["turn_count"] = 0
    session["question_index"] = 0
    session["quick_replies"] = ["A few days", "About a week", "More than 2 weeks", "Not sure"]
    _save_session(session_id, session)
    return _turn_response(
        session_id,
        session,
        phase="questions",
        message=bot,
        question=first_q,
        quick_replies=session["quick_replies"],
    )


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

    prior_phase = session.get("phase") or "questions"
    refine = prior_phase in ("suggestions", "emergency", "refine") and bool(session.get("suggestions"))

    # OpenAI path
    if session.get("mode") == "openai" and _openai_status().get("ready"):
        if not refine:
            session["turn_count"] = cint(session.get("turn_count") or 0) + 1
        force_suggest = (not refine) and cint(session.get("turn_count") or 0) >= MAX_ASK_TURNS
        conductor = _openai_conductor(session, force_suggest=force_suggest, refine=refine)
        if conductor:
            session["clinical_notes"] = _merge_clinical_notes(
                session.get("clinical_notes"), conductor.get("clinical_notes")
            )
            session["last_search_hints"] = conductor.get("search_hints") or session.get("last_search_hints")
            session["last_specialty"] = conductor.get("specialty_hint") or session.get("last_specialty")
            session["last_wellness_wings"] = conductor.get("wellness_wings") or session.get(
                "last_wellness_wings"
            )

            phase = conductor["phase"]
            if phase == "emergency":
                return _apply_emergency_phase(session_id, session, conductor)
            if phase in ("suggest", "refine") or force_suggest:
                # Re-build catalog for suggest/refine so ranking follows new hints
                return _apply_suggest_phase(
                    session_id,
                    session,
                    conductor,
                    response_phase="refine" if refine else "suggestions",
                )

            bot = conductor.get("message") or ""
            q = conductor.get("question")
            if q and q not in bot:
                bot = f"{bot}\n\n{q}".strip() if bot else q
            if not bot:
                bot = q or "Thanks — could you tell me a bit more?"
            session["messages"].append({"role": "assistant", "content": bot})
            session["phase"] = "questions"
            session["quick_replies"] = conductor.get("quick_replies") or []
            _save_session(session_id, session)
            return _turn_response(
                session_id,
                session,
                phase="questions",
                message=bot,
                question=q,
                quick_replies=session["quick_replies"],
            )
        # OpenAI failed mid-journey → switch to rules
        session["mode"] = "rules"

    # Rules path (including mid-journey fallback)
    idx = cint(session.get("question_index")) + 1
    session["question_index"] = idx
    session["turn_count"] = idx
    if refine and session.get("suggestions"):
        # Simple refine without OpenAI: rebuild from transcript
        transcript = " | ".join([session.get("symptoms") or ""] + list(session.get("answers") or []))
        suggestions = build_recommendations(
            transcript,
            latitude=session.get("latitude"),
            longitude=session.get("longitude"),
        )
        bot = (
            "I’ve updated the suggestions from our catalogue based on your latest note. "
            f"\n\n{DISCLAIMER}"
        )
        session["messages"].append({"role": "assistant", "content": bot})
        session["suggestions"] = suggestions
        session["phase"] = "suggestions"
        session["quick_replies"] = ["Something cheaper", "Why these tests?", "Book a doctor"]
        _save_session(session_id, session)
        return _turn_response(
            session_id,
            session,
            phase="suggestions",
            message=bot,
            suggestions=suggestions,
            quick_replies=session["quick_replies"],
        )

    out = _rules_fallback_bot(session, idx)
    session["messages"].append({"role": "assistant", "content": out["message"]})
    session["phase"] = out["phase"]
    session["quick_replies"] = out.get("quick_replies") or []
    if out.get("suggestions"):
        session["suggestions"] = out["suggestions"]
    _save_session(session_id, session)
    return _turn_response(
        session_id,
        session,
        phase=out["phase"],
        message=out["message"],
        question=out.get("question"),
        suggestions=out.get("suggestions"),
        quick_replies=session["quick_replies"],
    )


def setup_phase66():
    st = _openai_status()
    return {
        "ok": True,
        "phase": 66,
        "openai_configured": bool(st.get("configured")),
        "openai_status": st,
    }


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
    check("start_phase", start.get("phase") in ("questions", "suggestions", "emergency"))
    check("journey_mode_set", start.get("journey_mode") in ("openai", "rules"), detail=str(start.get("journey_mode")))
    sid = start["session_id"]

    if start.get("phase") == "questions":
        turn = continue_ai_physician_journey(sid, "3 days")
        check("turn_continues", turn.get("phase") in ("questions", "suggestions", "emergency", "refine"))
        # Drive toward suggestions (OpenAI may be ready earlier; rules needs fixed questions)
        guard = 0
        while turn.get("phase") == "questions" and guard < 8:
            turn = continue_ai_physician_journey(sid, "moderate, no other major issues")
            guard += 1
        check(
            "suggestions_or_emergency",
            turn.get("phase") in ("suggestions", "emergency", "refine"),
            detail=str(turn.get("phase")),
        )
        sug = turn.get("suggestions") or {}
    else:
        turn = start
        sug = turn.get("suggestions") or {}

    if turn.get("phase") == "suggestions":
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
        # Refine path still open
        refine = continue_ai_physician_journey(sid, "Something cheaper please")
        check("refine_keeps_suggestions", refine.get("phase") in ("suggestions", "refine", "questions"))
        check("quick_replies_list", isinstance(turn.get("quick_replies"), list))

    # Explicit hints override
    hinted = build_recommendations(
        "fever",
        search_hints=["MALARIA", "WIDAL", "CBC"],
        specialty_hint="General Medicine",
    )
    check("hint_merge", "MALARIA" in (hinted.get("matched_hints") or []), detail=str(hinted.get("matched_hints")))

    # Priority wellness: aesthetics / physio / yoga / psychotherapy surface first
    skin = build_recommendations("acne and pigmentation on face", wellness_wings=["aesthetics"])
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
    back = build_recommendations("lower back pain needing physiotherapy", wellness_wings=["physiotherapy"])
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
    mind = build_recommendations(
        "anxiety and depression needing psychotherapy", wellness_wings=["psychology"]
    )
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
