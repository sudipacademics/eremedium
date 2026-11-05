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
    '<script src="/employee-id-card.js?v=13" defer></script>',
    '<link rel="stylesheet" href="/people-access.css?v=9" />',
    '<script src="/people-access.js?v=14" defer></script>',
    '<script src="/people-org.js?v=30" defer></script>',
    '<script src="/people-geofence.js?v=2" defer></script>',
)

OPS_DIST = Path("/opt/health-ecosystem/ops_portal/dist")
OPS_TAG = '<script src="/ops-gate.js?v=2"></script>'

# Small fixes to the main SPA bundle, which is built elsewhere: (name, marker proving the fix is in, pattern, replacement).
BUNDLE_PATCHES = (
    (
        # The aesthetics console only lets in staff/HR roles; also admit the roles Portal Access grants for it.
        "aesthetic console roles",
        'includes("Aesthetic Staff")',
        re.compile(r'\b(\w+)\.includes\("Administrator"\)\|\|\1\.includes\("HR Manager"\)'),
        lambda g: f'{g.group(0)}||{g.group(1)}.includes("Aesthetic Staff")||{g.group(1)}.includes("Aesthetic Manager")',
    ),
    (
        # Lab staff are sent from /people/* to their lab My Profile; inside an embedded HR workspace that loops.
        "lab profile redirect skipped in frames",
        ".roles)||window.self!==window.top)return",
        re.compile(r'(\{tab:\w+="profile",children:\w+\}\)\{const\{user:\w+\}=\w+\(\),\{pathname:\w+\}=\w+\(\);if\(!\w+\(\w+==null\?void 0:\w+\.roles\))(\)return)'),
        lambda g: g.group(1) + "||window.self!==window.top" + g.group(2),
    ),
)
BUNDLE_SUFFIX = "-pa.js"

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
    (
        "clinical_phase90_people_hrms.py",
        "mobile_taken",
        re.compile(r'(\t\ttemp_password = f"Hire@\{random_string\(6\)\}"\n)(\t\tuser = frappe\.get_doc\(\n(?:\t\t\t.*\n){1,8}?\t\t\t\t"mobile_no": )mobile,\n'),
        lambda m: (
            m.group(1)
            + "\t\t# A mobile number can belong to only one login (often a patient OTP account); then keep it on the Employee only.\n"
            + '\t\tmobile_taken = bool(mobile) and bool(frappe.db.exists("User", {"mobile_no": mobile}))\n'
            + m.group(2)
            + "None if mobile_taken else mobile,\n"
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


def bump_sw_index(html):
    sw = DIST / "sw.js"
    if not sw.exists():
        return
    text = sw.read_text(encoding="utf-8", errors="replace")
    rev = "people-addons-" + hashlib.md5(html.encode()).hexdigest()[:12]
    sw.write_text(re.sub(r'(\{url:"index\.html",revision:")[^"]+', r"\g<1>" + rev, text, count=1), encoding="utf-8")


def patch_main_bundle():
    """Apply BUNDLE_PATCHES to the entry bundle. Web assets are cached as immutable, so the patched
    code is saved under a new file name and index.html is pointed at it."""
    index = DIST / "index.html"
    if not index.exists():
        return
    html = index.read_text()
    m = re.search(r'src="/?(web-assets/index-[^"]+\.js)"', html)
    if not m:
        return
    entry = m.group(1)
    text = (DIST / entry).read_text(encoding="utf-8")
    applied = []
    for name, marker, pattern, repl in BUNDLE_PATCHES:
        if marker in text or len(pattern.findall(text)) != 1:
            continue
        text = pattern.sub(repl, text)
        applied.append(name)
    if not applied:
        return
    target = entry if entry.endswith(BUNDLE_SUFFIX) else entry[:-3] + BUNDLE_SUFFIX
    dst = DIST / target
    tmp = dst.with_name(dst.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    shutil.copymode(DIST / entry, tmp)
    tmp.replace(dst)
    if target != entry:
        html = html.replace(entry, target)
        index.write_text(html)
        bump_sw_index(html)
    print("main bundle patched (" + ", ".join(applied) + "):", target)


def main():
    try:
        restore_backend()
    except Exception as exc:
        print("backend restore failed:", exc)
    for step in (restore_ops_gate, patch_main_bundle):
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
        bump_sw_index(html)
    if changed:
        print("restored:", ", ".join(changed))


if __name__ == "__main__":
    main()
