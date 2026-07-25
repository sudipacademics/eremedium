#!/usr/bin/env bash
set -euo pipefail
cd /opt/health-ecosystem/docker
echo "=== compose mounts for backend ==="
docker compose config 2>/dev/null | awk '/backend:/,/^  [a-z]/ {print}' | head -80
echo "=== inspect mounts ==="
docker inspect "$(docker compose ps -q backend)" --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
