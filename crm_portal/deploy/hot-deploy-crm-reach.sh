#!/bin/bash
# Deploy Smilecure CRM → REACH APIs without recreating the backend container
# (docker restart restores an older site-packages copy and drops helpers).
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

SRC="${1:-/tmp/crm-reach-sync}"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# Prefer colocated fix script when run from /tmp/crm-reach-sync
if [[ -f "$SRC/fix-crm-reach-import.sh" ]]; then
  bash "$SRC/fix-crm-reach-import.sh" "$SRC"
elif [[ -f "$SCRIPT_DIR/fix-crm-reach-import.sh" ]]; then
  bash "$SCRIPT_DIR/fix-crm-reach-import.sh" "$SRC"
else
  echo "fix-crm-reach-import.sh not found" >&2
  exit 1
fi
echo CRM_REACH_HOT_DEPLOY_OK
