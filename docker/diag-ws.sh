#!/bin/bash
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
cd /home/frappe/frappe-bench
printf '%s\n' \
'print(frappe.get_all("Workspace", or_filters=[["name","like","%ops%"],["name","like","%KPI%"],["label","like","%Ops%"]], fields=["name","label","title"]))' \
'print("PAGE_OK", frappe.db.exists("Page","hec-company-ops"))' \
'print("CLINICAL_SHORT", [s.label for s in frappe.get_doc("Workspace","Clinical").shortcuts if "Company" in (s.label or "") or "Ops" in (s.label or "")])' \
'exit()' \
| bench --site health.localhost console
EOS
