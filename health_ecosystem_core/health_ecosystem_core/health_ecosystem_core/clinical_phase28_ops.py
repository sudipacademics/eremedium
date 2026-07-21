"""Phase 28 — Company ops rhythm: division schedules, email digests, workflow tasks.

Based on Remedium modular division structure (CRM, Accounts, HR, Operations,
Marketing, Content, Asset, Legal, Franchisee, Planning).
"""

from __future__ import annotations

import os
from html import escape

import frappe
from frappe import _
from frappe.utils import get_datetime, now_datetime, today

PHASE28_DOCTYPES = (
    ("company_division", "Company Division"),
    ("ops_staff_profile", "Ops Staff Profile"),
    ("ops_rhythm_task", "Ops Rhythm Task"),
    ("ops_rhythm_dispatch", "Ops Rhythm Dispatch"),
)

DEMO_PASSWORD = "OpsDemoChangeMe@123"
COMPANY_NAME = "Remedium Care"
OPS_EMAIL_DOMAIN = "e-remedium.in"

DIVISIONS = (
    {
        "division_code": "CRM",
        "division_name": "CRM Division",
        "source_inputs": "Leads; Repeat / follow-up customers",
        "outputs": "Cash received after booking of service / product",
        "principal_workflow": "Leads → Booking → Reception → Customers → Sales → Cash",
    },
    {
        "division_code": "ACC",
        "division_name": "Accounts Division",
        "source_inputs": "Receipt / payment voucher; Payroll voucher",
        "outputs": "Taxation; Financial ratios",
        "principal_workflow": "Voucher → F/T + Taxation → Bank reconciliation → Ratios",
    },
    {
        "division_code": "HR",
        "division_name": "HR Division",
        "source_inputs": "Staff planning; Replacement needs",
        "outputs": "Onboarding / separation; Training / appraisal; Payroll",
        "principal_workflow": "Staff planning → Recruitment → Training → Lifecycle → Payroll → Separation → Replacement",
    },
    {
        "division_code": "OPS",
        "division_name": "Operations Division",
        "source_inputs": "Booking receipt; Development order",
        "outputs": "Service / order delivery; Asset installation / inauguration",
        "principal_workflow": "DO → Layout → Vendor selection → Work order → Purchase → Labour timesheet → Inspection → Mock drill → Inauguration",
    },
    {
        "division_code": "MKT",
        "division_name": "Marketing Division",
        "source_inputs": "Expansion plan / BGP",
        "outputs": "Leads",
        "principal_workflow": "Target → Content / tour plan → Campaign → ROAS / ROI → Lead creation",
    },
    {
        "division_code": "CNT",
        "division_name": "Content Division",
        "parent_division": "MKT",
        "source_inputs": "Content planner; Development orders from Planning",
        "outputs": "Content delivery",
        "principal_workflow": "Content plan → Visualization & writing → Calendar → Raw creation → Editing → Storage → Optimisation → Delivery",
    },
    {
        "division_code": "AST",
        "division_name": "Asset Management",
        "parent_division": "OPS",
        "source_inputs": "Asset issue",
        "outputs": "Entry, closure & security; Housekeeping roster; Maintenance & repair",
        "principal_workflow": "Asset issue → Surveillance → Housekeeping roster → Maintenance / repair / updation",
    },
    {
        "division_code": "LEG",
        "division_name": "Legal & Licensing",
        "parent_division": "OPS",
        "source_inputs": "Project orders; Legal notices",
        "outputs": "License creation; Legal defence",
        "principal_workflow": "Project order / notice → License filing → Defence / compliance closure",
    },
    {
        "division_code": "FRC",
        "division_name": "Franchisee Management",
        "source_inputs": "Franchisee booking",
        "outputs": "Franchisee maintenance; Corpus upkeep",
        "principal_workflow": "Booking → Money realization → Inter-dept project order → Coordination → Delivery → Replacement → Corpus maintenance",
    },
    {
        "division_code": "PLN",
        "division_name": "Planning Division",
        "source_inputs": "Business VMO; Financial budget",
        "outputs": "Divisional HR / asset plans; SOPs; Quality parameters",
        "principal_workflow": "VMO + Budget → Department feedback → Output creation → Variability analysis → Quality vs cost optimisation",
    },
)


def _import_doctype(folder, doctype_name):
    if frappe.db.exists("DocType", doctype_name):
        return
    from frappe.modules.import_file import import_file_by_path

    candidates = []
    app_path = frappe.get_app_path("health_ecosystem_core")
    candidates.append(os.path.join(app_path, "health_ecosystem_core", "doctype", folder, f"{folder}.json"))
    try:
        import health_ecosystem_core.health_ecosystem_core.api as api_mod

        pkg_root = os.path.dirname(api_mod.__file__)
        candidates.append(os.path.join(pkg_root, "doctype", folder, f"{folder}.json"))
    except Exception:
        pass
    for json_path in candidates:
        if os.path.isfile(json_path):
            import_file_by_path(json_path, force=True)
            frappe.db.commit()
            if frappe.db.exists("DocType", doctype_name):
                return
    frappe.throw(_("Could not install {0}").format(doctype_name))


def ensure_phase28_doctypes():
    for folder, name in PHASE28_DOCTYPES:
        _import_doctype(folder, name)


def ensure_phase28_settings():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields(
        {
            "Health Ecosystem Settings": [
                {
                    "fieldname": "enable_ops_rhythm_emails",
                    "label": "Enable Ops Rhythm Emails",
                    "fieldtype": "Check",
                    "default": "1",
                    "insert_after": "enable_scheduled_reminders",
                    "description": "Daily / weekly / monthly division task digests to staff",
                },
                {
                    "fieldname": "ops_rhythm_digest_hour",
                    "label": "Ops Digest Hour (0-23)",
                    "fieldtype": "Int",
                    "default": "8",
                    "insert_after": "enable_ops_rhythm_emails",
                },
            ],
        },
        update=True,
    )
    if frappe.db.exists("Health Ecosystem Settings", "Health Ecosystem Settings"):
        settings = frappe.get_single("Health Ecosystem Settings")
        changed = False
        if hasattr(settings, "enable_ops_rhythm_emails") and not settings.enable_ops_rhythm_emails:
            settings.enable_ops_rhythm_emails = 1
            changed = True
        if hasattr(settings, "ops_rhythm_digest_hour") and not getattr(settings, "ops_rhythm_digest_hour", None):
            settings.ops_rhythm_digest_hour = 8
            changed = True
        if changed:
            settings.save(ignore_permissions=True)


def ops_rhythm_enabled():
    settings = frappe.get_single("Health Ecosystem Settings") if frappe.db.exists(
        "DocType", "Health Ecosystem Settings"
    ) else None
    if settings and hasattr(settings, "enable_ops_rhythm_emails"):
        return bool(settings.enable_ops_rhythm_emails)
    return True


def _upsert_division(spec):
    code = spec["division_code"]
    if frappe.db.exists("Company Division", code):
        doc = frappe.get_doc("Company Division", code)
        doc.update({k: v for k, v in spec.items() if k != "division_code"})
        doc.save(ignore_permissions=True)
        return code
    doc = frappe.get_doc({"doctype": "Company Division", **spec})
    doc.insert(ignore_permissions=True)
    return doc.name


def _upsert_user(email, full_name, roles=None):
    roles = roles or ["Employee"]
    if frappe.db.exists("User", email):
        return email
    parts = full_name.split(None, 1)
    doc = frappe.get_doc(
        {
            "doctype": "User",
            "email": email,
            "first_name": parts[0],
            "last_name": parts[1] if len(parts) > 1 else "",
            "user_type": "System User",
            "send_welcome_email": 0,
            "enabled": 1,
        }
    )
    for role in roles:
        if frappe.db.exists("Role", role):
            doc.append("roles", {"role": role})
    doc.insert(ignore_permissions=True)
    from frappe.utils.password import update_password

    update_password(email, DEMO_PASSWORD, logout_all_sessions=False)
    return email


def _upsert_staff_profile(spec):
    code = spec["profile_code"]
    if frappe.db.exists("Ops Staff Profile", code):
        doc = frappe.get_doc("Ops Staff Profile", code)
        doc.update(spec)
        doc.save(ignore_permissions=True)
        return code
    doc = frappe.get_doc({"doctype": "Ops Staff Profile", **spec})
    doc.insert(ignore_permissions=True)
    return doc.name


def _upsert_task(spec):
    code = spec["task_code"]
    if frappe.db.exists("Ops Rhythm Task", code):
        doc = frappe.get_doc("Ops Rhythm Task", code)
        doc.update(spec)
        doc.save(ignore_permissions=True)
        return code
    doc = frappe.get_doc({"doctype": "Ops Rhythm Task", **spec})
    doc.insert(ignore_permissions=True)
    return doc.name


def seed_divisions():
    ensure_phase28_doctypes()
    created = []
    for spec in DIVISIONS:
        parent = spec.get("parent_division")
        row = dict(spec)
        if parent:
            row["parent_division"] = parent
        created.append(_upsert_division(row))
    return created


def seed_staff_profiles():
    """Officer + Clerk per division; Service HR from existing field roles."""
    from health_ecosystem_core.health_ecosystem_core.clinical_phase21 import ensure_employee_for_user

    profiles = []
    for div in DIVISIONS:
        code = div["division_code"]
        short = code.lower()
        for tier, label in (("Officer", "Officer"), ("Clerk", "Clerk")):
            email = f"{short}.{tier.lower()}@{OPS_EMAIL_DOMAIN}"
            full_name = f"{div['division_name']} {label}"
            user = _upsert_user(email, full_name, roles=["Employee"])
            ensure_employee_for_user(user)
            profile_code = f"{code}-{tier.upper()}"
            profiles.append(
                _upsert_staff_profile(
                    {
                        "profile_code": profile_code,
                        "full_name": full_name,
                        "user": user,
                        "division": code,
                        "role_tier": tier,
                        "work_email": email,
                        "active": 1,
                    }
                )
            )

    service_hr = (
        ("phlebotomist@health.local", "OPS", "Field Phlebotomist", f"collect.ops@{OPS_EMAIL_DOMAIN}"),
        ("sales_rep1@health.local", "MKT", "Sales Representative", f"reach.ops@{OPS_EMAIL_DOMAIN}"),
        ("franchise_hub@health.local", "FRC", "Franchise Hub Operator", f"partners.ops@{OPS_EMAIL_DOMAIN}"),
    )
    for user, division, title, work_email in service_hr:
        if not frappe.db.exists("User", user):
            continue
        full_name = frappe.db.get_value("User", user, "full_name") or title
        ensure_employee_for_user(user)
        code = f"SRV-{division}-{user.split('@')[0].upper()}"
        profiles.append(
            _upsert_staff_profile(
                {
                    "profile_code": code,
                    "full_name": full_name,
                    "user": user,
                    "division": division,
                    "role_tier": "Service HR",
                    "work_email": work_email,
                    "active": 1,
                }
            )
        )
    return profiles


def _task_specs():
    """Rhythm tasks derived from division workflows."""
    specs = []

    def add(code, division, frequency, tier, title, checklist, workflow=None, order=100):
        specs.append(
            {
                "task_code": code,
                "division": division,
                "frequency": frequency,
                "role_tier": tier,
                "title": title,
                "checklist": checklist,
                "workflow_reference": workflow or "",
                "sort_order": order,
                "active": 1,
            }
        )

    # --- Daily ---
    add(
        "CRM-D-OFF-01",
        "CRM",
        "Daily",
        "Officer",
        "Review lead pipeline & bookings",
        "<ul><li>Scan new leads from campaigns and phone</li><li>Prioritize hot leads for same-day callback</li><li>Confirm reception handoff for today's bookings</li><li>Log cash collection status on confirmed bookings</li></ul>",
        "Leads → Booking → Reception → Sales → Cash",
        10,
    )
    add(
        "CRM-D-CLK-01",
        "CRM",
        "Daily",
        "Clerk",
        "Update CRM register & follow-ups",
        "<ul><li>Enter yesterday's leads and booking receipts</li><li>Schedule repeat-customer follow-up calls</li><li>Share daily lead summary with CRM Officer</li></ul>",
        order=20,
    )
    add(
        "ACC-D-OFF-01",
        "ACC",
        "Daily",
        "Officer",
        "Approve vouchers & monitor cash position",
        "<ul><li>Review receipt / payment vouchers pending approval</li><li>Match booking cash deposits to bank credits</li><li>Flag exceptions for Planning division</li></ul>",
        "Voucher → F/T + Taxation → Bank recon",
        10,
    )
    add(
        "ACC-D-CLK-01",
        "ACC",
        "Daily",
        "Clerk",
        "Post daily receipts & payments",
        "<ul><li>Enter receipt and payment vouchers</li><li>Attach supporting documents</li><li>Prepare bank deposit summary for Officer sign-off</li></ul>",
        order=20,
    )
    add(
        "HR-D-OFF-01",
        "HR",
        "Daily",
        "Officer",
        "Staff attendance & replacement planning",
        "<ul><li>Review Service HR attendance (phlebo / field)</li><li>Approve urgent replacement requests</li><li>Check onboarding tasks for new joiners</li></ul>",
        order=10,
    )
    add(
        "OPS-D-OFF-01",
        "OPS",
        "Daily",
        "Officer",
        "Service delivery & DO progress",
        "<ul><li>Review open development orders and work orders</li><li>Confirm today's service HR roster vs bookings</li><li>Escalate blocked vendor / labour tasks</li></ul>",
        "Booking receipt → HR scheduling → Service delivery",
        10,
    )
    add(
        "OPS-D-SHR-01",
        "OPS",
        "Daily",
        "Service HR",
        "Field service execution checklist",
        "<ul><li>Confirm assigned collections / installations</li><li>GPS check-in at hub and at customer site</li><li>Complete service transcription & customer OTP</li></ul>",
        order=5,
    )
    add(
        "MKT-D-OFF-01",
        "MKT",
        "Daily",
        "Officer",
        "Campaign & lead quality review",
        "<ul><li>Check yesterday's campaign spend vs leads</li><li>Route qualified leads to CRM</li><li>Adjust today's digital content CTAs if needed</li></ul>",
        "Campaign → ROAS → Lead creation",
        10,
    )
    add(
        "CNT-D-CLK-01",
        "CNT",
        "Daily",
        "Clerk",
        "Content calendar execution",
        "<ul><li>Publish items due today per content calendar</li><li>Hand raw assets to editing queue</li><li>Update storage links for final assets</li></ul>",
        order=20,
    )
    add(
        "FRC-D-OFF-01",
        "FRC",
        "Daily",
        "Officer",
        "Franchisee booking & corpus watch",
        "<ul><li>Review new franchisee bookings and payments</li><li>Trigger inter-department project orders</li><li>Log corpus maintenance issues</li></ul>",
        order=10,
    )
    add(
        "PLN-D-OFF-01",
        "PLN",
        "Daily",
        "Officer",
        "Cross-division bottleneck scan",
        "<ul><li>Review divisional feedback from yesterday</li><li>Update vulnerability / variability log</li><li>Publish priority SOP clarifications if needed</li></ul>",
        order=10,
    )

    # --- Weekly (Monday digest) ---
    weekly = (
        ("CRM-W-ALL-01", "CRM", "Officer", "Weekly sales funnel review", "<ul><li>Lead → booking conversion</li><li>Repeat customer pipeline</li><li>Cash realization vs target</li></ul>"),
        ("ACC-W-ALL-01", "ACC", "Officer", "Weekly bank reconciliation", "<ul><li>Complete bank recon for the week</li><li>Update financial ratio dashboard</li><li>Prepare taxation accrual notes</li></ul>"),
        ("HR-W-ALL-01", "HR", "Officer", "Weekly staffing & training", "<ul><li>Staff planning vs demand</li><li>Training sessions completed</li><li>Appraisal follow-ups</li></ul>"),
        ("OPS-W-ALL-01", "OPS", "Officer", "Weekly operations stand-up", "<ul><li>DO / work order status</li><li>Vendor & labour performance</li><li>Mock drill / inspection schedule</li></ul>"),
        ("MKT-W-ALL-01", "MKT", "Officer", "Weekly ROAS / ROI review", "<ul><li>Campaign ROAS by channel</li><li>Field tour outcomes</li><li>Lead quality feedback to Content</li></ul>"),
        ("CNT-W-ALL-01", "CNT", "Officer", "Weekly content performance", "<ul><li>Content delivery vs plan</li><li>Patient adherence metrics from CRM</li><li>Next week's calendar draft</li></ul>"),
        ("AST-W-ALL-01", "AST", "Officer", "Weekly asset & housekeeping", "<ul><li>Housekeeping roster compliance</li><li>Maintenance backlog</li><li>Security surveillance review</li></ul>"),
        ("LEG-W-ALL-01", "LEG", "Officer", "Weekly license & legal queue", "<ul><li>Open licenses from project orders</li><li>Legal notices status</li></ul>"),
        ("FRC-W-ALL-01", "FRC", "Officer", "Weekly franchisee portfolio", "<ul><li>Inter-dept project delivery status</li><li>Replacement risk franchisees</li></ul>"),
        ("PLN-W-ALL-01", "PLN", "Officer", "Weekly planning council", "<ul><li>Budget vs actual by division</li><li>Quality vs cost trade-off decisions</li></ul>"),
    )
    for idx, (code, div, tier, title, checklist) in enumerate(weekly):
        add(code, div, "Weekly", tier, title, checklist, order=100 + idx)

    # --- Monthly ---
    monthly = (
        ("CRM-M-ALL-01", "CRM", "Officer", "Monthly CRM performance", "<ul><li>Lead source analysis</li><li>Booking & cash trends</li><li>Recommendations to Marketing</li></ul>"),
        ("ACC-M-ALL-01", "ACC", "Officer", "Monthly books close prep", "<ul><li>Payroll voucher reconciliation</li><li>Taxation filings calendar</li><li>Financial ratio pack for leadership</li></ul>"),
        ("HR-M-ALL-01", "HR", "Officer", "Monthly HR lifecycle", "<ul><li>Payroll management sign-off</li><li>Appraisal cycle progress</li><li>Separation / replacement pipeline</li></ul>"),
        ("OPS-M-ALL-01", "OPS", "Officer", "Monthly service quality review", "<ul><li>Service delivery SLA</li><li>Asset inauguration pipeline</li></ul>"),
        ("MKT-M-ALL-01", "MKT", "Officer", "Monthly marketing plan refresh", "<ul><li>BGP / expansion plan update</li><li>ROAS targets for next month</li></ul>"),
        ("PLN-M-ALL-01", "PLN", "All", "Monthly VMO & budget review", "<ul><li>Divisional HR & asset plans</li><li>SOP updates published</li><li>Quality parameter revisions</li></ul>"),
    )
    for idx, (code, div, tier, title, checklist) in enumerate(monthly):
        add(code, div, "Monthly", tier, title, checklist, order=200 + idx)

    return specs


def seed_ops_tasks():
    created = []
    for spec in _task_specs():
        created.append(_upsert_task(spec))
    return created


def seed_phase28_demo():
    divisions = seed_divisions()
    staff = seed_staff_profiles()
    tasks = seed_ops_tasks()
    frappe.db.commit()
    return {
        "divisions": len(divisions),
        "staff_profiles": len(staff),
        "tasks": len(tasks),
        "demo_password": DEMO_PASSWORD,
    }


def _period_key(frequency):
    now = get_datetime()
    if frequency == "Daily":
        return f"{today()}|daily"
    if frequency == "Weekly":
        year, week, _ = now.isocalendar()
        return f"{year}-W{week:02d}|weekly"
    return f"{now.strftime('%Y-%m')}|monthly"


def _staff_for_task(task):
    filters = {"division": task.division, "active": 1}
    tiers = [task.role_tier]
    if task.role_tier == "All":
        tiers = ["Officer", "Clerk", "Service HR"]
    rows = frappe.get_all(
        "Ops Staff Profile",
        filters=filters,
        fields=["name", "work_email", "user", "full_name", "role_tier"],
    )
    return [r for r in rows if r.role_tier in tiers]


def _already_dispatched(period_key, email, frequency):
    return frappe.db.exists(
        "Ops Rhythm Dispatch",
        {"period_key": period_key, "recipient_email": email, "frequency": frequency},
    )


def _log_dispatch(task, frequency, period_key, email, user, status, preview):
    frappe.get_doc(
        {
            "doctype": "Ops Rhythm Dispatch",
            "task": task,
            "frequency": frequency,
            "period_key": period_key,
            "recipient_email": email,
            "recipient_user": user,
            "status": status,
            "message_preview": (preview or "")[:500],
            "sent_on": now_datetime(),
        }
    ).insert(ignore_permissions=True)


def _email_configured():
    from health_ecosystem_core.health_ecosystem_core.clinical_email import email_configured

    return email_configured()


def _send_ops_email(recipient, subject, html_body, text_body):
    if not recipient or "@" not in recipient:
        return "Skipped"
    if not _email_configured():
        frappe.logger("hec_ops").info(f"OPS EMAIL [{recipient}] {subject}\n{text_body}")
        return "Logged"
    try:
        frappe.sendmail(
            recipients=[recipient],
            subject=subject,
            message=html_body,
            now=True,
        )
        return "Sent"
    except Exception:
        frappe.log_error(title="ops_rhythm_email", message=frappe.get_traceback())
        return "Failed"


def _build_digest(staff_row, tasks, frequency_label):
    division = frappe.db.get_value("Company Division", staff_row.division, "division_name") or staff_row.division
    workflow = frappe.db.get_value("Company Division", staff_row.division, "principal_workflow") or ""
    lines = [
        f"Hello {staff_row.full_name},",
        "",
        f"Your {frequency_label} operational checklist for {division} ({COMPANY_NAME}):",
        "",
    ]
    if workflow:
        lines.append(f"Division workflow: {workflow}")
        lines.append("")
    for task in tasks:
        lines.append(f"• {task.title}")
        if task.workflow_reference:
            lines.append(f"  Workflow: {task.workflow_reference}")
    lines.extend(["", "Complete items in ERPNext and reply to your division officer if blocked.", "", "— Remedium Care Ops Rhythm (automated)"])
    text = "\n".join(lines)

    html_parts = [
        f"<p>Hello <strong>{escape(staff_row.full_name)}</strong>,</p>",
        f"<p>Your <strong>{escape(frequency_label)}</strong> operational checklist for "
        f"<strong>{escape(division)}</strong>:</p>",
    ]
    if workflow:
        html_parts.append(f"<p><em>Workflow:</em> {escape(workflow)}</p>")
    html_parts.append("<ol>")
    for task in tasks:
        html_parts.append(f"<li><strong>{escape(task.title)}</strong>")
        if task.checklist:
            html_parts.append(task.checklist)
        html_parts.append("</li>")
    html_parts.append("</ol><p><em>— Remedium Care Ops Rhythm</em></p>")
    html = "".join(html_parts)
    subject = f"[{frequency_label}] {division} — your operational checklist"
    return subject, html, text


def _dispatch_frequency(frequency):
    if not ops_rhythm_enabled():
        return {"skipped": True, "reason": "ops_rhythm_disabled"}

    period = _period_key(frequency)
    tasks = frappe.get_all(
        "Ops Rhythm Task",
        filters={"frequency": frequency, "active": 1},
        fields=["name", "title", "division", "role_tier", "checklist", "workflow_reference", "sort_order"],
        order_by="sort_order asc",
    )
    if not tasks:
        return {"frequency": frequency, "period": period, "sent": 0, "tasks": 0}

    staff_rows = frappe.get_all(
        "Ops Staff Profile",
        filters={"active": 1},
        fields=["name", "full_name", "division", "role_tier", "work_email", "user"],
    )
    sent = 0
    frequency_label = frequency

    for staff in staff_rows:
        applicable = []
        for task in tasks:
            if task.division != staff.division:
                continue
            if task.role_tier == "All" or task.role_tier == staff.role_tier:
                applicable.append(frappe._dict(task))
        if not applicable:
            continue

        email = staff.work_email
        digest_period = f"{period}|{email}"
        if _already_dispatched(digest_period, email, frequency):
            continue

        subject, html, text = _build_digest(staff, applicable, frequency_label)
        status = _send_ops_email(email, subject, html, text)
        _log_dispatch(applicable[0].name, frequency, digest_period, email, staff.user, status, subject)
        if status in ("Sent", "Logged"):
            sent += 1

    frappe.db.commit()
    return {"frequency": frequency, "period": period, "sent": sent, "tasks": len(tasks)}


def run_daily_ops_emails():
    return _dispatch_frequency("Daily")


def run_weekly_ops_emails():
  # Frappe weekly hook — Monday-focused label in email
    return _dispatch_frequency("Weekly")


def run_monthly_ops_emails():
    return _dispatch_frequency("Monthly")


def run_all_ops_emails_now():
    """Manual trigger — runs daily + weekly + monthly (ignores 1st-of-month guard)."""
    results = [run_daily_ops_emails(), run_weekly_ops_emails()]
    results.append(_dispatch_frequency("Monthly"))
    return results


def seed_ops_rhythm_sop_note():
    """Desk Note — how to run and maintain the ops rhythm SOP."""
    title = "SOP: Company Ops Rhythm (Phase 28)"
    content = f"""<h3>Purpose</h3>
<p>Automated daily, weekly, and monthly email checklists so every division knows what to do.
Based on Remedium modular divisions (CRM, Accounts, HR, Operations, Marketing, Content,
Asset, Legal, Franchisee, Planning).</p>

<h3>Desk lists</h3>
<ul>
<li><strong>Company Division</strong> — division workflows and outputs</li>
<li><strong>Ops Staff Profile</strong> — who receives digests (Officer / Clerk / Service HR)</li>
<li><strong>Ops Rhythm Task</strong> — editable checklist templates</li>
<li><strong>Ops Rhythm Dispatch</strong> — audit log of sent or logged emails</li>
</ul>

<h3>Settings</h3>
<p><strong>Health Ecosystem Settings</strong> → <em>Enable Ops Rhythm Emails</em> (master switch).
<em>Ops Digest Hour</em> sets preferred morning hour (scheduler still runs on Frappe daily/weekly/monthly hooks).</p>

<h3>Deploy / update (server)</h3>
<pre>cd /opt/health-ecosystem/docker
sed -i 's/\\r$//' patch-phase28-ops.sh
bash patch-phase28-ops.sh</pre>

<h3>Manual commands</h3>
<pre># Full setup + seed demo staff/tasks
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.init.run_phase28_setup

# Smoke test (seed + send all digests once)
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.init.run_phase28_smoke_test

# Send digests now (daily + weekly + monthly)
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.init.run_phase28_dispatch_now</pre>

<h3>Scheduler (automatic)</h3>
<ul>
<li><strong>Daily</strong> — division morning checklists</li>
<li><strong>Weekly</strong> — stand-up / reconciliation tasks</li>
<li><strong>Monthly</strong> — month-end reviews</li>
</ul>
<p>Requires <code>scheduler</code> container running. Restart after hook changes:
<code>docker compose restart scheduler backend</code></p>

<h3>Demo staff (seeded)</h3>
<p>Officer + Clerk per division: <code>crm.officer@{OPS_EMAIL_DOMAIN}</code>,
<code>crm.clerk@{OPS_EMAIL_DOMAIN}</code>, etc. Password: <code>OpsDemoChangeMe@123</code></p>
<p>Service HR profiles link phlebotomist, sales rep, franchise hub users.</p>

<h3>Email behaviour</h3>
<p>If SMTP is configured (GoDaddy / Gmail patch), digests are sent.
If not, status is <strong>Logged</strong> in Ops Rhythm Dispatch and output appears in server logs (<code>hec_ops</code>).</p>

<h3>Edit SOP tasks</h3>
<ol>
<li>Open <strong>Ops Rhythm Task</strong> → edit checklist HTML or title</li>
<li>Assign division + frequency + role tier (Officer / Clerk / All / Service HR)</li>
<li>Add staff in <strong>Ops Staff Profile</strong> with correct <em>work_email</em></li>
</ol>
"""

    if not frappe.db.exists("DocType", "Note"):
        return {"created": False, "reason": "Note DocType missing"}

    existing = frappe.db.get_value("Note", {"title": title}, "name")
    if existing:
        doc = frappe.get_doc("Note", existing)
        doc.content = content
        doc.save(ignore_permissions=True)
        return {"created": False, "updated": True, "name": existing, "title": title}

    doc = frappe.get_doc(
        {
            "doctype": "Note",
            "title": title,
            "content": content,
            "public": 0,
        }
    )
    doc.insert(ignore_permissions=True)
    return {"created": True, "name": doc.name, "title": title}


def setup_phase28():
    ensure_phase28_doctypes()
    ensure_phase28_settings()
    demo = seed_phase28_demo()
    note = seed_ops_rhythm_sop_note()
    frappe.db.commit()
    frappe.clear_cache()
    return {
        "ok": True,
        "phase": 28,
        "ops_rhythm_enabled": ops_rhythm_enabled(),
        "email_configured": _email_configured(),
        "demo": demo,
        "sop_note": note,
    }


def smoke_phase28_ops():
    setup_phase28()
    preview = run_all_ops_emails_now()
    counts = {
        "divisions": frappe.db.count("Company Division"),
        "staff": frappe.db.count("Ops Staff Profile"),
        "tasks": frappe.db.count("Ops Rhythm Task"),
        "dispatches": frappe.db.count("Ops Rhythm Dispatch"),
    }
    note = frappe.db.get_value("Note", {"title": "SOP: Company Ops Rhythm (Phase 28)"}, "name")
    return {
        "ok": True,
        "counts": counts,
        "dispatch_preview": preview,
        "email_configured": _email_configured(),
        "sop_note": note,
    }
