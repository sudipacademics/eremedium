"""Barcode utilities shared by the patient identity layer, PhleboFirst and Teleporter.

- Prefix registry: every platform code is PREFIX + zero-padded sequence + one check character.
- Check characters: Verhoeff (digits only, catches all single errors and adjacent transpositions) and
  ISO 7064 Mod 11-2 (check char 0-9 or X).
- Unique Patient ID: REM-UID- + 7 random Crockford base32 characters + 1 check character (Damm scheme over GF(32):
  catches every single-character error and every adjacent transposition). RUP stays registered for legacy IDs.
- Code 128 (sets B and C) rendered as SVG in pure Python, so no new pip dependency is needed.
- Labels as PDF (A4 sheet through wkhtmltopdf), ZPL (Zebra) or TSPL (TSC and most generic thermal printers).
"""

from __future__ import annotations

import base64
import html
import re
import secrets

import frappe
from frappe import _
from frappe.utils import cint, cstr

CHECK_VERHOEFF = "verhoeff"
CHECK_MOD11 = "mod11"

PREFIXES = {
	"RUP": {"label": "Universal Patient ID (legacy RUP)", "digits": 10, "check": CHECK_VERHOEFF},
	"RU": {"label": "Universal Barcode (tube)", "digits": 9, "check": CHECK_MOD11},
	"RK": {"label": "Collection Kit", "digits": 7, "check": CHECK_MOD11},
	"RI": {"label": "Icebox", "digits": 6, "check": CHECK_MOD11},
	"RH": {"label": "Drop Hub", "digits": 5, "check": CHECK_MOD11},
	"RS": {"label": "Teleporter Shipment", "digits": 8, "check": CHECK_MOD11},
}

CODE_RE = re.compile(r"^[A-Za-z0-9._:/-]{1,64}$")
MAX_LABELS = 500


# ---------------------------------------------------------------------------
# Prefix registry
# ---------------------------------------------------------------------------


def register_prefix(prefix, label, digits, check=CHECK_MOD11):
	prefix = cstr(prefix).strip().upper()
	if not re.match(r"^[A-Z]{1,6}$", prefix):
		raise frappe.ValidationError(_("Prefix must be 1-6 letters"))
	if check not in (CHECK_VERHOEFF, CHECK_MOD11):
		raise frappe.ValidationError(_("Unknown check algorithm {0}").format(check))
	PREFIXES[prefix] = {"label": label, "digits": cint(digits) or 8, "check": check}
	return PREFIXES[prefix]


def get_prefix(prefix):
	return PREFIXES.get(cstr(prefix).strip().upper())


def list_prefixes():
	return [{"prefix": p, **spec} for p, spec in sorted(PREFIXES.items())]


def match_prefix(code):
	"""Longest registered prefix that `code` starts with followed by a digit (so RUP never reads as RU)."""
	code = cstr(code).strip().upper()
	for prefix in sorted(PREFIXES, key=len, reverse=True):
		if code.startswith(prefix) and len(code) > len(prefix) and code[len(prefix)].isdigit():
			return prefix
	return None


# ---------------------------------------------------------------------------
# Check characters
# ---------------------------------------------------------------------------

_VERHOEFF_D = (
	(0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
	(1, 2, 3, 4, 0, 6, 7, 8, 9, 5),
	(2, 3, 4, 0, 1, 7, 8, 9, 5, 6),
	(3, 4, 0, 1, 2, 8, 9, 5, 6, 7),
	(4, 0, 1, 2, 3, 9, 5, 6, 7, 8),
	(5, 9, 8, 7, 6, 0, 4, 3, 2, 1),
	(6, 5, 9, 8, 7, 1, 0, 4, 3, 2),
	(7, 6, 5, 9, 8, 2, 1, 0, 4, 3),
	(8, 7, 6, 5, 9, 3, 2, 1, 0, 4),
	(9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
)
_VERHOEFF_P = (
	(0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
	(1, 5, 7, 6, 2, 8, 3, 0, 9, 4),
	(5, 8, 0, 3, 7, 9, 6, 1, 4, 2),
	(8, 9, 1, 6, 0, 4, 3, 5, 2, 7),
	(9, 4, 5, 3, 1, 2, 6, 8, 7, 0),
	(4, 2, 8, 6, 5, 7, 3, 9, 0, 1),
	(2, 7, 9, 3, 8, 0, 6, 4, 1, 5),
	(7, 0, 4, 6, 9, 1, 3, 2, 5, 8),
)
_VERHOEFF_INV = (0, 4, 3, 2, 1, 5, 6, 7, 8, 9)


def _digits(value):
	value = cstr(value).strip()
	if not value or not value.isdigit():
		raise frappe.ValidationError(_("Check digits need a numeric body"))
	return value


def verhoeff_check_digit(number):
	c = 0
	for i, ch in enumerate(reversed(_digits(number))):
		c = _VERHOEFF_D[c][_VERHOEFF_P[(i + 1) % 8][int(ch)]]
	return str(_VERHOEFF_INV[c])


def verhoeff_validate(number_with_check):
	value = cstr(number_with_check).strip()
	if len(value) < 2 or not value.isdigit():
		return False
	c = 0
	for i, ch in enumerate(reversed(value)):
		c = _VERHOEFF_D[c][_VERHOEFF_P[i % 8][int(ch)]]
	return c == 0


def mod11_check_char(number):
	"""ISO 7064 MOD 11-2 (same scheme as ORCID): returns '0'-'9' or 'X'."""
	total = 0
	for ch in _digits(number):
		total = ((total + int(ch)) * 2) % 11
	result = (12 - total) % 11
	return "X" if result == 10 else str(result)


def mod11_validate(number_with_check):
	value = cstr(number_with_check).strip().upper()
	if len(value) < 2 or not value[:-1].isdigit():
		return False
	return mod11_check_char(value[:-1]) == value[-1]


def check_char(body, algorithm):
	if algorithm == CHECK_VERHOEFF:
		return verhoeff_check_digit(body)
	if algorithm == CHECK_MOD11:
		return mod11_check_char(body)
	raise frappe.ValidationError(_("Unknown check algorithm {0}").format(algorithm))


# ---------------------------------------------------------------------------
# Unique Patient ID (REM-UID-XXXXXXXX)
# ---------------------------------------------------------------------------

CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_CROCKFORD_INDEX = {ch: i for i, ch in enumerate(CROCKFORD_ALPHABET)}
_CROCKFORD_ALIASES = {"O": "0", "I": "1", "L": "1"}
# x^5 + x^2 + 1 is primitive, so multiplying by x permutes GF(32) and x + 1 is non-zero: the quasigroup
# a * b = x·a + b is totally anti-symmetric (Damm), which is what makes transpositions detectable.
_GF32_POLY = 0b100101
UID_PREFIX = "REM-UID-"
UID_RANDOM_CHARS = 7
UID_RE = re.compile(r"^REM-UID-[0-9A-HJKMNP-TV-Z]{8}$")
UID_LABEL = "Unique Patient ID"


def _gf32_times_x(value):
	value <<= 1
	if value & 0x20:
		value ^= _GF32_POLY
	return value


def damm32_interim(body):
	interim = 0
	for ch in cstr(body):
		value = _CROCKFORD_INDEX.get(ch)
		if value is None:
			raise frappe.ValidationError(_("{0} is not a Crockford base32 character").format(ch))
		interim = _gf32_times_x(interim) ^ value
	return interim


def damm32_check_char(body):
	return CROCKFORD_ALPHABET[_gf32_times_x(damm32_interim(body))]


def damm32_validate(body_with_check):
	value = cstr(body_with_check)
	if len(value) < 2 or any(ch not in _CROCKFORD_INDEX for ch in value):
		return False
	return damm32_interim(value) == 0


def normalize_uid(value):
	"""Upper-case, drop spaces / hyphens inside the ID and apply Crockford aliases (O -> 0, I / L -> 1).
	Anything that does not start with REM-UID is returned stripped and upper-cased."""
	text = cstr(value).strip().upper()
	compact = re.sub(r"[\s_-]+", "", text)
	if not compact.startswith("REMUID"):
		return text
	body = "".join(_CROCKFORD_ALIASES.get(ch, ch) for ch in compact[len("REMUID") :])
	return f"{UID_PREFIX}{body}"


def validate_uid(value, normalize=False):
	uid = normalize_uid(value) if normalize else cstr(value).strip()
	return bool(UID_RE.match(uid)) and damm32_validate(uid[len(UID_PREFIX) :])


def make_uid(body=None):
	"""REM-UID- + body (random when omitted) + check character. Uniqueness is the caller's job."""
	body = cstr(body).upper() if body else "".join(secrets.choice(CROCKFORD_ALPHABET) for _i in range(UID_RANDOM_CHARS))
	if len(body) != UID_RANDOM_CHARS or any(ch not in _CROCKFORD_INDEX for ch in body):
		raise frappe.ValidationError(_("A Unique Patient ID body is {0} Crockford base32 characters").format(UID_RANDOM_CHARS))
	return f"{UID_PREFIX}{body}{damm32_check_char(body)}"


# ---------------------------------------------------------------------------
# Codes
# ---------------------------------------------------------------------------


def make_code(prefix, seq, digits=None):
	"""PREFIX + zero-padded seq + check char, e.g. make_code("RU", 42) -> RU000000042<c>."""
	spec = get_prefix(prefix)
	if not spec:
		raise frappe.ValidationError(_("Unknown barcode prefix {0}").format(prefix))
	width = cint(digits) or spec["digits"]
	seq = cint(seq)
	if seq < 0 or len(str(seq)) > width:
		raise frappe.ValidationError(_("Sequence {0} does not fit {1} digits").format(seq, width))
	body = str(seq).zfill(width)
	return f"{cstr(prefix).strip().upper()}{body}{check_char(body, spec['check'])}"


def parse_code(code):
	"""{code, prefix, body, check, valid, label} for any registered code; prefix None when unknown."""
	code = cstr(code).strip().upper()
	if re.sub(r"[\s_-]+", "", code).startswith("REMUID"):
		uid = normalize_uid(code)
		rest = uid[len(UID_PREFIX) :]
		return {"code": uid, "prefix": UID_PREFIX.rstrip("-"), "body": rest[:-1], "check": rest[-1:], "valid": validate_uid(uid), "label": UID_LABEL}
	prefix = match_prefix(code)
	out = {"code": code, "prefix": prefix, "body": None, "check": None, "valid": False, "label": None}
	if not prefix:
		return out
	spec = PREFIXES[prefix]
	rest = code[len(prefix):]
	out.update({"label": spec["label"], "body": rest[:-1], "check": rest[-1:]})
	if spec["check"] == CHECK_VERHOEFF:
		out["valid"] = rest.isdigit() and verhoeff_validate(rest)
	else:
		out["valid"] = mod11_validate(rest)
	return out


def validate_code(code, prefix=None):
	parsed = parse_code(code)
	if prefix and parsed["prefix"] != cstr(prefix).strip().upper():
		return False
	return bool(parsed["valid"])


# ---------------------------------------------------------------------------
# Code 128
# ---------------------------------------------------------------------------

# Bar / space widths for symbol values 0..105, then STOP (106). Every symbol is 11 modules, STOP is 13.
_C128 = (
	"212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
	"221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
	"221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
	"212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
	"231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
	"231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
	"314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
	"112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
	"111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
	"214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
	"114131", "311141", "411131", "211412", "211214", "211232", "2331112",
)
_C128_START_B = 104
_C128_START_C = 105
_C128_STOP = 106


def code128_values(data):
	"""Symbol values (start, data, checksum, stop). All-digit even-length data uses set C, else set B."""
	data = cstr(data)
	if not data:
		raise frappe.ValidationError(_("Nothing to encode"))
	if data.isdigit() and len(data) % 2 == 0:
		values = [_C128_START_C] + [int(data[i : i + 2]) for i in range(0, len(data), 2)]
	else:
		values = [_C128_START_B]
		for ch in data:
			o = ord(ch)
			if o < 32 or o > 126:
				raise frappe.ValidationError(_("Code 128 set B cannot encode {0!r}").format(ch))
			values.append(o - 32)
	checksum = values[0] + sum(v * i for i, v in enumerate(values[1:], start=1))
	return values + [checksum % 103, _C128_STOP]


def code128_modules(data):
	"""'1' = bar module, '0' = space module (no quiet zone)."""
	out = []
	for value in code128_values(data):
		for j, width in enumerate(_C128[value]):
			out.append(("1" if j % 2 == 0 else "0") * int(width))
	return "".join(out)


def code128_svg(data, module=2, height=50, quiet=10, show_text=True, font_size=12):
	modules = code128_modules(data)
	module = max(1, cint(module) or 2)
	width = (len(modules) + 2 * quiet) * module
	total_h = height + (font_size + 4 if show_text else 0)
	rects = []
	i = 0
	while i < len(modules):
		if modules[i] == "1":
			j = i
			while j < len(modules) and modules[j] == "1":
				j += 1
			rects.append(f'<rect x="{(quiet + i) * module}" y="0" width="{(j - i) * module}" height="{height}"/>')
			i = j
		else:
			i += 1
	text = ""
	if show_text:
		text = (
			f'<text x="{width / 2:g}" y="{height + font_size}" font-family="monospace" '
			f'font-size="{font_size}" text-anchor="middle">{html.escape(cstr(data))}</text>'
		)
	return (
		f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{total_h}" '
		f'viewBox="0 0 {width} {total_h}" preserveAspectRatio="none">'
		f'<rect width="{width}" height="{total_h}" fill="#fff"/><g fill="#000">{"".join(rects)}</g>{text}</svg>'
	)


# ---------------------------------------------------------------------------
# Labels
# ---------------------------------------------------------------------------

LABEL_SIZES = {"50x25": (50, 25), "38x25": (38, 25), "50x30": (50, 30), "60x40": (60, 40), "100x50": (100, 50)}
DEFAULT_LABEL_SIZE = "50x25"
DOTS_PER_MM = 8  # 203 dpi thermal heads


def label_size(size=None):
	size = cstr(size or DEFAULT_LABEL_SIZE).strip().lower()
	if size in LABEL_SIZES:
		return LABEL_SIZES[size]
	m = re.match(r"^(\d{2,3})x(\d{2,3})$", size)
	if m:
		w, h = int(m.group(1)), int(m.group(2))
		if 20 <= w <= 120 and 10 <= h <= 120:
			return w, h
	raise frappe.ValidationError(_("Label size must look like 50x25 (mm)"))


def clean_codes(codes):
	if isinstance(codes, str):
		text = codes.strip()
		if text.startswith("["):
			codes = frappe.parse_json(text)
		else:
			codes = re.split(r"[\s,;]+", text)
	out = []
	for c in codes or []:
		c = cstr(c).strip()
		if not c:
			continue
		if not CODE_RE.match(c):
			raise frappe.ValidationError(_("Invalid barcode value {0}").format(c[:40]))
		out.append(c)
	if not out:
		raise frappe.ValidationError(_("No barcodes to print"))
	if len(out) > MAX_LABELS:
		raise frappe.ValidationError(_("At most {0} labels per print").format(MAX_LABELS))
	return out


def _safe_text(value, limit=40):
	return re.sub(r"[^A-Za-z0-9 ._:/#()-]", "", cstr(value))[:limit]


def labels_html(codes, size=None, captions=None):
	w, h = label_size(size)
	captions = captions or {}
	cells = []
	for code in codes:
		caption = html.escape(_safe_text(captions.get(code) or ""))
		svg = code128_svg(code, module=2, height=48, quiet=8, show_text=True, font_size=13)
		cells.append(
			f'<div class="lbl"><div class="bc">{svg}</div>'
			f'{f"<div class=cap>{caption}</div>" if caption else ""}</div>'
		)
	bar_h = max(8, h - 9) if any(captions.values()) else max(8, h - 5)
	return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body {{ margin: 0; font-family: Arial, sans-serif; }}
.lbl {{ display: inline-block; width: {w}mm; height: {h}mm; margin: 0 2mm 2mm 0; padding: 1.5mm; box-sizing: border-box;
  border: 0.2mm dashed #bbb; overflow: hidden; vertical-align: top; page-break-inside: avoid; }}
.bc svg {{ width: {w - 3}mm; height: {bar_h}mm; }}
.cap {{ font-size: 8pt; text-align: center; white-space: nowrap; overflow: hidden; }}
</style></head><body>{''.join(cells)}</body></html>"""


def labels_pdf(codes, size=None, captions=None):
	from frappe.utils.pdf import get_pdf

	return get_pdf(
		labels_html(codes, size, captions),
		{"page-size": "A4", "margin-top": "8mm", "margin-bottom": "8mm", "margin-left": "8mm", "margin-right": "8mm"},
	)


def labels_zpl(codes, size=None, captions=None):
	w, h = label_size(size)
	pw, ll = w * DOTS_PER_MM, h * DOTS_PER_MM
	bar_h = max(40, ll - 90)
	captions = captions or {}
	out = []
	for code in codes:
		data = code.replace("^", "").replace("~", "")
		caption = _safe_text(captions.get(code) or "")
		block = [
			"^XA",
			"^CI28",
			f"^PW{pw}",
			f"^LL{ll}",
			"^LH0,0",
			f"^FO24,16^BY2,3,{bar_h}^BCN,{bar_h},Y,N,N^FD{data}^FS",
		]
		if caption:
			block.append(f"^FO24,{bar_h + 50}^A0N,22,22^FD{caption}^FS")
		block.append("^XZ")
		out.append("\n".join(block))
	return "\n".join(out) + "\n"


def labels_tspl(codes, size=None, captions=None):
	w, h = label_size(size)
	bar_h = max(40, h * DOTS_PER_MM - 90)
	captions = captions or {}
	out = [f"SIZE {w} mm,{h} mm", "GAP 2 mm,0 mm", "DIRECTION 1", "REFERENCE 0,0"]
	for code in codes:
		data = code.replace('"', "")
		caption = _safe_text(captions.get(code) or "")
		out += ["CLS", f'BARCODE 24,16,"128",{bar_h},1,0,2,2,"{data}"']
		if caption:
			out.append(f'TEXT 24,{bar_h + 50},"2",0,1,1,"{caption}"')
		out.append("PRINT 1,1")
	return "\r\n".join(out) + "\r\n"


def render_labels(codes, fmt="pdf", size=None, captions=None):
	"""{fmt, filename, count, content_base64} for pdf; {fmt, filename, count, content} for zpl / tspl."""
	codes = clean_codes(codes)
	fmt = cstr(fmt or "pdf").strip().lower()
	if isinstance(captions, str) and captions.strip():
		captions = frappe.parse_json(captions)
	captions = {cstr(k): cstr(v) for k, v in (captions or {}).items()} if isinstance(captions, dict) else {}
	label_size(size)
	if fmt == "pdf":
		pdf = labels_pdf(codes, size, captions)
		return {"fmt": "pdf", "filename": "labels.pdf", "count": len(codes), "content_base64": base64.b64encode(pdf).decode()}
	if fmt == "zpl":
		return {"fmt": "zpl", "filename": "labels.zpl", "count": len(codes), "content": labels_zpl(codes, size, captions)}
	if fmt == "tspl":
		return {"fmt": "tspl", "filename": "labels.tspl", "count": len(codes), "content": labels_tspl(codes, size, captions)}
	raise frappe.ValidationError(_("Label format must be pdf, zpl or tspl"))


LABEL_ROLES = frozenset(
	{
		"System Manager",
		"Health System Admin",
		"Lab Manager",
		"Lab Technician",
		"Pathologist",
		"Phlebotomist",
		"Franchisee Operator",
		"Administrator",
	}
)


@frappe.whitelist(allow_guest=True)
def print_labels(codes=None, fmt="pdf", size=None, captions=None, sid=None):
	"""Staff label printing: Code 128 labels as PDF (A4 sheet), ZPL or TSPL."""
	from health_ecosystem_core.health_ecosystem_core.api import _error, _require_mobile_auth, _success

	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	if not set(frappe.get_roles(frappe.session.user)) & LABEL_ROLES:
		return _error(_("Staff access required"), 403)
	try:
		return _success(render_labels(codes, fmt, size, captions))
	except frappe.ValidationError as exc:
		return _error(cstr(exc) or _("Invalid request"))


@frappe.whitelist(allow_guest=True)
def validate_barcode(code=None, prefix=None, sid=None):
	from health_ecosystem_core.health_ecosystem_core.api import _error, _require_mobile_auth, _success

	if not _require_mobile_auth(sid):
		return _error(_("Not authenticated"), 401)
	parsed = parse_code(code)
	if prefix and parsed["prefix"] != cstr(prefix).strip().upper():
		parsed["valid"] = False
	return _success(parsed)
