#!/usr/bin/env bash
set -euo pipefail
cd /opt/health-ecosystem/docker

HOST=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
SRC=/tmp/hec-refer

echo "=== sync backend files ==="
cp -f "$SRC/clinical_phase75_patient_referral.py" "$HOST/"
cp -f "$SRC/clinical_iam.py" "$HOST/"
cp -f "$SRC/clinical_otp.py" "$HOST/"
cp -f "$SRC/email_auth.py" "$HOST/"
cp -f "$SRC/clinical_phase26.py" "$HOST/"
cp -f "$SRC/patient_bridge.py" "$HOST/"
cp -f "$SRC/api.py" "$HOST/"
cp -f "$SRC/health_patient.json" "$HOST/doctype/health_patient/health_patient.json"
mkdir -p "$HOST/doctype/patient_wallet_transaction"
cp -f "$SRC/patient_wallet_transaction.json" "$HOST/doctype/patient_wallet_transaction/patient_wallet_transaction.json"
cp -f "$SRC/patient_wallet_transaction.py" "$HOST/doctype/patient_wallet_transaction/patient_wallet_transaction.py"
cp -f "$SRC/pwt_init.py" "$HOST/doctype/patient_wallet_transaction/__init__.py"

./safe-update-app.sh

echo "=== setup + smoke phase75 ==="
sleep 4
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase75_patient_referral.setup_phase75'
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase75_patient_referral.smoke_phase75'
echo DONE
