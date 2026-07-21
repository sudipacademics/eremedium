"""Phase 63 — NABL 112A QMS + 132 complaints: CAPA, QI, audit, risk, LIS checklist."""

from __future__ import annotations

import os
from calendar import monthrange
from datetime import date

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate, today

PHASE63_DOCTYPES = (
	("quality_indicator", "Quality Indicator"),
	("quality_indicator_value", "Quality Indicator Value"),
	("risk_register", "Risk Register"),
	("lis_verification_checklist", "LIS Verification Checklist"),
	("lab_complaint", "Lab Complaint"),
	("capa", "CAPA"),
	("lab_internal_audit", "Lab Internal Audit"),
)

QI_SEED = (
	{
		"indicator_code": "REJ_PCT",
		"indicator_name": "Sample Rejection %",
		"category": "Pre-examination",
		"unit": "%",
		"target_value": 2.0,
		"direction": "Lower is better",
		"description": "Rejected samples / total received × 100",
	},
	{
		"indicator_code": "TAT_MET",
		"indicator_name": "TAT Met %",
		"category": "Post-examination",
		"unit": "%",
		"target_value": 90.0,
		"direction": "Higher is better",
		"description": "Reports within promised TAT",
	},
	{
		"indicator_code": "CMP_CNT",
		"indicator_name": "Complaints (count)",
		"category": "Customer",
		"unit": "count",
		"target_value": 5.0,
		"direction": "Lower is better",
		"description": "Customer complaints in period",
	},
)


def _import_doctype(folder, doctype_name, force=True):
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
			import_file_by_path(json_path, force=force)
			frappe.db.commit()
			frappe.clear_cache(doctype=doctype_name)
			if frappe.db.exists("DocType", doctype_name):
				return True
	frappe.throw(_("Could not install {0} doctype").format(doctype_name))


def ensure_phase63_doctypes():
	for folder, name in PHASE63_DOCTYPES:
		_import_doctype(folder, name, force=True)
	_import_doctype("health_ecosystem_settings", "Health Ecosystem Settings", force=True)


def _month_bounds(d=None):
	d = getdate(d or today())
	start = date(d.year, d.month, 1)
	end = date(d.year, d.month, monthrange(d.year, d.month)[1])
	return start, end


def seed_quality_indicators():
	created = []
	for row in QI_SEED:
		if frappe.db.exists("Quality Indicator", row["indicator_code"]):
			created.append(row["indicator_code"])
			continue
		doc = frappe.get_doc({"doctype": "Quality Indicator", "active": 1, **row})
		doc.insert(ignore_permissions=True)
		created.append(doc.name)
	frappe.db.commit()
	return created


def seed_qi_values(indicator_codes):
	start, end = _month_bounds()
	seeded = 0
	# Rejection %
	if "REJ_PCT" in indicator_codes or frappe.db.exists("Quality Indicator", "REJ_PCT"):
		exists = frappe.get_all(
			"Quality Indicator Value",
			filters={"indicator": "REJ_PCT", "period_start": start, "period_end": end},
			limit=1,
		)
		if not exists:
			rej = 0
			total = 0
			if frappe.db.exists("DocType", "Sample Rejection Record"):
				rej = frappe.db.count("Sample Rejection Record")
			elif frappe.db.exists("DocType", "Sample Rejection"):
				rej = frappe.db.count("Sample Rejection")
			# Approximate total from Lab Test Request / TRF if present
			for dt in ("Lab Test Request", "Test Request Form", "Lab Order"):
				if frappe.db.exists("DocType", dt):
					try:
						total = frappe.db.count(dt, {"creation": ["between", [str(start), str(end) + " 23:59:59"]]})
					except Exception:
						total = 0
					if total:
						break
			if not total:
				total = max(rej, 1) * 50  # demo denominator when no TRF count
			val = round((rej / total) * 100, 2) if total else 0.0
			target = flt(frappe.db.get_value("Quality Indicator", "REJ_PCT", "target_value") or 2)
			frappe.get_doc(
				{
					"doctype": "Quality Indicator Value",
					"indicator": "REJ_PCT",
					"period_start": start,
					"period_end": end,
					"value": val,
					"numerator": rej,
					"denominator": total,
					"meets_target": 1 if val <= target else 0,
					"notes": "Phase 63 seed",
				}
			).insert(ignore_permissions=True)
			seeded += 1

	# Complaints count
	if frappe.db.exists("Quality Indicator", "CMP_CNT"):
		exists = frappe.get_all(
			"Quality Indicator Value",
			filters={"indicator": "CMP_CNT", "period_start": start, "period_end": end},
			limit=1,
		)
		if not exists:
			cnt = frappe.db.count("Lab Complaint", {"complaint_date": ["between", [start, end]]}) if frappe.db.exists("DocType", "Lab Complaint") else 0
			target = flt(frappe.db.get_value("Quality Indicator", "CMP_CNT", "target_value") or 5)
			frappe.get_doc(
				{
					"doctype": "Quality Indicator Value",
					"indicator": "CMP_CNT",
					"period_start": start,
					"period_end": end,
					"value": float(cnt),
					"numerator": cnt,
					"denominator": 1,
					"meets_target": 1 if cnt <= target else 0,
					"notes": "Phase 63 seed",
				}
			).insert(ignore_permissions=True)
			seeded += 1

	# TAT met demo
	if frappe.db.exists("Quality Indicator", "TAT_MET"):
		exists = frappe.get_all(
			"Quality Indicator Value",
			filters={"indicator": "TAT_MET", "period_start": start, "period_end": end},
			limit=1,
		)
		if not exists:
			frappe.get_doc(
				{
					"doctype": "Quality Indicator Value",
					"indicator": "TAT_MET",
					"period_start": start,
					"period_end": end,
					"value": 94.0,
					"numerator": 94,
					"denominator": 100,
					"meets_target": 1,
					"notes": "Phase 63 seed demo",
				}
			).insert(ignore_permissions=True)
			seeded += 1

	frappe.db.commit()
	return seeded


def seed_complaint_and_capa():
	out = {"complaint": None, "capa": None}
	existing = frappe.get_all("Lab Complaint", filters={"subject": "Phase 63 demo complaint"}, limit=1)
	if existing:
		out["complaint"] = existing[0].name
	else:
		doc = frappe.get_doc(
			{
				"doctype": "Lab Complaint",
				"source": "Customer",
				"complaint_date": today(),
				"status": "Acknowledged",
				"priority": "Normal",
				"contact_name": "Demo Patient",
				"contact_phone": "9999999999",
				"subject": "Phase 63 demo complaint",
				"description": "<p>Delayed report delivery — seed for NABL 132 redressal flow.</p>",
				"investigation_notes": "<p>Investigating dispatch queue.</p>",
			}
		)
		doc.insert(ignore_permissions=True)
		out["complaint"] = doc.name

	capa_existing = frappe.get_all("CAPA", filters={"title": "Phase 63 demo CAPA"}, limit=1)
	if capa_existing:
		out["capa"] = capa_existing[0].name
	else:
		capa = frappe.get_doc(
			{
				"doctype": "CAPA",
				"title": "Phase 63 demo CAPA",
				"source": "Complaint",
				"severity": "Medium",
				"status": "Action",
				"opened_on": today(),
				"due_date": add_days(today(), 14),
				"nonconformity_description": "<p>Report TAT exceeded for demo case.</p>",
				"root_cause": "<p>Dispatch backlog at peak hours.</p>",
				"corrective_action": "<p>Added afternoon dispatch slot.</p>",
				"preventive_action": "<p>Monitor TAT QI weekly.</p>",
				"linked_complaint": out["complaint"],
				"owner_user": frappe.session.user if frappe.session.user != "Guest" else "Administrator",
				"notes": "Phase 63 seed",
			}
		)
		capa.insert(ignore_permissions=True)
		out["capa"] = capa.name
		frappe.db.set_value("Lab Complaint", out["complaint"], "linked_capa", capa.name)
		frappe.db.set_value("Lab Complaint", out["complaint"], "status", "CAPA Linked")

	frappe.db.commit()
	return out


def seed_audit_risk_lis():
	out = {"audit": None, "risk": None, "lis": None}
	aud = frappe.get_all("Lab Internal Audit", filters={"audit_title": "Phase 63 QMS internal audit"}, limit=1)
	if aud:
		out["audit"] = aud[0].name
	else:
		doc = frappe.get_doc(
			{
				"doctype": "Lab Internal Audit",
				"audit_title": "Phase 63 QMS internal audit",
				"audit_type": "Internal",
				"audit_date": today(),
				"status": "Completed",
				"auditor": "QM Demo",
				"area": "Pre-examination / Complaints",
				"findings_summary": "<p>Complaint log present; CAPA linkage verified.</p>",
				"nonconformities_count": 1,
				"next_audit_due": add_days(today(), 180),
				"notes": "Phase 63 seed",
			}
		)
		doc.insert(ignore_permissions=True)
		out["audit"] = doc.name

	risk = frappe.get_all("Risk Register", filters={"risk_title": "Sample mix-up at SCF"}, limit=1)
	if risk:
		out["risk"] = risk[0].name
	else:
		doc = frappe.get_doc(
			{
				"doctype": "Risk Register",
				"risk_title": "Sample mix-up at SCF",
				"process_area": "Sample collection",
				"likelihood": "2",
				"impact": "5",
				"status": "Mitigating",
				"mitigation": "<p>Two-identifier check + barcode scan.</p>",
				"owner_user": frappe.session.user if frappe.session.user != "Guest" else "Administrator",
				"review_date": add_days(today(), 90),
				"notes": "Phase 63 seed",
			}
		)
		doc.insert(ignore_permissions=True)
		out["risk"] = doc.name

	lis = frappe.get_all("LIS Verification Checklist", filters={"checklist_title": "Phase 63 LIS verification"}, limit=1)
	if lis:
		out["lis"] = lis[0].name
	else:
		doc = frappe.get_doc(
			{
				"doctype": "LIS Verification Checklist",
				"checklist_title": "Phase 63 LIS verification",
				"verification_date": today(),
				"status": "Pass",
				"verified_by": frappe.session.user if frappe.session.user != "Guest" else "Administrator",
				"access_control_ok": 1,
				"audit_trail_ok": 1,
				"backup_restore_ok": 1,
				"result_integrity_ok": 1,
				"interface_ok": 1,
				"user_training_ok": 1,
				"notes": "Phase 63 seed",
			}
		)
		doc.insert(ignore_permissions=True)
		out["lis"] = doc.name

	frappe.db.commit()
	return out


def ensure_retention_defaults():
	if not frappe.db.exists("DocType", "Health Ecosystem Settings"):
		return
	try:
		s = frappe.get_single("Health Ecosystem Settings")
		changed = False
		for field, default in (
			("retention_years_reports", 5),
			("retention_years_raw_data", 5),
			("retention_years_qc", 3),
			("retention_years_complaints", 5),
		):
			if hasattr(s, field) and not cint(getattr(s, field) or 0):
				setattr(s, field, default)
				changed = True
		if changed:
			s.save(ignore_permissions=True)
			frappe.db.commit()
	except Exception:
		pass


def setup_phase63():
	ensure_phase63_doctypes()
	ensure_retention_defaults()
	qi = seed_quality_indicators()
	linked = seed_complaint_and_capa()
	qi_vals = seed_qi_values(qi)
	extra = seed_audit_risk_lis()
	return {
		"ok": True,
		"quality_indicators": qi,
		"qi_values_seeded": qi_vals,
		"complaint": linked["complaint"],
		"capa": linked["capa"],
		"audit": extra["audit"],
		"risk": extra["risk"],
		"lis_checklist": extra["lis"],
		"counts": {
			"capa": frappe.db.count("CAPA"),
			"complaints": frappe.db.count("Lab Complaint"),
			"qi": frappe.db.count("Quality Indicator"),
			"qi_values": frappe.db.count("Quality Indicator Value"),
			"audits": frappe.db.count("Lab Internal Audit"),
			"risks": frappe.db.count("Risk Register"),
			"lis": frappe.db.count("LIS Verification Checklist"),
		},
	}


def smoke_phase63():
	result = {"ok": True, "checks": []}

	def check(name, cond, detail=""):
		result["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
		if not cond:
			result["ok"] = False

	setup = setup_phase63()
	check("setup", setup.get("ok"), str(setup.get("counts")))
	for dt in (
		"CAPA",
		"Lab Complaint",
		"Quality Indicator",
		"Quality Indicator Value",
		"Lab Internal Audit",
		"Risk Register",
		"LIS Verification Checklist",
	):
		check(f"doctype_{dt}", frappe.db.exists("DocType", dt))

	check("capa_rows", frappe.db.count("CAPA") >= 1)
	check("complaint_rows", frappe.db.count("Lab Complaint") >= 1)
	check("qi_rows", frappe.db.count("Quality Indicator") >= 3)
	check("qi_value_rows", frappe.db.count("Quality Indicator Value") >= 1)
	check("audit_rows", frappe.db.count("Lab Internal Audit") >= 1)
	check("risk_rows", frappe.db.count("Risk Register") >= 1)
	check("lis_rows", frappe.db.count("LIS Verification Checklist") >= 1)

	# Complaint has ack_id and optional CAPA link
	cmp_name = setup.get("complaint")
	if cmp_name:
		ack = frappe.db.get_value("Lab Complaint", cmp_name, "ack_id")
		capa = frappe.db.get_value("Lab Complaint", cmp_name, "linked_capa")
		check("complaint_ack_id", bool(ack), str(ack))
		check("complaint_capa_link", bool(capa), str(capa))

	# Risk score computed
	risk_name = setup.get("risk")
	if risk_name:
		score = cint(frappe.db.get_value("Risk Register", risk_name, "risk_score") or 0)
		check("risk_score", score == 10, f"score={score}")

	dash = _qms_dashboard_payload()
	check("dashboard_payload", isinstance(dash.get("counts"), dict), str(dash.get("counts")))

	return result


def _qms_dashboard_payload():
	capas = frappe.get_all(
		"CAPA",
		fields=["name", "title", "source", "severity", "status", "opened_on", "due_date", "linked_complaint"],
		order_by="opened_on desc",
		limit=30,
	)
	complaints = frappe.get_all(
		"Lab Complaint",
		fields=["name", "ack_id", "subject", "source", "status", "priority", "complaint_date", "linked_capa", "contact_name"],
		order_by="complaint_date desc",
		limit=30,
	)
	qi = frappe.get_all(
		"Quality Indicator",
		filters={"active": 1},
		fields=["name", "indicator_name", "indicator_code", "category", "unit", "target_value", "direction"],
		order_by="indicator_code asc",
	)
	qi_values = frappe.get_all(
		"Quality Indicator Value",
		fields=["name", "indicator", "period_start", "period_end", "value", "meets_target", "numerator", "denominator"],
		order_by="period_end desc",
		limit=40,
	)
	audits = frappe.get_all(
		"Lab Internal Audit",
		fields=["name", "audit_title", "audit_type", "audit_date", "status", "area", "nonconformities_count"],
		order_by="audit_date desc",
		limit=20,
	)
	risks = frappe.get_all(
		"Risk Register",
		fields=["name", "risk_title", "process_area", "likelihood", "impact", "risk_score", "status"],
		order_by="risk_score desc",
		limit=20,
	)
	lis = frappe.get_all(
		"LIS Verification Checklist",
		fields=["name", "checklist_title", "verification_date", "status"],
		order_by="verification_date desc",
		limit=10,
	)
	retention = {}
	try:
		s = frappe.get_single("Health Ecosystem Settings")
		retention = {
			"reports": cint(getattr(s, "retention_years_reports", 0) or 0),
			"raw_data": cint(getattr(s, "retention_years_raw_data", 0) or 0),
			"qc": cint(getattr(s, "retention_years_qc", 0) or 0),
			"complaints": cint(getattr(s, "retention_years_complaints", 0) or 0),
		}
	except Exception:
		pass

	open_capa = len([c for c in capas if c.status not in ("Closed", "Cancelled")])
	open_cmp = len([c for c in complaints if c.status not in ("Closed", "Rejected")])

	return {
		"capas": capas,
		"complaints": complaints,
		"quality_indicators": qi,
		"qi_values": qi_values,
		"audits": audits,
		"risks": risks,
		"lis_checklists": lis,
		"retention": retention,
		"counts": {
			"capa": frappe.db.count("CAPA"),
			"capa_open": open_capa,
			"complaints": frappe.db.count("Lab Complaint"),
			"complaints_open": open_cmp,
			"qi": frappe.db.count("Quality Indicator"),
			"audits": frappe.db.count("Lab Internal Audit"),
			"risks": frappe.db.count("Risk Register"),
			"lis": frappe.db.count("LIS Verification Checklist"),
		},
	}


# ── APIs ─────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def run_phase63_setup():
	from health_ecosystem_core.health_ecosystem_core.api import _success

	return _success(setup_phase63())


@frappe.whitelist()
def run_phase63_smoke():
	from health_ecosystem_core.health_ecosystem_core.api import _success

	return _success(smoke_phase63())


@frappe.whitelist()
def get_qms_dashboard():
	from health_ecosystem_core.health_ecosystem_core.api import _error, _success

	if frappe.session.user == "Guest":
		return _error("Not authenticated", 401)
	return _success(_qms_dashboard_payload())


@frappe.whitelist()
def create_capa(
	title=None,
	source=None,
	severity=None,
	nonconformity_description=None,
	root_cause=None,
	corrective_action=None,
	linked_complaint=None,
	due_date=None,
):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

	if frappe.session.user == "Guest":
		return _error("Not authenticated", 401)
	title = _parse_request_value("title", title)
	desc = _parse_request_value("nonconformity_description", nonconformity_description)
	if not title or not desc:
		return _error("title and nonconformity_description required")
	doc = frappe.get_doc(
		{
			"doctype": "CAPA",
			"title": title,
			"source": _parse_request_value("source", source) or "Internal",
			"severity": _parse_request_value("severity", severity) or "Medium",
			"status": "Open",
			"opened_on": today(),
			"due_date": _parse_request_value("due_date", due_date),
			"nonconformity_description": desc,
			"root_cause": _parse_request_value("root_cause", root_cause),
			"corrective_action": _parse_request_value("corrective_action", corrective_action),
			"linked_complaint": _parse_request_value("linked_complaint", linked_complaint),
			"owner_user": frappe.session.user,
		}
	)
	doc.insert(ignore_permissions=True)
	linked = _parse_request_value("linked_complaint", linked_complaint)
	if linked and frappe.db.exists("Lab Complaint", linked):
		frappe.db.set_value("Lab Complaint", linked, "linked_capa", doc.name)
		frappe.db.set_value("Lab Complaint", linked, "status", "CAPA Linked")
	frappe.db.commit()
	return _success({"capa": doc.name})


@frappe.whitelist(allow_guest=True)
def submit_lab_complaint(
	subject=None,
	description=None,
	contact_name=None,
	contact_phone=None,
	contact_email=None,
	source=None,
	patient=None,
):
	"""Public / staff complaint intake (NABL 132-style acknowledgement ID)."""
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

	subject = _parse_request_value("subject", subject)
	description = _parse_request_value("description", description)
	if not subject or not description:
		return _error("subject and description required")
	doc = frappe.get_doc(
		{
			"doctype": "Lab Complaint",
			"source": _parse_request_value("source", source) or "Customer",
			"complaint_date": today(),
			"status": "Acknowledged",
			"priority": "Normal",
			"contact_name": _parse_request_value("contact_name", contact_name),
			"contact_phone": _parse_request_value("contact_phone", contact_phone),
			"contact_email": _parse_request_value("contact_email", contact_email),
			"patient": _parse_request_value("patient", patient),
			"subject": subject,
			"description": f"<p>{frappe.utils.escape_html(description)}</p>" if "<" not in str(description) else description,
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return _success({"complaint": doc.name, "ack_id": doc.ack_id, "status": doc.status})


@frappe.whitelist()
def update_complaint_status(complaint=None, status=None, reply_summary=None, investigation_notes=None):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _parse_request_value, _success

	if frappe.session.user == "Guest":
		return _error("Not authenticated", 401)
	complaint = _parse_request_value("complaint", complaint)
	status = _parse_request_value("status", status)
	if not complaint or not status:
		return _error("complaint and status required")
	if not frappe.db.exists("Lab Complaint", complaint):
		return _error("Complaint not found", 404)
	vals = {"status": status}
	reply = _parse_request_value("reply_summary", reply_summary)
	notes = _parse_request_value("investigation_notes", investigation_notes)
	if reply is not None:
		vals["reply_summary"] = reply
	if notes is not None:
		vals["investigation_notes"] = notes
	if status == "Closed":
		vals["closed_on"] = today()
		vals["closed_by"] = frappe.session.user
	frappe.db.set_value("Lab Complaint", complaint, vals)
	frappe.db.commit()
	return _success({"complaint": complaint, "status": status})
