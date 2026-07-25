#!/bin/bash
set -e
APP=/home/frappe/frappe-bench/apps/health_ecosystem_core
SP=/home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core
SRC=/tmp/hec_reinstall
ls "$SRC/health_ecosystem_core/health_ecosystem_core/clinical_phase73f_ad_sync.py"
cp -a "$SRC/health_ecosystem_core/health_ecosystem_core/clinical_phase73f_ad_sync.py" "$APP/health_ecosystem_core/health_ecosystem_core/"
cp -a "$SRC/health_ecosystem_core/health_ecosystem_core/clinical_phase73d_hiring_marketing.py" "$APP/health_ecosystem_core/health_ecosystem_core/"
cp -a "$SRC/health_ecosystem_core/health_ecosystem_core/clinical_phase73b_careers.py" "$APP/health_ecosystem_core/health_ecosystem_core/"
cp -a "$SRC/health_ecosystem_core/health_ecosystem_core/clinical_secrets.py" "$APP/health_ecosystem_core/health_ecosystem_core/"
cp -a "$SRC/health_ecosystem_core/hooks.py" "$APP/health_ecosystem_core/hooks.py"
cp -a "$SRC/health_ecosystem_core/health_ecosystem_core/doctype/hec_hiring_campaign/hec_hiring_campaign.json" "$APP/health_ecosystem_core/health_ecosystem_core/doctype/hec_hiring_campaign/"
cp -a "$SRC/health_ecosystem_core/health_ecosystem_core/doctype/hec_hiring_campaign/hec_hiring_campaign.py" "$APP/health_ecosystem_core/health_ecosystem_core/doctype/hec_hiring_campaign/"
cp -a "$SRC/health_ecosystem_core/health_ecosystem_core/doctype/hec_hiring_lead/hec_hiring_lead.json" "$APP/health_ecosystem_core/health_ecosystem_core/doctype/hec_hiring_lead/"
cp -a "$SRC/health_ecosystem_core/health_ecosystem_core/doctype/health_ecosystem_settings/health_ecosystem_settings.json" "$APP/health_ecosystem_core/health_ecosystem_core/doctype/health_ecosystem_settings/"
cd /home/frappe/frappe-bench
./env/bin/pip install -q --force-reinstall --no-deps /tmp/hec_reinstall
test -f "$SP/health_ecosystem_core/clinical_phase73f_ad_sync.py"
bench --site health.localhost clear-cache
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase73f_ad_sync.setup_phase73f
bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase73f_ad_sync.smoke_phase73f
echo DONE
