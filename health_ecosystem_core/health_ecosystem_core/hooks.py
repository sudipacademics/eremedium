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
    "health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair.bind_hrms_module_app",
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
    "Diagnostic Test Master": "public/js/diagnostic_test_master.js",
}

scheduler_events = {
    "cron": {
        "*/10 * * * *": [
            "health_ecosystem_core.health_ecosystem_core.clinical_phase121_payment_core.poll_pending_intents",
            "health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers.post_due_circuit_shares",
        ],
    },
    "hourly": [
        "health_ecosystem_core.health_ecosystem_core.clinical_phase27.run_hourly_reminders",
    ],
    "daily": [
        "health_ecosystem_core.health_ecosystem_core.clinical_phase73f_ad_sync.run_daily_hiring_ads_sync",
        "health_ecosystem_core.health_ecosystem_core.clinical_phase93_franchise_go_live.run_daily_franchise_campaign_launches",
        "health_ecosystem_core.health_ecosystem_core.clinical_phase98_cpt.run_daily_cpt_refresh",
    ],
}

doc_events = {
    "HEC Wellness Video": {
        "validate": "health_ecosystem_core.health_ecosystem_core.clinical_phase114_wellness_videos.on_validate",
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

# hec-phase132 hooks (appended by deploy-partner-tiers; merges into doc_events / scheduler_events above)
_hec_p132_events = {'Health Patient': {'before_insert': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.on_health_patient_before_insert'}, 'Customer TRF': {'before_save': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.fill_universal_patient_id'}, 'Doctor Appointment': {'before_save': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.fill_universal_patient_id'}, 'Clinical Prescription': {'before_save': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.fill_universal_patient_id'}, 'Pharmacy Order': {'after_insert': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.attach_private_rx'}, 'Custody Scan Event': {'validate': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.on_custody_event_validate', 'on_trash': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.on_custody_event_trash', 'before_rename': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.block_custody_rename'}}
_hec_p132_cron = {'*/10 * * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers.post_due_circuit_shares']}
doc_events = globals().get("doc_events") or {}
for _dt, _evs in _hec_p132_events.items():
    _cur = doc_events.setdefault(_dt, {})
    for _ev, _fn in _evs.items():
        _have = _cur.get(_ev)
        _list = [_have] if isinstance(_have, str) else list(_have or [])
        if _fn not in _list:
            _list.append(_fn)
        _cur[_ev] = _list
scheduler_events = globals().get("scheduler_events") or {}
_cron = scheduler_events.setdefault("cron", {})
for _expr, _fns in _hec_p132_cron.items():
    _list = list(_cron.get(_expr) or [])
    for _fn in _fns:
        if _fn not in _list:
            _list.append(_fn)
    _cron[_expr] = _list

# hec-p133 hooks (appended by deploy-partner-tiers; merges into doc_events / scheduler_events above)
_hec_p133_events = {'Health Patient': {'before_insert': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.on_health_patient_before_insert'}, 'Customer TRF': {'before_save': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.fill_universal_patient_id'}, 'Doctor Appointment': {'before_save': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.fill_universal_patient_id'}, 'Clinical Prescription': {'before_save': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.fill_universal_patient_id'}, 'Pharmacy Order': {'after_insert': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.attach_private_rx'}, 'Custody Scan Event': {'validate': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.on_custody_event_validate', 'on_trash': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.on_custody_event_trash', 'before_rename': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.block_custody_rename'}}
_hec_p133_cron = {'*/10 * * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers.post_due_circuit_shares'], '*/2 * * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase133_phlebofirst.pf_rebroadcast_and_expire']}
doc_events = globals().get("doc_events") or {}
for _dt, _evs in _hec_p133_events.items():
    _cur = doc_events.setdefault(_dt, {})
    for _ev, _fn in _evs.items():
        _have = _cur.get(_ev)
        _list = [_have] if isinstance(_have, str) else list(_have or [])
        if _fn not in _list:
            _list.append(_fn)
        _cur[_ev] = _list
scheduler_events = globals().get("scheduler_events") or {}
_cron = scheduler_events.setdefault("cron", {})
for _expr, _fns in _hec_p133_cron.items():
    _list = list(_cron.get(_expr) or [])
    for _fn in _fns:
        if _fn not in _list:
            _list.append(_fn)
    _cron[_expr] = _list

# hec-p134 hooks (appended by deploy-partner-tiers; merges into doc_events / scheduler_events above)
_hec_p134_events = {'Health Patient': {'before_insert': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.on_health_patient_before_insert'}, 'Customer TRF': {'before_save': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.fill_universal_patient_id'}, 'Doctor Appointment': {'before_save': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.fill_universal_patient_id'}, 'Clinical Prescription': {'before_save': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.fill_universal_patient_id'}, 'Pharmacy Order': {'after_insert': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.attach_private_rx'}, 'Custody Scan Event': {'validate': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.on_custody_event_validate', 'on_trash': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.on_custody_event_trash', 'before_rename': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.block_custody_rename'}, 'Collection To Lab Mapping': {'validate': 'health_ecosystem_core.health_ecosystem_core.clinical_phase134_teleporter.on_mapping_validate'}}
_hec_p134_cron = {'*/10 * * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers.post_due_circuit_shares'], '*/2 * * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase133_phlebofirst.pf_rebroadcast_and_expire'], '*/15 * * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase134_teleporter.tp_overdue_transit_alerts'], '30 0 * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase134_teleporter.tp_expire_subscriptions']}
doc_events = globals().get("doc_events") or {}
for _dt, _evs in _hec_p134_events.items():
    _cur = doc_events.setdefault(_dt, {})
    for _ev, _fn in _evs.items():
        _have = _cur.get(_ev)
        _list = [_have] if isinstance(_have, str) else list(_have or [])
        if _fn not in _list:
            _list.append(_fn)
        _cur[_ev] = _list
scheduler_events = globals().get("scheduler_events") or {}
_cron = scheduler_events.setdefault("cron", {})
for _expr, _fns in _hec_p134_cron.items():
    _list = list(_cron.get(_expr) or [])
    for _fn in _fns:
        if _fn not in _list:
            _list.append(_fn)
    _cron[_expr] = _list

# hec-p135 hooks (appended by deploy-partner-tiers; merges into doc_events / scheduler_events above)
_hec_p135_events = {'Health Patient': {'before_insert': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.on_health_patient_before_insert'}, 'Customer TRF': {'before_save': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.fill_universal_patient_id'}, 'Doctor Appointment': {'before_save': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.fill_universal_patient_id'}, 'Clinical Prescription': {'before_save': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.fill_universal_patient_id'}, 'Pharmacy Order': {'after_insert': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.attach_private_rx'}, 'Custody Scan Event': {'validate': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.on_custody_event_validate', 'on_trash': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.on_custody_event_trash', 'before_rename': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.block_custody_rename'}, 'Collection To Lab Mapping': {'validate': 'health_ecosystem_core.health_ecosystem_core.clinical_phase134_teleporter.on_mapping_validate'}}
_hec_p135_cron = {'*/10 * * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers.post_due_circuit_shares'], '*/2 * * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase133_phlebofirst.pf_rebroadcast_and_expire'], '*/15 * * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase134_teleporter.tp_overdue_transit_alerts'], '30 0 * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase134_teleporter.tp_expire_subscriptions'], '*/5 * * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase135_uberdoc.ud_expire_holds', 'health_ecosystem_core.health_ecosystem_core.clinical_emr.emr_retry_webhooks']}
doc_events = globals().get("doc_events") or {}
for _dt, _evs in _hec_p135_events.items():
    _cur = doc_events.setdefault(_dt, {})
    for _ev, _fn in _evs.items():
        _have = _cur.get(_ev)
        _list = [_have] if isinstance(_have, str) else list(_have or [])
        if _fn not in _list:
            _list.append(_fn)
        _cur[_ev] = _list
scheduler_events = globals().get("scheduler_events") or {}
_cron = scheduler_events.setdefault("cron", {})
for _expr, _fns in _hec_p135_cron.items():
    _list = list(_cron.get(_expr) or [])
    for _fn in _fns:
        if _fn not in _list:
            _list.append(_fn)
    _cron[_expr] = _list

# hec-p136 hooks (appended by deploy-partner-tiers; merges into doc_events / scheduler_events above)
_hec_p136_events = {'Health Patient': {'before_insert': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.on_health_patient_before_insert', 'validate': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.on_health_patient_validate'}, 'Customer TRF': {'before_save': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.fill_universal_patient_id'}, 'Doctor Appointment': {'before_save': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.fill_universal_patient_id'}, 'Clinical Prescription': {'before_save': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.fill_universal_patient_id', 'on_update': 'health_ecosystem_core.health_ecosystem_core.clinical_phase136_emr.on_clinical_prescription_update'}, 'Pharmacy Order': {'after_insert': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.attach_private_rx'}, 'Custody Scan Event': {'validate': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.on_custody_event_validate', 'on_trash': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.on_custody_event_trash', 'before_rename': 'health_ecosystem_core.health_ecosystem_core.clinical_phase132_foundations.block_custody_rename'}, 'Collection To Lab Mapping': {'validate': 'health_ecosystem_core.health_ecosystem_core.clinical_phase134_teleporter.on_mapping_validate'}, 'Lab Report': {'on_update': 'health_ecosystem_core.health_ecosystem_core.clinical_phase136_emr.on_lab_report_update'}, 'Patient Care Journey': {'on_update': 'health_ecosystem_core.health_ecosystem_core.clinical_phase136_emr.on_journey_update'}, 'Patient Vital Log': {'after_insert': 'health_ecosystem_core.health_ecosystem_core.clinical_phase136_emr.on_vital_log_insert'}, 'Clinical Encounter': {'on_update': 'health_ecosystem_core.health_ecosystem_core.clinical_phase136_emr.on_encounter_update'}, 'Digital Prescription': {'on_update': 'health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle.on_digital_prescription_update'}, 'Tutorial Enrollment': {'on_update': 'health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle.on_enrollment_update'}}
_hec_p136_cron = {'*/10 * * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase126_partner_tiers.post_due_circuit_shares'], '*/2 * * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase133_phlebofirst.pf_rebroadcast_and_expire'], '*/15 * * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase134_teleporter.tp_overdue_transit_alerts', 'health_ecosystem_core.health_ecosystem_core.clinical_phase136_emr.vault_sync_recent', 'health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle.vault_dose_reminders'], '30 0 * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase134_teleporter.tp_expire_subscriptions'], '*/5 * * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase135_uberdoc.ud_expire_holds', 'health_ecosystem_core.health_ecosystem_core.clinical_emr.emr_retry_webhooks'], '20 0 * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle.vault_mark_missed_doses'], '30 8 * * *': ['health_ecosystem_core.health_ecosystem_core.clinical_phase136_lifestyle.vault_daily_nudges']}
doc_events = globals().get("doc_events") or {}
for _dt, _evs in _hec_p136_events.items():
    _cur = doc_events.setdefault(_dt, {})
    for _ev, _fn in _evs.items():
        _have = _cur.get(_ev)
        _list = [_have] if isinstance(_have, str) else list(_have or [])
        if _fn not in _list:
            _list.append(_fn)
        _cur[_ev] = _list
scheduler_events = globals().get("scheduler_events") or {}
_cron = scheduler_events.setdefault("cron", {})
for _expr, _fns in _hec_p136_cron.items():
    _list = list(_cron.get(_expr) or [])
    for _fn in _fns:
        if _fn not in _list:
            _list.append(_fn)
    _cron[_expr] = _list
