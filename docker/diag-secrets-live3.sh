#!/bin/bash
# Verify MSG91 + OpenAI via bench execute (no secret values printed).
cd /opt/health-ecosystem/docker
SITE=health.localhost

# 1) Config presence
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.clinical_msg91.sms_configured" 2>&1 | grep -vE 'version.*obsolete|^time=' | tail -5

# 2) OpenAI via telephony helper
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony._openai_chat_turn --kwargs \"{'messages': [{'role': 'user', 'content': 'Reply with the single word pong'}]}\" 2>&1" | grep -vE 'version.*obsolete|^time=' | tail -20

# 3) Latest OpenAI error (redacted)
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE mariadb -e \"SELECT creation, LEFT(REPLACE(REPLACE(error,'\n',' '), CHAR(10), ' '), 350) AS err FROM \\\`tabError Log\\\` WHERE method='telephony_openai' OR error LIKE '%openai%' ORDER BY creation DESC LIMIT 1;\"" 2>&1 | grep -vE 'version.*obsolete|^time=' | sed -E 's/sk-[A-Za-z0-9_-]+/sk-REDACTED/g; s/Bearer [^ ]+/Bearer REDACTED/g'

# 4) Masked key presence via execute of a one-liner module path — use db get
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE execute frappe.db.get_single_value --args \"['Health Ecosystem Settings','telephony_enabled']\"" 2>&1 | grep -vE 'version.*obsolete|^time=' | tail -3

echo "--- sms_auth_key set? ---"
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE console" <<'PY' 2>/dev/null | grep -E 'sms_|openai_|telephony_|DONE' 
import frappe
s=frappe.get_single('Health Ecosystem Settings')
o=(getattr(s,'telephony_openai_api_key',None) or '').strip()
try:
 sms=s.get_password('sms_auth_key', raise_exception=False) or ''
except Exception:
 sms=''
print('openai_set', bool(o), 'openai_len', len(o), 'openai_prefix', (o[:4]+'…') if o else '')
print('sms_set', bool(sms), 'sms_len', len(sms))
print('telephony_enabled', bool(getattr(s,'telephony_enabled',0)))
from health_ecosystem_core.health_ecosystem_core.clinical_msg91 import sms_configured
print('sms_configured', sms_configured())
print('DONE')
PY
