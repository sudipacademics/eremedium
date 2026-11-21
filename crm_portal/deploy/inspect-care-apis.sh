#!/bin/bash
set -euo pipefail
for pid in $(ss -lptn | awk '/:8095|:8096/{ if (match($0,/pid=([0-9]+)/,a)) print a[1] }' | sort -u); do
  echo "=== pid $pid ==="
  echo "cwd=$(readlink /proc/$pid/cwd)"
  tr '\0' ' ' < /proc/$pid/cmdline; echo
  tr '\0' '\n' < /proc/$pid/environ | grep -E '^(CARE_|PORT|PWD|NODE)' || true
  echo "auth.mjs mtime=$(stat -c %y $(readlink /proc/$pid/cwd)/server/auth.mjs 2>/dev/null || echo missing)"
done
systemctl list-units --type=service --all 2>/dev/null | grep -Ei 'care|aesth' || echo 'no systemd care units'
ls /etc/systemd/system 2>/dev/null | grep -Ei 'care|aesth|8095|8096' || true
command -v pm2 >/dev/null && pm2 list || true
ls /etc/supervisor/conf.d 2>/dev/null || true
grep -Rns '8095\|8096\|CARE_FLAVOR' /etc/systemd/system /etc/supervisor 2>/dev/null | head -40 || true
