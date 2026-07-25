#!/bin/bash
# Phase 74 — Staff training, KRA, and appraisal (sync + setup + smoke).
set -e
ROOT="/opt/health-ecosystem"
SITE="${FRAPPE_SITE:-health.localhost}"

if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

cd "$ROOT/docker"

echo "=== Sync Phase 74 modules ==="
docker compose exec -T backend bash -s "$SITE" <<'EOS'
set -e
SITE="$1"
cd /home/frappe/frappe-bench
APPS_PKG=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SITE_PKG=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.api as m, os; print(os.path.dirname(m.__file__))")
for f in clinical_phase74_performance.py clinical_hrms_repair.py clinical_phase71_ops_dashboards.py api.py init.py; do
  cp -f "$APPS_PKG/$f" "$SITE_PKG/$f"
  python3 -m py_compile "$SITE_PKG/$f"
  echo "OK $f"
done
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair.run_repair
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase74_setup
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase74_smoke
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase71_setup
bench --site "$SITE" clear-cache
EOS

docker compose restart backend
sleep 12

echo "=== API smoke (performance hub) ==="
python3 <<'PY'
import json, os, urllib.parse, urllib.request
API = os.environ.get("API_BASE", "http://127.0.0.1:8080")
USER = os.environ.get("PHLEBO_USER", "phlebotomist@health.local")
PASS = os.environ.get("PHLEBO_PASS", "PhlebChangeMe@123")

def post(method, data):
    url = f"{API}/api/method/health_ecosystem_core.health_ecosystem_core.api.{method}"
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=90) as resp:
        raw = json.loads(resp.read().decode())
    if isinstance(raw, dict) and isinstance(raw.get("message"), dict) and "status" in raw["message"]:
        return raw["message"]
    return raw

login = post("authenticate_user", {"usr": USER, "pwd": PASS})
assert login.get("status") == "success", login
sid = login["data"]["sid"]
hub = post("get_staff_performance_hub", {"sid": sid})
assert hub.get("status") == "success", hub
d = hub["data"]
print("OK performance hub employee=", d.get("employee"))
print("  kras=", len(d.get("kras") or []), "appraisals=", len(d.get("appraisals") or []))
print("  programs=", len(d.get("training_programs") or []), "events=", len(d.get("training_events") or []))
assert d.get("performance_available"), d
if d.get("training_events"):
    ev = d["training_events"][0]["name"]
    fb = post("submit_training_feedback", {
        "sid": sid,
        "training_event": ev,
        "rating": 4,
        "feedback": "HEC smoke training feedback",
    })
    assert fb.get("status") == "success", fb
    print("OK training feedback", ev)
print("PHASE74 SMOKE PASS")
PY

echo "Phase 74 deploy finished."
