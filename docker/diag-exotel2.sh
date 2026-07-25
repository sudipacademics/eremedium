#!/bin/bash
# Deeper Exotel/telephony diagnosis — read-only except logging a test call may create a row
set -e
cd /opt/health-ecosystem/docker

echo "=== Error log for telephony_incoming ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench; ls sites/*/logs/ 2>/dev/null | head; latest=$(ls -t sites/*/logs/error.log sites/health.localhost/logs/error.log 2>/dev/null | head -1); echo LATEST=$latest; tail -n 80 "$latest" 2>/dev/null | tail -80'

echo "=== whitelists on telephony_incoming ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench; ./env/bin/python - <<"PY"
import inspect, frappe
from health_ecosystem_core.health_ecosystem_core import clinical_phase64_telephony as t
fn = t.telephony_incoming
print("fn", fn)
print("whitelisted", getattr(fn, "_whitelisted", None) or getattr(fn, "whitelisted", None))
print("allow_guest", getattr(fn, "allow_guest", None))
src = inspect.getsource(fn)
print(src[:2500])
PY'

echo "=== settings via bench ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench
bench --site health.localhost execute frappe.db.get_single_value --args "[\"Health Ecosystem Settings\",\"telephony_enabled\"]"
for f in telephony_enabled exotel_sid exotel_api_key exotel_api_token exotel_virtual_number exotel_subdomain telephony_agent_number telephony_openai_api_key; do
  echo -n "$f="
  bench --site health.localhost execute frappe.db.get_single_value --args "[\"Health Ecosystem Settings\",\"$f\"]" 2>/dev/null | tr -d "\r" | head -c 80
  echo
done
'

echo "=== find masked call modules ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench/apps/health_ecosystem_core; rg -l "exotel|masked_call|start_masked" -g "*.py" | head -40'
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench/apps/health_ecosystem_core; rg -n "api.exotel|Exotel|exotel_api|/v1/Accounts|Calls/connect|start_masked_call|def start_masked" -g "*.py" | head -100'

echo "=== invoke telephony_incoming inside bench ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony.telephony_incoming --kwargs "{\"CallFrom\":\"9876543210\",\"CallTo\":\"08011112222\",\"CallSid\":\"bench-diag-1\",\"Direction\":\"incoming\"}" 2>&1 | tail -60
'

echo "=== recent Telephony Call Log ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench
bench --site health.localhost mariadb -e "select name, creation, from_number, path, status, escalate_reason from \`tabTelephony Call Log\` order by creation desc limit 8;" 2>&1 | tail -30
'
