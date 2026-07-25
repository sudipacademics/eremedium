#!/bin/bash
set -e
cd /opt/health-ecosystem/docker

docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
./env/bin/python <<'PY'
import frappe, inspect, traceback, pathlib
frappe.init(site="health.localhost", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()

from health_ecosystem_core.health_ecosystem_core import clinical_phase64_telephony as t

print("dir helpers", [x for x in dir(t) if any(k in x.lower() for k in ("verify","respond","handle","setting","exotel","xml","webhook"))])

for name in dir(t):
    if name.startswith("_") and any(k in name for k in ("verify","respond","handle","setting","xml","webhook","exotel","agent")):
        fn = getattr(t, name)
        if callable(fn):
            print("====", name, "====")
            try:
                print(inspect.getsource(fn)[:2200])
            except Exception as e:
                print("no src", e)

meta = frappe.get_meta("Health Ecosystem Settings")
print("==== settings fields tele/exotel ====")
for df in meta.fields:
    fn = df.fieldname or ""
    if any(x in fn.lower() for x in ("tele","exotel","openai","agent","virtual","mask")):
        val = frappe.db.get_single_value("Health Ecosystem Settings", fn)
        sens = any(x in fn for x in ("key","token","secret","password"))
        print(fn, df.fieldtype, ("SET" if val else "EMPTY") if sens else repr(val)[:120])

print("==== telephony_incoming format=json ====")
try:
    out = t.telephony_incoming(CallFrom="9876543210", CallTo="08011112222", CallSid="diag-json-3", format="json")
    print(repr(out)[:1200])
except Exception:
    traceback.print_exc()

print("==== telephony_incoming default/xml ====")
try:
    out = t.telephony_incoming(CallFrom="9876543210", CallTo="08011112222", CallSid="diag-xml-3")
    print("return", type(out), repr(out)[:800])
    print("frappe.local.response", dict(frappe.local.response))
except Exception:
    traceback.print_exc()

print("==== search exotel outbound ====")
root = pathlib.Path("/home/frappe/frappe-bench/apps/health_ecosystem_core")
hits = 0
for p in root.rglob("*.py"):
    text = p.read_text(encoding="utf-8", errors="ignore")
    if not any(k in text for k in ("api.exotel", "exotel.com", "start_masked_call", "masked_call", "exotel_api")):
        continue
    print("FILE", p)
    hits += 1
    for i, line in enumerate(text.splitlines(), 1):
        low = line.lower()
        if any(k in low for k in ("exotel", "masked_call", "/v1/accounts", "calls/connect")):
            print(f"  {i}:{line[:180]}")
print("files_hit", hits)
PY
EOS
