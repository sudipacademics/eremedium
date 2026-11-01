"""Phase 128 — competitor B2B rate chart → Orange FOCO billing.

1. build_competitor_review(csv_path, out_path): read-only. Matches every competitor line to our tests and writes a
   review workbook (one row per competitor line, PDF order) with a proposed Orange billing = competitor rate − 10%.
2. apply_competitor_review(path, dry_run): applies only rows marked Approve = Y. Existing Orange billing is kept;
   missing Orange billing is set (a partial chart row, off the circuit); unmatched lines become new items in
   "Lab Tests - Pricing Pending" (tests) or "Lab Charges" (charges), hidden until an MRP is set.
"""

from __future__ import annotations

import csv
import difflib
import io
import re
from typing import Any

import frappe
from frappe.utils import cint, cstr, flt

from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import (
	RATE_DT,
	TIER_ORANGE,
	clear_tier_caches,
	ensure_partner_tier_setup,
)
from health_ecosystem_core.health_ecosystem_core.clinical_phase127_pricing_chart import (
	CHARGES_GROUP,
	PENDING_GROUP,
	_lab_items,
)

DISCOUNT = 0.10
HIGH = 0.90
REVIEW = 0.75

# Longest phrases first; applied to the normalised (lowercase, alnum + spaces) name.
PHRASES = [
	("activated partial thromboplastin time", "aptt"),
	("partial thromboplastin time", "ptt"),
	("total iron binding capacity", "tibc"),
	("anti mullerian hormone", "amh"),
	("anti streptolysin o", "aso"),
	("antistreptolysin o", "aso"),
	("complete blood count", "cbc"),
	("complete blood picture", "cbc"),
	("haemogram", "cbc"),
	("hemogram", "cbc"),
	("c reactive protein", "crp"),
	("high sensitive crp", "hscrp"),
	("hs crp", "hscrp"),
	("thyroid stimulating hormone", "tsh"),
	("erythrocyte sedimentation rate", "esr"),
	("glycated haemoglobin", "hba1c"),
	("glycosylated haemoglobin", "hba1c"),
	("glycated hemoglobin", "hba1c"),
	("glycosylated hemoglobin", "hba1c"),
	("hb a1c", "hba1c"),
	("alpha feto protein", "afp"),
	("alpha fetoprotein", "afp"),
	("prostate specific antigen", "psa"),
	("blood urea nitrogen", "bun"),
	("post prandial", "pp"),
	("postprandial", "pp"),
	("postparandial", "pp"),
	("aspartate aminotransferase", "ast"),
	("alanine aminotransferase", "alt"),
	("gamma glutamyl transferase", "ggt"),
	("gamma gt", "ggt"),
	("lactate dehydrogenase", "ldh"),
	("lactic dehydrogenase", "ldh"),
	("lactic dehyderogenase", "ldh"),
	("creatine phosphokinase", "cpk"),
	("creatine kinase", "cpk"),
	("liver function test", "lft"),
	("liver function", "lft"),
	("kidney function test", "kft"),
	("renal function test", "kft"),
	("kidney function", "kft"),
	("hepatitis b surface antigen", "hbsag"),
	("vitamin b12", "vitb12"),
	("vit b12", "vitb12"),
	("cyanocobalamin", "vitb12"),
	("vitamin d3", "vitd25"),
	("25 oh vitamin d", "vitd25"),
	("vitamin d 25 oh", "vitd25"),
	("vitamin d 25 hydroxy", "vitd25"),
	("25 hydroxy vitamin d", "vitd25"),
	("vitd25 25 oh", "vitd25"),
	("vitd25 25", "vitd25"),
	("pro bnp", "probnp"),
	("human epididymis protein 4", "he4"),
	("routine examination", "routine"),
	("r e", "routine"),
	("prothrombin time", "pt"),
	("activated partial thromboplastin", "aptt"),
	("free t3", "ft3"),
	("free t4", "ft4"),
	("triiodothyronine", "t3"),
	("thyroxine", "t4"),
	("immunoglobulin", "ig"),
	("anti nuclear antibody", "ana"),
	("antinuclear antibody", "ana"),
	("rheumatoid factor", "ra factor"),
	("body fluid", "fluid"),
	("24 hours", "24hr"),
	("24 hour", "24hr"),
	("24 hrs", "24hr"),
	("24 hr", "24hr"),
	("24hrs", "24hr"),
	("24hours", "24hr"),
]
TOKENS = {
	"sugar": "glucose",
	"f": "fasting",
	"fbs": "fasting",
	"fbg": "fasting",
	"ppbs": "pp",
	"rbs": "random",
	"sgot": "ast",
	"sgpt": "alt",
	"hemoglobin": "hb",
	"haemoglobin": "hb",
	"hgb": "hb",
	"re": "routine",
	"hcg": "hcg",
	"ckmb": "cpkmb",
	"lipase": "lipase",
	"tsh": "tsh",
	"hbsag": "hbsag",
	"sodium": "na",
	"potassium": "k",
	"chloride": "cl",
	"chlorides": "cl",
	"triglyceride": "triglycerides",
	"widal": "widal",
	"vdrl": "vdrl",
	"estimation": "",
	"examination": "",
	"exam": "",
	"test": "",
	"tests": "",
	"level": "",
	"levels": "",
	"serum": "",
	"the": "",
	"of": "",
	"for": "",
	"by": "",
	"method": "",
	"and": "",
	"assay": "",
	"with": "",
	"titre": "",
	"titer": "",
	"citrated": "",
	"blood": "",
	"plasma": "",
	"clia": "",
	"eclia": "",
	"cmia": "",
	"inr": "pt",
	"cholecalciferol": "",
	"marker": "",
	"cancer": "",
	"viii": "8",
	"ix": "9",
	"iii": "3",
	"lll": "3",
}
# A parenthetical made only of these words is a method/default-specimen note, e.g. "HBA1C (HPLC METHOD)", "ADA (BLOOD)".
QUALIFIERS = {"hplc", "elisa", "clia", "eclia", "cmia", "ria", "method", "blood", "serum", "whole", "edta", "turbidimetry", "immunoturbidimetry", "nephelometry", "automated", "total"}
SPECIMENS = {"fluid", "urine", "csf", "pus", "stool", "sputum", "swab", "tissue", "24hr"}
CHARGE_RE = re.compile(r"\b(material|materials|pick ?up|panel creation|test charges)\b", re.I)

HEADERS = [
	"SL",
	"Competitor Name",
	"Competitor Rate",
	"Proposed Orange Billing",
	"Status",
	"Our Item Code",
	"Our Item Name",
	"Score",
	"Alternatives",
	"Current Orange Billing",
	"Proposed Action",
	"Final Item Code",
	"Approve",
]


def orange_rate(rate) -> float:
	return round(flt(rate) * (1 - DISCOUNT), 2)


def _drop_qualifier(m) -> str:
	words = set(re.sub(r"[^a-z0-9]+", " ", m.group(1)).split())
	return " " if words and words <= QUALIFIERS else f" {m.group(1)} "


def normalise(text) -> str:
	t = cstr(text).lower().replace("&", " and ").replace("+", " ")
	t = re.sub(r"\(([^()]*)\)", _drop_qualifier, t)
	t = re.sub(r"[^a-z0-9]+", " ", t)
	t = f" {' '.join(t.split())} "
	for phrase, repl in PHRASES:
		t = t.replace(f" {phrase} ", f" {repl} ")
	tokens = []
	for tok in t.split():
		mapped = TOKENS.get(tok, tok)
		if mapped:
			tokens.extend(mapped.split())
	return " ".join(sorted(set(tokens)))


def _code_text(code) -> str:
	c = re.sub(r"^LAB-", "", cstr(code), flags=re.I)
	c = re.sub(r"-\d+$", "", c)
	return c.replace("-", " ")


def _specimens(norm) -> frozenset:
	return frozenset(t for t in norm.split() if t in SPECIMENS)


def _marker_clash(a, b) -> bool:
	"""True when names differ by a distinguishing marker: Troponin T/I, VLDL/LDL, IgG/IgA, Hepatitis A/E, Hepatitis (B)."""
	sa, sb = set(a.split()), set(b.split())
	only_a, only_b = sa - sb, sb - sa

	def key(tokens):
		return {t for t in tokens if len(t) <= 4 or any(ch.isdigit() for ch in t)}

	if key(only_a) and key(only_b):
		return True
	return any(len(t) == 1 or t.isdigit() for t in only_a | only_b)


def _similarity(a, b) -> float:
	if not a or not b:
		return 0.0
	if a == b:
		return 1.0
	sa, sb = set(a.split()), set(b.split())
	jaccard = len(sa & sb) / max(len(sa | sb), 1)
	ratio = difflib.SequenceMatcher(None, a, b).ratio()
	score = max(jaccard, ratio)
	small = sa if len(sa) <= len(sb) else sb
	if (sa <= sb or sb <= sa) and (len(small) >= 2 or (len(next(iter(small))) >= 4 and not small & SPECIMENS)):
		score = max(score, REVIEW + 0.05)  # every word of one name is in the other: offer for review only
	return round(score, 3)


def _read_competitor_csv(path) -> list[dict[str, Any]]:
	with open(path, encoding="utf-8-sig") as fh:
		rows = []
		for r in csv.DictReader(fh):
			rows.append({"sl": cint(r.get("sl")), "name": cstr(r.get("name")).strip(), "rate": flt(r.get("rate"))})
	return rows


def _orange_billing_by_item():
	out = {}
	for r in frappe.get_all(
		RATE_DT,
		filters={"tier": TIER_ORANGE, "active": 1},
		fields=["item_code", "billing_rate"],
		limit_page_length=0,
	):
		if flt(r.billing_rate) > 0:
			out[r.item_code] = flt(r.billing_rate)
	return out


def _candidates():
	cands = []
	for item in _lab_items():
		names = {normalise(item.item_name or item.name), normalise(_code_text(item.name))}
		cands.append(
			{
				"code": item.name,
				"name": item.item_name or item.name,
				"group": item.item_group,
				"norms": [n for n in names if n],
			}
		)
	return cands


def match_rows(rows):
	"""Return one result dict per competitor row (same order)."""
	cands = _candidates()
	orange = _orange_billing_by_item()
	seen: dict[str, int] = {}
	out = []
	for row in rows:
		norm = normalise(row["name"])
		spec = _specimens(norm)
		scored = []
		for c in cands:
			best, best_norm = max(((_similarity(norm, n), n) for n in c["norms"]), default=(0.0, ""))
			if best >= 0.5:
				same_spec = any(_specimens(n) == spec for n in c["norms"])
				scored.append((best, same_spec, c, best_norm))
		scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
		top = scored[0] if scored else None
		charge = bool(CHARGE_RE.search(row["name"]))
		status = "New"
		if top and top[0] >= 1.0:
			status = "Exact"
		elif top and top[0] >= HIGH:
			status = "High"
		elif top and top[0] >= REVIEW:
			status = "Review"
		reason = ""
		if status in ("Exact", "High") and top and not top[1]:
			status, reason = "Review", "specimen differs"
		elif status == "High" and _marker_clash(norm, top[3]):
			status, reason = "Review", "marker differs"
		elif status in ("Exact", "High") and len(scored) > 1 and scored[1][0] >= top[0] - 0.001 and scored[1][1]:
			status, reason = "Review", "several of our items match"
		if charge and status in ("New", "Review"):
			status = "Charge"
		if norm in seen:
			status = "Duplicate"
		else:
			seen[norm] = row["sl"]
		match = top[2] if top and status in ("Exact", "High", "Review", "Duplicate") else None
		if status == "Charge" and top and top[0] >= 1.0:
			match = top[2]
		current = orange.get(match["code"]) if match else None
		if status == "Duplicate":
			action = f"Duplicate of SL {seen[norm]}"
		elif status == "Review":
			action = f"Review: {reason}" if reason else "Review"
		elif match:
			action = "Keep existing" if current else "Update"
		elif status == "Charge":
			action = "Create charge"
		else:
			action = "Create new"
		alternatives = "; ".join(f"{c['code']} ({s:.2f})" for s, _ok, c, _n in scored[1:4])
		out.append(
			{
				"sl": row["sl"],
				"name": row["name"],
				"rate": row["rate"],
				"orange": orange_rate(row["rate"]),
				"status": status,
				"code": match["code"] if match else "",
				"item_name": match["name"] if match else "",
				"score": top[0] if top else 0.0,
				"alternatives": alternatives,
				"current_orange": current,
				"action": action,
				"final_code": match["code"] if match and status in ("Exact", "High", "Review", "Charge") else "",
				"approve": "N" if status in ("Review", "Duplicate") else "Y",
			}
		)
	by_code: dict[str, list[dict]] = {}
	for r in out:
		if r["approve"] == "Y" and r["final_code"]:
			by_code.setdefault(r["final_code"], []).append(r)
	for code, claims in by_code.items():
		if len(claims) > 1:
			for r in claims:
				others = ", ".join(str(o["sl"]) for o in claims if o is not r)
				r.update(status="Review", action=f"Review: same item as SL {others}", approve="N")
	return out


def build_competitor_review(csv_path, out_path=None):
	"""Read-only: write the review workbook and return a summary."""
	from frappe.utils.xlsxutils import make_xlsx

	rows = _read_competitor_csv(csv_path)
	results = match_rows(rows)
	data = [HEADERS]
	for r in results:
		data.append(
			[
				r["sl"],
				r["name"],
				r["rate"],
				r["orange"],
				r["status"],
				r["code"],
				r["item_name"],
				r["score"],
				r["alternatives"],
				r["current_orange"] if r["current_orange"] is not None else "",
				r["action"],
				r["final_code"],
				r["approve"],
			]
		)
	xlsx = make_xlsx(data, "Competitor Review", column_widths=[6, 44, 12, 14, 11, 34, 40, 8, 60, 14, 22, 34, 9])
	if out_path:
		with open(out_path, "wb") as fh:
			fh.write(xlsx.getvalue())
		with open(re.sub(r"\.xlsx$", "", out_path) + ".csv", "w", encoding="utf-8", newline="") as fh:
			csv.writer(fh).writerows(data)
	summary: dict[str, int] = {}
	for r in results:
		summary[r["status"]] = summary.get(r["status"], 0) + 1
	actions: dict[str, int] = {}
	for r in results:
		key = re.sub(r"( of SL| as SL) .*$", "", r["action"])
		actions[key] = actions.get(key, 0) + 1
	frappe.db.rollback()
	return {
		"rows": len(results),
		"status": summary,
		"actions": actions,
		"out_path": out_path,
		"spot": {
			r["name"]: {"status": r["status"], "code": r["code"], "score": r["score"], "action": r["action"]}
			for r in results
			if r["name"]
			in (
				"Sugar F",
				"SGOT AST",
				"CBC (complete Blood Count)",
				"Vitamin B12",
				"HBA1C(HPLC METHOD)",
				"ADA-Adenosine Deaminase (BLOOD)",
				"ADA-Adenosine Deaminase (FLUID)",
				"AMYLASE(FLUID)",
			)
		},
	}


# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------


def _ensure_group(name):
	if frappe.db.exists("Item Group", name):
		return name
	parent = "All Item Groups" if frappe.db.exists("Item Group", "All Item Groups") else None
	frappe.get_doc({"doctype": "Item Group", "item_group_name": name, "parent_item_group": parent, "is_group": 0}).insert(
		ignore_permissions=True
	)
	return name


def _new_item_code(name):
	base = "LAB-" + re.sub(r"[^A-Z0-9]+", "-", cstr(name).upper()).strip("-")
	base = base[:120].rstrip("-") or "LAB-NEW-TEST"
	code = base
	n = 2
	while frappe.db.exists("Item", code):
		code = f"{base}-{n}"
		n += 1
	return code


def _create_item(name, group):
	uom = "Nos" if frappe.db.exists("UOM", "Nos") else (frappe.db.get_value("UOM", {}, "name") or "Nos")
	code = _new_item_code(name)
	frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": code,
			"item_name": cstr(name)[:140],
			"description": cstr(name),
			"item_group": group,
			"stock_uom": uom,
			"is_stock_item": 0,
			"is_sales_item": 1,
			"include_item_in_manufacturing": 0,
			"standard_rate": 0,
		}
	).insert(ignore_permissions=True)
	return code


def _set_orange_billing(code, rate):
	"""Set Orange FOCO billing only; other tiers untouched (partial chart row, off the circuit)."""
	name = frappe.db.get_value(RATE_DT, {"item_code": code, "tier": TIER_ORANGE}, "name")
	if name:
		frappe.db.set_value(RATE_DT, name, {"billing_rate": rate, "active": 1})
	else:
		frappe.get_doc(
			{"doctype": RATE_DT, "item_code": code, "tier": TIER_ORANGE, "billing_rate": rate, "platform_fee": 0, "active": 1}
		).insert(ignore_permissions=True)


REVIEW_SHEET = "Competitor Review"


def _sheet_records(path):
	if cstr(path).lower().endswith(".csv"):
		with open(path, encoding="utf-8-sig") as fh:
			sheet = [list(r) for r in csv.reader(io.StringIO(fh.read()))]
	else:
		from openpyxl import load_workbook

		wb = load_workbook(path, read_only=True, data_only=True)
		ws = wb[REVIEW_SHEET] if REVIEW_SHEET in wb.sheetnames else wb.active
		sheet = [list(r) for r in ws.iter_rows(values_only=True)]
		wb.close()
	sheet = [r for r in sheet if any(cstr(c).strip() for c in (r or []) if c is not None)]
	sheet = [[("" if c is None else c) for c in r] for r in sheet]
	head = [cstr(h).strip() for h in sheet[0]]
	missing = [h for h in ("SL", "Competitor Name", "Competitor Rate", "Final Item Code", "Approve") if h not in head]
	if missing:
		frappe.throw(f"Review sheet is missing columns: {', '.join(missing)}")
	return [dict(zip(head, r)) for r in sheet[1:]]


STATUS_RANK = {"exact": 0, "high": 1}


def apply_competitor_review(path, dry_run=1, log_path=None, statuses=None, overwrite=0):
	"""Apply approved review rows. dry_run=1 reports what would happen without writing.
	statuses: optional comma list (e.g. "Exact,High") — rows with any other Status are skipped.
	overwrite=1: replace an existing Orange billing with the sheet rate, except on tests already on the circuit.
	When several rows name the same item, Exact rows win over High, and High over the rest."""
	from frappe.utils.xlsxutils import make_xlsx

	dry = bool(cint(dry_run))
	if not dry:
		ensure_partner_tier_setup()
	records = _sheet_records(path)
	only = {s.strip().lower() for s in cstr(statuses).split(",") if s.strip()}
	orange = _orange_billing_by_item()
	done: dict[str, float] = {}
	report = {"rows": len(records), "statuses": sorted(only) or "all", "approved": 0, "updated": 0, "kept": 0, "created_tests": 0, "created_charges": 0, "skipped": 0, "duplicates": 0, "errors": [], "dry_run": dry}
	log = [["SL", "Competitor Name", "Orange Billing", "Item Code", "Result"]]
	check = {"approved_by_status": {}, "code_changed": [], "rate_edited": [], "kept_but_sheet_differs": [], "approved_review_rows": 0}
	for rec in records:
		if cstr(rec.get("Approve")).strip().lower() not in ("y", "yes", "1", "true"):
			continue
		st = cstr(rec.get("Status")).strip() or "?"
		check["approved_by_status"][st] = check["approved_by_status"].get(st, 0) + 1
		ours, final = cstr(rec.get("Our Item Code")).strip(), cstr(rec.get("Final Item Code")).strip()
		if ours != final:
			check["code_changed"].append([cint(rec.get("SL")), ours, final])
		proposed = flt(rec.get("Proposed Orange Billing"))
		if proposed and abs(proposed - orange_rate(rec.get("Competitor Rate"))) > 0.005:
			check["rate_edited"].append([cint(rec.get("SL")), flt(rec.get("Competitor Rate")), proposed])
		if final and orange.get(final) and proposed and abs(orange[final] - proposed) > 0.005:
			check["kept_but_sheet_differs"].append([cint(rec.get("SL")), final, orange[final], proposed])
	report["check"] = check
	replace = bool(cint(overwrite))
	from health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers import _all_tier_rates

	protected = set(_all_tier_rates().keys())
	report["overwritten"] = 0
	report["protected"] = sorted(protected)
	records = sorted(records, key=lambda r: (STATUS_RANK.get(cstr(r.get("Status")).strip().lower(), 2), cint(r.get("SL"))))
	# Dry runs perform every write too and roll back at the end, so Item validation is exercised.
	_ensure_group(PENDING_GROUP)
	_ensure_group(CHARGES_GROUP)
	for rec in records:
		sl = cint(rec.get("SL"))
		name = cstr(rec.get("Competitor Name")).strip()
		if only and cstr(rec.get("Status")).strip().lower() not in only:
			report["skipped"] += 1
			log.append([sl, name, "", cstr(rec.get("Final Item Code")), f"Skipped (status {cstr(rec.get('Status'))} not in this run)"])
			continue
		if cstr(rec.get("Approve")).strip().lower() not in ("y", "yes", "1", "true"):
			report["skipped"] += 1
			log.append([sl, name, "", cstr(rec.get("Final Item Code")), "Skipped (not approved)"])
			continue
		report["approved"] += 1
		rate = flt(rec.get("Proposed Orange Billing")) or orange_rate(rec.get("Competitor Rate"))
		code = cstr(rec.get("Final Item Code")).strip()
		status = cstr(rec.get("Status")).strip()
		frappe.db.savepoint("p128_row")
		try:
			if rate <= 0:
				raise frappe.ValidationError("No rate")
			if code:
				if not frappe.db.exists("Item", code):
					raise frappe.ValidationError(f"Item {code} not found")
				if code in done:
					report["duplicates"] += 1
					note = "Duplicate (already applied)" + ("" if done[code] == rate else f"; rate conflict {done[code]} vs {rate}")
					log.append([sl, name, rate, code, note])
					continue
				done[code] = rate
				if orange.get(code) and (not replace or code in protected or abs(orange[code] - rate) <= 0.005):
					report["kept"] += 1
					why = "on the circuit" if code in protected and replace else "existing"
					log.append([sl, name, orange[code], code, f"Kept existing Orange billing ({why})"])
					continue
				if orange.get(code):
					_set_orange_billing(code, rate)
					report["overwritten"] += 1
					log.append([sl, name, rate, code, f"Orange billing changed {orange[code]} -> {rate}"])
					continue
				_set_orange_billing(code, rate)
				report["updated"] += 1
				log.append([sl, name, rate, code, "Orange billing set"])
			elif status == "Duplicate":
				report["duplicates"] += 1
				log.append([sl, name, rate, "", "Duplicate line without an item code: skipped"])
			else:
				charge = status == "Charge" or bool(CHARGE_RE.search(name))
				group = CHARGES_GROUP if charge else PENDING_GROUP
				new_code = _create_item(name, group)
				_set_orange_billing(new_code, rate)
				report["created_charges" if charge else "created_tests"] += 1
				log.append([sl, name, rate, new_code, f"Created in {group}"])
		except Exception as exc:
			frappe.db.rollback(save_point="p128_row")
			report["errors"].append({"sl": sl, "name": name, "error": cstr(exc)[:200]})
			log.append([sl, name, rate, code, f"Error: {cstr(exc)[:150]}"])
	if dry:
		frappe.db.rollback()
	else:
		frappe.db.commit()
		clear_tier_caches()
	log = log[:1] + sorted(log[1:], key=lambda r: cint(r[0]))
	if log_path:
		with open(log_path, "wb") as fh:
			fh.write(make_xlsx(log, "Apply Log").getvalue())
	report["ok"] = not report["errors"]
	return report
