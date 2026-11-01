"""Phase 100 — AI Practice Assist: VoiceRx scribe, SmartSync OCR, CDSS differentials."""

from __future__ import annotations

import base64
import json
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import frappe
from frappe import _

from health_ecosystem_core.health_ecosystem_core.api import (
    _error,
    _parse_request_value,
    _require_mobile_auth,
    _success,
    _user_roles,
)
from health_ecosystem_core.health_ecosystem_core.clinical_iam import is_staff

SCRIBE_SYSTEM = """You are a clinical documentation assistant for Indian outpatient practice.
Given a consultation transcript, return ONLY valid JSON with keys:
chief_complaint, history_of_present_illness, examination, assessment, plan, diagnosis.
Use concise clinical language. If a section is unknown, use an empty string.
Do not invent medications or lab values that were not mentioned."""

CDSS_SYSTEM = """You are a clinical decision support assistant (advisory only, not a diagnosis).
Given symptoms and findings, return ONLY valid JSON:
{"differentials":[{"name":"...","rationale":"...","urgency":"routine|urgent|emergent"}],"cautions":["..."]}
Provide at most 3 differentials. Be conservative. Prefer common outpatient differentials in India."""

OCR_SYSTEM = """Extract medicines and lab tests from a handwritten or printed prescription text.
Return ONLY valid JSON:
{"medicines":[{"raw_name":"...","dosage":"...","frequency":"...","duration":"..."}],"diagnostics":[{"raw_name":"..."}],"notes":"..."}
If unsure, still include raw_name guesses. Do not invent brands not present in the text."""


def _require_provider_or_ops():
    if not _require_mobile_auth():
        return None, _error(_("Not authenticated"), 401)
    roles = _user_roles()
    allowed = is_staff(roles) or "Physician" in roles or "Franchisee" in roles or "Phlebotomist" in roles
    if not allowed:
        return None, _error(_("Not authorized"), 403)
    return roles, None


def _chat_json(system_prompt, user_content, temperature=0.2):
    from health_ecosystem_core.health_ecosystem_core.clinical_openai import (
        openai_chat_completion,
        openai_runtime_status,
    )

    status = openai_runtime_status()
    if not status.get("ready"):
        return None, status

    msg = openai_chat_completion(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        temperature=temperature,
        response_format={"type": "json_object"},
        log_prefix="phase100",
    )
    if not msg:
        return None, openai_runtime_status()
    content = (msg.get("content") or "").strip()
    try:
        return json.loads(content), status
    except Exception:
        # Try extract JSON blob
        m = re.search(r"\{[\s\S]*\}", content)
        if m:
            try:
                return json.loads(m.group(0)), status
            except Exception:
                pass
        return None, {"ready": False, "last_error_code": "json_parse", "last_error_message": content[:300]}


def _whisper_transcribe(audio_b64, filename="consult.webm"):
    from health_ecosystem_core.health_ecosystem_core.clinical_openai import (
        get_openai_api_key,
        openai_runtime_status,
    )
    from health_ecosystem_core.health_ecosystem_core import clinical_openai as _oa

    skip, reason = _oa._should_skip_call()
    if skip:
        return None, openai_runtime_status()

    key = get_openai_api_key()
    try:
        raw = base64.b64decode(audio_b64)
    except Exception:
        return None, {"ready": False, "last_error_code": "bad_audio", "last_error_message": "Invalid base64 audio"}

    boundary = "----hecboundary"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n'
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8") + raw + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req = Request(
        "https://api.openai.com/v1/audio/transcriptions",
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        _oa._mark_ok()
        return (payload.get("text") or "").strip(), openai_runtime_status()
    except HTTPError as exc:
        detail = {"code": f"http_{exc.code}", "message": str(exc.reason), "http_status": exc.code}
        _oa._mark_failure(detail)
        return None, openai_runtime_status()
    except URLError as exc:
        _oa._mark_failure({"code": "network", "message": str(exc.reason)})
        return None, openai_runtime_status()


def _vision_ocr_text(image_b64, mime="image/jpeg"):
    from health_ecosystem_core.health_ecosystem_core.clinical_openai import (
        openai_chat_completion,
        openai_runtime_status,
    )

    status = openai_runtime_status()
    if not status.get("ready"):
        return None, status

    data_url = f"data:{mime};base64,{image_b64}"
    msg = openai_chat_completion(
        [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Read all handwritten and printed text from this prescription image. Return plain text only.",
                    },
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
        temperature=0,
        log_prefix="phase100_ocr",
    )
    if not msg:
        return None, openai_runtime_status()
    return (msg.get("content") or "").strip(), openai_runtime_status()


def _fuzzy_match_items(raw_name, kind="medicine", limit=5):
    q = (raw_name or "").strip()
    if len(q) < 2:
        return []
    if kind == "medicine":
        from health_ecosystem_core.health_ecosystem_core.api import PHARMACY_ITEM_GROUPS

        rows = frappe.get_all(
            "Item",
            filters={"is_sales_item": 1, "disabled": 0, "item_group": ["in", list(PHARMACY_ITEM_GROUPS)]},
            or_filters=[["item_name", "like", f"%{q}%"], ["name", "like", f"%{q}%"]],
            fields=["name", "item_name", "standard_rate"],
            limit=limit,
        )
        return [{"name": r.name, "item_name": r.item_name, "rate": r.standard_rate} for r in rows]

    rows = frappe.get_all(
        "Diagnostic Test Master",
        or_filters=[["test_name", "like", f"%{q}%"], ["name", "like", f"%{q}%"]],
        fields=["name", "test_name", "item"],
        limit=limit,
    )
    return [
        {
            "name": r.name,
            "test_name": r.test_name,
            "item": r.item,
            "item_name": frappe.db.get_value("Item", r.item, "item_name") if r.item else None,
        }
        for r in rows
    ]


def _rule_based_soap(transcript):
    text = (transcript or "").strip()
    return {
        "chief_complaint": text[:240] if text else "",
        "history_of_present_illness": text,
        "examination": "",
        "assessment": "",
        "plan": "",
        "diagnosis": "",
        "source": "rule_fallback",
    }


def _rule_based_cdss(text):
    t = (text or "").lower()
    diffs = []
    if any(k in t for k in ("fever", "cough", "cold")):
        diffs.append({"name": "Acute upper respiratory infection", "rationale": "Fever/cough symptoms", "urgency": "routine"})
    if any(k in t for k in ("sugar", "diabetes", "polyuria", "thirst")):
        diffs.append({"name": "Type 2 diabetes mellitus / hyperglycemia", "rationale": "Glycemic symptoms", "urgency": "urgent"})
    if any(k in t for k in ("chest pain", "palpitation", "breathless")):
        diffs.append({"name": "Cardiac / respiratory evaluation needed", "rationale": "Chest symptoms", "urgency": "emergent"})
    if any(k in t for k in ("liver", "jaundice", "fatty")):
        diffs.append({"name": "NAFLD / hepatic dysfunction", "rationale": "Liver-related findings", "urgency": "routine"})
    if not diffs:
        diffs.append({"name": "Undifferentiated outpatient presentation", "rationale": "Insufficient specificity", "urgency": "routine"})
    return {"differentials": diffs[:3], "cautions": ["Advisory only — clinician judgment required"], "source": "rule_fallback"}


@frappe.whitelist()
def scribe_consultation_audio(audio_base64=None, filename=None, encounter_id=None, sid=None):
    roles, err = _require_provider_or_ops()
    if err:
        return err
    if "Physician" not in roles and not is_staff(roles):
        return _error(_("Only providers can use VoiceRx"), 403)

    audio_base64 = (_parse_request_value("audio_base64", audio_base64) or "").strip()
    if not audio_base64:
        return _error(_("Audio payload required"))
    # Strip data-URL prefix if present
    if "," in audio_base64 and audio_base64.startswith("data:"):
        audio_base64 = audio_base64.split(",", 1)[1]

    filename = (_parse_request_value("filename", filename) or "consult.webm").strip()
    transcript, st = _whisper_transcribe(audio_base64, filename=filename)
    if not transcript:
        return _error(
            _("Transcription unavailable ({0})").format(st.get("last_error_code") or "openai"),
            503,
        )

    structured, st2 = _chat_json(SCRIBE_SYSTEM, transcript)
    if not structured:
        structured = _rule_based_soap(transcript)
    else:
        structured["source"] = "openai"

    encounter_id = (_parse_request_value("encounter_id", encounter_id) or "").strip()
    if encounter_id and frappe.db.exists("Clinical Encounter", encounter_id):
        doc = frappe.get_doc("Clinical Encounter", encounter_id)
        if doc.status != "Final":
            doc.scribe_transcript = transcript
            for key in (
                "chief_complaint",
                "history_of_present_illness",
                "examination",
                "assessment",
                "plan",
                "diagnosis",
            ):
                if structured.get(key):
                    doc.set(key, structured.get(key))
            doc.save(ignore_permissions=True)
            frappe.db.commit()

    return _success(
        {
            "transcript": transcript,
            "structured": structured,
            "openai": st2 if isinstance(st2, dict) else st,
            "encounter_id": encounter_id or None,
        }
    )


@frappe.whitelist()
def suggest_differentials(clinical_text=None, encounter_id=None, sid=None):
    roles, err = _require_provider_or_ops()
    if err:
        return err
    if "Physician" not in roles and not is_staff(roles):
        return _error(_("Only providers can use CDSS"), 403)

    clinical_text = (_parse_request_value("clinical_text", clinical_text) or "").strip()
    if len(clinical_text) < 8:
        return _success({"suggestions": {"differentials": [], "cautions": ["Enter more clinical detail"]}})

    suggestions, st = _chat_json(CDSS_SYSTEM, clinical_text, temperature=0.1)
    if not suggestions:
        suggestions = _rule_based_cdss(clinical_text)
    else:
        suggestions["source"] = "openai"

    encounter_id = (_parse_request_value("encounter_id", encounter_id) or "").strip()
    if encounter_id and frappe.db.exists("Clinical Encounter", encounter_id):
        try:
            frappe.db.set_value(
                "Clinical Encounter",
                encounter_id,
                "cdss_suggestions_json",
                json.dumps(suggestions),
            )
            frappe.db.commit()
        except Exception:
            pass

    return _success({"suggestions": suggestions, "openai": st})


@frappe.whitelist()
def smartsync_parse_prescription(image_base64=None, mime_type=None, raw_text=None, sid=None):
    """OCR + LLM normalize + fuzzy match against Item / Diagnostic Test Master."""
    roles, err = _require_provider_or_ops()
    if err:
        return err

    image_base64 = (_parse_request_value("image_base64", image_base64) or "").strip()
    raw_text = (_parse_request_value("raw_text", raw_text) or "").strip()
    mime_type = (_parse_request_value("mime_type", mime_type) or "image/jpeg").strip()

    if image_base64 and "," in image_base64 and image_base64.startswith("data:"):
        header, image_base64 = image_base64.split(",", 1)
        if "image/" in header:
            mime_type = header.split(";")[0].replace("data:", "") or mime_type

    ocr_text = raw_text
    ocr_status = {}
    if image_base64 and not ocr_text:
        ocr_text, ocr_status = _vision_ocr_text(image_base64, mime=mime_type)
        if not ocr_text:
            return _error(
                _("OCR unavailable ({0})").format(ocr_status.get("last_error_code") or "openai"),
                503,
            )

    if not ocr_text:
        return _error(_("Provide an image or raw prescription text"))

    parsed, st = _chat_json(OCR_SYSTEM, ocr_text)
    if not parsed:
        # Naive line split fallback
        lines = [ln.strip() for ln in ocr_text.splitlines() if ln.strip()]
        parsed = {
            "medicines": [{"raw_name": ln} for ln in lines[:8]],
            "diagnostics": [],
            "notes": "",
            "source": "rule_fallback",
        }
    else:
        parsed["source"] = "openai"

    matched_meds = []
    for row in parsed.get("medicines") or []:
        raw_name = (row.get("raw_name") or "").strip()
        matches = _fuzzy_match_items(raw_name, kind="medicine")
        matched_meds.append({**row, "matches": matches, "best": matches[0] if matches else None})

    matched_diag = []
    for row in parsed.get("diagnostics") or []:
        raw_name = (row.get("raw_name") or "").strip()
        matches = _fuzzy_match_items(raw_name, kind="diagnostic")
        matched_diag.append({**row, "matches": matches, "best": matches[0] if matches else None})

    return _success(
        {
            "ocr_text": ocr_text,
            "medicines": matched_meds,
            "diagnostics": matched_diag,
            "notes": parsed.get("notes"),
            "source": parsed.get("source"),
            "openai": st or ocr_status,
        }
    )


def setup_phase100_ai_practice():
    # Ensure encounter AI fields exist (created in phase 99)
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase99_encounter import (
            setup_phase99_encounter,
        )

        setup_phase99_encounter()
    except Exception:
        pass
    return {"ok": True, "phase": "100", "feature": "ai_practice"}


def smoke_phase100_ai_practice():
    setup = setup_phase100_ai_practice()
    from health_ecosystem_core.health_ecosystem_core.clinical_openai import openai_runtime_status

    return {
        "ok": True,
        "phase": "100",
        "setup": setup,
        "openai": openai_runtime_status(),
        "rule_cdss_sample": _rule_based_cdss("fever cough 3 days"),
    }
