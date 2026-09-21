#!/usr/bin/env bash
# Cut over SSA to vedsutra.in (webhostbox DNS → this Hetzner host).
# Safe order: keep astro app live until vedsutra TLS succeeds, then redirect.
set -euo pipefail

REPO=/opt/eremedium
APP=$REPO/spiritual_super_app
NGINX_SRC=$APP/nginx/host-nginx
TARGET_IP=167.233.108.90
DOMAIN=vedsutra.in

cd "$REPO"
git fetch origin +feat/vedsutra-theme:refs/remotes/origin/feat/vedsutra-theme
git checkout -B feat/vedsutra-theme origin/feat/vedsutra-theme
git log -1 --oneline

mkdir -p /var/www/certbot

echo "=== install shared upstreams + keep astro APP live + vedsutra bootstrap ==="
ln -sfn "$NGINX_SRC/ssa-upstreams.conf" /etc/nginx/sites-enabled/zz-ssa-upstreams.conf
ln -sfn "$NGINX_SRC/astro.conf" /etc/nginx/sites-enabled/zz-astro.e-remedium.in
ln -sfn "$NGINX_SRC/vedsutra-bootstrap.conf" /etc/nginx/sites-enabled/zz-vedsutra.in
nginx -t
systemctl reload nginx

echo "=== DNS check (A → $TARGET_IP) ==="
wait_dns() {
  local host=$1
  local ip
  ip=$(dig +short "$host" A | grep -E '^[0-9.]+$' | tail -n1 | tr -d '[:space:]')
  echo "$host -> ${ip:-NONE}"
  [[ "$ip" == "$TARGET_IP" ]]
}

DNS_OK=0
for i in $(seq 1 36); do
  if wait_dns "$DOMAIN" && wait_dns "www.$DOMAIN"; then
    DNS_OK=1
    break
  fi
  echo "waiting for A records → $TARGET_IP (attempt $i/36)…"
  sleep 10
done

if [[ "$DNS_OK" != "1" ]]; then
  echo "DNS_NOT_READY"
  echo "At registrar: set NS to ns1.bh-in-3.webhostbox.net / ns2.bh-in-3.webhostbox.net"
  echo "In webhostbox DNS: A @ and www → $TARGET_IP"
  echo "astro.e-remedium.in is still serving the app. Re-run this script when dig shows the A records."
  exit 2
fi

echo "=== ACME cert for $DOMAIN ==="
certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" -d "www.$DOMAIN" \
  --non-interactive --agree-tos --register-unsafely-without-email \
  --keep-until-expiring

echo "=== enable full vedsutra vhost ==="
ln -sfn "$NGINX_SRC/vedsutra.conf" /etc/nginx/sites-enabled/zz-vedsutra.in
nginx -t
systemctl reload nginx

echo "=== .env domain cutover ==="
ENV=$APP/.env
cp -a "$ENV" "$ENV.bak.vedsutra.$(date +%Y%m%d%H%M%S)"
python3 - <<'PY'
from pathlib import Path
p = Path("/opt/eremedium/spiritual_super_app/.env")
text = p.read_text()
repl = {
    "PUBLIC_DOMAIN": "vedsutra.in",
    "CORS_ORIGINS": "https://vedsutra.in,https://www.vedsutra.in",
    "PUBLIC_WS_URL": "wss://vedsutra.in/api/v1/ws",
    "LIVEKIT_PUBLIC_URL": "wss://vedsutra.in",
}
lines = []
seen = set()
for line in text.splitlines():
    if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
        lines.append(line)
        continue
    key, _, _ = line.partition("=")
    key = key.strip()
    if key in repl:
        lines.append(f"{key}={repl[key]}")
        seen.add(key)
    else:
        lines.append(line.replace("astro.e-remedium.in", "vedsutra.in"))
for key, val in repl.items():
    if key not in seen:
        lines.append(f"{key}={val}")
p.write_text("\n".join(lines) + "\n")
print("env updated")
PY

cd "$APP"
docker compose -f docker-compose.yml -f docker-compose.shared-host.yml up -d --force-recreate core-gateway web livekit 2>&1 | tail -25
sleep 18

echo "=== smoke vedsutra ==="
GATE=$(cat /root/.ssa_gate_token 2>/dev/null || true)
AUTH=()
if [[ -n "${GATE:-}" ]]; then AUTH=(-H "Authorization: Bearer ${GATE}"); fi
curl -fsS -o /dev/null -w 'vedsutra:%{http_code}\n' "${AUTH[@]}" "https://vedsutra.in/"
curl -fsS -o /dev/null -w 'www:%{http_code}\n' "${AUTH[@]}" -L "https://www.vedsutra.in/" || true
HTML=$(curl -fsS "${AUTH[@]}" "https://vedsutra.in/" || true)
echo "$HTML" | grep -qi 'Vedic Wisdom' && echo 'home:has-vedic' || echo 'home:MISSING-vedic'
curl -fsS -o /dev/null -w 'rtc-validate:%{http_code}\n' "${AUTH[@]}" "https://vedsutra.in/rtc/validate" || true

echo "=== switch astro → 301 redirect ==="
ln -sfn "$NGINX_SRC/astro-redirect.conf" /etc/nginx/sites-enabled/zz-astro.e-remedium.in
nginx -t
systemctl reload nginx
curl -fsS -o /dev/null -w 'astro:%{http_code} loc:%{redirect_url}\n' "${AUTH[@]}" "https://astro.e-remedium.in/" || true

curl -fsS http://127.0.0.1:8000/healthz; echo
echo DONE
