#!/bin/bash
# Phase 21 smoke — HR self-service APIs (leave/expense as drafts for approval).
set -e
API="${API_BASE:-http://127.0.0.1:8080}"
USER="${PHLEBO_USER:-phlebotomist@health.local}"
PASS="${PHLEBO_PASS:-PhlebChangeMe@123}"

if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

echo "=== Phase 21 HR smoke test ($USER) ==="

python3 <<'PY'
import json, urllib.parse, urllib.request
from datetime import date, timedelta
import os

API = os.environ.get("API_BASE", "http://127.0.0.1:8080")
USER = os.environ.get("PHLEBO_USER", "phlebotomist@health.local")
PASS = os.environ.get("PHLEBO_PASS", "PhlebChangeMe@123")

def post(method, data):
    url = f"{API}/api/method/health_ecosystem_core.health_ecosystem_core.api.{method}"
    body = urllib.parse.urlencode({k: v for k, v in data.items() if v is not None}).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=90) as resp:
        raw = json.loads(resp.read().decode())
    # Frappe wraps whitelist returns under "message"
    if isinstance(raw, dict) and "message" in raw and isinstance(raw["message"], dict) and "status" in raw["message"]:
        return raw["message"]
    return raw

login = post("authenticate_user", {"usr": USER, "pwd": PASS})
assert login.get("status") == "success", login
sid = login["data"]["sid"]
print("OK login")

hr = post("get_hr_self_service", {"sid": sid})
assert hr.get("status") == "success", hr
d = hr["data"]
print("OK hr_self_service available=", d.get("hr_available"), "employee=", d.get("employee"))
print("  leave_types=", len(d.get("leave_types") or []), "expense_types=", len(d.get("expense_types") or []))
assert d.get("hr_available"), d
assert d.get("employee"), d
assert d.get("leave_types"), "no leave types"
assert d.get("expense_types"), "no expense types"

lt = d["leave_types"][0]["name"]
start = (date.today() + timedelta(days=21)).isoformat()
end = (date.today() + timedelta(days=22)).isoformat()
leave = post("submit_leave_application", {
    "sid": sid,
    "leave_type": lt,
    "from_date": start,
    "to_date": end,
    "description": "HEC smoke leave",
})
assert leave.get("status") == "success", leave
print("OK leave", leave.get("data"))

et = d["expense_types"][0]["name"]
exp = post("submit_expense_claim", {
    "sid": sid,
    "expense_type": et,
    "amount": 125,
    "description": "HEC smoke expense",
})
assert exp.get("status") == "success", exp
print("OK expense", exp.get("data"))
print("SMOKE PASS")
PY
