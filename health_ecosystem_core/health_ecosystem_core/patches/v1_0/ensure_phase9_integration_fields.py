"""Ensure Phase 9 integration custom fields on Health Ecosystem Settings."""

import frappe


def execute():
    from health_ecosystem_core.health_ecosystem_core.clinical_phase9 import ensure_integration_settings_fields

    ensure_integration_settings_fields()
