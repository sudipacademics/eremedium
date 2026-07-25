#!/bin/bash
set -e
WEB=/opt/health-ecosystem/health_web_app
TS=$(date +%Y%m%d-%H%M%S)
echo "=== Backup current dist ==="
rm -rf "$WEB/dist.pre-remedium-$TS"
cp -a "$WEB/dist" "$WEB/dist.pre-remedium-$TS"
echo "=== Restore Remedium dist.bak ==="
# Keep bak assets: replace dist contents with bak
rm -rf "$WEB/dist"
cp -a "$WEB/dist.bak" "$WEB/dist"
# Ensure index points at bak entry assets
head -20 "$WEB/dist/index.html"
echo "=== CSS/JS present ==="
ls "$WEB/dist/web-assets" | head -20
echo "DONE"
