"""Add the Care Backend portal to clinical_people_access.py in place (idempotent).

Usage: python3 patch_people_access.py /opt/health-ecosystem/people-addons/backend/clinical_people_access.py
"""

import sys
from pathlib import Path

CARE_PATHS = '''CARE_MODULE_PATHS = {
\t"Dashboard": ["/"],
\t"Appointments": ["/appointments"],
\t"Doctors": ["/doctors"],
\t"Physiotherapy": ["/physio"],
\t"Patients": ["/patients"],
\t"Test & Lab": ["/lab"],
\t"Diagnostics": ["/diagnostics"],
\t"Billing & Invoice": ["/billing"],
\t"Pharmacy": ["/pharmacy"],
\t"Inventory Management": ["/inventory"],
\t"Branch Management": ["/branches"],
\t"Reports & Analytics": ["/reports"],
\t"Assets Management": ["/assets"],
\t"User & Access": ["/access"],
\t"Settings": ["/settings"],
}
'''

CARE_PORTAL = '''\t"care": {
\t\t"label": "Care Backend",
\t\t"url": "https://care.e-remedium.in",
\t\t"roles": ["Care Staff", "Employee"],
\t\t"modules": list(CARE_MODULE_PATHS),
\t\t"manage_roles": ["Care Manager"],
\t\t"module_paths": CARE_MODULE_PATHS,
\t},
'''

EDITS = [
    (
        'ELEVATED_ROLES = {"HR Manager", "HR User", "Lab Manager", "Sales Manager", "Aesthetic Manager", "Operations Manager"}',
        'ELEVATED_ROLES = {"HR Manager", "HR User", "Lab Manager", "Sales Manager", "Aesthetic Manager", "Operations Manager", "Care Manager"}',
    ),
    (
        '# Roles these portals check that may not exist yet on a fresh site (created on first use).\n'
        'PORTAL_ROLES = ("Aesthetic Staff", "Aesthetic Manager", "Operations Staff", "Operations Manager")',
        CARE_PATHS
        + '# Roles these portals check that may not exist yet on a fresh site (created on first use).\n'
        'PORTAL_ROLES = ("Aesthetic Staff", "Aesthetic Manager", "Operations Staff", "Operations Manager", "Care Staff", "Care Manager")',
    ),
    (
        '\t\t"module_paths": OPS_MODULE_PATHS,\n\t},\n}',
        '\t\t"module_paths": OPS_MODULE_PATHS,\n\t},\n' + CARE_PORTAL + '}',
    ),
]


# Modules added to CARE_MODULE_PATHS after the first release: (new line, line it goes after).
LATER_MODULES = [
    ('\t"Diagnostics": ["/diagnostics"],', '\t"Test & Lab": ["/lab"],'),
    ('\t"Doctors": ["/doctors"],', '\t"Appointments": ["/appointments"],'),
    ('\t"Physiotherapy": ["/physio"],', '\t"Doctors": ["/doctors"],'),
]


def main(path):
    file = Path(path)
    text = file.read_text()
    if '"care": {' in text:
        block_start = text.index("CARE_MODULE_PATHS = {")
        block_end = text.index("\n}", block_start)
        block = text[block_start:block_end]
        added = []
        for new_line, after in LATER_MODULES:
            if new_line in block:
                continue
            if block.count(after) != 1:
                print("anchor not found:", after.strip())
                return 1
            block = block.replace(after, f"{after}\n{new_line}")
            added.append(new_line.strip().split(":")[0])
        if not added:
            print("care portal already present")
            return 0
        file.write_text(text[:block_start] + block + text[block_end:])
        print("care modules added:", ", ".join(added))
        return 0
    for old, new in EDITS:
        if text.count(old) != 1:
            print("anchor not found exactly once:", old.splitlines()[-1][:80])
            return 1
        text = text.replace(old, new)
    file.write_text(text)
    print("care portal added")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
