#!/usr/bin/env bash
# Smoke OpenAI helper after deploy (read-only probe).
set -euo pipefail
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && bench --site health.localhost console' <<'PY'
from health_ecosystem_core.health_ecosystem_core.clinical_openai import (
    openai_runtime_status,
    probe_openai,
    get_openai_model,
    get_openai_api_key,
)
print("MODEL", get_openai_model())
print("KEY_SET", bool(get_openai_api_key()))
print("STATUS", openai_runtime_status())
print("PROBE", probe_openai(force=True))
from health_ecosystem_core.health_ecosystem_core.clinical_phase66_ai_physician import start_ai_physician_journey
s = start_ai_physician_journey("fever for 2 days")
print("JOURNEY", {k: s.get(k) for k in ("phase", "openai_enabled", "openai_status")})
print("DONE")
PY
