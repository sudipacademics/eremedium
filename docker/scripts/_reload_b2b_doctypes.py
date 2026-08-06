import os
import frappe

os.chdir("/home/frappe/frappe-bench")
frappe.init(site="health.localhost", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
for module_name, label in (
    ("b2b_logistics_assignment", "B2B Logistics Assignment"),
    ("b2b_collection_centre", "B2B Collection Centre"),
    ("b2b_sales_entry", "B2B Sales Entry"),
):
    frappe.reload_doc("Health Ecosystem Core", "doctype", module_name, force=True)
    print("reloaded", label, bool(frappe.db.exists("DocType", label)))
from health_ecosystem_core.health_ecosystem_core.clinical_phase87_b2b_sales import (  # noqa: E402
    list_b2b_collection_centres,
)

print("phase87_ok", callable(list_b2b_collection_centres))
frappe.db.commit()
frappe.destroy()
