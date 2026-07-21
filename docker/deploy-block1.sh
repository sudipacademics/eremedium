#!/bin/bash
set -e
cd /opt/health-ecosystem/docker
echo "=== confirm mount: apps/ api.py has new endpoints? ==="
docker compose exec -T backend bash -lc "grep -c 'create_b2b_wallet_razorpay_order' apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py"
docker compose exec -T backend bash <<'EOS'
set -e
cd /home/frappe/frappe-bench
./env/bin/python -m py_compile apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/api.py && echo PYCOMPILE_OK
rm -rf /tmp/hec_reinstall
cp -a apps/health_ecosystem_core /tmp/hec_reinstall
./env/bin/pip install -q --force-reinstall --no-deps /tmp/hec_reinstall >/tmp/reinstall.log 2>&1 && echo REINSTALL_OK || { echo REINSTALL_FAIL; tail -20 /tmp/reinstall.log; }
echo "=== circular import test (phase18b first) ==="
./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.clinical_phase18b as m; print('phase18b OK complete_oauth_login=', hasattr(m,'complete_oauth_login'))"
echo "=== api lazy re-exports + new wallet endpoints ==="
./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.api as a; print('oauth', hasattr(a,'complete_oauth_login'), 'masked', hasattr(a,'start_masked_call'), 'wallet_order', hasattr(a,'create_b2b_wallet_razorpay_order'), 'wallet_verify', hasattr(a,'verify_b2b_wallet_razorpay_payment'))"
bench --site health.localhost clear-cache
EOS
docker compose restart backend queue-short queue-long scheduler
sleep 12
echo "=== P18b smoke ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase18b.smoke_phase18b_oauth 2>&1 | tail -6'
echo "=== P23 smoke ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase23.smoke_phase23 2>&1 | tail -6'
