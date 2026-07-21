#!/bin/bash
cd /opt/health-ecosystem/docker
echo "=== P18b full smoke output ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase18b.smoke_phase18b_oauth 2>&1 | head -40'
echo
echo "=== P18b: does smoke fn exist / signature ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && ./env/bin/python - <<PY
from health_ecosystem_core.health_ecosystem_core import clinical_phase18b as m
import inspect
for n in ["smoke_phase18b_oauth","smoke_oauth_login_token"]:
    f=getattr(m,n,None)
    print(n, "->", "OK" if f else "MISSING", (str(inspect.signature(f)) if f else ""))
PY'
echo
echo "=== P23 wallet rzp functions ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && ./env/bin/python - <<PY
from health_ecosystem_core.health_ecosystem_core import clinical_phase23 as m
import inspect, re
src=inspect.getsource(m)
for name in ["create_wallet_topup_order","verify_wallet_topup","smoke_phase23"]:
    i=src.find("def "+name)
    print("====",name,"====")
    print(src[i:i+1400] if i>=0 else "NOT FOUND")
    print()
PY'
