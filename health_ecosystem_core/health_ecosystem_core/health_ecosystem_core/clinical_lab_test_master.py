"""Lab Technician portal: Test Master (Diagnostic Test Master with its parameters and reference ranges).

Level comes from Portal Access → Lab Technician Portal → "Test Master" for logins HR manages there,
otherwise from roles: Lab Technician views, Lab Manager / Pathologist edit, admins manage.
Saves go through the DocType so its validation (calculated parameters, range codes) still runs.
"""

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt

DT = "Diagnostic Test Master"
LEVELS = ["none", "view", "create", "edit", "approve", "manage"]
ADMIN_ROLES = {"Administrator", "System Manager", "Health System Admin"}
EDIT_ROLES = {"Lab Manager", "Pathologist"}
VIEW_ROLES = {"Lab Technician"}

HEADER_FIELDS = (
	"department",
	"item",
	"disabled",
	"lis_code",
	"report_category",
	"is_nabl",
	"nabl_discipline",
	"specimen_material",
	"result_layout",
	"uses_age_related_ranges",
	"machine_method",
	"tat_days",
	"report_heading_1",
	"report_heading_2",
	"description",
	"interpretation",
)
PARAM_FIELDS = (
	"parameter_code",
	"parameter_name",
	"result_input_type",
	"unit",
	"choice_options",
	"default_value",
	"print_style",
	"before_heading",
	"normal_min",
	"normal_max",
	"critical_min",
	"critical_max",
	"method",
	"machine_name",
	"specimen_material",
	"nabl_discipline",
	"amr_min",
	"amr_max",
	"cv_percent",
	"measurement_uncertainty",
	"delta_limit_percent",
	"parameter_kind",
	"formula",
	"reagent_item",
	"reagent_qty",
	"description",
)
RANGE_FIELDS = (
	"parameter_code",
	"parameter_name",
	"gender",
	"age_from_years",
	"age_from_months",
	"age_from_days",
	"age_to_years",
	"age_to_months",
	"age_to_days",
	"normal_min",
	"normal_max",
	"critical_min",
	"critical_max",
	"display_label",
	"cycle_phase",
	"interpretation",
)
SELECT_SOURCES = {
	"result_input_type": "Diagnostic Test Parameter",
	"print_style": "Diagnostic Test Parameter",
	"parameter_kind": "Diagnostic Test Parameter",
	"nabl_discipline": DT,
	"specimen_material": DT,
	"result_layout": DT,
	"gender": "Diagnostic Test Reference Range",
	"cycle_phase": "Diagnostic Test Reference Range",
}


def _api():
	from health_ecosystem_core.health_ecosystem_core import api

	return api


def _clear_doctype_cache():
	cache = getattr(frappe.local, "table_columns", None)
	if isinstance(cache, dict):
		cache.pop(DT, None)
	frappe.clear_cache(doctype=DT)


def _ensure_custom_field(spec):
	"""Add a Custom Field when DocType meta does not already define it."""
	if frappe.get_meta(DT).has_field(spec["fieldname"]):
		return
	if frappe.db.exists("Custom Field", {"dt": DT, "fieldname": spec["fieldname"]}):
		return
	doc = frappe.get_doc({"doctype": "Custom Field", "dt": DT, **spec})
	doc.flags.ignore_validate = True
	doc.flags.ignore_permissions = True
	doc.insert(ignore_permissions=True)


def ensure_lab_test_master_fields():
	"""NABL checkbox and TAT (days) on Diagnostic Test Master (portal + Desk)."""
	if not frappe.db.exists("DocType", DT):
		return False
	pending = []
	if not frappe.get_meta(DT).has_field("is_nabl") and not frappe.db.has_column(DT, "is_nabl"):
		pending.append(
			{
				"fieldname": "is_nabl",
				"label": "NABL",
				"fieldtype": "Check",
				"default": "0",
				"insert_after": "report_category",
				"in_list_view": 1,
				"in_standard_filter": 1,
				"description": "Mark this test as NABL-accredited. Used when choosing NABL vs Non-NABL report letterhead.",
			}
		)
	if not frappe.get_meta(DT).has_field("tat_days"):
		pending.append(
			{
				"fieldname": "tat_days",
				"label": "TAT (days)",
				"fieldtype": "Int",
				"default": "0",
				"insert_after": "machine_method",
				"non_negative": 1,
				"description": "Turnaround time in days. 0 means Same day. Each number is one day.",
			}
		)
	for spec in pending:
		try:
			_ensure_custom_field(spec)
		except Exception:
			frappe.log_error(title="ensure_lab_test_master_fields", message=frappe.get_traceback())
	_clear_doctype_cache()
	if not frappe.db.has_column(DT, "is_nabl"):
		frappe.db.sql(f"ALTER TABLE `tab{DT}` ADD COLUMN `is_nabl` INT(1) NOT NULL DEFAULT 0")
		frappe.db.commit()
	if not frappe.db.has_column(DT, "tat_days"):
		frappe.db.sql(f"ALTER TABLE `tab{DT}` ADD COLUMN `tat_days` INT NOT NULL DEFAULT 0")
		frappe.db.commit()
	_clear_doctype_cache()
	return frappe.db.has_column(DT, "is_nabl") and frappe.db.has_column(DT, "tat_days")


def _level():
	user = frappe.session.user
	roles = set(frappe.get_roles(user))
	if roles & ADMIN_ROLES:
		return "manage"
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_people_access import _user_portal_perms

		info = _user_portal_perms(user)
		lab = info["portals"].get("labtech")
		if info["managed"] and lab is not None:
			level = lab.get("Test Master", "none")
			return level if level in LEVELS else "none"
	except Exception:
		pass
	if roles & EDIT_ROLES:
		return "edit"
	if roles & VIEW_ROLES:
		return "view"
	return "none"


def _guard(sid, need="view"):
	api = _api()
	if not api._require_mobile_auth(api._parse_request_value("sid", sid)):
		return api._error(_("Not authenticated"), 401), None
	level = _level()
	if LEVELS.index(level) < LEVELS.index(need):
		return api._error(_("You do not have {0} access to the Test Master").format(need), 403), None
	return None, level


def _arg(name, value):
	return _api()._parse_request_value(name, value)


def _options(doctype, fieldname):
	df = frappe.get_meta(doctype).get_field(fieldname)
	return [o for o in cstr(df.options if df else "").split("\n")]


def _num(v):
	if v in (None, ""):
		return None
	return flt(v)


def _clean(fields, row, doctype):
	meta = frappe.get_meta(doctype)
	out = {}
	for f in fields:
		if f not in row:
			continue
		df = meta.get_field(f)
		if not df:
			continue
		v = row.get(f)
		if df.fieldtype in ("Float", "Currency", "Percent"):
			out[f] = _num(v)
		elif df.fieldtype in ("Int", "Check"):
			out[f] = cint(v)
		else:
			out[f] = cstr(v).strip() if v is not None else ""
	return out


def _row_out(row, fields):
	return {"id": row.name, **{f: row.get(f) for f in fields}}


def _tat_days(value):
	return max(0, cint(value))


def test_detail(name):
	doc = frappe.get_doc(DT, name)
	header = {f: doc.get(f) for f in HEADER_FIELDS}
	if header.get("tat_days") in (None, "") and frappe.db.has_column(DT, "tat_days"):
		header["tat_days"] = frappe.db.sql(f"SELECT IFNULL(tat_days, 0) FROM `tab{DT}` WHERE name=%s", name)[0][0]
	header["tat_days"] = _tat_days(header.get("tat_days"))
	return {
		"name": doc.name,
		"test_name": doc.test_name,
		"modified": cstr(doc.modified),
		"modified_by": doc.modified_by,
		**header,
		"parameters": [_row_out(r, PARAM_FIELDS) for r in doc.get("parameters") or []],
		"reference_ranges": [_row_out(r, RANGE_FIELDS) for r in doc.get("reference_ranges") or []],
		"tubes": [{"tube": r.tube, "min_volume_ml": r.min_volume_ml, "preferred": cint(r.preferred)} for r in doc.get("tube_requirements") or []],
	}


def _merge_children(doc, table, fields, child_dt, rows):
	"""Keep fields the portal does not edit on existing rows; rows left out are removed."""
	existing = {r.name: r for r in doc.get(table) or []}
	merged = []
	for row in rows or []:
		values = _clean(fields, row, child_dt)
		current = existing.get(cstr(row.get("id")))
		if current:
			current.update(values)
			merged.append(current)
		else:
			merged.append(values)
	doc.set(table, [])
	for item in merged:
		doc.append(table, item if isinstance(item, dict) else item.as_dict())


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_lab_test_masters(sid=None, q=None, department=None, status=None, start=None, limit=None):
	denied, level = _guard(sid)
	if denied:
		return denied
	api = _api()
	ensure_lab_test_master_fields()
	q = cstr(_arg("q", q)).strip()
	department = cstr(_arg("department", department)).strip()
	status = cstr(_arg("status", status)).strip() or "Active"
	start = max(cint(_arg("start", start)), 0)
	limit = min(max(cint(_arg("limit", limit)) or 50, 1), 200)
	where, args = ["1=1"], []
	if q:
		where.append("(t.test_name LIKE %s OR t.lis_code LIKE %s OR t.item LIKE %s OR EXISTS (SELECT 1 FROM `tabDiagnostic Test Parameter` p WHERE p.parent = t.name AND p.parameter_name LIKE %s))")
		args += [f"%{q}%"] * 4
	if department:
		where.append("t.department = %s")
		args.append(department)
	if status == "Active":
		where.append("IFNULL(t.disabled, 0) = 0")
	elif status == "Disabled":
		where.append("IFNULL(t.disabled, 0) = 1")
	sql_where = " AND ".join(where)
	total = frappe.db.sql(f"SELECT COUNT(*) FROM `tab{DT}` t WHERE {sql_where}", args)[0][0]
	nabl_select = "IFNULL(t.is_nabl, 0) AS is_nabl" if frappe.db.has_column(DT, "is_nabl") else "0 AS is_nabl"
	tat_select = "IFNULL(t.tat_days, 0) AS tat_days" if frappe.db.has_column(DT, "tat_days") else "0 AS tat_days"
	rows = frappe.db.sql(
		f"""SELECT t.name, t.test_name, t.department, t.nabl_discipline, t.specimen_material, t.lis_code, t.item,
		           IFNULL(t.disabled, 0) AS disabled, {nabl_select}, {tat_select}, t.result_layout, t.modified,
		           (SELECT COUNT(*) FROM `tabDiagnostic Test Parameter` p WHERE p.parent = t.name AND p.parenttype = %s) AS parameters,
		           (SELECT COUNT(*) FROM `tabDiagnostic Test Reference Range` r WHERE r.parent = t.name AND r.parenttype = %s) AS ranges
		      FROM `tab{DT}` t WHERE {sql_where} ORDER BY t.test_name LIMIT %s OFFSET %s""",
		[DT, DT, *args, limit, start],
		as_dict=True,
	)
	departments = frappe.db.sql_list(f"SELECT DISTINCT department FROM `tab{DT}` WHERE IFNULL(department, '') != '' ORDER BY department")
	return api._success(
		{
			"items": [{**r, "modified": cstr(r.modified)} for r in rows],
			"total": total,
			"departments": departments,
			"level": level,
		}
	)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_lab_test_master(sid=None, test=None):
	denied, level = _guard(sid)
	if denied:
		return denied
	api = _api()
	ensure_lab_test_master_fields()
	test = cstr(_arg("test", test)).strip()
	if test and not frappe.db.exists(DT, test):
		return api._error(_("Test not found"), 404)
	return api._success(
		{
			"test": test_detail(test) if test else None,
			"level": level,
			"options": {f: _options(dt, f) for f, dt in SELECT_SOURCES.items()},
			"clinical_departments": frappe.get_all("Clinical Department", pluck="name", order_by="name asc") if frappe.db.exists("DocType", "Clinical Department") else [],
		}
	)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def save_lab_test_master(sid=None, test=None, data=None):
	api = _api()
	raw = _arg("data", data) or "{}"
	try:
		payload = json.loads(raw) if isinstance(raw, str) else dict(raw)
	except ValueError:
		return api._error(_("Invalid data"))
	test = cstr(_arg("test", test)).strip()
	creating = not test
	denied, _level_now = _guard(sid, "create" if creating else "edit")
	if denied:
		return denied
	ensure_lab_test_master_fields()
	try:
		if creating:
			name = cstr(payload.get("test_name")).strip()
			if not name:
				frappe.throw(_("Test name is required"))
			if frappe.db.exists(DT, name):
				frappe.throw(_("A test named {0} already exists").format(name))
			doc = frappe.new_doc(DT)
			doc.test_name = name
		else:
			if not frappe.db.exists(DT, test):
				return api._error(_("Test not found"), 404)
			doc = frappe.get_doc(DT, test)
			if payload.get("modified") and cstr(doc.modified) != cstr(payload.get("modified")):
				frappe.throw(_("{0} changed this test after you opened it. Reload and make your change again.").format(doc.modified_by))
		header = _clean(HEADER_FIELDS, payload, DT)
		if "tat_days" in header:
			header["tat_days"] = _tat_days(header["tat_days"])
		doc.update(header)
		if "parameters" in payload:
			_merge_children(doc, "parameters", PARAM_FIELDS, "Diagnostic Test Parameter", payload.get("parameters"))
		if "reference_ranges" in payload:
			_merge_children(doc, "reference_ranges", RANGE_FIELDS, "Diagnostic Test Reference Range", payload.get("reference_ranges"))
		for row in doc.get("parameters") or []:
			if not cstr(row.parameter_name).strip():
				frappe.throw(_("Every parameter needs a name"))
		doc.flags.ignore_permissions = True
		doc.save() if not creating else doc.insert()
		if "tat_days" in payload and frappe.db.has_column(DT, "tat_days") and not frappe.get_meta(DT).has_field("tat_days"):
			frappe.db.sql(
				f"UPDATE `tab{DT}` SET tat_days=%s WHERE name=%s",
				(_tat_days(payload.get("tat_days")), doc.name),
			)
		frappe.db.commit()
		return api._success({"test": test_detail(doc.name)}, message=_("Test saved"))
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		return api._error(cstr(exc) or _("Could not save the test"))
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="save_lab_test_master", message=frappe.get_traceback())
		return api._error(_("Could not save the test"), 500)
