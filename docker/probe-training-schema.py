#!/usr/bin/env python3
"""One-off server probe for Training Event / Feedback schema."""
import json, subprocess, textwrap

script = textwrap.dedent("""
import frappe
frappe.connect(site='health.localhost')
meta = frappe.get_meta('Training Event')
print('TE fields:', [f.fieldname for f in meta.fields if f.fieldtype in ('Table','Table MultiSelect')])
for f in meta.fields:
    if f.fieldtype == 'Table':
        print(' child', f.fieldname, '->', f.options)
        cm = frappe.get_meta(f.options)
        print('  child cols:', [c.fieldname for c in cm.fields if c.fieldname not in ('name','parent','parenttype','parentfield','idx')])
print('TF module:', frappe.db.get_value('DocType', 'Training Feedback', 'module'))
print('HR module exists:', frappe.db.exists('Module Def', 'HR'))
ev = frappe.get_all('Training Event', pluck='name', limit=1)
if ev:
    d = frappe.get_doc('Training Event', ev[0])
    print('sample event', ev[0], 'docstatus', d.docstatus, 'status', getattr(d,'event_status',None))
    for f in meta.fields:
        if f.fieldtype == 'Table':
            rows = d.get(f.fieldname) or []
            print(' rows', f.fieldname, len(rows))
""")

subprocess.run(
    [
        "ssh",
        "root@167.233.108.90",
        "cd /opt/health-ecosystem/docker && docker compose exec -T backend python3 -c "
        + json.dumps(script),
    ],
    check=False,
)
