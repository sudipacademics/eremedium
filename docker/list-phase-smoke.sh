#!/bin/bash
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench
PKG=$(./env/bin/python -c "import health_ecosystem_core, os; print(os.path.dirname(health_ecosystem_core.__file__))")
echo "=== phases exposing smoke/self-test ==="
grep -lE "def smoke_phase|def run_phase.*smoke|def .*_smoke" "$PKG/health_ecosystem_core"/clinical_phase*.py | while read f; do
  base=$(basename "$f")
  fns=$(grep -oE "def (smoke_phase[0-9a-z_]*|run_phase[0-9a-z_]*smoke|smoke_[0-9a-z_]+)" "$f" | sed "s/def //" | tr "\n" "," )
  printf "%-42s %s\n" "$base" "$fns"
done | sort
echo "--- total phases with smoke ---"
grep -lE "def smoke_phase|def run_phase.*smoke" "$PKG/health_ecosystem_core"/clinical_phase*.py | wc -l
echo "=== guest-exposed whitelists (attack surface) ==="
grep -rlE "allow_guest=True" "$PKG/health_ecosystem_core"/clinical_phase*.py | wc -l
echo "=== bare except count (fragility signal) ==="
grep -rcE "except:|except Exception" "$PKG/health_ecosystem_core"/clinical_phase*.py | awk -F: "{s+=\$2} END{print s}"
'
echo "=== git baseline (local canonical repo) ==="
