#!/bin/bash
# Build REACH (health_web_app) dist and refresh public static if needed.
set -euo pipefail
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

WEB=/opt/health-ecosystem/health_web_app
cd "$WEB"

test -f src/pages/sales/SalesB2bCentresPage.tsx
test -f src/pages/sales/SalesB2bSalesPage.tsx
grep -q "b2b-centres" src/App.tsx

echo "=== package manager / build ==="
if [ -f package-lock.json ]; then
  echo "using npm"
  npm ci --prefer-offline 2>/dev/null || npm install
  npm run build
elif [ -f pnpm-lock.yaml ]; then
  echo "using pnpm"
  corepack enable || true
  pnpm install --frozen-lockfile || pnpm install
  pnpm run build
elif [ -f yarn.lock ]; then
  echo "using yarn"
  yarn install --frozen-lockfile || yarn install
  yarn build
else
  npm install
  npm run build
fi

test -d dist
echo "=== dist grep ==="
grep -R "b2b-centres\|B2B Centres" dist 2>/dev/null | head -5 || {
  # Vite may minify strings — check chunk names / source maps loosely
  find dist -type f \( -name '*.js' -o -name '*.html' \) | head -20
  grep -R "B2B" dist 2>/dev/null | head -10 || echo "B2B_STRING_NOT_FOUND_IN_DIST"
}

echo "=== where is reach served from? ==="
# Host nginx sites
grep -R "reach\|health_web_app\|e-remedium" /etc/nginx 2>/dev/null | head -40 || true
ls -la /opt/health-ecosystem/health_web_app/dist/index.html

# If gateway container exists with profile web
cd /opt/health-ecosystem/docker
if docker compose -f docker-compose.yml -f docker-compose.ffms.yml --profile web ps -q gateway 2>/dev/null | grep -q .; then
  echo "=== restart gateway to pick new dist bind mount ==="
  docker compose -f docker-compose.yml -f docker-compose.ffms.yml --profile web up -d gateway
fi

# Common host static copy paths
for dest in \
  /var/www/reach \
  /var/www/health_web_app \
  /opt/health-ecosystem/reach-dist \
  /usr/share/nginx/html/reach
do
  if [ -d "$dest" ]; then
    echo "=== sync dist -> $dest ==="
    rsync -a --delete dist/ "$dest/"
  fi
done

# If nginx root points at health_web_app/dist already, nothing else needed
echo CURSOR_MOD_REACH_BUILD_OK
