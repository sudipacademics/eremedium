#!/bin/bash
# Backup site DB + apps/erpnext + apps/frappe before ERPNext bump (no compose down).
set -e
cd /opt/health-ecosystem/docker
SITE=health.localhost
TS=$(date +%Y%m%d-%H%M%S)
BK=/opt/health-ecosystem/backups
mkdir -p "$BK"

echo "=== versions before upgrade ===" | tee "$BK/upgrade-notes-$TS.txt"
docker compose exec -T backend bash -lc '
  cd /home/frappe/frappe-bench
  for a in frappe erpnext hrms; do
    echo -n "$a: "
    grep -m1 __version__ apps/$a/$a/__init__.py 2>/dev/null || echo MISSING
  done
  echo "image: $(grep -m1 image: docker-compose.yml 2>/dev/null || true)"
' 2>&1 | grep -vE 'version.*obsolete|^time=' | tee -a "$BK/upgrade-notes-$TS.txt"

echo "=== bench backup site $SITE ==="
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site $SITE backup --with-files" 2>&1 | grep -vE 'version.*obsolete|^time=' | tee -a "$BK/upgrade-notes-$TS.txt"

# Copy latest site backup out of the sites volume
echo "=== copy site backup to $BK ==="
docker compose exec -T backend bash -lc '
  cd /home/frappe/frappe-bench/sites/'"$SITE"'/private/backups
  ls -lt | head -6
  newest=$(ls -t *.sql.gz 2>/dev/null | head -1)
  echo NEWEST_SQL=$newest
'
# pull sql.gz + files tarball if present
docker compose cp backend:/home/frappe/frappe-bench/sites/$SITE/private/backups/. "$BK/site-backup-$TS/" 2>/dev/null || {
  mkdir -p "$BK/site-backup-$TS"
  docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench/sites/$SITE/private/backups && tar czf /tmp/site-bk.tgz ." 
  docker compose cp backend:/tmp/site-bk.tgz "$BK/site-backup-$TS.tgz"
  docker compose exec -T backend rm -f /tmp/site-bk.tgz
}

echo "=== tar apps/erpnext + apps/frappe inside container, copy out ==="
docker compose exec -T backend bash -lc '
  set -e
  cd /home/frappe/frappe-bench/apps
  tar czf /tmp/apps-erpnext-pre.tgz erpnext
  tar czf /tmp/apps-frappe-pre.tgz frappe
  ls -lh /tmp/apps-*-pre.tgz
'
docker compose cp backend:/tmp/apps-erpnext-pre.tgz "$BK/apps-erpnext-pre-$TS.tgz"
docker compose cp backend:/tmp/apps-frappe-pre.tgz "$BK/apps-frappe-pre-$TS.tgz"
docker compose exec -T backend bash -lc 'rm -f /tmp/apps-erpnext-pre.tgz /tmp/apps-frappe-pre.tgz'

echo "BACKUP_TS=$TS" | tee -a "$BK/upgrade-notes-$TS.txt"
ls -lh "$BK" | tail -15
echo "BACKUP_OK ts=$TS"
