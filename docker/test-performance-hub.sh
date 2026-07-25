#!/bin/bash
# Phase 74 API smoke — training hub for phlebotomist.
set -e
API="${API_BASE:-http://127.0.0.1:8080}"
USER="${PHLEBO_USER:-phlebotomist@health.local}"
PASS="${PHLEBO_PASS:-PhlebChangeMe@123}"

if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

python3 <<'PY'
import json, os, urllib.parse, urllib.request
API = os.environ.get("API_BASE", "http://127.0.0.1:8080")
USER = os.environ.get("PHLEBO_USER", "phlebotomist@health.local")
PASS = os.environ.get("PHLEBO_PASS", "PhlebChangeMe@123")

def post(method, data):
    url = f"{API}/api/method/health_ecosystem_core.health_ecosystem_core.api.{method}"
    body = urllib.parse.urlencode({k: v for k, v in data.items() if v is not None}).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=90) as resp:
        raw = json.loads(resp.read().decode())
    if isinstance(raw, dict) and isinstance(raw.get("message"), dict) and "status" in raw["message"]:
        return raw["message"]
    return raw

print("=== Phase 74 performance smoke ===")
login = post("authenticate_user", {"usr": USER, "pwd": PASS})
assert login.get("status") == "success", login
sid = login["data"]["sid"]
hub = post("get_staff_performance_hub", {"sid": sid})
assert hub.get("status") == "success", hub
d = hub["data"]
print("OK hub", "kras", len(d.get("kras") or []), "appraisals", len(d.get("appraisals") or []))
if d.get("appraisals"):
    app = d["appraisals"][0]["name"]
    res = post("submit_appraisal_self_review", {
        "sid": sid,
        "appraisal": app,
        "reflections": "HEC smoke self review",
        "ratings": "[]",
    })
    assert res.get("status") == "success", res
    print("OK self review", app)
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
print("SMOKE PASS")
PY
