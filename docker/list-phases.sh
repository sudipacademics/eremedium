#!/bin/bash
cd /opt/health-ecosystem/docker
echo "=== phase modules in installed package ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench
PKG=$(./env/bin/python -c "import health_ecosystem_core, os; print(os.path.dirname(health_ecosystem_core.__file__))")
echo PKG=$PKG
ls "$PKG/health_ecosystem_core" | grep -iE "phase|\.py$" | sort
echo "--- count ---"
ls "$PKG/health_ecosystem_core"/clinical_phase*.py 2>/dev/null | wc -l
'
echo "=== phase modules in /opt source tree ==="
ls /opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/ | grep -iE "phase" | sort

echo "=== phase docstrings (title of each phase) ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench
PKG=$(./env/bin/python -c "import health_ecosystem_core, os; print(os.path.dirname(health_ecosystem_core.__file__))")
for f in "$PKG/health_ecosystem_core"/clinical_phase*.py; do
  base=$(basename "$f")
  # first triple-quoted docstring line
  doc=$(awk "NR<=6 && /\"\"\"/{gsub(/\"\"\"/,\"\"); print; exit}" "$f")
  printf "%-45s %s\n" "$base" "$doc"
done | sort
'
