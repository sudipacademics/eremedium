#!/bin/bash
# Install or update the Smilecure CRM portal on the live server.
# Expects the upload in /tmp/crm_portal: dist/, nginx/, deploy/.
set -euo pipefail

SRC=/tmp/crm_portal
APP=/opt/health-ecosystem/crm_portal
DOMAIN=crm.e-remedium.in
SITE=/etc/nginx/sites-available/$DOMAIN

mkdir -p "$APP" /var/www/certbot

rm -rf "$APP/dist.new"
cp -r "$SRC/dist" "$APP/dist.new"
rm -rf "$APP/dist"
mv "$APP/dist.new" "$APP/dist"
cp -r "$SRC/nginx" "$APP/"
cp -r "$SRC/deploy" "$APP/"

find "$APP/dist" -type d -exec chmod 755 {} +
find "$APP/dist" -type f -exec chmod 644 {} +
chmod 755 "$APP" "$APP/dist"
# scp often creates assets as 700 — nginx then 404s the bundle
if [ -d "$APP/dist/assets" ]; then
  chmod 755 "$APP/dist/assets"
  find "$APP/dist/assets" -type f -exec chmod 644 {} +
fi

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

echo "CRM_PORTAL_DEPLOY_DONE"
