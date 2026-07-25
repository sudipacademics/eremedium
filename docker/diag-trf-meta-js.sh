#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
printf '%s\n' \
'from frappe.desk.form.meta import FormMeta' \
'meta = FormMeta("Customer TRF")' \
'meta.load_js_from_hooks()' \
'js = getattr(meta, "__js", None) or getattr(meta, "_FormMeta__js", None) or ""' \
'# FormMeta stores in self.js after as_dict' \
'd = meta.as_dict()' \
'code = d.get("__js") or d.get("js") or ""' \
'print("JS_LEN", len(code or ""))' \
'print("HAS_BILL", "hec-bill-entry" in (code or ""), "HAS_TRF_FLOW", "TRF_FLOW" in (code or ""))' \
'print("HEAD", (code or "")[:120].replace("\\n"," "))' \
'print("CLIENT", frappe.get_all("Client Script", filters={"dt":"Customer TRF"}, fields=["name","enabled","view"]))' \
'exit()' \
| bench --site health.localhost console
EOS
