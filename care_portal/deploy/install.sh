#!/bin/bash
# Install or update the Remedium Care portal on the live server.
# Expects the upload in /tmp/care_portal: dist/, server/, nginx/, deploy/.
# The SQLite database in /opt/health-ecosystem/care_portal/data is never replaced; it is backed up first.
set -euo pipefail

SRC=/tmp/care_portal
APP=/opt/health-ecosystem/care_portal
DOMAIN=care.e-remedium.in
SITE=/etc/nginx/sites-available/$DOMAIN

id careapi >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin careapi
mkdir -p "$APP/data" "$APP/data-aesthetic" /var/www/certbot

mkdir -p /opt/health-ecosystem/backups
if [ -f "$APP/data/care.db" ]; then
  cp "$APP/data/care.db" "/opt/health-ecosystem/backups/care-$(date +%Y%m%d-%H%M%S).db"
fi
if [ -f "$APP/data-aesthetic/aesthetic.db" ]; then
  cp "$APP/data-aesthetic/aesthetic.db" "/opt/health-ecosystem/backups/aesthetic-sessions-$(date +%Y%m%d-%H%M%S).db"
fi

rm -rf "$APP/dist.new" "$APP/server.new" "$APP/dist-aesthetic.new"
cp -r "$SRC/dist" "$APP/dist.new"
cp -r "$SRC/server" "$APP/server.new"
rm -rf "$APP/dist" "$APP/server"
mv "$APP/dist.new" "$APP/dist"
mv "$APP/server.new" "$APP/server"
# Aesthetic console session pages (npm run build:aesthetic); kept as they are when not in the upload.
if [ -d "$SRC/dist-aesthetic" ]; then
  cp -r "$SRC/dist-aesthetic" "$APP/dist-aesthetic.new"
  rm -rf "$APP/dist-aesthetic"
  mv "$APP/dist-aesthetic.new" "$APP/dist-aesthetic"
fi
cp -r "$SRC/nginx" "$APP/"
cp -r "$SRC/deploy" "$APP/"

for d in "$APP/dist" "$APP/server" "$APP/dist-aesthetic"; do
  [ -d "$d" ] || continue
  find "$d" -type d -exec chmod 755 {} +
  find "$d" -type f -exec chmod 644 {} +
done
chmod 755 "$APP"
chown -R careapi:careapi "$APP/data" "$APP/data-aesthetic"
chmod 750 "$APP/data" "$APP/data-aesthetic"

cp "$APP/deploy/care-api.service" /etc/systemd/system/care-api.service
cp "$APP/deploy/aes-api.service" /etc/systemd/system/aes-api.service
systemctl daemon-reload
systemctl enable care-api aes-api >/dev/null
systemctl restart care-api aes-api
sleep 2
curl -fsS http://127.0.0.1:8095/care-api/health && echo " care-api OK"
curl -fsS http://127.0.0.1:8096/care-api/health && echo " aes-api OK"

if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  cp "$APP/nginx/$DOMAIN.conf" "$SITE"
else
  cp "$APP/nginx/$DOMAIN.http.conf" "$SITE"
fi
ln -sf "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
nginx -t
systemctl reload nginx

if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
  cp "$APP/nginx/$DOMAIN.conf" "$SITE"
  nginx -t
  systemctl reload nginx
fi

echo "CARE_PORTAL_DEPLOY_DONE"
