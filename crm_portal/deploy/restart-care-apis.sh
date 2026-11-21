#!/bin/bash
set -euo pipefail
echo "Care API cwd: $(readlink /proc/32217/cwd 2>/dev/null || true)"
echo "Aes API cwd: $(readlink /proc/32218/cwd 2>/dev/null || true)"
systemctl list-units --type=service --all 2>/dev/null | grep -Ei 'care|aesth' || true
ls /etc/systemd/system/*care* /etc/systemd/system/*aesth* /etc/systemd/system/*8095* /etc/systemd/system/*8096* 2>/dev/null || true
# Prefer systemd units if present
for u in care-api aesthetic-api care_portal aesthetic_portal remedium-care remedium-aesthetic; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^${u}"; then
    systemctl restart "$u" && echo "restarted $u"
  fi
done
# Fallback: kill node server.mjs so a supervisor/systemd restarts them, or start from known path
CARE_ROOT=/opt/health-ecosystem/care_portal
if [[ -d "$CARE_ROOT" ]]; then
  cp -f /opt/health-ecosystem/care_portal/server/auth.mjs "$CARE_ROOT/server/auth.mjs" 2>/dev/null || true
fi
# Kill current listeners; if under systemd they come back. Else start manually.
for pid in $(ss -lptn | awk '/:8095|:8096/{match($0,/pid=([0-9]+)/,a); if(a[1]) print a[1]}' | sort -u); do
  echo "Stopping pid $pid"
  kill "$pid" || true
done
sleep 2
still=$(ss -lptn | grep -E ':8095|:8096' || true)
if [[ -n "$still" ]]; then
  echo "Still listening (supervisor restarted):"
  echo "$still"
  exit 0
fi
# Manual start if nothing revived them
cd "$CARE_ROOT"
if [[ -f server/server.mjs ]]; then
  nohup env CARE_FLAVOR=aesthetic PORT=8096 node --no-warnings server/server.mjs >/var/log/aesthetic-api.log 2>&1 &
  nohup env CARE_FLAVOR=care PORT=8095 node --no-warnings server/server.mjs >/var/log/care-api.log 2>&1 &
  sleep 1
  ss -lptn | grep -E ':8095|:8096' || true
  echo "Manual start attempted"
fi
echo CARE_API_RESTART_DONE
