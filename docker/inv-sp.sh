#!/bin/bash
# Capture a sorted inventory (relative paths) of the RUNNING site-packages package.
# Usage: inv-sp.sh <tag>   -> writes /opt/health-ecosystem/backups/sp-inv-<tag>.txt
cd /opt/health-ecosystem/docker
TAG="${1:-snapshot}"
OUT="/opt/health-ecosystem/backups/sp-inv-$TAG.txt"
docker compose exec -T backend bash -lc '
  cd /home/frappe/frappe-bench/env/lib/python3.11/site-packages/health_ecosystem_core
  find . -type f ! -path "*/__pycache__/*" ! -name "*.pyc" | LC_ALL=C sort
' > "$OUT"
echo "wrote $OUT"
wc -l "$OUT"
