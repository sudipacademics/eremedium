#!/usr/bin/env bash
# Poll DNS then finish cutover. Logs to /var/log/vedsutra-cutover-wait.log
set -euo pipefail
LOG=/var/log/vedsutra-cutover-wait.log
exec >>"$LOG" 2>&1
echo "==== $(date -Is) wait start ===="
TARGET_IP=167.233.108.90
for i in $(seq 1 240); do
  A=$(dig +short vedsutra.in A | grep -E '^[0-9.]+$' | tail -n1 || true)
  W=$(dig +short www.vedsutra.in A | grep -E '^[0-9.]+$' | tail -n1 || true)
  echo "$(date -Is) attempt=$i apex=$A www=$W"
  if [[ "$A" == "$TARGET_IP" && "$W" == "$TARGET_IP" ]]; then
    echo "DNS ready — running cutover"
    sed -i 's/\r$//' /opt/eremedium/spiritual_super_app/scripts/cutover-vedsutra-domain.sh
    bash /opt/eremedium/spiritual_super_app/scripts/cutover-vedsutra-domain.sh
    echo "==== $(date -Is) cutover finished exit=$? ===="
    exit 0
  fi
  sleep 30
done
echo "==== $(date -Is) timed out after ~2h ===="
exit 1
