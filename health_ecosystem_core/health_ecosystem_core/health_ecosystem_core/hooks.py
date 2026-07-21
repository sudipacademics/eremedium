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
}

app_include_js = ["/assets/health_ecosystem_core/js/hec_desk_redirects.js"]

doctype_js = {
    "Health Patient": "public/js/health_patient.js",
    "Patient Care Journey": "public/js/patient_care_journey.js",
    "Clinical Prescription": "public/js/clinical_prescription.js",
    "Customer TRF": "public/js/customer_trf.js",
    "Lab Report": "public/js/lab_report.js",
    "Health Ecosystem Settings": "public/js/health_ecosystem_settings.js",
}

scheduler_events = {
    "hourly": [
        "health_ecosystem_core.health_ecosystem_core.clinical_phase27.run_hourly_reminders",
    ],
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
