#!/bin/bash
# Backup both the apps/ bind-mount and the running site-packages package before reconciliation.
set -e
TS=$(date +%Y%m%d-%H%M%S)
BK=/opt/health-ecosystem/backups
mkdir -p "$BK"
cd /opt/health-ecosystem/docker
echo "=== backup apps bind-mount -> $BK/apps-hec-$TS.tgz ==="
tar czf "$BK/apps-hec-$TS.tgz" -C /opt/health-ecosystem health_ecosystem_core
echo "=== backup running site-packages -> $BK/sp-hec-$TS.tgz ==="
docker compose exec -T backend bash -lc 'tar czf /tmp/sp-hec.tgz -C /home/frappe/frappe-bench/env/lib/python3.11/site-packages health_ecosystem_core'
docker compose cp backend:/tmp/sp-hec.tgz "$BK/sp-hec-$TS.tgz"
docker compose exec -T backend bash -lc 'rm -f /tmp/sp-hec.tgz'
echo "=== backups ==="
ls -lh "$BK" | tail -8
echo "BACKUP_TS=$TS"
