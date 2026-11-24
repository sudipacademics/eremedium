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
    "people-checkin.js",
    "people-access.js",
    "people-access.css",
    "people-assets.js",
    "people-assets.css",
    "people-announce.js",
    "people-announce.css",
    "people-my-team.js",
    "people-my-team.css",
    "people-leave-flow.js",
    "people-hr-records.js",
    "people-company.js",
    "people-company.css",
    "people-login-shell.js",
    "people-login-shell.css",
    "people-host.js",
    "smilecure-lifestyle.png",
    "smilecure-lifestyle-glow.png",
    "smilecure-icon.png",
    "smilecure-icon-care.png",
    "labtech-smilecure-logo.png",
    "lab-test-master.js",
    "lab-test-master.css",
    "labtech-settings.js",
    "labtech-settings.css",
    "report-lifecycle.js",
    "report-lifecycle.css",
    "labtech-report-editor.js",
    "labtech-report-editor.css",
    "fabric.min.js",
    "nabl-header.png",
    "non-nabl-header.png",
    "report-footer.png",
    "reach-team-perf.js",
    "reach-team-perf.css",
    "reach-portal-ui.js",
    "reach-portal-ui.css",
    "reach-sales-host.js",
    "aesthetic-stock.js",
    "aesthetic-sessions.js",
    "aesthetic-sessions.css",
    "aesthetic-plans.js",
    "aesthetic-plans.css",
    "aesthetic-patients.js",
    "aesthetic-patients.css",
    "aesthetic-machines.js",
    "aesthetic-machines.css",
    "verify-id.html",
)
TAGS = (
    '<link rel="stylesheet" href="/people-profile-align.css?v=4" />',
    '<link rel="stylesheet" href="/people-user-menu.css" />',
    '<link rel="stylesheet" href="/employee-id-card.css?v=5" />',
    '<link rel="stylesheet" href="/people-org.css?v=19" />',
    '<script src="/qrcode-generator.js"></script>',
    '<script src="/people-user-menu.js" defer></script>',
    '<script src="/employee-id-card.js?v=13" defer></script>',
    '<link rel="stylesheet" href="/people-access.css?v=18" />',
    '<script src="/people-access.js?v=46" defer></script>',
    '<script src="/people-org.js?v=36" defer></script>',
    '<script src="/people-geofence.js?v=2" defer></script>',
    '<script src="/people-checkin.js?v=3" defer></script>',
    '<link rel="stylesheet" href="/people-assets.css?v=11" />',
    '<script src="/people-assets.js?v=11" defer></script>',
    '<link rel="stylesheet" href="/people-announce.css?v=2" />',
    '<script src="/people-announce.js?v=2" defer></script>',
    '<link rel="stylesheet" href="/people-my-team.css?v=10" />',
    '<script src="/people-my-team.js?v=10" defer></script>',
    '<script src="/people-leave-flow.js?v=1" defer></script>',
    '<script src="/people-hr-records.js?v=1" defer></script>',
    '<link rel="stylesheet" href="/people-company.css?v=1" />',
    '<script src="/people-company.js?v=1" defer></script>',
    '<link rel="stylesheet" href="/people-login-shell.css?v=15" />',
    '<script src="/people-login-shell.js?v=17" defer></script>',
    '<script src="/people-host.js?v=1"></script>',
    '<link rel="stylesheet" href="/lab-test-master.css?v=3" />',
    '<script src="/lab-test-master.js?v=8" defer></script>',
    '<link rel="stylesheet" href="/labtech-settings.css?v=23" />',
    '<script src="/labtech-settings.js?v=24" defer></script>',
    '<link rel="stylesheet" href="/report-lifecycle.css?v=3" />',
    '<script src="/report-lifecycle.js?v=3" defer></script>',
    '<link rel="stylesheet" href="/reach-team-perf.css?v=9" />',
    '<script src="/reach-team-perf.js?v=9" defer></script>',
    '<link rel="stylesheet" href="/reach-portal-ui.css?v=11" />',
    '<script src="/reach-portal-ui.js?v=11" defer></script>',
    '<script src="/reach-sales-host.js?v=1" defer></script>',
    '<script src="/aesthetic-stock.js?v=3" defer></script>',
    '<link rel="stylesheet" href="/aesthetic-sessions.css?v=6" />',
    '<script src="/aesthetic-sessions.js?v=14" defer></script>',
    '<link rel="stylesheet" href="/aesthetic-plans.css?v=5" />',
    '<script src="/aesthetic-plans.js?v=13" defer></script>',
    '<link rel="stylesheet" href="/aesthetic-patients.css?v=1" />',
    '<script src="/aesthetic-patients.js?v=2" defer></script>',
    '<link rel="stylesheet" href="/aesthetic-machines.css?v=2" />',
    '<script src="/aesthetic-machines.js?v=3" defer></script>',
)

OPS_DIST = Path("/opt/health-ecosystem/ops_portal/dist")
OPS_TAG = '<script src="/ops-gate.js?v=4"></script>'

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
    (
        # Same redirect also fires on people.e-remedium.in for users who also have Lab roles → blank /dashboard/profile/hrms.
        "lab profile redirect skipped on people host",
        'hostname==="people.e-remedium.in"||window.self!==window.top)return',
        re.compile(
            r"(\.roles\)\|\|)(window\.self!==window\.top\)return)"
        ),
        lambda g: g.group(1)
        + 'location.hostname==="people.e-remedium.in"||'
        + g.group(2),
    ),
    (
        # HostPortalGate LABTECH_PATHS omitted Settings → hard refresh bounced to Result entry.
        "labtech settings path allowed",
        '"/dashboard/settings"',
        re.compile(r'("/dashboard/inventory","/dashboard/pathologist","/dashboard/pf-inbox")'),
        lambda g: g.group(1) + ',"/dashboard/settings","/dashboard/test-master"',
    ),
    (
        # No React route for these paths, so a refresh matched the splat and the lab home sent it to Result entry.
        "lab settings and test master routes",
        'path:"test-master"',
        re.compile(re.escape(
            'e.jsx(Be,{path:"lab-tech",element:e.jsx(pt,{roles:[We.LAB_TECH,We.ADMIN,We.SYSTEM_MANAGER],children:e.jsx(vz,{})})}),e.jsx(Be,{path:"all-bookings"'
        )),
        lambda g: g.group(0).replace(
            'path:"all-bookings"',
            'path:"settings",element:e.jsx(pt,{children:e.jsx("p",{className:"muted",children:"Settings"})})}),e.jsx(Be,{path:"test-master",element:e.jsx(pt,{children:e.jsx("p",{className:"muted",children:"Test Master"})})}),e.jsx(Be,{path:"all-bookings"',
            1,
        ),
    ),
    (
        "lab settings and test master sidebar",
        'to:"/dashboard/settings"',
        re.compile(re.escape(
            'e.jsx(Hs,{to:"/dashboard/pathologist/signed",icon:"signed",children:"Reports (Signed)"}),e.jsx("span",{className:"sidebar-section",children:"Account"}),e.jsx(Hs,{to:"/dashboard/profile",icon:"profile",children:"My Profile"})]})}const L$='
        )),
        lambda g: (
            'e.jsx(Hs,{to:"/dashboard/pathologist/signed",icon:"signed",children:"Reports (Signed)"}),'
            'e.jsx(Hs,{to:"/dashboard/test-master",icon:"accession",children:"Test Master"}),'
            'e.jsx("span",{className:"sidebar-section",children:"Account"}),'
            'e.jsx(Hs,{to:"/dashboard/settings",icon:"settings",children:"Settings"}),'
            'e.jsx(Hs,{to:"/dashboard/profile",icon:"profile",children:"My Profile"})]})}const L$='
        ),
    ),
    (
        "lab settings and test master crumbs",
        '["/dashboard/settings","Settings"]',
        re.compile(r'\["/dashboard/lab-reports","Result entry"\]'),
        lambda g: '["/dashboard/test-master","Test Master"],["/dashboard/settings","Settings"],' + g.group(0),
    ),
    (
        # Signed reports are a tab on Pathologist. Drop the extra sidebar item.
        "signed reports removed from sidebar",
        'children:"Pathologist"}),e.jsx(Hs,{to:"/dashboard/test-master",icon:"accession",children:"Test Master"})',
        re.compile(re.escape('e.jsx(Hs,{to:"/dashboard/pathologist/signed",icon:"signed",children:"Reports (Signed)"}),')),
        lambda g: "",
    ),
    (
        "signed reports removed from mobile nav",
        '{type:"link",to:"/dashboard/pathologist",label:"Pathologist"},{type:"link",to:"/dashboard/test-master",label:"Test Master"}',
        re.compile(re.escape('{type:"link",to:"/dashboard/pathologist/signed",label:"Reports (Signed)"},')),
        lambda g: "",
    ),
    (
        "signed route crumb is All Signed",
        'v?"All Signed"',
        re.compile(re.escape('v?"Reports (Signed)"')),
        lambda g: 'v?"All Signed"',
    ),
    (
        "signed page label is All Signed",
        '["/dashboard/pathologist/signed","All Signed"]',
        re.compile(re.escape('["/dashboard/pathologist/signed","Reports (Signed)"]')),
        lambda g: '["/dashboard/pathologist/signed","All Signed"]',
    ),
    (
        "signed reports are pathologist header tabs",
        '["signed",`All Signed (${(Re==null?void 0:Re.signed)??0})`],["signed_today",`Signed Today (${(Re==null?void 0:Re.signed_today)??0})`],["sent_back"',
        re.compile(re.escape(
            '(t?[["signed",`All Signed (${(Re==null?void 0:Re.signed)??0})`],["signed_today",`Signed Today (${(Re==null?void 0:Re.signed_today)??0})`]]:'
            '[["pending_review",`Pending Review (${(Re==null?void 0:Re.pending_review)??0})`],["ready_for_sign",`Ready for Sign (${(Re==null?void 0:Re.ready_for_sign)??0})`],'
            '["signed_today","Signed (Today)"],["sent_back",`Sent Back (${(Re==null?void 0:Re.sent_back)??0})`],["all","All Reports"]])'
        )),
        lambda g: (
            '([["pending_review",`Pending Review (${(Re==null?void 0:Re.pending_review)??0})`],["ready_for_sign",`Ready for Sign (${(Re==null?void 0:Re.ready_for_sign)??0})`],'
            '["signed",`All Signed (${(Re==null?void 0:Re.signed)??0})`],["signed_today",`Signed Today (${(Re==null?void 0:Re.signed_today)??0})`],'
            '["sent_back",`Sent Back (${(Re==null?void 0:Re.sent_back)??0})`],["all","All Reports"]])'
        ),
    ),
    (
        "pathologist kpis stay with signed tab",
        '}):null,e.jsxs("div",{className:"po-kpis"',
        re.compile(re.escape('t?null:e.jsxs("div",{className:"po-kpis"')),
        lambda g: 'e.jsxs("div",{className:"po-kpis"',
    ),
    (
        "signed tab does not lock other reports",
        'const De=!!ae,et=(ae==null?void 0:ae.stage)==="signed"',
        re.compile(re.escape('const De=!!ae,et=t||')),
        lambda g: 'const De=!!ae,et=',
    ),
)
# New suffix busts immutable /web-assets/ caching when we add further SPA guards.
BUNDLE_SUFFIX = "-people-sgn.js"

CONTAINER = "docker-backend-1"
PKG = "/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core"
APP = PKG + "/health_ecosystem_core"
# Host bind-mount of the app (entrypoint copies api.py from here into site-packages on every restart).
APPS_HOST = Path("/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core")
SITE_FILES = "/home/frappe/frappe-bench/sites/health.localhost/public/files"
HOOK = "health_ecosystem_core.health_ecosystem_core.clinical_people_access.enforce_portal_permissions"
# PDF letterhead logo must live inside the container (host people-addons is not mounted).
PDF_LOGO = "smilecure-lifestyle.png"

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
    (
        "clinical_people_access.py",
        '"Pathologist": ["/dashboard/pathologist", "/dashboard/pathologist/signed"]',
        re.compile(
            r'\t"Pathologist": \["/dashboard/pathologist"\],\n\t"Reports \(Signed\)": \["/dashboard/pathologist/signed"\],\n'
        ),
        lambda m: '\t"Pathologist": ["/dashboard/pathologist", "/dashboard/pathologist/signed"],\n',
    ),
    (
        "clinical_people_access.py",
        '"Reports": ["Pathologist"],',
        re.compile(r'"Reports": \["Pathologist", "Reports \(Signed\)"\],'),
        lambda m: '"Reports": ["Pathologist"],',
    ),
)


def _cat(path):
    try:
        return subprocess.check_output(["docker", "exec", CONTAINER, "cat", path], stderr=subprocess.DEVNULL).decode()
    except subprocess.CalledProcessError:
        return None


def _backend_ready():
    """True when the backend container can exec and serve (avoid restore→restart loops during boot)."""
    try:
        subprocess.check_call(
            ["docker", "exec", CONTAINER, "test", "-f", f"{APP}/api.py"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True
    except subprocess.CalledProcessError:
        return False


def _norm_py(text):
    return (text or "").replace("\r\n", "\n").replace("\r", "\n")


# CRM_KEEP_GUARD: never replace a live CRM module with a copy that dropped the shipped fixes.
CRM_KEEP_MARKERS = {
    "clinical_people_access.py": ("Service Lead", "WhatsApp Centre", "_checked_crm_categories"),
    "clinical_phase87_whatsapp.py": ("_hydrate_message_media", "Sit just after the latest message"),
    "clinical_secrets.py": ("get_crm_service_whatsapp_settings",),
    "api.py": ("save_crm_service_whatsapp_api", "mark_crm_whatsapp_conversation_read"),
}


def _crm_downgrade(name, new_text, old_text):
    marks = CRM_KEEP_MARKERS.get(name)
    if not marks or not old_text:
        return False
    return all(m in old_text for m in marks) and not all(m in (new_text or "") for m in marks)


def _put(path, text):
    tmp = Path("/tmp/_people_addon_put.py")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    subprocess.check_call(["docker", "cp", str(tmp), f"{CONTAINER}:{path}"])
    tmp.unlink()
    subprocess.check_call(["docker", "exec", CONTAINER, "/home/frappe/frappe-bench/env/bin/python", "-m", "py_compile", path])


def restore_pdf_logo():
    """Copy company logo into site public/files so Performance Report PDFs can embed it."""
    src = ADDONS / PDF_LOGO
    if not src.is_file():
        alt = DIST / "brand" / PDF_LOGO
        src = alt if alt.is_file() else None
    if not src:
        return
    dest = f"{SITE_FILES}/{PDF_LOGO}"
    try:
        subprocess.check_call(["docker", "exec", CONTAINER, "test", "-f", dest], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # Refresh when host file is newer / different size
        host_size = src.stat().st_size
        remote = subprocess.check_output(["docker", "exec", CONTAINER, "stat", "-c", "%s", dest], stderr=subprocess.DEVNULL).decode().strip()
        if remote == str(host_size):
            return
    except subprocess.CalledProcessError:
        pass
    subprocess.check_call(["docker", "exec", CONTAINER, "mkdir", "-p", SITE_FILES])
    subprocess.check_call(["docker", "cp", str(src), f"{CONTAINER}:{dest}"])
    print("pdf logo restored:", PDF_LOGO)


def restore_backend():
    changed = []
    restore_pdf_logo()
    if not _backend_ready():
        print("backend not ready — skip module restore this pass")
        return
    backend = ADDONS / "backend"
    if backend.exists():
        for src in sorted(backend.glob("clinical_*.py")):
            text = _norm_py(src.read_text(encoding="utf-8", errors="replace"))
            if APPS_HOST.is_dir():
                host_py = APPS_HOST / src.name
                host_text = host_py.read_text(encoding="utf-8", errors="replace") if host_py.is_file() else ""
                if _crm_downgrade(src.name, text, host_text):
                    print("refusing CRM downgrade", src.name)
                    continue
                if _norm_py(host_text) != text:
                    host_py.write_text(text, encoding="utf-8", newline="\n")
            remote = _cat(f"{APP}/{src.name}")
            if remote is not None and _crm_downgrade(src.name, text, remote):
                print("refusing CRM downgrade", src.name)
                continue
            if remote is None or _norm_py(remote) != text:
                _put(f"{APP}/{src.name}", text)
                changed.append(src.name)
        # api.py whitelist surface — keep site-packages AND the host apps mount identical.
        # Otherwise entrypoint overwrites site-packages on restart and the cron restore restarts forever (502 loop).
        api_src = backend / "api.py"
        if api_src.is_file():
            text = _norm_py(api_src.read_text(encoding="utf-8", errors="replace"))
            if APPS_HOST.is_dir():
                host_api = APPS_HOST / "api.py"
                host_text = host_api.read_text(encoding="utf-8", errors="replace") if host_api.is_file() else ""
                if _crm_downgrade("api.py", text, host_text):
                    print("refusing CRM downgrade api.py")
                elif _norm_py(host_text) != text:
                    host_api.write_text(text, encoding="utf-8", newline="\n")
            remote = _cat(f"{APP}/api.py")
            if remote is not None and _crm_downgrade("api.py", text, remote):
                print("refusing CRM downgrade api.py")
            elif remote is not None and _norm_py(remote) != text:
                _put(f"{APP}/api.py", text)
                changed.append("api.py")
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
            if APPS_HOST.is_dir():
                (APPS_HOST / name).write_text(new_text, encoding="utf-8", newline="\n")
            addon_py = ADDONS / "backend" / name
            if addon_py.parent.is_dir():
                addon_py.write_text(new_text, encoding="utf-8", newline="\n")
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


PEOPLE_PORTAL_NAME = "People Management - SLPL"
PEOPLE_TITLE_MARKER = "People Management - SLPL"


def patch_people_portal_title():
    """Set browser tab / PWA name on people.e-remedium.in before the SPA boots."""
    index = DIST / "index.html"
    if not index.exists():
        return
    html = index.read_text(encoding="utf-8", errors="replace")
    if "location.hostname === 'people.e-remedium.in'" in html and "document.title =" in html:
        updated = (
            html.replace("people management SLPL", PEOPLE_PORTAL_NAME)
            .replace("People HRMS", PEOPLE_PORTAL_NAME)
        )
        # Normalize any leftover title/content strings inside the people-host block.
        updated = re.sub(
            r"(if \(appTitle\) appTitle\.setAttribute\('content', ')[^']+('\);)",
            rf"\g<1>{PEOPLE_PORTAL_NAME}\2",
            updated,
            count=1,
        )
        updated = re.sub(
            r"(document\.title = ')[^']+(';)",
            rf"\g<1>{PEOPLE_PORTAL_NAME}\2",
            updated,
            count=1,
        )
        if updated != html:
            index.write_text(updated, encoding="utf-8")
            bump_sw_index(updated)
            print("people portal title updated in index.html")
        return
    block = (
        "        if (location.hostname === 'people.e-remedium.in') {\n"
        "          var peopleMark = document.querySelectorAll('link[rel=\"icon\"],link[rel=\"apple-touch-icon\"]');\n"
        "          for (var p = 0; p < peopleMark.length; p++) {\n"
        "            peopleMark[p].href = '/brand/smilecure-icon.png?v=5';\n"
        "            if (peopleMark[p].rel === 'icon') peopleMark[p].type = 'image/png';\n"
        "          }\n"
        "          var theme = document.querySelector('meta[name=\"theme-color\"]');\n"
        "          if (theme) theme.setAttribute('content', '#0b3a3b');\n"
        "          var appTitle = document.querySelector('meta[name=\"apple-mobile-web-app-title\"]');\n"
        f"          if (appTitle) appTitle.setAttribute('content', '{PEOPLE_PORTAL_NAME}');\n"
        f"          document.title = '{PEOPLE_PORTAL_NAME}';\n"
        "        }\n"
    )
    needle = "        var gone = /^\\/(?:aesthetic|aesthetics|wellness\\/aesthetics)\\/?$/;"
    if needle not in html:
        return
    html = html.replace(needle, block + needle, 1)
    index.write_text(html, encoding="utf-8")
    bump_sw_index(html)
    print("people portal title patched into index.html")


LAB_PORTAL_NAME = "Lab Tech - Smilecure"
LAB_ICON = "/brand/smilecure-icon.png?v=6"


def patch_labtech_portal_brand():
    """Lab Tech portal name and S icon before the SPA boots. Login stays on this host."""
    index = DIST / "index.html"
    if not index.exists():
        return
    html = index.read_text(encoding="utf-8", errors="replace")
    if "location.hostname === 'labtech.e-remedium.in'" in html and LAB_PORTAL_NAME in html:
        return
    block = (
        "        if (location.hostname === 'labtech.e-remedium.in') {\n"
        "          var labMark = document.querySelectorAll('link[rel=\"icon\"],link[rel=\"apple-touch-icon\"]');\n"
        "          for (var q = 0; q < labMark.length; q++) {\n"
        f"            labMark[q].href = '{LAB_ICON}';\n"
        "            if (labMark[q].rel === 'icon') labMark[q].type = 'image/png';\n"
        "          }\n"
        "          var labTheme = document.querySelector('meta[name=\"theme-color\"]');\n"
        "          if (labTheme) labTheme.setAttribute('content', '#0b3a3b');\n"
        "          var labTitle = document.querySelector('meta[name=\"apple-mobile-web-app-title\"]');\n"
        f"          if (labTitle) labTitle.setAttribute('content', '{LAB_PORTAL_NAME}');\n"
        f"          document.title = '{LAB_PORTAL_NAME}';\n"
        "        }\n"
    )
    needle = "        var gone = /^\\/(?:aesthetic|aesthetics|wellness\\/aesthetics)\\/?$/;"
    if needle not in html:
        return
    html = html.replace(needle, block + needle, 1)
    index.write_text(html, encoding="utf-8")
    bump_sw_index(html)
    print("labtech portal brand patched into index.html")


PEOPLE_HOST_GUARD = 'hostname==="people.e-remedium.in"||window.self!==window.top)return'


def _bundle_people_target(entry: str) -> str:
    """Map any index-*.js entry to a cache-busting patched bundle name."""
    base = entry
    for suffix in (BUNDLE_SUFFIX, "-people-lts.js", "-people.js", "-pa.js"):
        if base.endswith(suffix):
            base = base[: -len(suffix)] + ".js"
            break
    if base.endswith(BUNDLE_SUFFIX):
        return base
    return base[:-3] + BUNDLE_SUFFIX


def patch_main_bundle():
    """Apply BUNDLE_PATCHES to the entry bundle. Web assets are cached as immutable, so the patched
    code is saved under a new *-people.js file name and index.html is pointed at it.

    Permanently keeps the People-host lab-redirect guard so HR users with Lab roles do not land on
    a blank /dashboard/profile/hrms page on people.e-remedium.in.
    """
    index = DIST / "index.html"
    if not index.exists():
        return
    html = index.read_text()
    m = re.search(r'src="/?(web-assets/index-[^"]+\.js)"', html)
    if not m:
        return
    entry = m.group(1)
    src = DIST / entry
    if not src.is_file():
        assets = DIST / "web-assets"
        fallback = None
        if assets.is_dir():
            for alt in sorted(assets.glob("index-CBQDktaa*.js"), reverse=True):
                if alt.name.endswith(BUNDLE_SUFFIX):
                    continue
                fallback = alt
                break
        if not fallback:
            print("main bundle missing:", entry)
            return
        src = fallback
        entry = f"web-assets/{fallback.name}"
    text = src.read_text(encoding="utf-8")
    applied = []
    for name, marker, pattern, repl in BUNDLE_PATCHES:
        if marker in text:
            continue
        if len(pattern.findall(text)) != 1:
            print("main bundle: skip", name, "(pattern count != 1)")
            continue
        text = pattern.sub(repl, text)
        applied.append(name)
    if PEOPLE_HOST_GUARD not in text:
        print("main bundle: people host guard still missing after patches:", ", ".join(applied) or "none")
        if not applied:
            return
    # Prefer an already-patched source (e.g. *-people.js) so prior guards stay when we only add Settings.
    if not applied and entry.endswith(BUNDLE_SUFFIX):
        return
    if not applied and '"/dashboard/settings"' in text and PEOPLE_HOST_GUARD in text:
        # Already fully patched under an older suffix — still retarget to the current cache-bust name.
        pass
    elif not applied:
        return
    target = _bundle_people_target(entry)
    dst = DIST / target
    tmp = dst.with_name(dst.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    try:
        shutil.copymode(src, tmp)
    except Exception:
        pass
    tmp.replace(dst)
    if target != entry:
        html = html.replace(entry, target)
        index.write_text(html)
        bump_sw_index(html)
    print("main bundle patched (" + ", ".join(applied or ["retarget"]) + "):", target)


def main():
    try:
        restore_backend()
    except Exception as exc:
        print("backend restore failed:", exc)
    for step in (restore_ops_gate, patch_main_bundle, patch_people_portal_title, patch_labtech_portal_brand):
        try:
            step()
        except Exception as exc:
            print(step.__name__, "failed:", exc)
    index = DIST / "index.html"
    if not index.exists() or not ADDONS.exists():
        return
    changed = []
    brand_map = {
        "smilecure-lifestyle.png": DIST / "brand" / "smilecure-lifestyle.png",
        "smilecure-lifestyle-glow.png": DIST / "brand" / "smilecure-lifestyle-glow.png",
        "smilecure-icon.png": DIST / "brand" / "smilecure-icon.png",
        "smilecure-icon-care.png": DIST / "brand" / "smilecure-icon-care.png",
        "labtech-smilecure-logo.png": DIST / "brand" / "labtech-smilecure-logo.png",
    }
    for name in FILES:
        src = ADDONS / name
        dst = brand_map.get(name, DIST / name)
        if src.exists() and (not dst.exists() or not filecmp.cmp(src, dst, shallow=False)):
            dst.parent.mkdir(parents=True, exist_ok=True)
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
    html = index.read_text()
    stripped = re.sub(
        r'\s*<(?:link|script)[^>]*(?:href|src)="/labtech-report-editor\.(?:css|js)(?:\?[^"]*)?"[^>]*>(?:</script>)?',
        "",
        html,
    )
    if stripped != html:
        index.write_text(stripped)
        changed.append("removed report page editor")
    if changed:
        print("restored:", ", ".join(changed))


if __name__ == "__main__":
    main()
