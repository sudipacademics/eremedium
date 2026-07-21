"""Ensure Phase 8 Lab Report DocTypes exist after migrate."""

import frappe


def execute():
    from health_ecosystem_core.health_ecosystem_core.clinical_phase8 import setup_phase8

    if frappe.db.exists("DocType", "Lab Report"):
        return
    setup_phase8(seed_demo_methods=False)
