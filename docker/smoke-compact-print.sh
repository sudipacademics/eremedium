#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
printf '%s\n' \
'from health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill import get_hec_invoice_pdf, _landscape_html' \
'import re' \
'html = frappe.db.get_value("Print Format", "HEC Landscape GST Bill Purchase", "html") or ""' \
'print("DB_HAS_ROOT", "hec-bill-root" in html)' \
'print("TMPL_HAS_ROOT", "hec-bill-root" in _landscape_html())' \
'pdf = get_hec_invoice_pdf("Purchase Invoice", "ACC-PINV-2026-00029")' \
'open("/tmp/hec_compact_bill.pdf", "wb").write(pdf)' \
'm = re.search(br"/Count\\s+(\\d+)", pdf)' \
'print("PDF_BYTES", len(pdf), "PAGE_COUNT", m.group(1).decode() if m else "?")' \
'exit()' \
| bench --site health.localhost console
EOS
