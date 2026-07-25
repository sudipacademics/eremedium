#!/bin/bash
set -euo pipefail
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash <<'EOS'
set -e
python3 - <<'PY'
import re
pdf = open("/tmp/hec_compact_bill.pdf", "rb").read()
pages = len(re.findall(rb"/Type\s*/Page(?![s\w])", pdf))
print("PAGE_OBJ", pages)
print("PDF_BYTES", len(pdf))
PY
(command -v pdfinfo >/dev/null && pdfinfo /tmp/hec_compact_bill.pdf) || true
EOS
