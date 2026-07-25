#!/bin/bash
# Print OpenAI 429 body type only (quota vs rate limit), redacted.
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site health.localhost console" <<'PY'
import frappe, re, json
rows = frappe.get_all("Error Log", filters={"method":"telephony_openai"}, fields=["creation","error"], order_by="creation desc", limit_page_length=1)
err = (rows[0].error if rows else "") or ""
# urllib HTTPError often embeds the body in the message inconsistently; search for JSON error codes
for code in ("insufficient_quota", "rate_limit_exceeded", "invalid_api_key", "billing_not_active"):
    if code in err:
        print("openai_error_code", code)
print("http", (re.search(r"HTTP Error (\\d+)", err) or type("m",(object,),{"group":lambda s,i:"?"})()).group(1))
# try extract any { ... } snippet
m = re.search(r"(\\{[^{}]*error[^{}]*\\})", err)
if m:
    print("body_snip", m.group(1)[:300])
else:
    # last line often has the HTTPError
    print("tail", err.strip().splitlines()[-1][:200])
print("DONE")
PY
