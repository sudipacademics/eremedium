"""Phase 136 — goals, habit tips and the lifestyle & medication manager of the patient vault.

- Health Goal (weight, fasting glucose, HbA1c, blood pressure, daily activity minutes, yoga streak) with Goal Progress
  Entry rows from manual entry, lab analytes (EMR Analyte Point), Patient Vital Log, tutorial progress and checklist
  completions. Progress %, current value and streaks are computed here, never in the browser.
- Habit Tip library (ops editable; the seed only inserts missing tips) with trigger rules on active goals, recent analyte
  flags, active medicines / routines or "always"; min_interval_days per tip and patient. One in-app tip a day per
  profile (Patient Tip Delivery); WhatsApp only for profiles that opted in. Every tip is general wellness guidance.
- Medication Schedule rows are created from signed Uber Doc e-Rx medicines and Remedium Clinical Prescriptions
  (frequency / duration parsed conservatively; unknown patterns are flagged for the patient to set times), Dose Log
  rows record Taken / Skipped / Missed, and a nightly job marks unlogged doses Missed. Routine Item rows come from e-Rx
  exercise / yoga plans and active Tutorial Enrollments (deep link back to the Uber Doc programme).

Scheduler code runs in worker containers, so module-level imports stay limited to frappe and phase 132.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta
from typing import NoReturn

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, get_datetime, getdate, now_datetime, today

from health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations import PATIENT_DT, _ensure_doctype, _perms, _sel

MODULE_PATH = "health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle"
GOAL_DT = "Health Goal"
ENTRY_DT = "Goal Progress Entry"
TIP_DT = "Habit Tip"
TIP_DELIVERY_DT = "Patient Tip Delivery"
SCHEDULE_DT = "Medication Schedule"
DOSE_DT = "Dose Log"
ROUTINE_DT = "Routine Item"
ROUTINE_LOG_DT = "Routine Log"
REMINDER_DT = "Vault Reminder Log"
POINT_DT = "EMR Analyte Point"
VITAL_DT = "Patient Vital Log"
RX_DT = "Digital Prescription"
CP_DT = "Clinical Prescription"
ENROLL_DT = "Tutorial Enrollment"
PROGRAM_DT = "Tutorial Program"
PROFILE_DT = "Patient Vault Profile"

GOAL_TYPES = ("Weight", "Fasting Glucose", "HbA1c", "Blood Pressure", "Daily Activity", "Yoga Streak")
GOAL_META = {
	"Weight": {"unit": "kg", "lo": 10, "hi": 300},
	"Fasting Glucose": {"unit": "mg/dL", "lo": 40, "hi": 600, "analyte": "glucose_fasting"},
	"HbA1c": {"unit": "%", "lo": 3, "hi": 20, "analyte": "hba1c"},
	"Blood Pressure": {"unit": "mmHg", "lo": 60, "hi": 260, "lo2": 30, "hi2": 160},
	"Daily Activity": {"unit": "min/day", "lo": 5, "hi": 600},
	"Yoga Streak": {"unit": "days", "lo": 1, "hi": 365},
}
VALUE_GOALS = ("Weight", "Fasting Glucose", "HbA1c", "Blood Pressure")
STREAK_GOALS = ("Daily Activity", "Yoga Streak")
GOAL_STATUSES = ("Active", "Achieved", "Paused", "Archived")
OPEN_GOAL_STATUSES = ("Active", "Achieved", "Paused")
ENTRY_SOURCES = ("Manual", "Lab Report", "Vital Log", "Tutorial", "Device", "Checklist")
TIP_CATEGORIES = ("Hydration", "Movement", "Sleep", "Nutrition", "Stress", "Sunlight", "Medication", "Check-ups", "General")
TIP_DISCLAIMER = "General wellness guidance, not medical advice. Follow your doctor's advice."
SCHEDULE_STATUSES = ("Active", "Completed", "Stopped")
DOSE_STATUSES = ("Taken", "Skipped", "Missed")
ROUTINE_CATEGORIES = ("Yoga", "Exercise", "Physio", "Other")
REMINDER_STATUSES = ("Queued", "Sent", "Failed", "Muted")
TIME_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
SLOTS3 = ("08:00", "14:00", "21:00")
SLOTS4 = ("08:00", "13:00", "18:00", "22:00")
FOOD_TIMINGS = (
	("Before Food", r"\b(before\s+(food|meals?|breakfast|lunch|dinner)|empty\s+stomach|a\.?c\.?)\b"),
	("After Food", r"\b(after\s+(food|meals?|breakfast|lunch|dinner)|p\.?c\.?)\b"),
	("With Food", r"\bwith\s+(food|meals?)\b"),
)
NUMBER_WORDS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "ten": 10, "fourteen": 14, "fifteen": 15, "thirty": 30}
MAX_TIMES = 8
LOG_BACK_DAYS = 7
MISSED_BACK_DAYS = 3
REMINDER_WINDOW_MINUTES = 15
BACKFILL_DAYS = 60
FEED_BACK_DAYS = 60


def _fail(message) -> NoReturn:
	raise frappe.ValidationError(message)


def _deny(message) -> NoReturn:
	raise frappe.PermissionError(message)


def _missing(message) -> NoReturn:
	raise frappe.DoesNotExistError(message)


def _has_field(doctype, fieldname):
	try:
		return bool(frappe.db.exists("DocType", doctype)) and frappe.get_meta(doctype).has_field(fieldname)
	except Exception:
		return False


def _day(value=None):
	return getdate(value) if value else getdate(today())


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


def _patient_field(**over):
	"""A fresh dict per DocType: frappe.get_doc annotates the child dicts it is given."""
	return {"fieldname": "patient", "label": "Patient", "fieldtype": "Link", "options": PATIENT_DT, "reqd": 1, "in_list_view": 1, "in_standard_filter": 1, "search_index": 1, **over}


def _doctype_specs():
	managers = ("System Manager", "Health System Admin")
	return [
		(
			GOAL_DT,
			[
				_patient_field(),
				{"fieldname": "goal_type", "label": "Goal", "fieldtype": "Select", "options": _sel(GOAL_TYPES), "reqd": 1, "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "title", "label": "Title", "fieldtype": "Data"},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(GOAL_STATUSES), "default": "Active", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "unit", "label": "Unit", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "baseline_value", "label": "Baseline", "fieldtype": "Float", "precision": "2"},
				{"fieldname": "baseline_value_2", "label": "Baseline (diastolic)", "fieldtype": "Float", "precision": "2"},
				{"fieldname": "has_baseline", "label": "Has Baseline", "fieldtype": "Check", "default": "0"},
				{"fieldname": "target_value", "label": "Target", "fieldtype": "Float", "precision": "2", "reqd": 1},
				{"fieldname": "target_value_2", "label": "Target (diastolic)", "fieldtype": "Float", "precision": "2"},
				{"fieldname": "start_date", "label": "Start Date", "fieldtype": "Date"},
				{"fieldname": "target_date", "label": "Target Date", "fieldtype": "Date"},
				{"fieldname": "current_value", "label": "Current", "fieldtype": "Float", "precision": "2", "read_only": 1},
				{"fieldname": "current_value_2", "label": "Current (diastolic)", "fieldtype": "Float", "precision": "2", "read_only": 1},
				{"fieldname": "has_current", "label": "Has Current", "fieldtype": "Check", "default": "0", "read_only": 1},
				{"fieldname": "progress_pct", "label": "Progress %", "fieldtype": "Float", "precision": "1", "read_only": 1, "in_list_view": 1},
				{"fieldname": "streak_days", "label": "Current Streak", "fieldtype": "Int", "read_only": 1},
				{"fieldname": "best_streak", "label": "Best Streak", "fieldtype": "Int", "read_only": 1},
				{"fieldname": "last_entry_on", "label": "Last Entry", "fieldtype": "Date", "read_only": 1},
				{"fieldname": "achieved_on", "label": "Achieved On", "fieldtype": "Date", "read_only": 1},
				{"fieldname": "auto_feed", "label": "Fill From Reports / Vitals / Checklist", "fieldtype": "Check", "default": "1"},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
				{"fieldname": "created_by_user", "label": "Created By", "fieldtype": "Link", "options": "User", "read_only": 1},
			],
			_perms(managers, ()),
			{"title_field": "title"},
		),
		(
			ENTRY_DT,
			[
				{"fieldname": "goal", "label": "Goal", "fieldtype": "Link", "options": GOAL_DT, "reqd": 1, "in_list_view": 1, "search_index": 1},
				_patient_field(reqd=0),
				{"fieldname": "entry_date", "label": "Date", "fieldtype": "Date", "reqd": 1, "in_list_view": 1},
				{"fieldname": "value", "label": "Value", "fieldtype": "Float", "precision": "2", "in_list_view": 1},
				{"fieldname": "has_value", "label": "Has Value", "fieldtype": "Check", "default": "0"},
				{"fieldname": "value_2", "label": "Value 2 (diastolic)", "fieldtype": "Float", "precision": "2"},
				{"fieldname": "has_value_2", "label": "Has Value 2", "fieldtype": "Check", "default": "0"},
				{"fieldname": "source", "label": "Source", "fieldtype": "Select", "options": _sel(ENTRY_SOURCES), "default": "Manual", "in_list_view": 1},
				{"fieldname": "source_doctype", "label": "Source DocType", "fieldtype": "Link", "options": "DocType", "read_only": 1},
				{"fieldname": "source_name", "label": "Source", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "source_key", "label": "Source Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
				{"fieldname": "notes", "label": "Notes", "fieldtype": "Small Text"},
			],
			_perms(managers, ()),
			{"sort_field": "entry_date", "sort_order": "DESC"},
		),
		(
			TIP_DT,
			[
				{"fieldname": "tip_key", "label": "Tip Key", "fieldtype": "Data", "reqd": 1, "unique": 1, "in_list_view": 1},
				{"fieldname": "title", "label": "Title", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "body", "label": "Tip", "fieldtype": "Small Text", "reqd": 1},
				{"fieldname": "category", "label": "Category", "fieldtype": "Select", "options": _sel(TIP_CATEGORIES), "default": "General", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "trigger_json", "label": "Trigger Rules", "fieldtype": "Code", "options": "JSON", "description": 'e.g. {"always": true} or {"goals": ["Blood Pressure"], "analytes": [{"key": "glucose_fasting", "flags": ["H"]}], "medications": true}'},
				{"fieldname": "min_interval_days", "label": "Minimum Days Between Repeats", "fieldtype": "Int", "default": "7"},
				{"fieldname": "priority", "label": "Priority", "fieldtype": "Int", "default": "0"},
				{"fieldname": "active", "label": "Active", "fieldtype": "Check", "default": "1", "in_list_view": 1},
				{"fieldname": "source", "label": "Source", "fieldtype": "Select", "options": "Operations\nSeed", "default": "Operations", "read_only": 1},
			],
			_perms(managers, ()),
			{"naming_rule": "By fieldname", "title_field": "title"},
		),
		(
			TIP_DELIVERY_DT,
			[
				_patient_field(),
				{"fieldname": "tip", "label": "Tip", "fieldtype": "Link", "options": TIP_DT, "reqd": 1, "in_list_view": 1},
				{"fieldname": "tip_title", "label": "Tip Title", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "delivered_on", "label": "Date", "fieldtype": "Date", "in_list_view": 1, "search_index": 1},
				{"fieldname": "channel", "label": "Channel", "fieldtype": "Select", "options": "App\nWhatsApp", "default": "App", "in_list_view": 1},
				{"fieldname": "reason", "label": "Why This Tip", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Shown\nQueued\nSent\nFailed\nMuted", "default": "Shown", "in_list_view": 1},
				{"fieldname": "error", "label": "Error", "fieldtype": "Small Text", "read_only": 1},
				{"fieldname": "helpful", "label": "Helpful", "fieldtype": "Select", "options": "\nYes\nNo"},
				{"fieldname": "delivery_key", "label": "Delivery Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
			],
			_perms((), managers),
			{"in_create": 1, "sort_field": "creation", "sort_order": "DESC"},
		),
		(
			SCHEDULE_DT,
			[
				_patient_field(),
				{"fieldname": "drug_name", "label": "Medicine", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "strength", "label": "Strength", "fieldtype": "Data"},
				{"fieldname": "dose", "label": "Dose", "fieldtype": "Data"},
				{"fieldname": "frequency_text", "label": "Frequency (as prescribed)", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "duration_text", "label": "Duration (as prescribed)", "fieldtype": "Data"},
				{"fieldname": "route", "label": "Route", "fieldtype": "Data"},
				{"fieldname": "timing", "label": "Food Timing", "fieldtype": "Data"},
				{"fieldname": "instructions", "label": "Instructions", "fieldtype": "Data"},
				{"fieldname": "times", "label": "Dose Times (HH:MM, comma separated)", "fieldtype": "Data"},
				{"fieldname": "times_custom", "label": "Times Set By Patient", "fieldtype": "Check", "default": "0"},
				{"fieldname": "as_needed", "label": "As Needed (SOS)", "fieldtype": "Check", "default": "0"},
				{"fieldname": "every_n_days", "label": "Every N Days", "fieldtype": "Int", "default": "1"},
				{"fieldname": "start_date", "label": "Start", "fieldtype": "Date", "in_list_view": 1},
				{"fieldname": "end_date", "label": "End", "fieldtype": "Date", "in_list_view": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(SCHEDULE_STATUSES), "default": "Active", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "needs_review", "label": "Patient Should Confirm Times", "fieldtype": "Check", "default": "0"},
				{"fieldname": "reminders", "label": "Reminders", "fieldtype": "Check", "default": "1"},
				{"fieldname": "prescriber", "label": "Prescriber", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "source_doctype", "label": "Source DocType", "fieldtype": "Link", "options": "DocType", "read_only": 1},
				{"fieldname": "source_name", "label": "Source", "fieldtype": "Data", "read_only": 1, "search_index": 1},
				{"fieldname": "source_row", "label": "Source Row", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "schedule_key", "label": "Schedule Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
				{"fieldname": "stop_reason", "label": "Stop Reason", "fieldtype": "Small Text"},
			],
			_perms(managers, ()),
			{"title_field": "drug_name"},
		),
		(
			DOSE_DT,
			[
				{"fieldname": "schedule", "label": "Medication Schedule", "fieldtype": "Link", "options": SCHEDULE_DT, "reqd": 1, "in_list_view": 1, "search_index": 1},
				_patient_field(reqd=0),
				{"fieldname": "dose_date", "label": "Date", "fieldtype": "Date", "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "slot_time", "label": "Time", "fieldtype": "Data", "in_list_view": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(DOSE_STATUSES), "reqd": 1, "in_list_view": 1},
				{"fieldname": "logged_at", "label": "Logged At", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "source", "label": "Source", "fieldtype": "Select", "options": "Patient\nMissed Job", "default": "Patient"},
				{"fieldname": "dose_key", "label": "Dose Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
			],
			_perms((), managers),
			{"sort_field": "dose_date", "sort_order": "DESC"},
		),
		(
			ROUTINE_DT,
			[
				_patient_field(),
				{"fieldname": "title", "label": "Practice", "fieldtype": "Data", "reqd": 1, "in_list_view": 1},
				{"fieldname": "category", "label": "Category", "fieldtype": "Select", "options": _sel(ROUTINE_CATEGORIES), "default": "Exercise", "in_list_view": 1},
				{"fieldname": "details", "label": "Details", "fieldtype": "Data"},
				{"fieldname": "frequency_text", "label": "Frequency (as prescribed)", "fieldtype": "Data"},
				{"fieldname": "minutes", "label": "Minutes", "fieldtype": "Int"},
				{"fieldname": "tutorial_program", "label": "Tutorial Programme", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "tutorial_enrollment", "label": "Tutorial Enrollment", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "start_date", "label": "Start", "fieldtype": "Date"},
				{"fieldname": "end_date", "label": "End", "fieldtype": "Date"},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(SCHEDULE_STATUSES), "default": "Active", "in_list_view": 1},
				{"fieldname": "prescriber", "label": "Assigned By", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "source_doctype", "label": "Source DocType", "fieldtype": "Link", "options": "DocType", "read_only": 1},
				{"fieldname": "source_name", "label": "Source", "fieldtype": "Data", "read_only": 1, "search_index": 1},
				{"fieldname": "source_row", "label": "Source Row", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "item_key", "label": "Item Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
			],
			_perms(managers, ()),
			{"title_field": "title"},
		),
		(
			ROUTINE_LOG_DT,
			[
				{"fieldname": "routine_item", "label": "Routine Item", "fieldtype": "Link", "options": ROUTINE_DT, "reqd": 1, "in_list_view": 1, "search_index": 1},
				_patient_field(reqd=0),
				{"fieldname": "done_date", "label": "Date", "fieldtype": "Date", "reqd": 1, "in_list_view": 1, "search_index": 1},
				{"fieldname": "minutes", "label": "Minutes", "fieldtype": "Int"},
				{"fieldname": "logged_at", "label": "Logged At", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "log_key", "label": "Log Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
			],
			_perms((), managers),
			{"sort_field": "done_date", "sort_order": "DESC"},
		),
		(
			REMINDER_DT,
			[
				_patient_field(),
				{"fieldname": "kind", "label": "Kind", "fieldtype": "Select", "options": "Dose\nTip\nRoutine", "in_list_view": 1},
				{"fieldname": "message", "label": "Message", "fieldtype": "Small Text", "read_only": 1},
				{"fieldname": "mobile", "label": "Mobile", "fieldtype": "Data", "read_only": 1},
				{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": _sel(REMINDER_STATUSES), "default": "Queued", "in_list_view": 1, "in_standard_filter": 1},
				{"fieldname": "error", "label": "Error", "fieldtype": "Small Text", "read_only": 1},
				{"fieldname": "sent_at", "label": "Sent At", "fieldtype": "Datetime", "read_only": 1},
				{"fieldname": "reminder_key", "label": "Reminder Key", "fieldtype": "Data", "unique": 1, "read_only": 1, "hidden": 1},
			],
			_perms((), managers),
			{"in_create": 1, "sort_field": "creation", "sort_order": "DESC"},
		),
	]


def ensure_lifestyle_setup():
	created = []
	for name, fields, perms, extra in _doctype_specs():
		autoname = "field:tip_key" if name == TIP_DT else "hash"
		if _ensure_doctype(name, fields, perms, autoname=autoname, extra=extra):
			created.append(name)
	return created


# ---------------------------------------------------------------------------
# Habit tip seed (general wellness only: no dosing, diagnosis or outcome claims)
# ---------------------------------------------------------------------------

_GLUCOSE_RULE = {"goals": ["Fasting Glucose", "HbA1c"], "analytes": [{"key": "glucose_fasting", "flags": ["H"]}, {"key": "hba1c", "flags": ["H"]}]}
SEED_TIPS = (
	("hydration-bottle", "Keep water within reach", "Keep a filled water bottle where you work and sip through the day. If your doctor has asked you to limit fluids, follow that advice.", "Hydration", {"always": True}, 7, 0),
	("hydration-morning", "Start the day with water", "A glass of water when you wake up is an easy habit to build on. Pair it with something you already do every morning.", "Hydration", {"always": True}, 10, 0),
	("walk-after-meals", "A short walk after meals", "A gentle 10 to 15 minute walk after a main meal is a simple way to add movement to your day.", "Movement", {"goals": ["Fasting Glucose", "HbA1c", "Weight", "Daily Activity"], "analytes": _GLUCOSE_RULE["analytes"]}, 5, 3),
	("stand-every-hour", "Stand up every hour", "If you sit for long stretches, stand up and move for a minute or two every hour. A phone reminder can help.", "Movement", {"always": True}, 7, 0),
	("stairs-one-floor", "Take the stairs for one floor", "Where it is safe for you, take the stairs for one floor instead of the lift, and build up slowly.", "Movement", {"goals": ["Weight", "Daily Activity"]}, 7, 1),
	("movement-snacks", "Try movement snacks", "Short bursts of activity count: a few minutes of brisk walking or stretching between tasks adds up over the day.", "Movement", {"goals": ["Daily Activity", "Weight"]}, 6, 2),
	("vegetable-each-meal", "Add a vegetable to each meal", "Try to include at least one vegetable with every main meal. Seasonal, local vegetables are an easy place to start.", "Nutrition", {"always": True}, 7, 0),
	("whole-grains", "Choose whole grains when you can", "Whole grains such as brown rice, millets, whole-wheat roti and oats keep more of their natural fibre than refined versions.", "Nutrition", {"goals": ["Fasting Glucose", "HbA1c", "Weight"], "analytes": _GLUCOSE_RULE["analytes"]}, 7, 2),
	("swap-sugary-drink", "Swap one sugary drink", "Replace one sweetened drink a day with water, buttermilk without sugar or plain tea.", "Nutrition", {"goals": ["Fasting Glucose", "HbA1c", "Weight"], "analytes": _GLUCOSE_RULE["analytes"]}, 7, 3),
	("fruit-whole", "Eat fruit whole", "Whole fruit keeps its fibre, while juice does not. If you are watching your blood sugar, ask your doctor which fruits suit you.", "Nutrition", {"goals": ["Fasting Glucose", "HbA1c"], "analytes": _GLUCOSE_RULE["analytes"]}, 10, 2),
	("smaller-plate", "Use a smaller plate", "Serving meals on a smaller plate is a simple way to notice portion sizes without counting anything.", "Nutrition", {"goals": ["Weight"]}, 10, 2),
	("taste-before-salt", "Taste before you add salt", "Taste your food before adding salt at the table, and keep the salt shaker off the dining table.", "Nutrition", {"goals": ["Blood Pressure"]}, 7, 3),
	("label-sodium", "Check labels for salt", "Pickles, papad, packaged snacks and instant foods can be high in salt. Check the sodium on labels and choose lower options.", "Nutrition", {"goals": ["Blood Pressure"]}, 10, 2),
	("fried-food-less", "Go easy on fried foods", "Choose steamed, grilled or roasted options more often than deep-fried ones, and reuse frying oil less.", "Nutrition", {"analytes": [{"key": "cholesterol_total", "flags": ["H"]}, {"key": "ldl_cholesterol", "flags": ["H"]}, {"key": "triglycerides", "flags": ["H"]}], "goals": ["Weight"]}, 10, 2),
	("iron-rich-foods", "Include iron-rich foods", "Green leafy vegetables, lentils, beans and dates are common sources of iron. Ask your doctor before starting any supplement.", "Nutrition", {"analytes": [{"key": "haemoglobin", "flags": ["L"]}]}, 10, 3),
	("sleep-regular", "Keep a regular sleep time", "Going to bed and waking up at about the same time each day, including weekends, helps build a steady routine.", "Sleep", {"always": True}, 7, 0),
	("screens-off", "Wind down without screens", "Put phones and screens away for the last half hour before bed and try reading or quiet music instead.", "Sleep", {"always": True}, 7, 0),
	("caffeine-cutoff", "Have tea or coffee earlier", "If you find it hard to fall asleep, try having your last tea or coffee by mid-afternoon.", "Sleep", {"always": True}, 10, 0),
	("slow-breathing", "Two minutes of slow breathing", "Sit comfortably, breathe in slowly through your nose and breathe out a little longer. Two calm minutes can be a good pause in a busy day.", "Stress", {"always": True}, 7, 0),
	("daylight-outside", "Step outside in daylight", "Spend a little time outdoors in daylight, ideally in the morning. Avoid strong midday sun and protect your skin.", "Sunlight", {"always": True, "analytes": [{"key": "vitamin_d", "flags": ["L"]}]}, 7, 1),
	("weigh-same-time", "Weigh yourself the same way", "For a fair comparison, weigh yourself at the same time of day, on the same scale, in similar clothing.", "Check-ups", {"goals": ["Weight"]}, 14, 2),
	("bp-same-way", "Measure your BP the same way", "Sit quietly for a few minutes, keep your arm supported at heart level, and avoid tea, coffee or exercise just before you measure.", "Check-ups", {"goals": ["Blood Pressure"]}, 14, 3),
	("discuss-flagged-results", "Discuss flagged results with your doctor", "Some values in your recent report are outside the reference range. Reference ranges are a guide; your doctor can explain what they mean for you.", "Check-ups", {"analytes": [{"key": "*", "flags": ["H", "L", "C"]}]}, 14, 4),
	("meds-anchor-habit", "Link medicines to a daily habit", "Taking medicines at the same time as an existing habit, like brushing your teeth, makes them easier to remember. Never change a dose without asking your doctor.", "Medication", {"medications": True}, 7, 3),
	("meds-stock-check", "Check your medicine stock weekly", "Once a week, check how many days of each medicine you have left so you can refill in time.", "Medication", {"medications": True}, 7, 2),
	("yoga-small-regular", "Small and regular beats long and rare", "A short daily practice is easier to keep up than an occasional long session. Even ten minutes counts towards your streak.", "Movement", {"goals": ["Yoga Streak"], "routine": True}, 5, 3),
	("yoga-mat-ready", "Keep your mat ready", "Leave your mat or practice space set up so starting takes no effort. Follow your instructor's guidance on what suits you.", "Movement", {"goals": ["Yoga Streak"], "routine": True}, 7, 2),
)


def seed_tips():
	"""Inserts missing seed tips only; tips already present (including ops edits) are left alone."""
	inserted = 0
	for key, title, body, category, rule, interval, priority in SEED_TIPS:
		if frappe.db.exists(TIP_DT, key):
			continue
		frappe.get_doc(
			{
				"doctype": TIP_DT,
				"tip_key": key,
				"title": title,
				"body": body,
				"category": category,
				"trigger_json": json.dumps(rule, sort_keys=True),
				"min_interval_days": interval,
				"priority": priority,
				"active": 1,
				"source": "Seed",
			}
		).insert(ignore_permissions=True)
		inserted += 1
	return {"inserted": inserted, "total": frappe.db.count(TIP_DT), "active": frappe.db.count(TIP_DT, {"active": 1})}


# ---------------------------------------------------------------------------
# Prescription parsing
# ---------------------------------------------------------------------------


def _hours_times(n):
	start = 8 if n >= 12 else 6
	return sorted(f"{(start + k * n) % 24:02d}:00" for k in range(24 // n))


def food_timing(text, rx_timing=None):
	if rx_timing:
		return cstr(rx_timing)
	t = cstr(text).lower()
	for label, pattern in FOOD_TIMINGS:
		if re.search(pattern, t):
			return label
	return None


def parse_frequency(text, timing=None):
	"""{"times", "as_needed", "every_n_days", "single_day", "needs_review", "doses"} from 1-0-1 patterns and the usual
	abbreviations (OD / BD / TDS / QID / HS / SOS / q8h ...). Unknown wording -> no times and needs_review."""
	raw = cstr(text).strip()
	t = raw.lower().replace("\u00bd", "0.5")
	out = {"times": [], "as_needed": 0, "every_n_days": 1, "single_day": 0, "needs_review": 0, "doses": []}
	bedtime = cstr(timing) == "Bedtime"
	m = re.search(r"(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?", t)
	if m:
		qty = [float(g) for g in m.groups() if g is not None]
		slots = SLOTS4 if len(qty) == 4 else SLOTS3
		out["times"] = [s for s, q in zip(slots, qty) if q > 0]
		out["doses"] = [q for q in qty if q > 0]
		if not out["times"]:
			out["needs_review"] = 1
		return out
	words = set(re.findall(r"[a-z]+", t))
	if words & {"sos", "prn"} or re.search(r"\b(as|when|if)\s+(needed|required|necessary)\b", t):
		out["as_needed"] = 1
		return out
	m = re.search(r"\bq\s*(\d{1,2})\s*h\b|\bevery\s+(\d{1,2})\s*(?:hours?|hrs?|h)\b|\b(\d{1,2})\s*-?\s*hourly\b", t)
	if m:
		n = cint(next(g for g in m.groups() if g))
		if n in (4, 6, 8, 12, 24):
			out["times"] = _hours_times(n)
			return out
		out["needs_review"] = 1
		return out
	night = bool(words & {"hs", "bedtime", "night", "nightly"}) or bedtime
	if re.search(r"\b(twice|thrice|two|three|four|[2-6])\s*(times\s*)?(a|per|in\s+a|/)?\s*(week|wk)\b", t):
		out["needs_review"] = 1
	elif words & {"qid", "qds"} or re.search(r"\bfour\s+times\b|\b4\s*times\b", t):
		out["times"] = ["08:00", "12:00", "16:00", "20:00"]
	elif words & {"tds", "tid"} or re.search(r"\bthrice\b|\bthree\s+times\b|\b3\s*times\b", t):
		out["times"] = ["08:00", "14:00", "20:00"]
	elif words & {"bd", "bid"} or re.search(r"\btwice\b|\btwo\s+times\b|\b2\s*times\b", t):
		out["times"] = ["08:00", "20:00"]
	elif words & {"qod"} or re.search(r"\b(alternate|every\s+other)\s+days?\b", t):
		out["times"] = ["22:00" if night else "08:00"]
		out["every_n_days"] = 2
	elif re.search(r"\b(once\s+a\s+week|weekly|once\s+weekly)\b", t):
		out["times"] = ["22:00" if night else "08:00"]
		out["every_n_days"] = 7
	elif words & {"stat"}:
		out["times"] = ["08:00"]
		out["single_day"] = 1
	elif words & {"od", "qd", "daily", "once"} or re.search(r"\bonce\s+(a\s+)?day\b|\bevery\s+day\b", t):
		out["times"] = ["22:00" if night else "08:00"]
	elif night:
		out["times"] = ["22:00"]
	elif "morning" in words:
		out["times"] = ["08:00"]
	else:
		out["needs_review"] = 1
	return out


def parse_duration(text):
	"""Days, or None for ongoing / unclear wording ("continue", "as directed", a bare number)."""
	t = cstr(text).strip().lower()
	if not t or re.search(r"\b(continue|ongoing|long\s*term|lifelong|life\s*long|till\s+next\s+visit|until\s+(review|further)|as\s+directed|sos)\b", t):
		return None
	for word, n in NUMBER_WORDS.items():
		t = re.sub(rf"\b{word}\b", str(n), t)
	m = re.search(r"(\d+)\s*(days?|d|weeks?|wks?|w|months?|mo|m)\b", t)
	if not m:
		return None
	n, unit = cint(m.group(1)), m.group(2)
	days = n * (7 if unit.startswith("w") else 30 if unit.startswith("m") else 1)
	return days if 0 < days <= 730 else None


def clean_times(values):
	items = values if isinstance(values, (list, tuple)) else re.split(r"[\s,;]+", cstr(values))
	out = []
	for v in items:
		v = cstr(v).strip()
		if not v:
			continue
		m = TIME_RE.match(v)
		if not m:
			_fail(_("Times must look like 08:00"))
		hhmm = f"{int(m.group(1)):02d}:{m.group(2)}"
		if hhmm not in out:
			out.append(hhmm)
	if len(out) > MAX_TIMES:
		_fail(_("At most {0} dose times a day").format(MAX_TIMES))
	return sorted(out)


def _times(row):
	return [t for t in cstr(row.times).split(",") if TIME_RE.match(t)]


def _upsert_schedule(patient, source_doctype, source_name, source_row, drug, strength=None, dose=None, frequency=None, duration=None, route=None, timing=None, instructions=None, start=None, prescriber=None):
	key = f"{source_doctype}:{source_name}:{source_row}"
	existing = frappe.db.get_value(SCHEDULE_DT, {"schedule_key": key}, "name")
	if existing:
		return existing, False
	food = food_timing(f"{frequency or ''} {instructions or ''}", timing)
	parsed = parse_frequency(frequency, food)
	start = _day(start)
	days = 1 if parsed["single_day"] else parse_duration(duration)
	end = start + timedelta(days=days - 1) if days else None
	status = "Completed" if end and end < _day() else "Active"
	doc = frappe.get_doc(
		{
			"doctype": SCHEDULE_DT,
			"patient": patient,
			"drug_name": cstr(drug).strip()[:140] or _("Medicine"),
			"strength": cstr(strength).strip()[:140] or None,
			"dose": cstr(dose).strip()[:140] or None,
			"frequency_text": cstr(frequency).strip()[:140] or None,
			"duration_text": cstr(duration).strip()[:140] or None,
			"route": cstr(route).strip()[:40] or None,
			"timing": food,
			"instructions": cstr(instructions).strip()[:140] or None,
			"times": ",".join(parsed["times"]),
			"as_needed": parsed["as_needed"],
			"every_n_days": parsed["every_n_days"],
			"start_date": start,
			"end_date": end,
			"status": status,
			"needs_review": 1 if parsed["needs_review"] or (not days and not parsed["as_needed"] and not cstr(duration).strip()) else 0,
			"reminders": 1,
			"prescriber": cstr(prescriber).strip()[:140] or None,
			"source_doctype": source_doctype,
			"source_name": source_name,
			"source_row": source_row,
			"schedule_key": key,
		}
	)
	try:
		doc.insert(ignore_permissions=True)
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		return frappe.db.get_value(SCHEDULE_DT, {"schedule_key": key}, "name"), False
	return doc.name, True


def _routine_category(title, program_category=None, provider_category=None):
	text = cstr(title).lower()
	if program_category in ("Yoga",) or provider_category == "Yoga Instructor" or re.search(r"\b(yoga|asana|pranayama|surya|namaskar|meditation)\b", text):
		return "Yoga"
	if program_category == "Physio" or provider_category == "Physiotherapist" or re.search(r"\bphysio", text):
		return "Physio"
	return "Exercise"


def _upsert_routine(patient, source_doctype, source_name, source_row, title, category, details=None, frequency=None, minutes=None, program=None, enrollment=None, start=None, end=None, prescriber=None):
	key = f"{source_doctype}:{source_name}:{source_row}"
	existing = frappe.db.get_value(ROUTINE_DT, {"item_key": key}, "name")
	if existing:
		return existing, False
	doc = frappe.get_doc(
		{
			"doctype": ROUTINE_DT,
			"patient": patient,
			"title": cstr(title).strip()[:140] or _("Practice"),
			"category": category if category in ROUTINE_CATEGORIES else "Other",
			"details": cstr(details).strip()[:140] or None,
			"frequency_text": cstr(frequency).strip()[:140] or None,
			"minutes": cint(minutes) or None,
			"tutorial_program": program or None,
			"tutorial_enrollment": enrollment or None,
			"start_date": _day(start),
			"end_date": getdate(end) if end else None,
			"status": "Active",
			"prescriber": cstr(prescriber).strip()[:140] or None,
			"source_doctype": source_doctype,
			"source_name": source_name,
			"source_row": source_row,
			"item_key": key,
		}
	)
	try:
		doc.insert(ignore_permissions=True)
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		return frappe.db.get_value(ROUTINE_DT, {"item_key": key}, "name"), False
	return doc.name, True


def stop_from_source(source_doctype, source_name, reason):
	n = 0
	for dt in (SCHEDULE_DT, ROUTINE_DT):
		for name in frappe.get_all(dt, filters={"source_doctype": source_doctype, "source_name": source_name, "status": "Active"}, pluck="name", limit=0):
			values = {"status": "Stopped"}
			if dt == SCHEDULE_DT:
				values["stop_reason"] = cstr(reason)[:500]
			frappe.db.set_value(dt, name, values)
			n += 1
	return n


def sync_rx_schedules(name):
	"""Signed Uber Doc e-Rx -> medication schedules + exercise / yoga routine items (idempotent); cancelled -> stopped."""
	if not frappe.db.exists("DocType", SCHEDULE_DT) or not frappe.db.exists(RX_DT, name):
		return {"skipped": "not installed"}
	rx = frappe.get_doc(RX_DT, name)
	if not rx.patient or not frappe.db.exists(PATIENT_DT, rx.patient):
		return {"skipped": "no patient"}
	if rx.status == "Cancelled":
		return {"stopped": stop_from_source(RX_DT, name, _("Prescription {0} was cancelled").format(name))}
	if rx.status != "Signed":
		return {"skipped": rx.status}
	start = getdate(rx.rx_date or rx.signed_on or today())
	meds = routines = 0
	for m in rx.get("medications") or []:
		_n, created = _upsert_schedule(rx.patient, RX_DT, rx.name, m.name, m.drug_name, m.strength, m.dose, m.frequency, m.duration, m.route, m.timing, m.instructions, start, rx.provider_name)
		meds += 1 if created else 0
	for e in rx.get("exercises") or []:
		category = None
		if e.get("tutorial_program") and frappe.db.exists(PROGRAM_DT, e.tutorial_program):
			category = frappe.db.get_value(PROGRAM_DT, e.tutorial_program, "category")
		details = " · ".join(x for x in (f"{cint(e.sets)} sets" if cint(e.sets) else "", f"{cint(e.reps)} reps" if cint(e.reps) else "", f"{cint(e.duration_min)} min" if cint(e.duration_min) else "", cstr(e.notes)) if x)
		_n, created = _upsert_routine(
			rx.patient, RX_DT, rx.name, e.name, e.exercise_name, _routine_category(e.exercise_name, category, rx.provider_category), details, e.frequency, e.duration_min, e.get("tutorial_program"), None, start, rx.follow_up_date, rx.provider_name
		)
		routines += 1 if created else 0
	return {"schedules_created": meds, "routines_created": routines}


def sync_cp_schedules(name):
	"""Remedium Clinical Prescription (not an Uber Doc mirror) -> medication schedules; cancelled -> stopped."""
	if not frappe.db.exists("DocType", SCHEDULE_DT) or not frappe.db.exists(CP_DT, name):
		return {"skipped": "not installed"}
	cp = frappe.get_doc(CP_DT, name)
	if cp.get("digital_prescription") or not cp.patient or not frappe.db.exists(PATIENT_DT, cp.patient):
		return {"skipped": "mirror or no patient"}
	if cp.status == "Cancelled":
		return {"stopped": stop_from_source(CP_DT, name, _("Prescription {0} was cancelled").format(name))}
	if cp.status not in ("Submitted", "Dispensed"):
		return {"skipped": cp.status}
	created = 0
	for m in cp.get("medicines") or []:
		drug = (frappe.db.get_value("Item", m.medicine_item, "item_name") if m.get("medicine_item") else None) or m.get("medicine_item")
		_n, new = _upsert_schedule(cp.patient, CP_DT, cp.name, m.name, drug, m.get("salt"), m.get("dosage"), m.get("frequency"), m.get("duration"), m.get("route"), None, m.get("instructions"), cp.encounter_date or getdate(cp.creation), cp.doctor)
		created += 1 if new else 0
	return {"schedules_created": created}


def sync_enrollment(name):
	"""Active Tutorial Enrollment -> routine item with a link back to Uber Doc; completed / cancelled close it; yoga
	module completions feed an active Yoga Streak goal."""
	if not frappe.db.exists("DocType", ROUTINE_DT) or not frappe.db.exists(ENROLL_DT, name):
		return {"skipped": "not installed"}
	doc = frappe.get_doc(ENROLL_DT, name)
	if not doc.patient or not frappe.db.exists(PATIENT_DT, doc.patient):
		return {"skipped": "no patient"}
	key = f"{ENROLL_DT}:{name}:programme"
	item = frappe.db.get_value(ROUTINE_DT, {"item_key": key}, ["name", "status"], as_dict=True)
	category = frappe.db.get_value(PROGRAM_DT, doc.program, "category") if doc.program and frappe.db.exists(PROGRAM_DT, doc.program) else None
	if doc.status == "Active" and not item:
		_upsert_routine(doc.patient, ENROLL_DT, name, "programme", doc.program_title or doc.program, _routine_category(doc.program_title, category), _("Tutorial programme"), None, None, doc.program, name, doc.enrolled_on or doc.creation)
	elif item and doc.status in ("Completed", "Cancelled") and item.status == "Active":
		frappe.db.set_value(ROUTINE_DT, item.name, "status", "Completed" if doc.status == "Completed" else "Stopped")
	fed = 0
	if category == "Yoga":
		for goal in _auto_goals(doc.patient, ("Yoga Streak",)):
			for row in doc.get("progress") or []:
				if cint(row.completed) and row.completed_on:
					_upsert_entry(goal, getdate(row.completed_on), 1, None, "Tutorial", ENROLL_DT, name, f"{goal.name}:tut:{name}:{row.module_row}")
					fed += 1
			recompute_goal(goal.name)
	return {"enrollment": name, "fed": fed}


def on_digital_prescription_update(doc, method=None):
	try:
		if doc.status in ("Signed", "Cancelled"):
			sync_rx_schedules(doc.name)
	except Exception:
		frappe.log_error(title="phase136 e-Rx schedule hook", message=frappe.get_traceback())


def on_enrollment_update(doc, method=None):
	try:
		sync_enrollment(doc.name)
	except Exception:
		frappe.log_error(title="phase136 enrollment hook", message=frappe.get_traceback())


# ---------------------------------------------------------------------------
# Daily checklist, dose log, adherence
# ---------------------------------------------------------------------------

SCHEDULE_FIELDS = ["name", "patient", "drug_name", "strength", "dose", "frequency_text", "duration_text", "route", "timing", "instructions", "times", "times_custom", "as_needed", "every_n_days", "start_date", "end_date", "status", "needs_review", "reminders", "prescriber", "source_doctype", "source_name"]
ROUTINE_FIELDS = ["name", "patient", "title", "category", "details", "frequency_text", "minutes", "tutorial_program", "tutorial_enrollment", "start_date", "end_date", "status", "prescriber", "source_doctype", "source_name"]


def _due_on(s, day):
	start = getdate(s.start_date) if s.start_date else day
	if day < start or (s.end_date and day > getdate(s.end_date)):
		return False
	return (day - start).days % max(cint(s.every_n_days) or 1, 1) == 0


def _active_schedules(patient, day):
	rows = frappe.get_all(SCHEDULE_DT, filters={"patient": patient, "status": "Active"}, fields=SCHEDULE_FIELDS, order_by="creation asc", limit=500)
	return [r for r in rows if (not r.start_date or getdate(r.start_date) <= day) and (not r.end_date or getdate(r.end_date) >= day)]


def _schedule_out(s):
	return {
		"name": s.name,
		"drug_name": s.drug_name,
		"strength": s.strength,
		"dose": s.dose,
		"frequency_text": s.frequency_text,
		"duration_text": s.duration_text,
		"route": s.route,
		"timing": s.timing,
		"instructions": s.instructions,
		"times": _times(s),
		"times_custom": cint(s.times_custom),
		"as_needed": cint(s.as_needed),
		"every_n_days": cint(s.every_n_days) or 1,
		"start_date": cstr(s.start_date) or None,
		"end_date": cstr(s.end_date) or None,
		"status": s.status,
		"needs_review": cint(s.needs_review),
		"reminders": cint(s.reminders),
		"prescriber": s.prescriber,
		"source": "Uber Doc e-Rx" if s.source_doctype == RX_DT else ("Remedium prescription" if s.source_doctype == CP_DT else s.source_doctype),
		"source_name": s.source_name,
	}


def _routine_out(r):
	return {
		"name": r.name,
		"title": r.title,
		"category": r.category,
		"details": r.details,
		"frequency_text": r.frequency_text,
		"minutes": cint(r.minutes) or None,
		"tutorial_program": r.tutorial_program,
		"tutorial_enrollment": r.tutorial_enrollment,
		"start_date": cstr(r.start_date) or None,
		"end_date": cstr(r.end_date) or None,
		"status": r.status,
		"prescriber": r.prescriber,
		"source": "Uber Doc e-Rx" if r.source_doctype == RX_DT else ("Uber Doc programme" if r.source_doctype == ENROLL_DT else r.source_doctype),
	}


def today_checklist(patient, day=None):
	day = _day(day)
	now = now_datetime()
	schedules = _active_schedules(patient, day)
	logs = {(lg.schedule, lg.slot_time): lg for lg in frappe.get_all(DOSE_DT, filters={"patient": patient, "dose_date": day}, fields=["name", "schedule", "slot_time", "status", "logged_at"], limit=0)}
	doses, prn = [], []
	for s in schedules:
		if cint(s.as_needed):
			taken = [lg for (sch, _slot), lg in logs.items() if sch == s.name and lg.status == "Taken"]
			prn.append({**_schedule_out(s), "taken_today": len(taken)})
			continue
		if not _due_on(s, day):
			continue
		for slot in _times(s):
			lg = logs.get((s.name, slot))
			if lg:
				state = lg.status
			elif day < getdate(now):
				state = "Missed"
			else:
				due = datetime.combine(day, datetime.strptime(slot, "%H:%M").time())
				state = "Due" if due <= now else "Upcoming"
			doses.append({"schedule": s.name, "slot": slot, "drug_name": s.drug_name, "strength": s.strength, "dose": s.dose, "timing": s.timing, "instructions": s.instructions, "status": state, "logged_at": cstr(lg.logged_at) if lg else None, "needs_review": cint(s.needs_review)})
	doses.sort(key=lambda d: (d["slot"], d["drug_name"] or ""))
	review = [_schedule_out(s) for s in schedules if cint(s.needs_review) and not cint(s.as_needed) and not _times(s)]
	routine_rows = frappe.get_all(ROUTINE_DT, filters={"patient": patient, "status": "Active"}, fields=ROUTINE_FIELDS, order_by="creation asc", limit=200)
	done = {lg.routine_item: lg for lg in frappe.get_all(ROUTINE_LOG_DT, filters={"patient": patient, "done_date": day}, fields=["routine_item", "minutes", "logged_at"], limit=0)}
	routine = []
	for r in routine_rows:
		if (r.start_date and getdate(r.start_date) > day) or (r.end_date and getdate(r.end_date) < day):
			continue
		lg = done.get(r.name)
		routine.append({**_routine_out(r), "done": bool(lg), "done_minutes": cint(lg.minutes) if lg else None})
	total = len(doses) + len(routine)
	completed = sum(1 for d in doses if d["status"] in ("Taken", "Skipped")) + sum(1 for r in routine if r["done"])
	return {"date": cstr(day), "doses": doses, "as_needed": prn, "needs_times": review, "routine": routine, "total": total, "completed": completed}


def _schedule_in_scope(patients, name):
	row = frappe.db.get_value(SCHEDULE_DT, name, SCHEDULE_FIELDS, as_dict=True) if name else None
	if not row:
		_missing(_("Medicine not found"))
	if row.patient not in patients:
		_deny(_("This medicine is not in your health vault"))
	return row


def _routine_in_scope(patients, name):
	row = frappe.db.get_value(ROUTINE_DT, name, ROUTINE_FIELDS, as_dict=True) if name else None
	if not row:
		_missing(_("Routine item not found"))
	if row.patient not in patients:
		_deny(_("This routine item is not in your health vault"))
	return row


def _log_window(day):
	day = _day(day)
	if day > _day() or day < _day() - timedelta(days=LOG_BACK_DAYS):
		_fail(_("Doses can be logged for today and the last {0} days").format(LOG_BACK_DAYS))
	return day


def log_dose(patients, schedule, day, slot, status):
	s = _schedule_in_scope(patients, schedule)
	day = _log_window(day)
	status = cstr(status).strip()
	if status not in ("Taken", "Skipped", ""):
		_fail(_("Mark the dose as taken or skipped"))
	if cint(s.as_needed):
		if status != "Taken":
			_fail(_("As-needed medicines are logged when you take them"))
		slot = f"SOS-{now_datetime().strftime('%H%M%S')}" if day == _day() else "SOS"
	else:
		slot = cstr(slot).strip()
		if slot not in _times(s) or not _due_on(s, day):
			_fail(_("That dose is not on your schedule for {0}").format(day))
	key = f"{s.name}:{day}:{slot}"
	existing = frappe.db.get_value(DOSE_DT, {"dose_key": key}, "name")
	if not status:
		if existing:
			frappe.delete_doc(DOSE_DT, existing, ignore_permissions=True, force=True)
		return today_checklist(s.patient, day)
	if existing:
		frappe.db.set_value(DOSE_DT, existing, {"status": status, "logged_at": now_datetime(), "source": "Patient"})
	else:
		frappe.get_doc({"doctype": DOSE_DT, "schedule": s.name, "patient": s.patient, "dose_date": day, "slot_time": slot, "status": status, "logged_at": now_datetime(), "source": "Patient", "dose_key": key}).insert(ignore_permissions=True)
	return today_checklist(s.patient, day)


def log_routine(patients, item, day, done=1, minutes=None):
	r = _routine_in_scope(patients, item)
	day = _log_window(day)
	key = f"{r.name}:{day}"
	existing = frappe.db.get_value(ROUTINE_LOG_DT, {"log_key": key}, "name")
	minutes = cint(minutes) or cint(r.minutes) or None
	if minutes and (minutes < 1 or minutes > 600):
		_fail(_("Minutes must be between 1 and 600"))
	if cint(done):
		if existing:
			frappe.db.set_value(ROUTINE_LOG_DT, existing, {"minutes": minutes, "logged_at": now_datetime()})
		else:
			frappe.get_doc({"doctype": ROUTINE_LOG_DT, "routine_item": r.name, "patient": r.patient, "done_date": day, "minutes": minutes, "logged_at": now_datetime(), "log_key": key}).insert(ignore_permissions=True)
	elif existing:
		frappe.delete_doc(ROUTINE_LOG_DT, existing, ignore_permissions=True, force=True)
	_feed_routine(r, day, bool(cint(done)), minutes, key)
	return today_checklist(r.patient, day)


def adherence(patient, days=30, until=None):
	"""Taken / expected scheduled doses over the window (past days in full, today's slots once their time has passed)."""
	end = _day(until)
	days = min(max(cint(days) or 30, 1), 365)
	start = end - timedelta(days=days - 1)
	now = now_datetime()
	rows = frappe.get_all(SCHEDULE_DT, filters={"patient": patient, "as_needed": 0, "status": ("in", ("Active", "Completed"))}, fields=SCHEDULE_FIELDS, limit=500)
	logs = frappe.get_all(DOSE_DT, filters={"patient": patient, "dose_date": ("between", [start, end])}, fields=["schedule", "dose_date", "slot_time", "status"], limit=0)
	by_key = {(lg.schedule, getdate(lg.dose_date), lg.slot_time): lg.status for lg in logs}
	expected = taken = skipped = missed = 0
	for s in rows:
		times = _times(s)
		if not times:
			continue
		d = max(start, getdate(s.start_date) if s.start_date else start)
		last = min(end, getdate(s.end_date) if s.end_date else end)
		while d <= last:
			if _due_on(s, d):
				for slot in times:
					state = by_key.get((s.name, d, slot))
					if d == getdate(now) and not state and datetime.combine(d, datetime.strptime(slot, "%H:%M").time()) > now:
						continue
					expected += 1
					if state == "Taken":
						taken += 1
					elif state == "Skipped":
						skipped += 1
					else:
						missed += 1
			d += timedelta(days=1)
	return {"days": days, "expected": expected, "taken": taken, "skipped": skipped, "missed": missed, "pct": round(100.0 * taken / expected, 1) if expected else None}


def medications(patient):
	rank = {s: i for i, s in enumerate(SCHEDULE_STATUSES)}
	schedules = frappe.get_all(SCHEDULE_DT, filters={"patient": patient}, fields=SCHEDULE_FIELDS, order_by="start_date desc, creation desc", limit=300)
	routine = frappe.get_all(ROUTINE_DT, filters={"patient": patient}, fields=ROUTINE_FIELDS, order_by="creation desc", limit=200)
	schedules.sort(key=lambda s: rank.get(s.status, 9))
	routine.sort(key=lambda r: rank.get(r.status, 9))
	return {"schedules": [_schedule_out(s) for s in schedules], "routine": [_routine_out(r) for r in routine], "adherence_30d": adherence(patient, 30), "adherence_7d": adherence(patient, 7)}


def update_schedule(patients, name, payload):
	s = _schedule_in_scope(patients, name)
	p = payload or {}
	values = {}
	if "times" in p:
		if cint(s.as_needed):
			_fail(_("As-needed medicines have no fixed times"))
		times = clean_times(p.get("times"))
		if not times:
			_fail(_("Add at least one time"))
		values.update({"times": ",".join(times), "times_custom": 1, "needs_review": 0})
	if "reminders" in p:
		values["reminders"] = 1 if cint(p.get("reminders")) else 0
	if "status" in p:
		status = cstr(p.get("status")).strip()
		if status not in ("Active", "Stopped"):
			_fail(_("Choose active or stopped"))
		values["status"] = status
		if status == "Stopped":
			values["stop_reason"] = cstr(p.get("reason")).strip()[:500] or _("Stopped by the patient")
	if values:
		frappe.db.set_value(SCHEDULE_DT, s.name, values)
	return _schedule_out(frappe.db.get_value(SCHEDULE_DT, s.name, SCHEDULE_FIELDS, as_dict=True))


def update_routine(patients, name, payload):
	r = _routine_in_scope(patients, name)
	status = cstr((payload or {}).get("status")).strip()
	if status not in ("Active", "Stopped", "Completed"):
		_fail(_("Choose active, completed or stopped"))
	frappe.db.set_value(ROUTINE_DT, r.name, "status", status)
	return _routine_out(frappe.db.get_value(ROUTINE_DT, r.name, ROUTINE_FIELDS, as_dict=True))


def vault_mark_missed_doses(back_days=MISSED_BACK_DAYS, patients=None):
	"""Nightly: unlogged scheduled doses of the previous days become Missed; ended schedules are closed. Idempotent.
	`patients` limits the run (smoke)."""
	if not frappe.db.exists("DocType", DOSE_DT):
		return {"skipped": "not installed"}
	today_ = _day()
	report = {"missed": 0, "completed": 0, "errors": 0}
	scope = {"patient": ("in", list(patients))} if patients else {}
	# Frappe compares an empty date as 0001-01-01, so open-ended (SOS / no-duration) schedules need the "is set" guard.
	ended_filters = [["status", "=", "Active"], ["end_date", "is", "set"], ["end_date", "<", today_ - timedelta(days=cint(back_days))]]
	ended_filters += [["patient", "in", list(patients)]] if patients else []
	ended = frappe.get_all(SCHEDULE_DT, filters=ended_filters, pluck="name", limit=0)
	for name in ended:
		frappe.db.set_value(SCHEDULE_DT, name, "status", "Completed", update_modified=False)
		report["completed"] += 1
	frappe.db.commit()
	earliest = today_ - timedelta(days=cint(back_days) or MISSED_BACK_DAYS)
	rows = frappe.get_all(SCHEDULE_DT, filters={"status": ("in", ("Active", "Completed")), "as_needed": 0, "start_date": ("<", today_), **scope}, fields=SCHEDULE_FIELDS, limit=0)
	pending = 0
	for s in rows:
		if s.end_date and getdate(s.end_date) < earliest:
			continue
		times = _times(s)
		for offset in range(1, (cint(back_days) or MISSED_BACK_DAYS) + 1):
			d = today_ - timedelta(days=offset)
			if not _due_on(s, d):
				continue
			for slot in times:
				key = f"{s.name}:{d}:{slot}"
				if frappe.db.exists(DOSE_DT, {"dose_key": key}):
					continue
				try:
					frappe.get_doc({"doctype": DOSE_DT, "schedule": s.name, "patient": s.patient, "dose_date": d, "slot_time": slot, "status": "Missed", "logged_at": now_datetime(), "source": "Missed Job", "dose_key": key}).insert(ignore_permissions=True)
					report["missed"] += 1
					pending += 1
				except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
					continue
				except Exception:
					report["errors"] += 1
					frappe.log_error(title="phase136 missed dose", message=f"{key}\n{frappe.get_traceback()}")
				if pending >= 200:
					frappe.db.commit()
					pending = 0
	frappe.db.commit()
	return report


# ---------------------------------------------------------------------------
# Goals
# ---------------------------------------------------------------------------

GOAL_FIELDS = ["name", "patient", "goal_type", "title", "status", "unit", "baseline_value", "baseline_value_2", "has_baseline", "target_value", "target_value_2", "start_date", "target_date", "current_value", "current_value_2", "has_current", "progress_pct", "streak_days", "best_streak", "last_entry_on", "achieved_on", "auto_feed", "notes"]
ENTRY_FIELDS = ["name", "goal", "entry_date", "value", "has_value", "value_2", "has_value_2", "source", "source_doctype", "source_name", "notes", "creation"]


def _goal_row(name):
	return frappe.db.get_value(GOAL_DT, name, GOAL_FIELDS, as_dict=True)


def _goal_in_scope(patients, name):
	row = _goal_row(name) if name else None
	if not row:
		_missing(_("Goal not found"))
	if row.patient not in patients:
		_deny(_("This goal is not in your health vault"))
	return row


def _auto_goals(patient, types):
	return frappe.get_all(GOAL_DT, filters={"patient": patient, "goal_type": ("in", list(types)), "status": ("in", ("Active", "Achieved")), "auto_feed": 1}, fields=GOAL_FIELDS, limit=20)


def _check_value(goal_type, value, second=False, label=None):
	meta = GOAL_META[goal_type]
	lo, hi = (meta.get("lo2"), meta.get("hi2")) if second else (meta["lo"], meta["hi"])
	v = flt(value)
	if v < lo or v > hi:
		_fail(_("{0} should be between {1} and {2} {3}").format(label or goal_type, lo, hi, meta["unit"]))
	return v


def _unit_ok(unit, goal_unit):
	u = re.sub(r"\s+", "", cstr(unit)).lower()
	return not u or u == re.sub(r"\s+", "", goal_unit).lower()


def _upsert_entry(goal, entry_date, value, value_2, source, source_doctype, source_name, key, notes=None):
	values = {
		"goal": goal.name,
		"patient": goal.patient,
		"entry_date": getdate(entry_date),
		"value": flt(value) if value is not None else 0,
		"has_value": 1 if value is not None else 0,
		"value_2": flt(value_2) if value_2 is not None else 0,
		"has_value_2": 1 if value_2 is not None else 0,
		"source": source,
		"source_doctype": source_doctype,
		"source_name": cstr(source_name)[:140] or None,
		"notes": cstr(notes)[:500] or None,
	}
	existing = frappe.db.get_value(ENTRY_DT, {"source_key": key}, "name")
	if existing:
		frappe.db.set_value(ENTRY_DT, existing, values)
		return existing
	doc = frappe.get_doc({"doctype": ENTRY_DT, **values, "source_key": key})
	try:
		doc.insert(ignore_permissions=True)
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		return frappe.db.get_value(ENTRY_DT, {"source_key": key}, "name")
	return doc.name


def _progress(baseline, target, current):
	if baseline is None or current is None:
		return 0.0
	span = flt(target) - flt(baseline)
	if not span:
		return 100.0 if flt(current) == flt(target) else 0.0
	return round(min(max((flt(current) - flt(baseline)) / span * 100.0, 0.0), 100.0), 1)


def _streaks(done_days, today_):
	"""(current streak ending today or yesterday, best streak)."""
	if not done_days:
		return 0, 0
	days = sorted(done_days)
	best = run = 1
	for a, b in zip(days, days[1:]):
		run = run + 1 if (b - a).days == 1 else 1
		best = max(best, run)
	current = 0
	cursor = today_ if today_ in done_days else today_ - timedelta(days=1)
	while cursor in done_days:
		current += 1
		cursor -= timedelta(days=1)
	return current, best


def recompute_goal(name, today_=None):
	g = _goal_row(name)
	if not g:
		return None
	today_ = _day(today_)
	entries = frappe.get_all(ENTRY_DT, filters={"goal": name}, fields=ENTRY_FIELDS, order_by="entry_date asc, creation asc", limit=0)
	values = {"last_entry_on": getdate(entries[-1].entry_date) if entries else None}
	if g.goal_type in VALUE_GOALS:
		v1 = [e for e in entries if cint(e.has_value)]
		v2 = [e for e in entries if cint(e.has_value_2)]
		cur = flt(v1[-1].value) if v1 else None
		cur2 = flt(v2[-1].value_2) if v2 else None
		base = flt(g.baseline_value) if cint(g.has_baseline) else (flt(v1[0].value) if v1 else None)
		pct = _progress(base, g.target_value, cur)
		if g.goal_type == "Blood Pressure":
			base2 = flt(g.baseline_value_2) if cint(g.has_baseline) and flt(g.baseline_value_2) else (flt(v2[0].value_2) if v2 else None)
			pct = min(pct, _progress(base2, g.target_value_2, cur2)) if g.target_value_2 else pct
		values.update({"current_value": cur or 0, "current_value_2": cur2 or 0, "has_current": 1 if cur is not None else 0, "progress_pct": pct})
		if g.status == "Active" and pct >= 100 and cur is not None:
			values.update({"status": "Achieved", "achieved_on": today_})
	else:
		per_day = {}
		for e in entries:
			d = getdate(e.entry_date)
			per_day[d] = per_day.get(d, 0.0) + (flt(e.value) if cint(e.has_value) else 1.0)
		if g.goal_type == "Daily Activity":
			done = {d for d, total in per_day.items() if total >= flt(g.target_value)}
			week = sum(1 for k in range(7) if today_ - timedelta(days=k) in done)
			current, best = _streaks(done, today_)
			values.update({"current_value": per_day.get(today_, 0.0), "has_current": 1, "progress_pct": round(100.0 * week / 7, 1), "streak_days": current, "best_streak": best})
		else:
			done = {d for d, total in per_day.items() if total > 0}
			current, best = _streaks(done, today_)
			pct = round(min(100.0, 100.0 * current / max(flt(g.target_value), 1)), 1)
			values.update({"current_value": current, "has_current": 1, "progress_pct": pct, "streak_days": current, "best_streak": best})
			if g.status == "Active" and current >= flt(g.target_value):
				values.update({"status": "Achieved", "achieved_on": today_})
	frappe.db.set_value(GOAL_DT, name, values, update_modified=False)
	return goal_out(_goal_row(name))


def goal_out(g, entries=None):
	out = {
		"name": g.name,
		"goal_type": g.goal_type,
		"title": g.title or g.goal_type,
		"status": g.status,
		"unit": g.unit,
		"baseline": flt(g.baseline_value) if cint(g.has_baseline) else None,
		"baseline_2": flt(g.baseline_value_2) if cint(g.has_baseline) and flt(g.baseline_value_2) else None,
		"target": flt(g.target_value),
		"target_2": flt(g.target_value_2) or None,
		"current": flt(g.current_value) if cint(g.has_current) else None,
		"current_2": flt(g.current_value_2) or None,
		"progress_pct": flt(g.progress_pct, 1),
		"streak_days": cint(g.streak_days),
		"best_streak": cint(g.best_streak),
		"start_date": cstr(g.start_date) or None,
		"target_date": cstr(g.target_date) or None,
		"last_entry_on": cstr(g.last_entry_on) or None,
		"achieved_on": cstr(g.achieved_on) or None,
		"auto_feed": cint(g.auto_feed),
		"notes": g.notes,
	}
	if entries is not None:
		out["entries"] = [
			{"name": e.name, "date": cstr(e.entry_date), "value": flt(e.value) if cint(e.has_value) else None, "value_2": flt(e.value_2) if cint(e.has_value_2) else None, "source": e.source, "notes": e.notes, "deletable": e.source == "Manual"}
			for e in entries
		]
	return out


def _latest_known(patient, goal_type):
	"""(value, value_2, date, source, doctype, name) of the most recent lab / vital reading for an auto-fed goal."""
	meta = GOAL_META[goal_type]
	if meta.get("analyte") and frappe.db.exists("DocType", POINT_DT):
		for p in frappe.get_all(POINT_DT, filters={"patient": patient, "analyte_key": meta["analyte"], "has_num": 1}, fields=["name", "value_num", "unit", "observed_on", "emr_record"], order_by="observed_on desc, creation desc", limit=10):
			if _unit_ok(p.unit, meta["unit"]):
				return flt(p.value_num), None, p.observed_on, "Lab Report", "EMR Record", p.emr_record
	if goal_type == "Weight" and frappe.db.exists("DocType", VITAL_DT):
		row = frappe.db.get_value(VITAL_DT, {"patient": patient, "vital_type": "weight"}, ["name", "value", "unit", "recorded_at", "creation"], as_dict=True, order_by="recorded_at desc")
		if row and flt(row.value) and _unit_ok(row.unit, "kg"):
			return flt(row.value), None, row.recorded_at or row.creation, "Vital Log", VITAL_DT, row.name
	if goal_type == "Blood Pressure" and frappe.db.exists("DocType", VITAL_DT):
		sys_row = frappe.db.get_value(VITAL_DT, {"patient": patient, "vital_type": "bp_systolic"}, ["name", "value", "recorded_at", "creation"], as_dict=True, order_by="recorded_at desc")
		if sys_row and flt(sys_row.value):
			dia = _bp_partner(patient, sys_row, "bp_diastolic")
			return flt(sys_row.value), flt(dia.value) if dia else None, sys_row.recorded_at or sys_row.creation, "Vital Log", VITAL_DT, sys_row.name
	return None


def save_goal(user, patients, patient, payload):
	p = payload or {}
	name = cstr(p.get("name")).strip()
	if name:
		g = _goal_in_scope(patients, name)
		values = {}
		if "target" in p:
			values["target_value"] = _check_value(g.goal_type, p.get("target"), label=_("Target"))
		if "target_2" in p and g.goal_type == "Blood Pressure":
			values["target_value_2"] = _check_value(g.goal_type, p.get("target_2"), True, _("Diastolic target"))
		if "target_date" in p:
			values["target_date"] = getdate(p.get("target_date")) if p.get("target_date") else None
		if "notes" in p:
			values["notes"] = cstr(p.get("notes")).strip()[:500] or None
		if "auto_feed" in p:
			values["auto_feed"] = 1 if cint(p.get("auto_feed")) else 0
		if "status" in p:
			status = cstr(p.get("status")).strip()
			if status not in ("Active", "Paused", "Archived"):
				_fail(_("Choose active, paused or archived"))
			if status == "Active" and g.status != "Active" and frappe.db.exists(GOAL_DT, {"patient": g.patient, "goal_type": g.goal_type, "status": "Active", "name": ("!=", g.name)}):
				_fail(_("You already have an active {0} goal").format(g.goal_type))
			values["status"] = status
		if values:
			frappe.db.set_value(GOAL_DT, g.name, values)
		return recompute_goal(g.name)
	goal_type = cstr(p.get("goal_type")).strip()
	if goal_type not in GOAL_TYPES:
		_fail(_("Choose a goal"))
	if frappe.db.exists(GOAL_DT, {"patient": patient, "goal_type": goal_type, "status": ("in", ("Active", "Paused"))}):
		_fail(_("You already have a {0} goal; update or archive it first").format(goal_type))
	meta = GOAL_META[goal_type]
	target = _check_value(goal_type, p.get("target"), label=_("Target"))
	target_2 = _check_value(goal_type, p.get("target_2"), True, _("Diastolic target")) if goal_type == "Blood Pressure" else 0
	if goal_type == "Blood Pressure" and not p.get("target_2"):
		_fail(_("Enter both systolic and diastolic targets"))
	target_date = getdate(p.get("target_date")) if p.get("target_date") else None
	if target_date and target_date <= _day():
		_fail(_("The target date should be in the future"))
	baseline = baseline_2 = None
	known = _latest_known(patient, goal_type) if goal_type in VALUE_GOALS else None
	if p.get("baseline") not in (None, "") and goal_type in VALUE_GOALS:
		baseline = _check_value(goal_type, p.get("baseline"), label=_("Starting value"))
		if goal_type == "Blood Pressure" and p.get("baseline_2") not in (None, ""):
			baseline_2 = _check_value(goal_type, p.get("baseline_2"), True, _("Starting diastolic"))
	elif known:
		baseline, baseline_2 = known[0], known[1]
	doc = frappe.get_doc(
		{
			"doctype": GOAL_DT,
			"patient": patient,
			"goal_type": goal_type,
			"title": cstr(p.get("title")).strip()[:140] or goal_type,
			"status": "Active",
			"unit": meta["unit"],
			"baseline_value": baseline or 0,
			"baseline_value_2": baseline_2 or 0,
			"has_baseline": 1 if baseline is not None else 0,
			"target_value": target,
			"target_value_2": target_2,
			"start_date": _day(),
			"target_date": target_date,
			"auto_feed": 0 if p.get("auto_feed") in (0, "0", False) else 1,
			"notes": cstr(p.get("notes")).strip()[:500] or None,
			"created_by_user": user,
		}
	)
	doc.insert(ignore_permissions=True)
	g = _goal_row(doc.name)
	if known and cint(g.auto_feed):
		value, value_2, when, source, dt, src = known
		_upsert_entry(g, when, value, value_2, source, dt, src, f"{g.name}:baseline:{src}")
	if cint(g.auto_feed) and goal_type in STREAK_GOALS:
		_feed_history(g)
	return recompute_goal(doc.name)


def add_entry(patients, goal, payload):
	g = _goal_in_scope(patients, goal)
	if g.status == "Archived":
		_fail(_("This goal is archived"))
	p = payload or {}
	day = getdate(p.get("date") or today())
	if day > _day() or day < getdate(g.start_date or day) - timedelta(days=365):
		_fail(_("Choose a date up to today"))
	value_2 = None
	if g.goal_type in VALUE_GOALS:
		value = _check_value(g.goal_type, p.get("value"), label=_("Value"))
		if g.goal_type == "Blood Pressure":
			value_2 = _check_value(g.goal_type, p.get("value_2"), True, _("Diastolic"))
		key = f"{g.name}:manual:{frappe.generate_hash(length=10)}"
	elif g.goal_type == "Daily Activity":
		value = cint(p.get("value"))
		if value < 1 or value > 600:
			_fail(_("Minutes must be between 1 and 600"))
		key = f"{g.name}:manual:{frappe.generate_hash(length=10)}"
	else:
		value = 1
		key = f"{g.name}:manual:{day}"
	_upsert_entry(g, day, value, value_2, "Manual", None, None, key, p.get("notes"))
	return goal_detail(patients, g.name)


def delete_entry(patients, entry):
	row = frappe.db.get_value(ENTRY_DT, entry, ["name", "goal", "source"], as_dict=True) if entry else None
	if not row:
		_missing(_("Entry not found"))
	g = _goal_in_scope(patients, row.goal)
	if row.source != "Manual":
		_fail(_("Entries from reports, vitals or your checklist cannot be deleted here"))
	frappe.delete_doc(ENTRY_DT, row.name, ignore_permissions=True, force=True)
	return goal_detail(patients, g.name)


def goal_detail(patients, name):
	g = _goal_in_scope(patients, name)
	recompute_goal(g.name)
	entries = frappe.get_all(ENTRY_DT, filters={"goal": g.name}, fields=ENTRY_FIELDS, order_by="entry_date asc, creation asc", limit=1000)
	return goal_out(_goal_row(g.name), entries)


def list_goals(patient, include_archived=False):
	filters = {"patient": patient}
	if not include_archived:
		filters["status"] = ("in", OPEN_GOAL_STATUSES)
	rank = {s: i for i, s in enumerate(GOAL_STATUSES)}
	rows = frappe.get_all(GOAL_DT, filters=filters, fields=GOAL_FIELDS, order_by="creation desc", limit=100)
	rows.sort(key=lambda g: rank.get(g.status, 9))
	return {"goals": [goal_out(g) for g in rows]}


def goals_summary(patient):
	return list_goals(patient)["goals"][:6]


def feed_goals_from_analytes(patient, emr_record):
	if not frappe.db.exists("DocType", GOAL_DT):
		return 0
	fed = 0
	for g in _auto_goals(patient, ("Fasting Glucose", "HbA1c")):
		key = GOAL_META[g.goal_type]["analyte"]
		points = frappe.get_all(POINT_DT, filters={"emr_record": emr_record, "analyte_key": key, "has_num": 1}, fields=["name", "value_num", "unit", "observed_on"], limit=5)
		for p in points:
			if _unit_ok(p.unit, GOAL_META[g.goal_type]["unit"]):
				_upsert_entry(g, p.observed_on, flt(p.value_num), None, "Lab Report", "EMR Record", emr_record, f"{g.name}:emr:{emr_record}:{key}")
				fed += 1
				break
		recompute_goal(g.name)
	return fed


def _bp_partner(patient, row, partner_type):
	when = get_datetime(row.recorded_at or row.creation)
	rows = frappe.get_all(
		VITAL_DT,
		filters={"patient": patient, "vital_type": partner_type, "recorded_at": ("between", [when - timedelta(minutes=10), when + timedelta(minutes=10)])},
		fields=["name", "value", "recorded_at"],
		order_by="recorded_at asc",
		limit=1,
	)
	return rows[0] if rows else None


def feed_goals_from_vital(name):
	if not frappe.db.exists("DocType", GOAL_DT):
		return 0
	v = frappe.db.get_value(VITAL_DT, name, ["name", "patient", "vital_type", "value", "unit", "recorded_at", "creation"], as_dict=True)
	if not v or not v.patient or not flt(v.value):
		return 0
	when = v.recorded_at or v.creation
	fed = 0
	if v.vital_type == "weight" and _unit_ok(v.unit, "kg"):
		for g in _auto_goals(v.patient, ("Weight",)):
			_upsert_entry(g, when, flt(v.value), None, "Vital Log", VITAL_DT, v.name, f"{g.name}:vital:{v.name}")
			recompute_goal(g.name)
			fed += 1
	elif v.vital_type == "hba1c" and _unit_ok(v.unit, "%"):
		for g in _auto_goals(v.patient, ("HbA1c",)):
			_upsert_entry(g, when, flt(v.value), None, "Vital Log", VITAL_DT, v.name, f"{g.name}:vital:{v.name}")
			recompute_goal(g.name)
			fed += 1
	elif v.vital_type in ("bp_systolic", "bp_diastolic"):
		partner_type = "bp_diastolic" if v.vital_type == "bp_systolic" else "bp_systolic"
		partner = _bp_partner(v.patient, v, partner_type)
		sys_row, dia_row = (v, partner) if v.vital_type == "bp_systolic" else (partner, v)
		for g in _auto_goals(v.patient, ("Blood Pressure",)):
			keys = [f"{g.name}:bp:{r.name}" for r in (sys_row, dia_row) if r]
			key = next((k for k in keys if frappe.db.exists(ENTRY_DT, {"source_key": k})), keys[0])
			_upsert_entry(g, when, flt(sys_row.value) if sys_row else None, flt(dia_row.value) if dia_row else None, "Vital Log", VITAL_DT, (sys_row or dia_row).name, key)
			recompute_goal(g.name)
			fed += 1
	return fed


def _feed_routine(item, day, done, minutes, log_key):
	"""Checklist completion -> Yoga Streak (yoga items) and Daily Activity (minutes) goal entries; un-ticking removes them."""
	types = ["Daily Activity"] + (["Yoga Streak"] if item.category == "Yoga" else [])
	for g in _auto_goals(item.patient, types):
		key = f"{g.name}:routine:{log_key}"
		if not done:
			existing = frappe.db.get_value(ENTRY_DT, {"source_key": key}, "name")
			if existing:
				frappe.delete_doc(ENTRY_DT, existing, ignore_permissions=True, force=True)
		elif g.goal_type == "Yoga Streak":
			_upsert_entry(g, day, 1, None, "Checklist", ROUTINE_LOG_DT, log_key, key)
		elif minutes:
			_upsert_entry(g, day, minutes, None, "Checklist", ROUTINE_LOG_DT, log_key, key)
		recompute_goal(g.name)


def _feed_history(g):
	since = _day() - timedelta(days=FEED_BACK_DAYS)
	items = {r.name: r for r in frappe.get_all(ROUTINE_DT, filters={"patient": g.patient}, fields=["name", "category", "minutes"], limit=0)}
	for lg in frappe.get_all(ROUTINE_LOG_DT, filters={"patient": g.patient, "done_date": (">=", since)}, fields=["routine_item", "done_date", "minutes", "log_key"], limit=0):
		item = items.get(lg.routine_item)
		if not item:
			continue
		if g.goal_type == "Yoga Streak" and item.category == "Yoga":
			_upsert_entry(g, lg.done_date, 1, None, "Checklist", ROUTINE_LOG_DT, lg.log_key, f"{g.name}:routine:{lg.log_key}")
		elif g.goal_type == "Daily Activity" and cint(lg.minutes):
			_upsert_entry(g, lg.done_date, cint(lg.minutes), None, "Checklist", ROUTINE_LOG_DT, lg.log_key, f"{g.name}:routine:{lg.log_key}")
	if g.goal_type == "Yoga Streak" and frappe.db.exists("DocType", ENROLL_DT):
		for e in frappe.get_all(ENROLL_DT, filters={"patient": g.patient, "status": ("in", ("Active", "Completed"))}, fields=["name", "program"], limit=50):
			if frappe.db.get_value(PROGRAM_DT, e.program, "category") != "Yoga":
				continue
			doc = frappe.get_doc(ENROLL_DT, e.name)
			for row in doc.get("progress") or []:
				if cint(row.completed) and row.completed_on and getdate(row.completed_on) >= since:
					_upsert_entry(g, getdate(row.completed_on), 1, None, "Tutorial", ENROLL_DT, e.name, f"{g.name}:tut:{e.name}:{row.module_row}")


# ---------------------------------------------------------------------------
# Habit tips
# ---------------------------------------------------------------------------


def patient_signals(patient, day=None):
	day = _day(day)
	goals = set(frappe.get_all(GOAL_DT, filters={"patient": patient, "status": "Active"}, pluck="goal_type", limit=50))
	flags = {}
	if frappe.db.exists("DocType", POINT_DT):
		for r in frappe.get_all(POINT_DT, filters={"patient": patient, "observed_on": (">=", day - timedelta(days=365))}, fields=["analyte_key", "flag"], order_by="observed_on desc, creation desc", limit=2000):
			flags.setdefault(r.analyte_key, r.flag or None)
	meds = bool(frappe.db.exists(SCHEDULE_DT, {"patient": patient, "status": "Active"}))
	routine = bool(frappe.db.exists(ROUTINE_DT, {"patient": patient, "status": "Active"}))
	return {"goals": goals, "flags": flags, "medications": meds, "routine": routine}


def match_rule(rule, signals):
	"""(weight, reason) for the strongest matching trigger, or None. Lab flags outrank goals, goals outrank "always"."""
	rule = rule or {}
	for ar in rule.get("analytes") or []:
		want = set(ar.get("flags") or ["H", "L", "C"])
		key = cstr(ar.get("key"))
		if key == "*":
			hit = next((k for k, f in sorted(signals["flags"].items()) if f in want), None)
			if hit:
				return 3, f"Recent result flagged: {hit}"
		elif signals["flags"].get(key) in want:
			return 3, f"Recent result flagged: {key}"
	for goal_type in rule.get("goals") or []:
		if goal_type in signals["goals"]:
			return 2, f"Active goal: {goal_type}"
	if rule.get("medications") and signals["medications"]:
		return 2, "Active medicines"
	if rule.get("routine") and signals["routine"]:
		return 2, "Active routine"
	if rule.get("always"):
		return 0, "General wellness"
	return None


def _jitter(*parts):
	return int(hashlib.sha256(":".join(cstr(p) for p in parts).encode()).hexdigest()[:6], 16) % 10


TIP_FIELDS = ["name", "title", "body", "category", "trigger_json", "min_interval_days", "priority"]


def select_tip(patient, day=None, channel="App"):
	"""Today's tip for one profile (idempotent per day and channel); None when every matching tip is inside its interval."""
	day = _day(day)
	key = f"{patient}:{day}:{channel}"
	existing = frappe.db.get_value(TIP_DELIVERY_DT, {"delivery_key": key}, "name")
	if existing:
		return existing, False
	signals = patient_signals(patient, day)
	last = {}
	for r in frappe.get_all(TIP_DELIVERY_DT, filters={"patient": patient, "delivered_on": (">=", day - timedelta(days=120))}, fields=["tip", "delivered_on"], order_by="delivered_on desc", limit=500):
		last.setdefault(r.tip, getdate(r.delivered_on))
	best = None
	for tip in frappe.get_all(TIP_DT, filters={"active": 1}, fields=TIP_FIELDS, limit=500):
		try:
			rule = json.loads(tip.trigger_json or "{}")
		except ValueError:
			continue
		hit = match_rule(rule, signals)
		if not hit:
			continue
		prev = last.get(tip.name)
		if prev and (day - prev).days < max(cint(tip.min_interval_days), 1):
			continue
		score = hit[0] * 100 + cint(tip.priority) * 10 + _jitter(patient, day, tip.name)
		if not best or score > best[0]:
			best = (score, tip, hit[1])
	if not best:
		return None, False
	_score, tip, reason = best
	doc = frappe.get_doc({"doctype": TIP_DELIVERY_DT, "patient": patient, "tip": tip.name, "tip_title": tip.title, "delivered_on": day, "channel": channel, "reason": reason[:140], "status": "Shown" if channel == "App" else "Queued", "delivery_key": key})
	try:
		doc.insert(ignore_permissions=True)
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		return frappe.db.get_value(TIP_DELIVERY_DT, {"delivery_key": key}, "name"), False
	return doc.name, True


def _delivery_out(name):
	d = frappe.db.get_value(TIP_DELIVERY_DT, name, ["name", "tip", "tip_title", "delivered_on", "channel", "reason", "status", "helpful"], as_dict=True)
	if not d:
		return None
	tip = frappe.db.get_value(TIP_DT, d.tip, ["title", "body", "category"], as_dict=True) or {}
	return {"delivery": d.name, "tip": d.tip, "title": tip.get("title") or d.tip_title, "body": tip.get("body"), "category": tip.get("category"), "date": cstr(d.delivered_on), "reason": d.reason, "channel": d.channel, "status": d.status, "helpful": d.helpful or None, "disclaimer": TIP_DISCLAIMER}


def daily_tip(patient, day=None):
	if not frappe.db.exists("DocType", TIP_DELIVERY_DT):
		return None
	name, _created = select_tip(patient, day, "App")
	return _delivery_out(name) if name else None


def tip_history(patient, limit=30):
	names = frappe.get_all(TIP_DELIVERY_DT, filters={"patient": patient}, pluck="name", order_by="delivered_on desc, creation desc", limit=min(cint(limit) or 30, 100))
	return {"rows": [_delivery_out(n) for n in names], "disclaimer": TIP_DISCLAIMER}


def tip_feedback(patients, delivery, helpful):
	row = frappe.db.get_value(TIP_DELIVERY_DT, delivery, ["name", "patient"], as_dict=True) if delivery else None
	if not row:
		_missing(_("Tip not found"))
	if row.patient not in patients:
		_deny(_("Not your tip"))
	value = cstr(helpful).strip().title()
	if value not in ("Yes", "No", ""):
		_fail(_("Choose yes or no"))
	frappe.db.set_value(TIP_DELIVERY_DT, row.name, "helpful", value or None)
	return _delivery_out(row.name)


# ---------------------------------------------------------------------------
# WhatsApp nudges (opt-in) and dose reminders
# ---------------------------------------------------------------------------


def _opted_in(field, patients=None):
	if not frappe.db.exists("DocType", PROFILE_DT):
		return []
	filters = {field: 1}
	if patients:
		filters["patient"] = ("in", list(patients))
	return frappe.get_all(PROFILE_DT, filters=filters, fields=["patient", "wa_mobile"], limit=0)


def _wa_mobile(profile):
	mobile = re.sub(r"\D", "", cstr(profile.wa_mobile or frappe.db.get_value(PATIENT_DT, profile.patient, "mobile")))[-10:]
	return mobile if len(mobile) == 10 and mobile[0] in "6789" else None


def _queue_whatsapp(doctype, name, mobile, text):
	"""After commit; muted (no send) while frappe.flags.vault_no_notify is set, e.g. in the smoke."""
	if frappe.flags.vault_no_notify:
		frappe.db.set_value(doctype, name, "status", "Muted", update_modified=False)
		return "Muted"
	frappe.enqueue(f"{MODULE_PATH}.vault_send_whatsapp_job", queue="short", enqueue_after_commit=True, doctype=doctype, name=name, mobile=mobile, text=text)
	return "Queued"


def vault_send_whatsapp_job(doctype=None, name=None, mobile=None, text=None):
	try:
		from health_ecosystem_core.health_ecosystem_core.clinical_phase87_whatsapp import send_whatsapp

		ok = send_whatsapp(mobile, text, context={"source": "vault"})
		values = {"status": "Sent" if ok else "Failed", "error": None if ok else "WhatsApp provider returned no message id"}
		if doctype == REMINDER_DT:
			values["sent_at"] = now_datetime()
		frappe.db.set_value(doctype, name, values, update_modified=False)
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="phase136 WhatsApp", message=frappe.get_traceback())
		try:
			frappe.db.set_value(doctype, name, {"status": "Failed", "error": frappe.get_traceback()[-500:]}, update_modified=False)
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()


def vault_daily_nudges(day=None, patients=None):
	"""Daily at 08:30: one WhatsApp tip for each profile that opted in."""
	if not frappe.db.exists("DocType", TIP_DELIVERY_DT):
		return {"skipped": "not installed"}
	report = {"queued": 0, "muted": 0, "none": 0, "errors": 0}
	for prof in _opted_in("wa_tips", patients):
		try:
			mobile = _wa_mobile(prof)
			if not mobile:
				continue
			name, created = select_tip(prof.patient, day, "WhatsApp")
			if not name:
				report["none"] += 1
				continue
			if not created:
				continue
			d = _delivery_out(name)
			text = f"Remedium health tip: {d['title']}\n{d['body']}\n\n{TIP_DISCLAIMER} You can turn these messages off in your health vault settings."
			state = _queue_whatsapp(TIP_DELIVERY_DT, name, mobile, text)
			report["muted" if state == "Muted" else "queued"] += 1
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			report["errors"] += 1
			frappe.log_error(title="phase136 daily nudge", message=f"{prof.patient}\n{frappe.get_traceback()}")
	return report


def vault_dose_reminders(now=None, patients=None):
	"""Every 15 minutes: one WhatsApp per opted-in profile and time slot that just came due and is not logged yet."""
	if not frappe.db.exists("DocType", REMINDER_DT):
		return {"skipped": "not installed"}
	now = get_datetime(now) if now else now_datetime()
	day = getdate(now)
	window_start = now - timedelta(minutes=REMINDER_WINDOW_MINUTES)
	report = {"queued": 0, "muted": 0, "errors": 0}
	for prof in _opted_in("wa_reminders", patients):
		try:
			mobile = _wa_mobile(prof)
			if not mobile:
				continue
			slots = {}
			for s in _active_schedules(prof.patient, day):
				if cint(s.as_needed) or not cint(s.reminders) or not _due_on(s, day):
					continue
				for slot in _times(s):
					due = datetime.combine(day, datetime.strptime(slot, "%H:%M").time())
					if not (window_start < due <= now):
						continue
					if frappe.db.exists(DOSE_DT, {"dose_key": f"{s.name}:{day}:{slot}"}):
						continue
					slots.setdefault(slot, []).append(" ".join(x for x in (s.drug_name, s.dose or "") if x))
			for slot, drugs in slots.items():
				key = f"dose:{prof.patient}:{day}:{slot}"
				if frappe.db.exists(REMINDER_DT, {"reminder_key": key}):
					continue
				text = f"Remedium reminder ({slot}): {', '.join(drugs)}. Mark it in your health vault checklist."
				doc = frappe.get_doc({"doctype": REMINDER_DT, "patient": prof.patient, "kind": "Dose", "message": text[:1000], "mobile": mobile, "status": "Queued", "reminder_key": key})
				doc.insert(ignore_permissions=True)
				state = _queue_whatsapp(REMINDER_DT, doc.name, mobile, text)
				report["muted" if state == "Muted" else "queued"] += 1
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			report["errors"] += 1
			frappe.log_error(title="phase136 dose reminder", message=f"{prof.patient}\n{frappe.get_traceback()}")
	return report


# ---------------------------------------------------------------------------
# Backfill and export
# ---------------------------------------------------------------------------


def backfill_lifestyle(days=BACKFILL_DAYS):
	"""Schedules / routine items for prescriptions of the last `days` days and for active tutorial enrollments."""
	since = _day() - timedelta(days=cint(days) or BACKFILL_DAYS)
	report = {"uberdoc_rx": 0, "clinical_prescriptions": 0, "enrollments": 0, "errors": 0}

	def run_each(names, fn, label):
		for name in names:
			frappe.db.savepoint("vault_life_row")
			try:
				fn(name)
				report[label] += 1
			except Exception:
				frappe.db.rollback(save_point="vault_life_row")
				report["errors"] += 1
				frappe.log_error(title=f"phase136 lifestyle backfill {label}", message=f"{name}\n{frappe.get_traceback()}")
		frappe.db.commit()

	if frappe.db.exists("DocType", RX_DT):
		run_each(frappe.get_all(RX_DT, filters={"status": "Signed", "rx_date": (">=", since), "patient": ("is", "set")}, pluck="name", limit=0), sync_rx_schedules, "uberdoc_rx")
	if frappe.db.exists("DocType", CP_DT):
		filters = {"status": ("in", ("Submitted", "Dispensed")), "encounter_date": (">=", since)}
		if _has_field(CP_DT, "digital_prescription"):
			filters["digital_prescription"] = ("is", "not set")
		run_each(frappe.get_all(CP_DT, filters=filters, pluck="name", limit=0), sync_cp_schedules, "clinical_prescriptions")
	if frappe.db.exists("DocType", ENROLL_DT):
		run_each(frappe.get_all(ENROLL_DT, filters={"status": "Active", "patient": ("is", "set")}, pluck="name", limit=0), sync_enrollment, "enrollments")
	return report


def export_lifestyle(patient):
	goals = frappe.get_all(GOAL_DT, filters={"patient": patient}, fields=GOAL_FIELDS, limit=0)
	out_goals = []
	for g in goals:
		entries = frappe.get_all(ENTRY_DT, filters={"goal": g.name}, fields=ENTRY_FIELDS, order_by="entry_date asc", limit=0)
		out_goals.append(goal_out(g, entries))
	since = _day() - timedelta(days=365)
	return {
		"goals": out_goals,
		"medications": [_schedule_out(s) for s in frappe.get_all(SCHEDULE_DT, filters={"patient": patient}, fields=SCHEDULE_FIELDS, limit=0)],
		"dose_log": [
			{"schedule": d.schedule, "date": cstr(d.dose_date), "time": d.slot_time, "status": d.status}
			for d in frappe.get_all(DOSE_DT, filters={"patient": patient, "dose_date": (">=", since)}, fields=["schedule", "dose_date", "slot_time", "status"], order_by="dose_date asc", limit=0)
		],
		"routine": [_routine_out(r) for r in frappe.get_all(ROUTINE_DT, filters={"patient": patient}, fields=ROUTINE_FIELDS, limit=0)],
		"routine_log": [
			{"item": r.routine_item, "date": cstr(r.done_date), "minutes": cint(r.minutes) or None}
			for r in frappe.get_all(ROUTINE_LOG_DT, filters={"patient": patient, "done_date": (">=", since)}, fields=["routine_item", "done_date", "minutes"], order_by="done_date asc", limit=0)
		],
		"tips": tip_history(patient, 100)["rows"],
	}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def _iam():
	from health_ecosystem_core.health_ecosystem_core import clinical_phase136_patient_iam as iam

	return iam


@frappe.whitelist(allow_guest=True)
def vault_today(patient=None, date=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: today_checklist(iam.patient_in_scope(ctx, patient), date))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_dose_log(schedule=None, date=None, slot=None, status=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: log_dose(iam.patients_of(ctx), schedule, date, slot, status), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_routine_log(item=None, date=None, done=1, minutes=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: log_routine(iam.patients_of(ctx), item, date, done, minutes), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def vault_medications(patient=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: medications(iam.patient_in_scope(ctx, patient)))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_medication_update(name=None, payload=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: update_schedule(iam.patients_of(ctx), name, iam._parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_routine_update(name=None, payload=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: update_routine(iam.patients_of(ctx), name, iam._parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True)
def vault_adherence(patient=None, days=30, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: adherence(iam.patient_in_scope(ctx, patient), days))


@frappe.whitelist(allow_guest=True)
def vault_goals(patient=None, include_archived=0, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: list_goals(iam.patient_in_scope(ctx, patient), cint(include_archived)))


@frappe.whitelist(allow_guest=True)
def vault_goal_detail(name=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: goal_detail(iam.patients_of(ctx), name), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_goal_save(patient=None, payload=None, sid=None):
	iam = _iam()

	def fn(ctx):
		p = iam._parse(payload)
		pid = iam.patient_in_scope(ctx, patient) if not p.get("name") else None
		return save_goal(ctx.user, iam.patients_of(ctx), pid, p)

	return iam.run(sid, fn, message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_goal_entry(goal=None, payload=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: add_entry(iam.patients_of(ctx), goal, iam._parse(payload)), message=_("Saved"), commit=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_goal_entry_delete(entry=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: delete_entry(iam.patients_of(ctx), entry), message=_("Deleted"), commit=True)


@frappe.whitelist(allow_guest=True)
def vault_tip_today(patient=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: {"tip": daily_tip(iam.patient_in_scope(ctx, patient)), "disclaimer": TIP_DISCLAIMER}, commit=True)


@frappe.whitelist(allow_guest=True)
def vault_tips(patient=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: tip_history(iam.patient_in_scope(ctx, patient)))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def vault_tip_feedback(delivery=None, helpful=None, sid=None):
	iam = _iam()
	return iam.run(sid, lambda ctx: tip_feedback(iam.patients_of(ctx), delivery, helpful), message=_("Thanks"), commit=True)
