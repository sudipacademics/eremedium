#!/bin/bash
set -e
cd /home/frappe/frappe-bench
if [ -f apps/health_ecosystem_core/health_ecosystem_core/hooks.py ]; then
  if ! ./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.api" 2>/dev/null; then
    echo "Installing health_ecosystem_core from apps mount..."
    rm -rf /tmp/health_ecosystem_core_install
    cp -a apps/health_ecosystem_core /tmp/health_ecosystem_core_install
    PYTHONDONTWRITEBYTECODE=1 ./env/bin/pip install -q /tmp/health_ecosystem_core_install || true
  elif ! ./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.mobile_booking" 2>/dev/null; then
    echo "Reinstalling health_ecosystem_core (mobile_booking missing)..."
    rm -rf /tmp/health_ecosystem_core_install
    cp -a apps/health_ecosystem_core /tmp/health_ecosystem_core_install
    PYTHONDONTWRITEBYTECODE=1 ./env/bin/pip install -q --force-reinstall --no-deps /tmp/health_ecosystem_core_install || true
  fi
  if ! grep -q health_ecosystem_core sites/apps.txt; then
    echo health_ecosystem_core >> sites/apps.txt
  fi
  APPS_PKG=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
  if [ -d "$APPS_PKG" ]; then
    SITE_PKG=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.api as m, os; print(os.path.dirname(m.__file__))" 2>/dev/null || true)
    if [ -n "$SITE_PKG" ] && [ -d "$SITE_PKG" ] && [ "$APPS_PKG" != "$SITE_PKG" ]; then
      chmod -R u+w "$SITE_PKG" 2>/dev/null || true
      # CRM_KEEP_GUARD: a copy missing these markers must not replace one that has them.
      crm_good() {
        local f="$1" name="$2"
        [ -f "$f" ] || return 1
        case "$name" in
          clinical_people_access.py)
            grep -q 'Service Lead' "$f" && grep -q 'WhatsApp Centre' "$f" && grep -q '_checked_crm_categories' "$f" ;;
          clinical_phase87_whatsapp.py)
            grep -q '_hydrate_message_media' "$f" && grep -q 'Sit just after the latest message' "$f" ;;
          clinical_secrets.py)
            grep -q 'get_crm_service_whatsapp_settings' "$f" ;;
          api.py)
            grep -q 'save_crm_service_whatsapp_api' "$f" && grep -q 'mark_crm_whatsapp_conversation_read' "$f" ;;
          *)
            return 1 ;;
        esac
      }
      copy_if_diff() {
        local src="$1" dest="$2"
        if [ ! -f "$dest" ] || ! cmp -s "$src" "$dest"; then
          chattr -i "$dest" 2>/dev/null || true
          cp -f "$src" "$dest" 2>/dev/null || true
        fi
      }
      PIN_DIR=apps/health_ecosystem_core/crm-pins
      for pyfile in api.py clinical_iam.py clinical_utils.py clinical_setup.py patient_bridge.py clinical_journey.py mobile_booking.py clinical_phase6.py clinical_phase75_patient_referral.py clinical_people_access.py clinical_phase87_whatsapp.py clinical_secrets.py; do
        case "$pyfile" in
          clinical_people_access.py|clinical_phase87_whatsapp.py|clinical_secrets.py|api.py)
            src=""
            if crm_good "$APPS_PKG/$pyfile" "$pyfile"; then
              src="$APPS_PKG/$pyfile"
            elif crm_good "$PIN_DIR/$pyfile" "$pyfile"; then
              src="$PIN_DIR/$pyfile"
              echo "CRM_KEEP_GUARD restored $pyfile from pin"
            elif crm_good "$SITE_PKG/$pyfile" "$pyfile"; then
              src="$SITE_PKG/$pyfile"
              echo "CRM_KEEP_GUARD kept site-packages $pyfile"
            fi
            if [ -n "$src" ]; then
              copy_if_diff "$src" "$APPS_PKG/$pyfile"
              copy_if_diff "$src" "$SITE_PKG/$pyfile"
              if [ "$pyfile" = "clinical_people_access.py" ]; then
                copy_if_diff "$src" /home/frappe/frappe-bench/crm_clinical_people_access.GOOD.py
              fi
            fi
            ;;
          *)
            if [ -f "$APPS_PKG/$pyfile" ]; then
              copy_if_diff "$APPS_PKG/$pyfile" "$SITE_PKG/$pyfile"
            fi
            ;;
        esac
      done
      # Printed lab report. Python imports site-packages, so a new container
      # would otherwise keep the image copy and drop these fixes. Lock the
      # saved files so a later copy cannot overwrite them.
      for pyfile in clinical_report_format.py clinical_phase88_diagnostic_formats.py clinical_phase125_report_share.py clinical_report_page_layout.py clinical_phase58_report_signatories.py; do
        if [ -f "$APPS_PKG/$pyfile" ]; then
          copy_if_diff "$APPS_PKG/$pyfile" "$SITE_PKG/$pyfile"
          rm -f "$SITE_PKG/__pycache__/${pyfile%.py}"*.pyc
          chattr +i "$APPS_PKG/$pyfile" 2>/dev/null || true
          chattr +i "$SITE_PKG/$pyfile" 2>/dev/null || true
        fi
      done
      echo "Synced health_ecosystem_core modules -> $SITE_PKG"
    fi
  fi
fi
exec "$@"
