#!/bin/bash
# Copy uploaded add-on files from /tmp/addons into the server's add-on store, then re-apply them
# (web files into the live build, backend modules + hook + small patches into the backend container).
set -e
mkdir -p /opt/health-ecosystem/people-addons/backend
for f in /tmp/addons/*; do
  name=$(basename "$f")
  case "$name" in
    restore_people_addons.py) cp "$f" /opt/health-ecosystem/people-addons/restore_people_addons.py ;;
    publish_addons.sh) ;;
    clinical_*.py) cp "$f" "/opt/health-ecosystem/people-addons/backend/$name"; echo "backend module staged: $name" ;;
    *) cp "$f" "/opt/health-ecosystem/people-addons/$name" ;;
  esac
done
python3 /opt/health-ecosystem/people-addons/restore_people_addons.py
grep -o '<script src="/people-[a-z-]*\.js[^"]*"' /opt/health-ecosystem/health_web_app/dist/index.html
rm -rf /tmp/addons
