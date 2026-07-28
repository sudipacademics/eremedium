#!/bin/bash
set -euo pipefail
SW=/opt/health-ecosystem/health_web_app/dist/sw.js
python3 - <<PY
from pathlib import Path
t = Path("$SW").read_text(encoding="utf-8")
print("has_denylist", "denylist" in t)
print("has_onboard_deny", r"/^\/onboard" in t or "/^\\/onboard" in t)
i = t.find("createHandlerBoundToURL")
print(t[i:i+280] if i >= 0 else "missing handler")
PY
# Ensure post-deploy patch still no-ops cleanly when already baked in
bash /tmp/patch-sw-ffms-denylist.sh || true
