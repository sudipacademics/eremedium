#!/usr/bin/env python3
from pathlib import Path

p = Path(
    "/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase64_telephony.py"
)
text = p.read_text(encoding="utf-8")
start = text.find("def _respond_xml(xml):")
if start < 0:
    raise SystemExit("def _respond_xml not found")
end = text.find("\n\n", start)
old = text[start:end]
print("OLD:\n", old)
new = '''def _respond_xml(xml):
\t# Frappe has no response type "text" (KeyError) — use download/inline for raw XML.
\tfrappe.local.response["type"] = "download"
\tfrappe.local.response["filename"] = "exotel.xml"
\tfrappe.local.response["filecontent"] = xml
\tfrappe.local.response["content_type"] = "application/xml"
\tfrappe.local.response["display_content_as"] = "inline"
\tfrappe.local.response["http_status_code"] = 200
\treturn xml'''
text = text[:start] + new + text[end:]
p.write_text(text, encoding="utf-8")
print("patched ok")

# Also ensure api.py re-exports masked call helpers
api = Path(
    "/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py"
)
api_text = api.read_text(encoding="utf-8")
if "start_masked_call" not in api_text:
    block = '''

# Phase 65 — Exotel masked click-to-call
from health_ecosystem_core.health_ecosystem_core.clinical_phase65_number_masking import (  # noqa: E402
    get_masked_call_context,
    start_masked_call,
)
'''
    # Prefer append near other re-exports
    marker = "from health_ecosystem_core.health_ecosystem_core.clinical_phase18b import"
    idx = api_text.rfind(marker)
    if idx >= 0:
        # find end of that import block
        nl = api_text.find("\n\n", idx)
        if nl < 0:
            api_text = api_text + block
        else:
            api_text = api_text[:nl] + block + api_text[nl:]
    else:
        api_text = api_text + block
    api.write_text(api_text, encoding="utf-8")
    print("api.py masked exports added")
else:
    print("api.py already has start_masked_call")
