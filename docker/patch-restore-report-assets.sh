#!/bin/bash
# Restore Desk/report assets so Stock Ledger renders correctly
set -e
cd /opt/health-ecosystem/docker

docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
mkdir -p sites/assets/frappe/dist
if [ -d apps/frappe/frappe/public/dist ]; then
  cp -a apps/frappe/frappe/public/dist/. sites/assets/frappe/dist/
fi
# sync other public files without wiping dist
rsync -a --exclude node_modules --exclude dist apps/frappe/frappe/public/ sites/assets/frappe/ 2>/dev/null || true

python3 - <<'PY'
import json, os, glob
root = "sites/assets"
aj = os.path.join(root, "assets.json")
data = json.load(open(aj)) if os.path.exists(aj) else {}

def newest(pattern):
    hits = sorted(glob.glob(os.path.join(root, pattern)))
    # prefer non-.map
    hits = [h for h in hits if not h.endswith(".map")]
    return hits[-1] if hits else None

mapping = {
    "report.bundle.css": "frappe/dist/css/report.bundle.*.css",
    "report.bundle.js": "frappe/dist/js/report.bundle.*.js",
    "desk.bundle.css": "frappe/dist/css/desk.bundle.*.css",
    "desk.bundle.js": "frappe/dist/js/desk.bundle.*.js",
    "list.bundle.js": "frappe/dist/js/list.bundle.*.js",
    "form.bundle.js": "frappe/dist/js/form.bundle.*.js",
    "controls.bundle.js": "frappe/dist/js/controls.bundle.*.js",
    "query_report.bundle.js": "frappe/dist/js/query_report.bundle.*.js",
}
for key, pat in mapping.items():
    hit = newest(pat)
    if not hit:
        print("skip missing", key, pat)
        continue
    rel = "/assets/" + os.path.relpath(hit, root).replace("\\", "/")
    print(key, data.get(key), "->", rel)
    data[key] = rel

json.dump(data, open(aj, "w"), indent=1)
for k in ("report.bundle.css", "report.bundle.js", "desk.bundle.css"):
    p = data.get(k, "")
    disk = "sites/assets" + p[len("/assets"):] if p.startswith("/assets/") else ""
    print("verify", k, os.path.exists(disk), disk)
PY
bench --site health.localhost clear-cache || true
echo ASSETS_OK
EOS

docker compose restart frontend
sleep 4
# probe via frontend container or host nginx
REPORT_CSS=$(docker compose exec -T backend bash -lc 'python3 -c "import json; print(json.load(open(\"sites/assets/assets.json\")).get(\"report.bundle.css\",\"\"))"')
REPORT_CSS=$(echo "$REPORT_CSS" | tr -d '\r')
echo "REPORT_CSS=$REPORT_CSS"
curl -skI "https://erp.e-remedium.in${REPORT_CSS}" | head -5
echo RESTORE_DONE
