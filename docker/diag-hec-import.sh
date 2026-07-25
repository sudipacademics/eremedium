#!/usr/bin/env bash
set -euo pipefail
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc '
cd /home/frappe/frappe-bench
echo "=== pip show ==="
./env/bin/pip show health_ecosystem_core || true
echo "=== import try ==="
./env/bin/python - <<PY
try:
    import health_ecosystem_core
    print("OK", health_ecosystem_core.__file__)
except Exception as e:
    print("FAIL", type(e).__name__, e)
PY
echo "=== paths ==="
ls -la apps/health_ecosystem_core 2>/dev/null | head -20 || echo "no apps/hec"
ls -la /opt/health-ecosystem/health_ecosystem_core 2>/dev/null | head -10 || true
ls -la env/lib/python3.11/site-packages/health_ecosystem_core 2>/dev/null | head -15 || echo "no site-packages hec"
ls -la env/lib/python3.11/site-packages/*.egg-link 2>/dev/null || true
ls -la env/lib/python3.11/site-packages/__editable__* 2>/dev/null || true
'
