#!/bin/bash
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
cd /home/frappe/frappe-bench
./env/bin/python - <<'PY'
import health_ecosystem_core.health_ecosystem_core.api as a
print("masked_api", hasattr(a, "start_masked_call"), hasattr(a, "get_masked_call_context"))
from health_ecosystem_core.health_ecosystem_core.clinical_phase65_number_masking import masking_ready, _exotel_creds
c = _exotel_creds()
print("masking_ready", masking_ready())
print("creds", {
  "enabled": c.get("enabled"),
  "sid": bool(c.get("sid")),
  "api_key": bool(c.get("api_key")),
  "api_token": bool(c.get("api_token")),
  "vn_last4": (c.get("virtual_number") or "")[-4:] or None,
})
from health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony import _agent_number, _telephony_enabled, _webhook_secret
print("telephony_enabled", _telephony_enabled())
print("agent_number", bool(_agent_number()))
print("webhook_secret", bool(_webhook_secret()))
PY
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase65_number_masking.smoke_phase65
EOS
curl -sS -D - -o /tmp/pub.xml -X POST \
  "https://www.e-remedium.in/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony.telephony_incoming" \
  -H "X-Frappe-Site-Name: health.localhost" \
  -d "CallFrom=9876500666&CallTo=08011112222&CallSid=diag-public-xml2" | head -12
echo BODY:
head -c 500 /tmp/pub.xml; echo
