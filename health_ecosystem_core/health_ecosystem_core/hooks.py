app_name = "health_ecosystem_core"
app_title = "Health Ecosystem Core"
app_publisher = "Health Ecosystem"
app_description = "Clinical care, lab TRF, LIS bridge, franchisee hub & pharmacy orders"
app_email = "ops@healthecosystem.local"
app_license = "MIT"
app_version = "1.0.0"

required_apps = ["erpnext"]

after_install = "health_ecosystem_core.health_ecosystem_core.init.after_install"

before_request = [
    "health_ecosystem_core.health_ecosystem_core.desk_route_redirect.redirect_broken_desk_routes",
    "health_ecosystem_core.health_ecosystem_core.cors.sanitize_broken_session",
]

override_whitelisted_methods = {
    "hrms.overrides.employee_master.get_timeline_data": (
        "health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair.safe_get_timeline_data"
    ),
    "frappe.integrations.oauth2_logins.login_via_google": (
        "health_ecosystem_core.health_ecosystem_core.clinical_phase18b.portal_google_oauth_callback"
    ),
    "frappe.utils.print_format.download_pdf": (
        "health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.safe_download_pdf"
    ),
}

app_include_js = [
    "/assets/health_ecosystem_core/js/hec_desk_redirects.js",
    "/assets/health_ecosystem_core/js/hec_lab_bill_entry.js",
]

doctype_js = {
    "Health Patient": "public/js/health_patient.js",
    "Patient Care Journey": "public/js/patient_care_journey.js",
    "Clinical Prescription": "public/js/clinical_prescription.js",
    # Bill Entry is loaded via app_include_js (Frappe doctype_js lists only keep first path)
    "Customer TRF": "public/js/customer_trf.js",
    "Lab Report": "public/js/lab_report.js",
    "Pharmacy Order": "public/js/pharmacy_order.js",
    "Health Ecosystem Settings": "public/js/health_ecosystem_settings.js",
    "Purchase Invoice": "public/js/hec_invoice_marg.js",
    "Sales Invoice": "public/js/hec_invoice_marg.js",
}

scheduler_events = {
    "hourly": [
        "health_ecosystem_core.health_ecosystem_core.clinical_phase27.run_hourly_reminders",
    ],
    "daily": [
        "health_ecosystem_core.health_ecosystem_core.clinical_phase28_ops.run_daily_ops_emails",
        "health_ecosystem_core.health_ecosystem_core.clinical_phase73f_ad_sync.run_daily_hiring_ads_sync",
    ],
    "weekly": [
        "health_ecosystem_core.health_ecosystem_core.clinical_phase28_ops.run_weekly_ops_emails",
    ],
    "monthly": [
        "health_ecosystem_core.health_ecosystem_core.clinical_phase28_ops.run_monthly_ops_emails",
    ],
}

doc_events = {
    "Customer TRF": {
        "after_insert": "health_ecosystem_core.health_ecosystem_core.clinical_phase51_employee_gamification.on_doc_after_insert",
        "on_update": "health_ecosystem_core.health_ecosystem_core.clinical_phase51_employee_gamification.on_doc_on_update",
    },
    "Doctor Appointment": {
        "after_insert": "health_ecosystem_core.health_ecosystem_core.clinical_phase51_employee_gamification.on_doc_after_insert",
        "on_update": "health_ecosystem_core.health_ecosystem_core.clinical_phase51_employee_gamification.on_doc_on_update",
    },
    "Pharmacy Order": {
        "after_insert": "health_ecosystem_core.health_ecosystem_core.clinical_phase51_employee_gamification.on_doc_after_insert",
        "on_update": "health_ecosystem_core.health_ecosystem_core.clinical_phase51_employee_gamification.on_doc_on_update",
    },
    "Sales Invoice": {
        "on_submit": "health_ecosystem_core.health_ecosystem_core.clinical_phase51_employee_gamification.on_doc_on_submit",
    },
    # Desk / form assignment of assigned_rep must create pending Reach Log Visit immediately.
    "Franchise Sales Lead": {
        "after_insert": "health_ecosystem_core.health_ecosystem_core.clinical_phase25.on_franchise_sales_lead_update",
        "on_update": "health_ecosystem_core.health_ecosystem_core.clinical_phase25.on_franchise_sales_lead_update",
    },
}

fixtures = [
    {
        "dt": "Role",
        "filters": [["name", "in", [
            "Health System Admin", "Franchisee Operator", "Lab Technician",
            "Physician", "Nurse", "Phlebotomist", "Pathologist",
        ]]],
    },
    {
        "dt": "Custom Field",
        "filters": [["module", "=", "Health Ecosystem Core"]],
    },
]

jinja = {
    "methods": [
        "health_ecosystem_core.health_ecosystem_core.clinical_phase69_pharma_bill.build_landscape_bill_context",
    ],
}
