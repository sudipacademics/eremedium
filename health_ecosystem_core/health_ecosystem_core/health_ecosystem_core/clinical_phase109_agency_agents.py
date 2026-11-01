"""Phase 109 — Agency Agents (BA / MLM) portal for franchise distribution.

Non-employee multi-level agents: PBA → BA → SBA → CBA → Partner.
Conversion + monthly revenue commissions with descending editable level rates.
"""

from __future__ import annotations

import re

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, getdate, now_datetime, today

LEVEL_DT = "Agency Agent Level"
AGENT_DT = "Agency Agent"
ATTR_DT = "Agency Franchise Attribution"
LEDGER_DT = "Agency Commission Ledger"
REQUEST_DT = "Agency Franchise Onboard Request"

AGENCY_AGENT_ROLE = "Agency Agent"
AGENCY_MANAGER_ROLE = "Agency Manager"

CONVERSION_BASE_INR = 100_000

SEED_LEVELS = (
    {"code": "PBA", "title": "Prospective Business Associate", "rank": 1, "conversion_pct": 1.0, "monthly_revenue_pct": 0.20, "override_pct": 0.05},
    {"code": "BA", "title": "Business Associate", "rank": 2, "conversion_pct": 2.0, "monthly_revenue_pct": 0.40, "override_pct": 0.10},
    {"code": "SBA", "title": "Senior Business Associate", "rank": 3, "conversion_pct": 3.0, "monthly_revenue_pct": 0.60, "override_pct": 0.15},
    {"code": "CBA", "title": "Chief Business Associate", "rank": 4, "conversion_pct": 4.0, "monthly_revenue_pct": 0.80, "override_pct": 0.20},
    {"code": "Partner", "title": "Partner / Agency Manager", "rank": 5, "conversion_pct": 5.0, "monthly_revenue_pct": 1.00, "override_pct": 0.25},
)

DEFAULT_PERMS = [
    {"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1, "export": 1, "report": 1},
    {"role": "Health System Admin", "read": 1, "write": 1, "create": 1, "export": 1, "report": 1},
    {"role": AGENCY_MANAGER_ROLE, "read": 1, "write": 1, "create": 1, "export": 1, "report": 1},
    {"role": AGENCY_AGENT_ROLE, "read": 1, "write": 0, "create": 0, "export": 0, "report": 1},
]


def _ensure_role(role_name: str):
    if not frappe.db.exists("Role", role_name):
        frappe.get_doc({"doctype": "Role", "role_name": role_name, "desk_access": 0}).insert(ignore_permissions=True)


def _ensure_doctype(name, fields, autoname, permissions=None):
    if frappe.db.exists("DocType", name):
        return False
    naming_rule = "Random"
    if str(autoname).startswith("format:"):
        naming_rule = "Expression"
    elif str(autoname).startswith("field:"):
        naming_rule = "By fieldname"
    frappe.get_doc(
        {
            "doctype": "DocType",
            "name": name,
            "module": "Health Ecosystem Core",
            "custom": 0,
            "autoname": autoname,
            "naming_rule": naming_rule,
            "engine": "InnoDB",
            "track_changes": 1,
            "fields": fields,
            "permissions": permissions or DEFAULT_PERMS,
        }
    ).insert(ignore_permissions=True)
    frappe.clear_cache(doctype=name)
    return True


def ensure_phase109_doctypes():
    _ensure_role(AGENCY_AGENT_ROLE)
    _ensure_role(AGENCY_MANAGER_ROLE)
    created = []

    if _ensure_doctype(
        LEVEL_DT,
        [
            {"fieldname": "code", "label": "Code", "fieldtype": "Data", "reqd": 1, "unique": 1, "in_list_view": 1},
            {"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
            {"fieldname": "rank", "label": "Rank", "fieldtype": "Int", "reqd": 1, "in_list_view": 1},
            {"fieldname": "conversion_pct", "label": "Conversion %", "fieldtype": "Percent", "reqd": 1, "default": "1"},
            {"fieldname": "monthly_revenue_pct", "label": "Monthly Revenue %", "fieldtype": "Percent", "reqd": 1, "default": "0.2"},
            {"fieldname": "override_pct", "label": "Override %", "fieldtype": "Percent", "reqd": 1, "default": "0.05"},
            {"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
        ],
        "field:code",
    ):
        created.append(LEVEL_DT)

    if _ensure_doctype(
        AGENT_DT,
        [
            {"fieldname": "full_name", "label": "Full Name", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
            {"fieldname": "mobile", "label": "Mobile", "fieldtype": "Data", "in_list_view": 1},
            {"fieldname": "email", "label": "Email", "fieldtype": "Data"},
            {"fieldname": "user", "label": "Portal User", "fieldtype": "Link", "options": "User"},
            {"fieldname": "level", "label": "Level", "fieldtype": "Link", "options": LEVEL_DT, "reqd": 1, "in_list_view": 1},
            {"fieldname": "sponsor", "label": "Sponsor (Upline)", "fieldtype": "Link", "options": AGENT_DT},
            {
                "fieldname": "status",
                "label": "Status",
                "fieldtype": "Select",
                "options": "Prospect\nActive\nInactive",
                "default": "Active",
                "in_list_view": 1,
            },
            {"fieldname": "is_agency_manager", "label": "Agency Manager", "fieldtype": "Check", "default": "0"},
            {"fieldname": "joined_on", "label": "Joined On", "fieldtype": "Date", "default": "Today"},
            {"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
        ],
        "format:AAG-{#####}",
    ):
        created.append(AGENT_DT)

    if _ensure_doctype(
        ATTR_DT,
        [
            {"fieldname": "franchisee", "label": "Franchisee", "fieldtype": "Link", "options": "Franchisee Profile", "reqd": 1, "in_list_view": 1},
            {"fieldname": "agent", "label": "Converting Agent", "fieldtype": "Link", "options": AGENT_DT, "reqd": 1, "in_list_view": 1},
            {"fieldname": "level_at_conversion", "label": "Level at Conversion", "fieldtype": "Link", "options": LEVEL_DT},
            {"fieldname": "deal_value", "label": "Deal Value", "fieldtype": "Currency", "default": str(CONVERSION_BASE_INR)},
            {"fieldname": "attributed_on", "label": "Attributed On", "fieldtype": "Date", "default": "Today", "in_list_view": 1},
            {"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Active\nReversed", "default": "Active"},
            {"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
        ],
        "format:AFA-{#####}",
    ):
        created.append(ATTR_DT)

    if _ensure_doctype(
        LEDGER_DT,
        [
            {"fieldname": "agent", "label": "Agent", "fieldtype": "Link", "options": AGENT_DT, "reqd": 1, "in_list_view": 1},
            {
                "fieldname": "entry_type",
                "label": "Entry Type",
                "fieldtype": "Select",
                "options": "Conversion\nMonthly Revenue\nOverride\nAdjustment",
                "reqd": 1,
                "in_list_view": 1,
            },
            {"fieldname": "franchisee", "label": "Franchisee", "fieldtype": "Link", "options": "Franchisee Profile"},
            {"fieldname": "source_agent", "label": "Source Agent", "fieldtype": "Link", "options": AGENT_DT},
            {"fieldname": "period", "label": "Period", "fieldtype": "Data", "in_list_view": 1},
            {"fieldname": "gross_amount", "label": "Gross Amount", "fieldtype": "Currency"},
            {"fieldname": "commission_rate", "label": "Commission Rate", "fieldtype": "Percent"},
            {"fieldname": "commission_amount", "label": "Commission Amount", "fieldtype": "Currency", "reqd": 1, "in_list_view": 1},
            {
                "fieldname": "status",
                "label": "Status",
                "fieldtype": "Select",
                "options": "Accrued\nPaid\nReversed",
                "default": "Accrued",
                "in_list_view": 1,
            },
            {"fieldname": "posting_date", "label": "Posting Date", "fieldtype": "Date", "default": "Today", "reqd": 1},
            {"fieldname": "reference_doctype", "label": "Reference DocType", "fieldtype": "Data"},
            {"fieldname": "reference_name", "label": "Reference Name", "fieldtype": "Data"},
            {"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
        ],
        "format:ACL-{#####}",
    ):
        created.append(LEDGER_DT)

    if _ensure_doctype(
        REQUEST_DT,
        [
            {"fieldname": "agent", "label": "Agent", "fieldtype": "Link", "options": AGENT_DT, "reqd": 1, "in_list_view": 1},
            {"fieldname": "prospect_name", "label": "Prospect Name", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
            {"fieldname": "mobile", "label": "Mobile", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
            {"fieldname": "email", "label": "Email", "fieldtype": "Data"},
            {"fieldname": "territory", "label": "Territory / City", "fieldtype": "Data"},
            {
                "fieldname": "franchise_model",
                "label": "Franchise Model",
                "fieldtype": "Select",
                "options": "\nFOFO\nFOCO",
                "in_list_view": 1,
            },
            {"fieldname": "deal_value", "label": "Expected Deal Value", "fieldtype": "Currency", "default": str(CONVERSION_BASE_INR)},
            {"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
            {
                "fieldname": "status",
                "label": "Status",
                "fieldtype": "Select",
                "options": "Draft\nPending FFMS\nApproved\nRejected\nCompleted\nCancelled",
                "default": "Draft",
                "in_list_view": 1,
            },
            {"fieldname": "ffms_request_id", "label": "FFMS Request ID", "fieldtype": "Data"},
            {"fieldname": "ffms_lead_id", "label": "FFMS Lead ID", "fieldtype": "Data"},
            {"fieldname": "decided_by", "label": "Decided By", "fieldtype": "Data"},
            {"fieldname": "decided_on", "label": "Decided On", "fieldtype": "Datetime"},
            {"fieldname": "decision_notes", "label": "Decision Notes", "fieldtype": "Small Text"},
            {"fieldname": "franchisee", "label": "Franchisee Profile", "fieldtype": "Link", "options": "Franchisee Profile"},
            {"fieldname": "attribution", "label": "Attribution", "fieldtype": "Link", "options": ATTR_DT},
        ],
        "format:AOR-{#####}",
    ):
        created.append(REQUEST_DT)

    frappe.db.commit()
    return created


def _franchise_display_name(franchisee_id):
    """Franchisee Profile uses franchise_name (not franchisee_name)."""
    if not franchisee_id or not frappe.db.exists("Franchisee Profile", franchisee_id):
        return cstr(franchisee_id or "")
    meta = frappe.get_meta("Franchisee Profile")
    for field in ("franchise_name", "owner_name", "branch_code"):
        if meta.has_field(field):
            value = frappe.db.get_value("Franchisee Profile", franchisee_id, field)
            if value:
                return cstr(value)
    return cstr(franchisee_id)


def seed_agency_levels():
    ensure_phase109_doctypes()
    out = []
    for row in SEED_LEVELS:
        if frappe.db.exists(LEVEL_DT, row["code"]):
            frappe.db.set_value(
                LEVEL_DT,
                row["code"],
                {
                    "title": row["title"],
                    "rank": row["rank"],
                    "conversion_pct": row["conversion_pct"],
                    "monthly_revenue_pct": row["monthly_revenue_pct"],
                    "override_pct": row["override_pct"],
                    "active": 1,
                },
            )
            out.append(row["code"])
            continue
        frappe.get_doc({"doctype": LEVEL_DT, **row, "active": 1}).insert(ignore_permissions=True)
        out.append(row["code"])
    frappe.db.commit()
    return out


# Published demo default: never applied (new agency logins get hec_seed_staff_password or a random one);
# setup_phase132 reads it to rotate admin accounts still using it.
DEMO_AGENCY_PASSWORD = "AgencyChangeMe@123"


def _ensure_portal_user(email: str, full_name: str, roles: list[str], password: str | None = None):
    if not frappe.db.exists("User", email):
        from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import seed_staff_password

        user = frappe.get_doc(
            {
                "doctype": "User",
                "email": email,
                "first_name": full_name.split()[0],
                "last_name": " ".join(full_name.split()[1:]) or "Agent",
                "send_welcome_email": 0,
                "user_type": "System User",
            }
        )
        user.insert(ignore_permissions=True)
        user.new_password = password or seed_staff_password()
        user.save(ignore_permissions=True)
    else:
        user = frappe.get_doc("User", email)
    for role in roles:
        _ensure_role(role)
        if role not in (user.get("roles") or []) and not frappe.db.exists("Has Role", {"parent": email, "role": role}):
            user.add_roles(role)
    return email


def seed_demo_agency_agents():
    """Seed Partner → CBA → SBA → BA → PBA pyramid + one peer BA."""
    seed_agency_levels()
    specs = [
        {
            "key": "partner",
            "full_name": "Agency Partner Demo",
            "email": "agency.partner@health.local",
            "mobile": "9000001001",
            "level": "Partner",
            "sponsor_key": None,
            "is_agency_manager": 1,
            "roles": [AGENCY_AGENT_ROLE, AGENCY_MANAGER_ROLE],
        },
        {
            "key": "cba",
            "full_name": "Chief BA Demo",
            "email": "agency.cba@health.local",
            "mobile": "9000001002",
            "level": "CBA",
            "sponsor_key": "partner",
            "is_agency_manager": 0,
            "roles": [AGENCY_AGENT_ROLE],
        },
        {
            "key": "sba",
            "full_name": "Senior BA Demo",
            "email": "agency.sba@health.local",
            "mobile": "9000001003",
            "level": "SBA",
            "sponsor_key": "cba",
            "is_agency_manager": 0,
            "roles": [AGENCY_AGENT_ROLE],
        },
        {
            "key": "ba",
            "full_name": "Business Associate Demo",
            "email": "agency.ba@health.local",
            "mobile": "9000001004",
            "level": "BA",
            "sponsor_key": "sba",
            "is_agency_manager": 0,
            "roles": [AGENCY_AGENT_ROLE],
        },
        {
            "key": "pba",
            "full_name": "Prospective BA Demo",
            "email": "agency.pba@health.local",
            "mobile": "9000001005",
            "level": "PBA",
            "sponsor_key": "ba",
            "is_agency_manager": 0,
            "roles": [AGENCY_AGENT_ROLE],
        },
        {
            "key": "ba2",
            "full_name": "Business Associate East",
            "email": "agency.ba2@health.local",
            "mobile": "9000001006",
            "level": "BA",
            "sponsor_key": "sba",
            "is_agency_manager": 0,
            "roles": [AGENCY_AGENT_ROLE],
        },
    ]
    by_key = {}
    for spec in specs:
        existing = frappe.db.get_value(AGENT_DT, {"email": spec["email"]}, "name")
        user = _ensure_portal_user(spec["email"], spec["full_name"], spec["roles"])
        sponsor = by_key.get(spec["sponsor_key"]) if spec["sponsor_key"] else None
        if existing:
            frappe.db.set_value(
                AGENT_DT,
                existing,
                {
                    "full_name": spec["full_name"],
                    "mobile": spec["mobile"],
                    "user": user,
                    "level": spec["level"],
                    "sponsor": sponsor,
                    "status": "Active",
                    "is_agency_manager": spec["is_agency_manager"],
                },
            )
            by_key[spec["key"]] = existing
            continue
        doc = frappe.get_doc(
            {
                "doctype": AGENT_DT,
                "full_name": spec["full_name"],
                "mobile": spec["mobile"],
                "email": spec["email"],
                "user": user,
                "level": spec["level"],
                "sponsor": sponsor,
                "status": "Active",
                "is_agency_manager": spec["is_agency_manager"],
                "joined_on": today(),
            }
        )
        doc.insert(ignore_permissions=True)
        by_key[spec["key"]] = doc.name
    frappe.db.commit()
    return by_key


def setup_phase109_agency_agents():
    created = ensure_phase109_doctypes()
    levels = seed_agency_levels()
    agents = seed_demo_agency_agents()
    return {"ok": True, "phase": "109", "created": created, "levels": levels, "agents": agents}


def get_agent_for_user(user=None):
    user = user or frappe.session.user
    if not user or user == "Guest":
        return None
    return frappe.db.get_value(AGENT_DT, {"user": user}, "name") or frappe.db.get_value(
        AGENT_DT, {"email": user}, "name"
    )


def is_agency_user(user=None):
    user = user or frappe.session.user
    if not user or user == "Guest":
        return False
    roles = set(frappe.get_roles(user))
    if AGENCY_AGENT_ROLE in roles or AGENCY_MANAGER_ROLE in roles:
        return True
    if "System Manager" in roles or "Health System Admin" in roles:
        return True
    return bool(get_agent_for_user(user))


def is_agency_manager_user(user=None):
    user = user or frappe.session.user
    roles = set(frappe.get_roles(user))
    if AGENCY_MANAGER_ROLE in roles or "System Manager" in roles or "Health System Admin" in roles:
        return True
    agent_id = get_agent_for_user(user)
    if not agent_id:
        return False
    return cint(frappe.db.get_value(AGENT_DT, agent_id, "is_agency_manager")) == 1


def _level_row(code):
    if not code or not frappe.db.exists(LEVEL_DT, code):
        return None
    return frappe.db.get_value(
        LEVEL_DT,
        code,
        ["name", "code", "title", "rank", "conversion_pct", "monthly_revenue_pct", "override_pct", "active"],
        as_dict=True,
    )


def _agent_row(agent_id):
    if not agent_id or not frappe.db.exists(AGENT_DT, agent_id):
        return None
    row = frappe.db.get_value(
        AGENT_DT,
        agent_id,
        [
            "name",
            "full_name",
            "mobile",
            "email",
            "user",
            "level",
            "sponsor",
            "status",
            "is_agency_manager",
            "joined_on",
        ],
        as_dict=True,
    )
    if not row:
        return None
    level = _level_row(row.level)
    sponsor_name = None
    if row.sponsor:
        sponsor_name = frappe.db.get_value(AGENT_DT, row.sponsor, "full_name")
    return {
        **row,
        "level_title": level.title if level else row.level,
        "level_rank": level.rank if level else None,
        "sponsor_name": sponsor_name,
        "joined_on": str(row.joined_on) if row.joined_on else None,
        "is_agency_manager": cint(row.is_agency_manager),
    }


def _upline_chain(agent_id, max_depth=12):
    chain = []
    seen = set()
    current = agent_id
    for _ in range(max_depth):
        sponsor = frappe.db.get_value(AGENT_DT, current, "sponsor")
        if not sponsor or sponsor in seen:
            break
        seen.add(sponsor)
        chain.append(sponsor)
        current = sponsor
    return chain


def _ledger_exists(agent, entry_type, franchisee=None, period=None, source_agent=None):
    filters = {"agent": agent, "entry_type": entry_type, "status": ("!=", "Reversed")}
    if franchisee:
        filters["franchisee"] = franchisee
    if period:
        filters["period"] = period
    if source_agent:
        filters["source_agent"] = source_agent
    return bool(frappe.db.exists(LEDGER_DT, filters))


def _post_ledger(**kwargs):
    doc = frappe.get_doc({"doctype": LEDGER_DT, "status": "Accrued", "posting_date": today(), **kwargs})
    doc.insert(ignore_permissions=True)
    return doc.name


def attribute_franchisee_to_agent(agent_id, franchisee_id, deal_value=None, notes=None):
    ensure_phase109_doctypes()
    if not frappe.db.exists(AGENT_DT, agent_id):
        frappe.throw(_("Agent not found"))
    if not frappe.db.exists("Franchisee Profile", franchisee_id):
        # Allow smoke with synthetic franchisee id when DocType exists but row missing:
        # create a lightweight stub only if Franchisee Profile DocType is present and name free.
        frappe.throw(_("Franchisee not found"))

    existing = frappe.db.get_value(ATTR_DT, {"franchisee": franchisee_id, "status": "Active"}, "name")
    if existing:
        return {"attribution_id": existing, "already": True}

    agent = frappe.get_doc(AGENT_DT, agent_id)
    deal = flt(deal_value if deal_value is not None else CONVERSION_BASE_INR)
    attr = frappe.get_doc(
        {
            "doctype": ATTR_DT,
            "franchisee": franchisee_id,
            "agent": agent_id,
            "level_at_conversion": agent.level,
            "deal_value": deal,
            "attributed_on": today(),
            "status": "Active",
            "notes": notes or "Franchise conversion attributed",
        }
    )
    attr.insert(ignore_permissions=True)

    level = _level_row(agent.level)
    rate = flt(level.conversion_pct) if level else 0
    amount = round(deal * rate / 100.0, 2)
    ledger_ids = []
    if amount > 0 and not _ledger_exists(agent_id, "Conversion", franchisee=franchisee_id):
        ledger_ids.append(
            _post_ledger(
                agent=agent_id,
                entry_type="Conversion",
                franchisee=franchisee_id,
                source_agent=agent_id,
                gross_amount=deal,
                commission_rate=rate,
                commission_amount=amount,
                reference_doctype=ATTR_DT,
                reference_name=attr.name,
                notes=f"Conversion commission at {rate}%",
            )
        )

    for upline in _upline_chain(agent_id):
        up_level_code = frappe.db.get_value(AGENT_DT, upline, "level")
        up_level = _level_row(up_level_code)
        ov_rate = flt(up_level.override_pct) if up_level else 0
        ov_amt = round(deal * ov_rate / 100.0, 2)
        if ov_amt <= 0:
            continue
        if _ledger_exists(upline, "Override", franchisee=franchisee_id, source_agent=agent_id, period="conversion"):
            continue
        ledger_ids.append(
            _post_ledger(
                agent=upline,
                entry_type="Override",
                franchisee=franchisee_id,
                source_agent=agent_id,
                period="conversion",
                gross_amount=deal,
                commission_rate=ov_rate,
                commission_amount=ov_amt,
                reference_doctype=ATTR_DT,
                reference_name=attr.name,
                notes=f"Override on conversion from {agent.full_name}",
            )
        )

    frappe.db.commit()
    return {"attribution_id": attr.name, "ledger_ids": ledger_ids, "deal_value": deal, "already": False}


def _franchisee_period_revenue(franchisee_id, period):
    """Best-effort monthly revenue for a franchisee (B2B sales if available)."""
    year, month = period.split("-")[:2]
    start = f"{year}-{month}-01"
    # end of month approx
    if cint(month) == 12:
        end = f"{cint(year) + 1}-01-01"
    else:
        end = f"{year}-{int(month) + 1:02d}-01"

    total = 0.0
    if frappe.db.exists("DocType", "B2B Sales Entry"):
        rows = frappe.get_all(
            "B2B Sales Entry",
            filters={
                "franchisee": franchisee_id,
                "sales_date": (">=", start),
            },
            fields=["name", "sales_date", "amount", "net_amount", "total_amount"],
            limit=500,
        )
        for row in rows:
            d = str(row.sales_date or "")
            if d and d < end:
                total += flt(row.get("net_amount") or row.get("total_amount") or row.get("amount") or 0)
    return total


def accrue_agency_monthly_commissions(period=None, franchisee_id=None, revenue_amount=None):
    """Accrue monthly revenue + override commissions for active attributions."""
    ensure_phase109_doctypes()
    period = cstr(period or today()[:7])
    filters = {"status": "Active"}
    if franchisee_id:
        filters["franchisee"] = franchisee_id
    attrs = frappe.get_all(ATTR_DT, filters=filters, fields=["name", "franchisee", "agent"], limit=500)
    created = []
    for attr in attrs:
        revenue = flt(revenue_amount) if revenue_amount is not None and franchisee_id else _franchisee_period_revenue(
            attr.franchisee, period
        )
        if revenue_amount is not None and (not franchisee_id or franchisee_id == attr.franchisee):
            revenue = flt(revenue_amount)
        if revenue <= 0:
            continue
        agent_level = frappe.db.get_value(AGENT_DT, attr.agent, "level")
        level = _level_row(agent_level)
        rate = flt(level.monthly_revenue_pct) if level else 0
        amount = round(revenue * rate / 100.0, 2)
        if amount > 0 and not _ledger_exists(attr.agent, "Monthly Revenue", franchisee=attr.franchisee, period=period):
            created.append(
                _post_ledger(
                    agent=attr.agent,
                    entry_type="Monthly Revenue",
                    franchisee=attr.franchisee,
                    source_agent=attr.agent,
                    period=period,
                    gross_amount=revenue,
                    commission_rate=rate,
                    commission_amount=amount,
                    reference_doctype=ATTR_DT,
                    reference_name=attr.name,
                    notes=f"Monthly revenue share {period} at {rate}%",
                )
            )
        for upline in _upline_chain(attr.agent):
            up_level_code = frappe.db.get_value(AGENT_DT, upline, "level")
            up_level = _level_row(up_level_code)
            ov_rate = flt(up_level.override_pct) if up_level else 0
            ov_amt = round(revenue * ov_rate / 100.0, 2)
            if ov_amt <= 0:
                continue
            if _ledger_exists(upline, "Override", franchisee=attr.franchisee, period=period, source_agent=attr.agent):
                continue
            created.append(
                _post_ledger(
                    agent=upline,
                    entry_type="Override",
                    franchisee=attr.franchisee,
                    source_agent=attr.agent,
                    period=period,
                    gross_amount=revenue,
                    commission_rate=ov_rate,
                    commission_amount=ov_amt,
                    reference_doctype=ATTR_DT,
                    reference_name=attr.name,
                    notes=f"Monthly override {period}",
                )
            )
    frappe.db.commit()
    return {"period": period, "ledger_ids": created, "count": len(created)}


def list_agency_levels():
    ensure_phase109_doctypes()
    rows = frappe.get_all(
        LEVEL_DT,
        fields=["name", "code", "title", "rank", "conversion_pct", "monthly_revenue_pct", "override_pct", "active"],
        order_by="rank asc",
        limit=50,
    )
    return {"levels": rows, "conversion_base_inr": CONVERSION_BASE_INR}


def update_agency_level(level_code, conversion_pct=None, monthly_revenue_pct=None, override_pct=None, active=None):
    if not frappe.db.exists(LEVEL_DT, level_code):
        frappe.throw(_("Level not found"))
    updates = {}
    if conversion_pct is not None:
        updates["conversion_pct"] = flt(conversion_pct)
    if monthly_revenue_pct is not None:
        updates["monthly_revenue_pct"] = flt(monthly_revenue_pct)
    if override_pct is not None:
        updates["override_pct"] = flt(override_pct)
    if active is not None:
        updates["active"] = cint(active)
    if updates:
        frappe.db.set_value(LEVEL_DT, level_code, updates)
        frappe.db.commit()
    return _level_row(level_code)


def list_agency_commissions(agent_id=None, limit=100):
    filters = {}
    if agent_id:
        filters["agent"] = agent_id
    rows = frappe.get_all(
        LEDGER_DT,
        filters=filters,
        fields=[
            "name",
            "agent",
            "entry_type",
            "franchisee",
            "source_agent",
            "period",
            "gross_amount",
            "commission_rate",
            "commission_amount",
            "status",
            "posting_date",
            "notes",
        ],
        order_by="posting_date desc, creation desc",
        limit=cint(limit) or 100,
    )
    for row in rows:
        row["agent_name"] = frappe.db.get_value(AGENT_DT, row.agent, "full_name")
        if row.franchisee and frappe.db.exists("Franchisee Profile", row.franchisee):
            row["franchise_name"] = _franchise_display_name(row.franchisee) or row.franchisee
        else:
            row["franchise_name"] = row.franchisee
        row["posting_date"] = str(row.posting_date) if row.posting_date else None
    accrued = sum(flt(r.commission_amount) for r in rows if r.status == "Accrued")
    paid = sum(flt(r.commission_amount) for r in rows if r.status == "Paid")
    month = today()[:7]
    month_accrued = sum(
        flt(r.commission_amount) for r in rows if r.status == "Accrued" and str(r.posting_date or "").startswith(month)
    )
    return {
        "entries": rows,
        "summary": {
            "accrued_total": accrued,
            "paid_total": paid,
            "month_accrued": month_accrued,
            "entry_count": len(rows),
        },
    }


def get_agency_team_tree(root_agent=None):
    agents = frappe.get_all(
        AGENT_DT,
        fields=["name", "full_name", "level", "sponsor", "status", "is_agency_manager", "email", "mobile"],
        filters={"status": ("!=", "Inactive")},
        limit=500,
    )
    by_sponsor = {}
    for a in agents:
        by_sponsor.setdefault(a.sponsor or "", []).append(a)

    def build(node_id):
        children = []
        for child in by_sponsor.get(node_id, []):
            level = _level_row(child.level)
            children.append(
                {
                    "id": child.name,
                    "full_name": child.full_name,
                    "level": child.level,
                    "level_title": level.title if level else child.level,
                    "status": child.status,
                    "is_agency_manager": cint(child.is_agency_manager),
                    "children": build(child.name),
                }
            )
        return children

    if root_agent:
        root = _agent_row(root_agent)
        return {"root": root, "tree": build(root_agent)}
    roots = [a for a in agents if not a.sponsor]
    forest = []
    for r in roots:
        level = _level_row(r.level)
        forest.append(
            {
                "id": r.name,
                "full_name": r.full_name,
                "level": r.level,
                "level_title": level.title if level else r.level,
                "status": r.status,
                "is_agency_manager": cint(r.is_agency_manager),
                "children": build(r.name),
            }
        )
    return {"root": None, "tree": forest}


def get_agency_agent_profile(agent_id=None, user=None):
    ensure_phase109_doctypes()
    agent_id = agent_id or get_agent_for_user(user or frappe.session.user)
    if not agent_id:
        frappe.throw(_("No agency agent profile linked to this user"))
    profile = _agent_row(agent_id)
    downline = frappe.get_all(AGENT_DT, filters={"sponsor": agent_id}, fields=["name", "full_name", "level", "status"])
    attrs = frappe.get_all(
        ATTR_DT,
        filters={"agent": agent_id, "status": "Active"},
        fields=["name", "franchisee", "deal_value", "attributed_on", "level_at_conversion"],
        limit=100,
    )
    for a in attrs:
        a["attributed_on"] = str(a.attributed_on) if a.attributed_on else None
        if a.franchisee and frappe.db.exists("Franchisee Profile", a.franchisee):
            a["franchise_name"] = _franchise_display_name(a.franchisee)
        else:
            a["franchise_name"] = a.franchisee
    commissions = list_agency_commissions(agent_id=agent_id, limit=50)
    requests = list_agency_onboard_requests(agent_id=agent_id, limit=50)
    return {
        "agent": profile,
        "downline": downline,
        "downline_count": len(downline),
        "franchisees": attrs,
        "onboard_requests": requests.get("requests") or [],
        "commissions": commissions,
    }


def _push_onboard_request_to_ffms(request_doc):
    """Notify FFMS of a new agency onboard request (HMAC secret)."""
    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            get_rfms_api_base_url,
            _franchise_ads_secret,
        )
        from urllib.request import Request, urlopen
        import json

        base = get_rfms_api_base_url()
        if not base:
            return {"ok": False, "error": "rfms_api_base_url missing"}
        secret = _franchise_ads_secret() or cstr(frappe.conf.get("onboard_hmac_secret") or "")
        agent = frappe.db.get_value(
            AGENT_DT,
            request_doc.agent,
            ["full_name", "email", "mobile", "level"],
            as_dict=True,
        )
        payload = {
            "request_id": request_doc.name,
            "agent_id": request_doc.agent,
            "agent_name": (agent.full_name if agent else "") or "",
            "agent_email": (agent.email if agent else "") or "",
            "agent_mobile": (agent.mobile if agent else "") or "",
            "agent_level": (agent.level if agent else "") or "",
            "prospect_name": request_doc.prospect_name,
            "mobile": request_doc.mobile,
            "email": request_doc.email or "",
            "territory": request_doc.territory or "",
            "franchise_model": request_doc.franchise_model or "",
            "deal_value": flt(request_doc.deal_value),
            "notes": request_doc.notes or "",
            "status": "pending",
            "source": "agency_agents",
        }
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if secret:
            headers["X-Franchise-Ads-Secret"] = secret
        req = Request(f"{base}/agency/onboard-requests", data=body, headers=headers, method="POST")
        with urlopen(req, timeout=25) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            data = json.loads(text) if text else {}
            inner = data.get("data") if isinstance(data, dict) else {}
            return {"ok": True, "data": inner or data}
    except Exception:
        frappe.log_error(title="agency_onboard_ffms_push", message=frappe.get_traceback())
        return {"ok": False, "error": "ffms_push_failed"}


def submit_agency_onboard_request(
    agent_id,
    *,
    prospect_name,
    mobile,
    email=None,
    territory=None,
    franchise_model=None,
    deal_value=None,
    notes=None,
):
    ensure_phase109_doctypes()
    if not frappe.db.exists(AGENT_DT, agent_id):
        frappe.throw(_("Agent not found"))
    name = cstr(prospect_name or "").strip()
    phone = re.sub(r"\D", "", cstr(mobile or ""))[-10:]
    if not name:
        frappe.throw(_("Prospect name is required"))
    if not re.match(r"^[6-9]\d{9}$", phone):
        frappe.throw(_("Valid 10-digit mobile is required"))
    model = cstr(franchise_model or "").strip().upper()
    if model and model not in ("FOFO", "FOCO"):
        frappe.throw(_("Franchise model must be FOFO or FOCO"))

    doc = frappe.get_doc(
        {
            "doctype": REQUEST_DT,
            "agent": agent_id,
            "prospect_name": name[:140],
            "mobile": phone,
            "email": cstr(email or "").strip().lower()[:140],
            "territory": cstr(territory or "").strip()[:140],
            "franchise_model": model,
            "deal_value": flt(deal_value if deal_value is not None else CONVERSION_BASE_INR),
            "notes": cstr(notes or "")[:2000],
            "status": "Pending FFMS",
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    pushed = _push_onboard_request_to_ffms(doc)
    if pushed.get("ok"):
        data = pushed.get("data") or {}
        updates = {}
        if data.get("id"):
            updates["ffms_request_id"] = cstr(data.get("id"))[:120]
        if data.get("lead_id"):
            updates["ffms_lead_id"] = cstr(data.get("lead_id"))[:120]
        if updates:
            frappe.db.set_value(REQUEST_DT, doc.name, updates)
            frappe.db.commit()
            doc.reload()
    else:
        # Keep pending; FFMS may be briefly down — manager can still sync later.
        frappe.db.set_value(
            REQUEST_DT,
            doc.name,
            "decision_notes",
            f"FFMS sync pending: {pushed.get('error') or 'unknown'}",
        )
        frappe.db.commit()

    return {
        "request_id": doc.name,
        "status": doc.status,
        "ffms_request_id": doc.ffms_request_id,
        "ffms_lead_id": doc.ffms_lead_id,
        "ffms_push": pushed,
    }


def apply_ffms_onboard_decision(request_id, *, decision, decided_by=None, notes=None, ffms_lead_id=None):
    ensure_phase109_doctypes()
    if not frappe.db.exists(REQUEST_DT, request_id):
        frappe.throw(_("Onboard request not found"))
    decision = cstr(decision or "").strip().lower()
    if decision not in ("approved", "rejected"):
        frappe.throw(_("Decision must be approved or rejected"))
    status = "Approved" if decision == "approved" else "Rejected"
    values = {
        "status": status,
        "decided_by": cstr(decided_by or "FFMS")[:120],
        "decided_on": now_datetime(),
        "decision_notes": cstr(notes or "")[:2000],
    }
    if ffms_lead_id:
        values["ffms_lead_id"] = cstr(ffms_lead_id)[:120]
    frappe.db.set_value(REQUEST_DT, request_id, values)
    frappe.db.commit()
    return {"request_id": request_id, "status": status}


def complete_agency_onboard(request_id, agent_id=None):
    """After FFMS approval, create Franchisee Profile + attribution/commissions."""
    ensure_phase109_doctypes()
    if not frappe.db.exists(REQUEST_DT, request_id):
        frappe.throw(_("Onboard request not found"))
    req = frappe.get_doc(REQUEST_DT, request_id)
    if agent_id and req.agent != agent_id and not is_agency_manager_user():
        frappe.throw(_("Not allowed to complete this request"))
    if req.status != "Approved":
        frappe.throw(_("FFMS must approve this request before onboarding"))
    if req.franchisee and req.status == "Completed":
        return {"request_id": request_id, "franchisee": req.franchisee, "already": True}

    # Create / reuse Franchisee Profile
    franchisee_id = None
    phone = re.sub(r"\D", "", cstr(req.mobile or ""))[-10:]
    if phone and frappe.db.exists("DocType", "Franchisee Profile"):
        # Prefer contact_phone match when available.
        meta = frappe.get_meta("Franchisee Profile")
        if meta.has_field("contact_phone"):
            franchisee_id = frappe.db.get_value("Franchisee Profile", {"contact_phone": phone}, "name")
    if not franchisee_id:
        branch = f"AG-{phone[-4:] if phone else frappe.generate_hash(length=4)}-{frappe.generate_hash(length=4)}".upper()
        payload = {
            "doctype": "Franchisee Profile",
            "franchise_name": req.prospect_name[:140],
            "owner_name": req.prospect_name[:140],
            "branch_code": branch[:40],
            "contact_phone": phone,
            "contact_email": cstr(req.email or "")[:140],
            "territory_region": cstr(req.territory or "")[:140],
            "active_status": "Active",
        }
        # franchise_model (FOFO/FOCO) is commercial; Franchisee Profile.franchisee_type is Vector/Pulse — do not map.
        stub = frappe.get_doc(payload)
        stub.insert(ignore_permissions=True, ignore_mandatory=True)
        franchisee_id = stub.name

    attr = attribute_franchisee_to_agent(
        req.agent,
        franchisee_id,
        deal_value=req.deal_value or CONVERSION_BASE_INR,
        notes=f"Completed from onboard request {request_id}",
    )
    frappe.db.set_value(
        REQUEST_DT,
        request_id,
        {
            "status": "Completed",
            "franchisee": franchisee_id,
            "attribution": attr.get("attribution_id"),
        },
    )
    frappe.db.commit()
    return {
        "request_id": request_id,
        "franchisee": franchisee_id,
        "franchise_name": _franchise_display_name(franchisee_id),
        "attribution": attr,
        "already": False,
    }


def list_agency_onboard_requests(agent_id=None, limit=100):
    ensure_phase109_doctypes()
    filters = {}
    if agent_id:
        filters["agent"] = agent_id
    rows = frappe.get_all(
        REQUEST_DT,
        filters=filters,
        fields=[
            "name",
            "agent",
            "prospect_name",
            "mobile",
            "email",
            "territory",
            "franchise_model",
            "deal_value",
            "status",
            "ffms_request_id",
            "ffms_lead_id",
            "decided_by",
            "decided_on",
            "decision_notes",
            "franchisee",
            "attribution",
            "creation",
            "notes",
        ],
        order_by="creation desc",
        limit=cint(limit) or 100,
    )
    for row in rows:
        row["agent_name"] = frappe.db.get_value(AGENT_DT, row.agent, "full_name")
        row["franchise_name"] = _franchise_display_name(row.franchisee) if row.franchisee else None
        row["decided_on"] = str(row.decided_on) if row.decided_on else None
        row["created_at"] = str(row.creation) if row.creation else None
        # Commission earned so far for this franchisee (payout from FFMS later).
        earned = 0.0
        if row.franchisee:
            earned = sum(
                flt(x)
                for x in frappe.get_all(
                    LEDGER_DT,
                    filters={"franchisee": row.franchisee, "agent": row.agent, "status": ("!=", "Reversed")},
                    pluck="commission_amount",
                )
            )
        row["commission_earned"] = earned
        row["commission_payout_status"] = "Pending FFMS"  # payout sync not in this build
    return {"requests": rows}


def list_agent_franchisees_with_commissions(agent_id=None, limit=100):
    """Attributed franchisees + commission earned (FFMS payout later)."""
    ensure_phase109_doctypes()
    filters = {"status": "Active"}
    if agent_id:
        filters["agent"] = agent_id
    attrs = frappe.get_all(
        ATTR_DT,
        filters=filters,
        fields=["name", "franchisee", "agent", "deal_value", "attributed_on", "level_at_conversion"],
        order_by="attributed_on desc",
        limit=cint(limit) or 100,
    )
    rows = []
    for a in attrs:
        earned_rows = frappe.get_all(
            LEDGER_DT,
            filters={"franchisee": a.franchisee, "agent": a.agent, "status": ("!=", "Reversed")},
            fields=["entry_type", "commission_amount", "status", "period"],
        )
        earned = sum(flt(r.commission_amount) for r in earned_rows)
        paid = sum(flt(r.commission_amount) for r in earned_rows if r.status == "Paid")
        rows.append(
            {
                "attribution_id": a.name,
                "franchisee": a.franchisee,
                "franchise_name": _franchise_display_name(a.franchisee),
                "agent": a.agent,
                "agent_name": frappe.db.get_value(AGENT_DT, a.agent, "full_name"),
                "deal_value": flt(a.deal_value),
                "attributed_on": str(a.attributed_on) if a.attributed_on else None,
                "level_at_conversion": a.level_at_conversion,
                "commission_earned": earned,
                "commission_paid": paid,
                "commission_payout_status": "Pending FFMS",
                "ledger_entries": len(earned_rows),
            }
        )
    return {"franchisees": rows}


def get_agency_manager_dashboard(user=None):
    ensure_phase109_doctypes()
    user = user or frappe.session.user
    agents = frappe.get_all(AGENT_DT, fields=["name", "status", "level", "is_agency_manager", "sponsor"])
    levels = list_agency_levels()["levels"]
    attrs = frappe.get_all(ATTR_DT, filters={"status": "Active"}, fields=["name", "agent", "franchisee"])
    ledger = frappe.get_all(
        LEDGER_DT,
        filters={"status": "Accrued"},
        fields=["commission_amount", "entry_type", "agent"],
        limit=2000,
    )
    economics = sum(flt(r.commission_amount) for r in ledger)
    active = [a for a in agents if a.status == "Active"]
    prospects = [a for a in agents if a.status == "Prospect"]
    managers = [a for a in agents if cint(a.is_agency_manager)]
    me = get_agent_for_user(user)
    return {
        "stats": {
            "recruitment": len(prospects),
            "activation": len(active),
            "productivity": len(attrs),
            "leadership": len(managers),
            "economics": economics,
            "team_size": len(agents),
        },
        "levels": levels,
        "my_agent_id": me,
        "is_manager": is_agency_manager_user(user),
        "recent_attributions": attrs[:20],
        "conversion_base_inr": CONVERSION_BASE_INR,
    }


def smoke_phase109_agency_agents():
    setup = setup_phase109_agency_agents()
    levels = frappe.get_all(LEVEL_DT, pluck="name")
    agents = frappe.get_all(AGENT_DT, pluck="name")
    ok = len(levels) >= 5 and len(agents) >= 5
    attr_result = None
    monthly = None
    onboard = None
    franchisee = frappe.db.get_value("Franchisee Profile", {}, "name", order_by="creation asc")
    if not franchisee and frappe.db.exists("DocType", "Franchisee Profile"):
        # Minimal smoke franchisee when none exist.
        try:
            stub = frappe.get_doc(
                {
                    "doctype": "Franchisee Profile",
                    "franchise_name": "Agency Smoke Franchisee",
                    "owner_name": "Agency Smoke Owner",
                    "branch_code": f"AGENCY-SMOKE-{frappe.generate_hash(length=6)}",
                    "active_status": "Active",
                }
            )
            stub.insert(ignore_permissions=True, ignore_mandatory=True)
            frappe.db.commit()
            franchisee = stub.name
        except Exception:
            frappe.log_error(title="agency_smoke_franchisee", message=frappe.get_traceback())
            franchisee = None
    ba = frappe.db.get_value(AGENT_DT, {"level": "BA"}, "name")
    if franchisee and ba:
        attr_result = attribute_franchisee_to_agent(ba, franchisee, deal_value=100000, notes="phase109 smoke")
        monthly = accrue_agency_monthly_commissions(period=today()[:7], franchisee_id=franchisee, revenue_amount=500000)

    # Onboard request → FFMS decision → complete (FFMS push may soft-fail offline).
    partner = frappe.db.get_value(AGENT_DT, {"email": "agency.partner@health.local"}, "name") or ba
    if partner:
        suffix = frappe.generate_hash(length=4)
        mobile = f"98{frappe.generate_hash(length=8)[:8]}"
        # Keep valid Indian mobile pattern 6-9xxxxxxxx
        mobile = "98" + "".join(ch for ch in mobile if ch.isdigit())[-8:]
        if not re.match(r"^[6-9]\d{9}$", mobile):
            mobile = "9876543210"
        submitted = submit_agency_onboard_request(
            partner,
            prospect_name=f"Smoke Prospect {suffix}",
            mobile=mobile,
            email=f"smoke.prospect.{suffix}@agency.local",
            territory="Kolkata",
            franchise_model="FOFO",
            deal_value=100000,
            notes="phase109 onboard smoke",
        )
        apply_ffms_onboard_decision(
            submitted["request_id"],
            decision="approved",
            decided_by="smoke",
            notes="auto-approve for smoke",
        )
        completed = complete_agency_onboard(submitted["request_id"], agent_id=partner)
        profile_check = get_agency_agent_profile(agent_id=partner)
        # Ensure franchise_name enrichment does not raise (column fix).
        _ = [r.get("franchise_name") for r in (profile_check.get("franchisees") or [])]
        onboard = {
            "request_id": submitted.get("request_id"),
            "status": submitted.get("status"),
            "completed_franchisee": completed.get("franchisee"),
            "franchise_name": completed.get("franchise_name"),
            "profile_franchisees": len(profile_check.get("franchisees") or []),
            "onboard_requests": len(profile_check.get("onboard_requests") or []),
        }

    return {
        "ok": bool(ok),
        "phase": "109",
        "setup": setup,
        "levels": levels,
        "agents_count": len(agents),
        "attribute": attr_result,
        "monthly": monthly,
        "onboard": onboard,
        "ledger_count": frappe.db.count(LEDGER_DT) if frappe.db.exists("DocType", LEDGER_DT) else 0,
    }


# ---------------------------------------------------------------------------
# Whitelisted portal APIs
# ---------------------------------------------------------------------------

def _require_agency_auth(sid=None):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _require_mobile_auth

    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    if not is_agency_user(frappe.session.user):
        return _error(_("Agency agent access required"), 403)
    return None


@frappe.whitelist(allow_guest=True)
def setup_agency_agents(sid=None):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _require_mobile_auth, _success

    if not _require_mobile_auth(sid):
        return _error(_("Not authenticated"), 401)
    roles = set(frappe.get_roles(frappe.session.user))
    if not ({"System Manager", "Health System Admin", AGENCY_MANAGER_ROLE} & roles):
        return _error(_("Manager access required"), 403)
    return _success(setup_phase109_agency_agents())


@frappe.whitelist(allow_guest=True)
def get_agency_dashboard(sid=None):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _success

    denied = _require_agency_auth(sid)
    if denied:
        return denied
    try:
        return _success(get_agency_manager_dashboard(frappe.session.user))
    except Exception as exc:
        frappe.log_error(title="get_agency_dashboard", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load agency dashboard"))


@frappe.whitelist(allow_guest=True)
def get_agency_profile(sid=None, agent_id=None):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

    denied = _require_agency_auth(sid)
    if denied:
        return denied
    try:
        aid = _parse_request_value("agent_id", agent_id)
        if aid and not is_agency_manager_user(frappe.session.user):
            me = get_agent_for_user(frappe.session.user)
            if aid != me:
                return _error(_("Not allowed to view this agent"), 403)
        return _success(get_agency_agent_profile(agent_id=aid, user=frappe.session.user))
    except Exception as exc:
        frappe.log_error(title="get_agency_profile", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to load agent profile"))


@frappe.whitelist(allow_guest=True)
def get_agency_team(sid=None):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _success

    denied = _require_agency_auth(sid)
    if denied:
        return denied
    me = get_agent_for_user(frappe.session.user)
    root = None if is_agency_manager_user(frappe.session.user) else me
    return _success(get_agency_team_tree(root_agent=root))


@frappe.whitelist(allow_guest=True)
def get_agency_commissions(sid=None, limit=50):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

    denied = _require_agency_auth(sid)
    if denied:
        return denied
    me = get_agent_for_user(frappe.session.user)
    agent_id = None if is_agency_manager_user(frappe.session.user) else me
    return _success(list_agency_commissions(agent_id=agent_id, limit=_parse_request_value("limit", limit) or 50))


@frappe.whitelist(allow_guest=True)
def get_agency_levels(sid=None):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _success

    denied = _require_agency_auth(sid)
    if denied:
        return denied
    return _success(list_agency_levels())


@frappe.whitelist(allow_guest=True)
def save_agency_level(sid=None, level_code=None, conversion_pct=None, monthly_revenue_pct=None, override_pct=None, active=None):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

    denied = _require_agency_auth(sid)
    if denied:
        return denied
    if not is_agency_manager_user(frappe.session.user):
        return _error(_("Only agency managers can edit levels"), 403)
    try:
        row = update_agency_level(
            _parse_request_value("level_code", level_code),
            conversion_pct=_parse_request_value("conversion_pct", conversion_pct),
            monthly_revenue_pct=_parse_request_value("monthly_revenue_pct", monthly_revenue_pct),
            override_pct=_parse_request_value("override_pct", override_pct),
            active=_parse_request_value("active", active),
        )
        return _success({"level": row}, message=_("Level updated"))
    except Exception as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def agency_attribute_franchisee(sid=None, agent_id=None, franchisee_id=None, deal_value=None, notes=None):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

    denied = _require_agency_auth(sid)
    if denied:
        return denied
    try:
        result = attribute_franchisee_to_agent(
            _parse_request_value("agent_id", agent_id) or get_agent_for_user(frappe.session.user),
            _parse_request_value("franchisee_id", franchisee_id),
            deal_value=_parse_request_value("deal_value", deal_value),
            notes=_parse_request_value("notes", notes),
        )
        return _success(result, message=_("Franchisee attributed"))
    except Exception as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def agency_accrue_monthly(sid=None, period=None, franchisee_id=None, revenue_amount=None):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

    denied = _require_agency_auth(sid)
    if denied:
        return denied
    if not is_agency_manager_user(frappe.session.user):
        return _error(_("Only agency managers can accrue monthly commissions"), 403)
    try:
        result = accrue_agency_monthly_commissions(
            period=_parse_request_value("period", period),
            franchisee_id=_parse_request_value("franchisee_id", franchisee_id),
            revenue_amount=_parse_request_value("revenue_amount", revenue_amount),
        )
        return _success(result, message=_("Monthly commissions accrued"))
    except Exception as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def submit_agency_franchisee_onboard(sid=None, **kwargs):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

    denied = _require_agency_auth(sid)
    if denied:
        return denied
    agent_id = _parse_request_value("agent_id", kwargs.get("agent_id")) or get_agent_for_user(frappe.session.user)
    try:
        result = submit_agency_onboard_request(
            agent_id,
            prospect_name=_parse_request_value("prospect_name", kwargs.get("prospect_name")),
            mobile=_parse_request_value("mobile", kwargs.get("mobile")),
            email=_parse_request_value("email", kwargs.get("email")),
            territory=_parse_request_value("territory", kwargs.get("territory")),
            franchise_model=_parse_request_value("franchise_model", kwargs.get("franchise_model")),
            deal_value=_parse_request_value("deal_value", kwargs.get("deal_value")),
            notes=_parse_request_value("notes", kwargs.get("notes")),
        )
        return _success(result, message=_("Onboard request sent to FFMS for approval"))
    except Exception as exc:
        frappe.log_error(title="submit_agency_franchisee_onboard", message=frappe.get_traceback())
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def complete_agency_franchisee_onboard(sid=None, request_id=None):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

    denied = _require_agency_auth(sid)
    if denied:
        return denied
    try:
        result = complete_agency_onboard(
            _parse_request_value("request_id", request_id),
            agent_id=get_agent_for_user(frappe.session.user),
        )
        return _success(result, message=_("Franchisee onboarded"))
    except Exception as exc:
        return _error(str(exc))


@frappe.whitelist(allow_guest=True)
def get_agency_onboard_requests(sid=None, limit=50):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

    denied = _require_agency_auth(sid)
    if denied:
        return denied
    me = get_agent_for_user(frappe.session.user)
    agent_id = None if is_agency_manager_user(frappe.session.user) else me
    return _success(list_agency_onboard_requests(agent_id=agent_id, limit=_parse_request_value("limit", limit) or 50))


@frappe.whitelist(allow_guest=True)
def get_agency_franchisees(sid=None, limit=50):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

    denied = _require_agency_auth(sid)
    if denied:
        return denied
    me = get_agent_for_user(frappe.session.user)
    agent_id = None if is_agency_manager_user(frappe.session.user) else me
    return _success(
        list_agent_franchisees_with_commissions(agent_id=agent_id, limit=_parse_request_value("limit", limit) or 50)
    )


@frappe.whitelist(allow_guest=True)
def ffms_agency_onboard_decision(**kwargs):
    """FFMS HMAC bridge — approve/reject agency franchisee onboard request."""
    frappe.flags.ignore_csrf = True
    from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

    try:
        from health_ecosystem_core.health_ecosystem_core.clinical_phase86_franchise_ads import (
            _check_webhook_secret,
        )

        _check_webhook_secret()
        result = apply_ffms_onboard_decision(
            _parse_request_value("request_id", kwargs.get("request_id")),
            decision=_parse_request_value("decision", kwargs.get("decision")),
            decided_by=_parse_request_value("decided_by", kwargs.get("decided_by")),
            notes=_parse_request_value("notes", kwargs.get("notes")),
            ffms_lead_id=_parse_request_value("ffms_lead_id", kwargs.get("ffms_lead_id")),
        )
        return _success(result, message=_("Agency onboard decision applied"))
    except Exception as exc:
        frappe.log_error(title="ffms_agency_onboard_decision", message=frappe.get_traceback())
        return _error(str(exc) or _("Unable to apply decision"))


@frappe.whitelist(allow_guest=True)
def smoke_agency_agents(sid=None):
    from health_ecosystem_core.health_ecosystem_core.api import _error, _require_mobile_auth, _success

    # Allow System Manager / guest HMAC-less smoke when already System Manager session
    if frappe.session.user == "Guest":
        return _error(_("Not authenticated"), 401)
    roles = set(frappe.get_roles(frappe.session.user))
    if not ({"System Manager", "Health System Admin", "Administrator"} & roles):
        if not _require_mobile_auth(sid):
            return _error(_("Not authenticated"), 401)
        if not ({"System Manager", "Health System Admin", "Administrator"} & set(frappe.get_roles(frappe.session.user))):
            return _error(_("Admin access required"), 403)
    return _success(smoke_phase109_agency_agents())
