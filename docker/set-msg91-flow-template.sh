#!/bin/bash
cd /opt/health-ecosystem/docker || exit 1
docker compose exec -T backend bash <<'EOS'
cd /home/frappe/frappe-bench
export PATH="/usr/local/bin:$PATH"
bench --site health.localhost console <<'PY'
import frappe
s = frappe.get_single("Health Ecosystem Settings")
old_dlt = (getattr(s, "sms_dlt_template_id", None) or "").strip()
print("before_msg91_template", repr(getattr(s, "sms_msg91_template_id", None)))
print("before_dlt_template", repr(old_dlt))
s.sms_msg91_template_id = "6a5f60864f2c1301c90b6393"
# If someone pasted MSG91 hex into DLT field, clear it (DLT must be numeric)
if old_dlt and not old_dlt.isdigit():
    s.sms_dlt_template_id = ""
    print("cleared_non_numeric_dlt_field")
s.save(ignore_permissions=True)
frappe.db.commit()
frappe.clear_cache()
from health_ecosystem_core.health_ecosystem_core.clinical_secrets import (
    get_sms_msg91_template_id,
    get_sms_dlt_template_id,
)
print("after_msg91_template", get_sms_msg91_template_id())
print("after_dlt_template", repr(get_sms_dlt_template_id()))
print("DONE")
PY
EOS
