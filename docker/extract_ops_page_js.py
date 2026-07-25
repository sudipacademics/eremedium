from pathlib import Path
import re

src = Path(
    r"C:\develop\My_Lab_System\health_ecosystem_core\health_ecosystem_core\health_ecosystem_core\clinical_phase71_ops_dashboards.py"
).read_text(encoding="utf-8")
m = re.search(r'def _ops_page_js\(\):\n\treturn r"""(.*?)"""', src, re.S)
if not m:
    raise SystemExit("ops page js not found")
js = m.group(1).lstrip("\n")
out = Path(
    r"C:\develop\My_Lab_System\health_ecosystem_core\health_ecosystem_core\health_ecosystem_core\page\hec_company_ops\hec_company_ops.js"
)
out.write_text(js, encoding="utf-8")
print("WROTE", len(js))
