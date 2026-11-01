#!/usr/bin/env python3
"""Re-install the People HRMS add-on files into the web build if a deploy wiped them.

Safe to run repeatedly: it only writes when a file or an index.html tag is missing.
"""
import filecmp
import hashlib
import re
import shutil
import subprocess
from pathlib import Path

ADDONS = Path("/opt/health-ecosystem/people-addons")
DIST = Path("/opt/health-ecosystem/health_web_app/dist")
FILES = (
    "people-profile-align.css",
    "people-user-menu.css",
    "people-user-menu.js",
    "employee-id-card.css",
    "qrcode-generator.js",
    "employee-id-card.js",
    "people-org.css",
    "people-org.js",
    "people-geofence.js",
    "people-access.js",
    "people-access.css",
    "verify-id.html",
)
TAGS = (
    '<link rel="stylesheet" href="/people-profile-align.css?v=3" />',
    '<link rel="stylesheet" href="/people-user-menu.css" />',
    '<link rel="stylesheet" href="/employee-id-card.css?v=5" />',
    '<link rel="stylesheet" href="/people-org.css?v=18" />',
    '<script src="/qrcode-generator.js"></script>',
    '<script src="/people-user-menu.js" defer></script>',
    '<script src="/employee-id-card.js?v=11" defer></script>',
    '<link rel="stylesheet" href="/people-access.css?v=8" />',
    '<script src="/people-access.js?v=12" defer></script>',
    '<script src="/people-org.js?v=30" defer></script>',
    '<script src="/people-geofence.js?v=2" defer></script>',
)

OPS_DIST = Path("/opt/health-ecosystem/ops_portal/dist")
OPS_TAG = '<script src="/ops-gate.js?v=2"></script>'

# The aesthetics console only lets in staff/HR roles; also admit the roles Portal Access grants for it.
AE_GATE = re.compile(r'\b(\w+)\.includes\("Administrator"\)\|\|\1\.includes\("HR Manager"\)')
AE_MARK = 'includes("Aesthetic Staff")'

CONTAINER = "docker-backend-1"
PKG = "/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core"
APP = PKG + "/health_ecosystem_core"
HOOK = "health_ecosystem_core.health_ecosystem_core.clinical_people_access.enforce_portal_permissions"

# (file, marker that proves the fix is present, old text, new text)
PATCHES = (
    (
        "clinical_phase132_foundations.py",
        'pinned = {"hr_manager@health.local"}',
        re.compile(r'^(\t+)for user in sorted\(users - \{"Administrator", "Guest"\}\):\n', re.M),
        lambda m: (
            f"{m.group(1)}# Dedicated People portal login. Its password is restored by seed_demo_hr_manager and must not be rotated.\n"
            f'{m.group(1)}pinned = {{"hr_manager@health.local"}}\n'
            f'{m.group(1)}for user in sorted(users - {{"Administrator", "Guest"}} - pinned):\n'
        ),
    ),
    (
        "clinical_phase90_people_hrms.py",
        "include_inactive",
        re.compile(r'^(\t)filters = \{"status": "Active"\}\n(\tif department:\n\t\tfilters\["department"\] = department)', re.M),
        lambda m: f'{m.group(1)}filters = {{}} if cint(frappe.form_dict.get("include_inactive")) else {{"status": "Active"}}\n{m.group(2)}',
    ),
    (
        "clinical_phase90_people_hrms.py",
        "geo_sites",
        re.compile(r'^\tpayload\["locations"\] = sorted\(\{r\.get\("location"\) for r in rows if r\.get\("location"\)\}\)\n', re.M),
        lambda m: (
            '\tgeo_sites = []\n'
            '\tif frappe.db.exists("DocType", "People Geofence Location"):\n'
            '\t\tgeo_sites = [cstr(t) for t in frappe.get_all("People Geofence Location", filters={"status": "Active"}, pluck="title", order_by="title asc") if t]\n'
            '\tpayload["locations"] = geo_sites + sorted({r.get("location") for r in rows if r.get("location")} - set(geo_sites))\n'
        ),
    ),
)


def _cat(path):
    try:
        return subprocess.check_output(["docker", "exec", CONTAINER, "cat", path], stderr=subprocess.DEVNULL).decode()
    except subprocess.CalledProcessError:
        return None


def _put(path, text):
    tmp = Path("/tmp/_people_addon_put.py")
    tmp.write_text(text)
    subprocess.check_call(["docker", "cp", str(tmp), f"{CONTAINER}:{path}"])
    tmp.unlink()
    subprocess.check_call(["docker", "exec", CONTAINER, "/home/frappe/frappe-bench/env/bin/python", "-m", "py_compile", path])


def restore_backend():
    changed = []
    backend = ADDONS / "backend"
    if backend.exists():
        for src in sorted(backend.glob("clinical_*.py")):
            text = src.read_text()
            if _cat(f"{APP}/{src.name}") != text:
                _put(f"{APP}/{src.name}", text)
                changed.append(src.name)
    hooks = _cat(f"{PKG}/hooks.py")
    if hooks and HOOK not in hooks and "before_request = [" in hooks:
        start = hooks.index("before_request = [")
        close = hooks.index("\n]", start) + 1
        _put(f"{PKG}/hooks.py", hooks[:close] + f'    "{HOOK}",\n' + hooks[close:])
        changed.append("hooks.py")
    for name, marker, pattern, repl in PATCHES:
        text = _cat(f"{APP}/{name}")
        if not text or marker in text:
            continue
        new_text, count = pattern.subn(repl, text, count=1)
        if count:
            _put(f"{APP}/{name}", new_text)
            changed.append(name)
    if changed:
        subprocess.check_call(["docker", "restart", CONTAINER], stdout=subprocess.DEVNULL)
        print("backend restored:", ", ".join(changed))


def restore_ops_gate():
    index = OPS_DIST / "index.html"
    src = ADDONS / "ops-gate.js"
    if not index.exists() or not src.exists():
        return
    changed = []
    dst = OPS_DIST / "ops-gate.js"
    if not dst.exists() or not filecmp.cmp(src, dst, shallow=False):
        shutil.copyfile(src, dst)
        changed.append("ops-gate.js")
    html = index.read_text()
    if OPS_TAG not in html:
        html = re.sub(r'\s*<script src="/ops-gate\.js[^"]*"></script>', "", html)
        html = re.sub(r"(\s*)(<script type=\"module\")", r"\1" + OPS_TAG + r"\1\2", html, count=1)
        if OPS_TAG not in html:
            html = html.replace("</head>", "  " + OPS_TAG + "\n  </head>", 1)
        index.write_text(html)
        changed.append("ops index.html")
    if changed:
        print("ops restored:", ", ".join(changed))


def patch_aesthetic_gate():
    index = DIST / "index.html"
    if not index.exists():
        return
    m = re.search(r'src="/?(web-assets/index-[^"]+\.js)"', index.read_text())
    if not m:
        return
    bundle = DIST / m.group(1)
    text = bundle.read_text(encoding="utf-8")
    if AE_MARK in text or len(AE_GATE.findall(text)) != 1:
        return
    new_text = AE_GATE.sub(lambda g: f'{g.group(0)}||{g.group(1)}.includes("Aesthetic Staff")||{g.group(1)}.includes("Aesthetic Manager")', text)
    tmp = bundle.with_name(bundle.name + ".tmp")
    tmp.write_text(new_text, encoding="utf-8")
    shutil.copymode(bundle, tmp)
    tmp.replace(bundle)
    sw = DIST / "sw.js"
    if sw.exists():
        sw_text = sw.read_text(encoding="utf-8", errors="replace")
        pattern = r'(\{url:"' + re.escape(m.group(1)) + r'",revision:)(null|"[^"]*")'
        sw.write_text(re.sub(pattern, lambda g: f'{g.group(1)}"ae-{len(new_text)}"', sw_text, count=1), encoding="utf-8")
    print("aesthetic console gate patched:", bundle.name)


def main():
    try:
        restore_backend()
    except Exception as exc:
        print("backend restore failed:", exc)
    for step in (restore_ops_gate, patch_aesthetic_gate):
        try:
            step()
        except Exception as exc:
            print(step.__name__, "failed:", exc)
    index = DIST / "index.html"
    if not index.exists() or not ADDONS.exists():
        return
    changed = []
    for name in FILES:
        src, dst = ADDONS / name, DIST / name
        if src.exists() and (not dst.exists() or not filecmp.cmp(src, dst, shallow=False)):
            shutil.copyfile(src, dst)
            changed.append(name)
    html = index.read_text()
    if not all(tag in html for tag in TAGS):
        for tag in TAGS:
            asset = re.search(r'(?:href|src)="(/[^"?]+)', tag).group(1)
            html = re.sub(r'\s*<(?:link|script)[^>]*(?:href|src)="' + re.escape(asset) + r'(?:\?[^"]*)?"[^>]*>(?:</script>)?', "", html)
        block = "\n    " + "\n    ".join(TAGS) + "\n  "
        html = html.replace("</body>", block + "</body>", 1)
        index.write_text(html)
        changed.append("index.html")
        sw = DIST / "sw.js"
        if sw.exists():
            text = sw.read_text(encoding="utf-8", errors="replace")
            rev = "people-addons-" + hashlib.md5(html.encode()).hexdigest()[:12]
            sw.write_text(re.sub(r'(\{url:"index\.html",revision:")[^"]+', r"\g<1>" + rev, text, count=1), encoding="utf-8")
    if changed:
        print("restored:", ", ".join(changed))


if __name__ == "__main__":
    main()
