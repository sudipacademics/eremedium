#!/bin/bash
# Deploy Marg-style compact continuous print bill (no full-page footer gap)
set -euo pipefail
ROOT="/opt/health-ecosystem"
SITE="${FRAPPE_SITE:-health.localhost}"
SRC="$ROOT/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase69_pharma_bill.py"
cd "$ROOT/docker"

if [[ ! -f "$SRC" ]]; then
  echo "MISSING $SRC" >&2
  exit 1
fi

docker compose cp "$SRC" \
  backend:/home/frappe/frappe-bench/apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase69_pharma_bill.py

docker compose exec -T backend bash -s "$SITE" <<'EOS'
set -e
SITE="$1"
cd /home/frappe/frappe-bench
PKG=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core as m, os; print(os.path.dirname(m.__file__))")
cp -f apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase69_pharma_bill.py "$PKG/clinical_phase69_pharma_bill.py"
bench --site "$SITE" clear-cache
EOS

docker compose restart backend
sleep 10

docker compose exec -T backend bash -s "$SITE" <<'EOS'
set -e
SITE="$1"
cd /home/frappe/frappe-bench
OUT=$(bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.ensure_print_formats)
echo "PRINT_FORMATS $OUT"

# Smoke: render PDF for latest purchase invoice and check page count via pdfinfo if present
PINV=$(bench --site "$SITE" execute frappe.client.get_list --kwargs '{"doctype":"Purchase Invoice","fields":["name"],"limit_page_length":1,"order_by":"modified desc"}')
echo "LATEST_PINV $PINV"
NAME=$(python3 - <<PY
import ast,sys
raw="""$PINV"""
# bench execute may print repr
try:
  data=ast.literal_eval(raw.strip().splitlines()[-1])
except Exception:
  data=[]
print(data[0]["name"] if data else "")
PY
)
if [[ -z "$NAME" ]]; then
  echo "NO_PINV_SKIP_PDF"
  exit 0
fi
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.get_hec_invoice_pdf --kwargs "{\"doctype\":\"Purchase Invoice\",\"name\":\"$NAME\"}" >/tmp/hec_bill_smoke.bin 2>/tmp/hec_bill_smoke.err || true
# Prefer writing PDF via small python helper
./env/bin/python - <<PY
import frappe, os
frappe.init(site="$SITE")
frappe.connect()
from health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill import get_hec_invoice_pdf
pdf = get_hec_invoice_pdf("Purchase Invoice", "$NAME")
path = "/tmp/hec_compact_bill.pdf"
open(path, "wb").write(pdf)
print("PDF_BYTES", len(pdf), "PATH", path)
# Count pages via /Count in PDF trailer (rough)
n = pdf.count(b"/Type /Page") + pdf.count(b"/Type/Page")
# Deduplicate common double-count; prefer /Count
import re
m = re.search(br"/Count\s+(\d+)", pdf)
print("PAGE_HINT_COUNT", m.group(1).decode() if m else "?", "PAGE_OBJ_HINT", n)
frappe.destroy()
PY
echo COMPACT_PRINT_OK
EOS
