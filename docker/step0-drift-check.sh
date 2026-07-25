#!/bin/bash
# Drift check: /opt deploy tree vs actually-running installed package
cd /opt/health-ecosystem/docker
OPT=/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
PKG=$(docker compose exec -T backend bash -lc './env/bin/python -c "import health_ecosystem_core,os;print(os.path.dirname(health_ecosystem_core.__file__))"' | tr -d '\r')
echo "OPT=$OPT"
echo "PKG(container)=$PKG"

echo "=== file count ==="
echo -n "opt .py: "; find "$OPT" -maxdepth 1 -name '*.py' | wc -l
docker compose exec -T backend bash -lc "find $PKG/health_ecosystem_core -maxdepth 1 -name '*.py' | wc -l" | tr -d '\r' | sed 's/^/pkg .py: /'

echo "=== md5 of each phase module: opt vs pkg (mismatches only) ==="
# compute opt hashes
declare -A OPTH
while read -r h f; do OPTH["$(basename "$f")"]=$h; done < <(find "$OPT" -maxdepth 1 -name '*.py' -exec md5sum {} +)
# compute pkg hashes inside container
docker compose exec -T backend bash -lc "find $PKG/health_ecosystem_core -maxdepth 1 -name '*.py' -exec md5sum {} +" | tr -d '\r' > /tmp/pkg_hashes.txt
MISMATCH=0
while read -r h f; do
  b=$(basename "$f")
  o=${OPTH[$b]}
  if [ -n "$o" ] && [ "$o" != "$h" ]; then
    echo "DIFF  $b  opt=$o pkg=$h"
    MISMATCH=$((MISMATCH+1))
  fi
done < /tmp/pkg_hashes.txt
# files present in pkg but missing in opt
while read -r h f; do
  b=$(basename "$f")
  [ -z "${OPTH[$b]}" ] && echo "ONLY-IN-PKG  $b"
done < /tmp/pkg_hashes.txt
echo "mismatches=$MISMATCH"

echo "=== total tree size to transfer (opt app root) ==="
du -sh /opt/health-ecosystem/health_ecosystem_core 2>/dev/null
find /opt/health-ecosystem/health_ecosystem_core -name '*.py' | wc -l | sed 's/^/total .py files: /'
