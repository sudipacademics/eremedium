#!/usr/bin/env bash
set -euo pipefail
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && bench --site health.localhost console' <<'PY'
from health_ecosystem_core.health_ecosystem_core import clinical_openai as o
print("FILE", o.__file__)
o.clear_openai_status_cache()
print("STATUS0", o.openai_runtime_status())
msg = o.openai_chat_completion([{"role": "user", "content": "Say only: ok"}], temperature=0, timeout=30, log_prefix="diag")
print("MSG", msg)
print("STATUS1", o.openai_runtime_status())
print("PROBE", o.probe_openai(force=True))
from health_ecosystem_core.health_ecosystem_core.clinical_phase66_ai_physician import start_ai_physician_journey
j = start_ai_physician_journey("fever for 2 days")
print("JOURNEY", j.get("phase"), j.get("openai_enabled"), j.get("openai_status"))
print("DONE")
PY
