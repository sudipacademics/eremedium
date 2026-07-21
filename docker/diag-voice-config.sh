#!/bin/bash
# Read-only diagnostic: telephony/AI-voice config + OAuth base URL resolution.
cd /opt/health-ecosystem/docker
docker compose exec -T backend bench --site health.localhost console <<'PY'
from health_ecosystem_core.health_ecosystem_core import clinical_phase64_telephony as t
print("VOICE telephony_enabled", t._telephony_enabled())
print("VOICE openai_key_set", bool(t._openai_key()))
print("VOICE agent_number_set", bool(t._agent_number()))
print("VOICE webhook_secret_set", bool(t._webhook_secret()))
print("VOICE public_base_url", t._public_base_url())
print("VOICE ai_gather_action_url", t._method_url("telephony_ai_gather"))
from health_ecosystem_core.health_ecosystem_core import clinical_phase18b as o
print("OAUTH portal_base_url", repr(o.portal_base_url()))
print("OAUTH frappe_oauth_callback_url", o.frappe_oauth_callback_url())
import frappe
print("CONF host_name", frappe.conf.get("host_name"))
print("SETTING patient_portal_base_url", repr(frappe.db.get_single_value("Health Ecosystem Settings", "patient_portal_base_url")))
PY
