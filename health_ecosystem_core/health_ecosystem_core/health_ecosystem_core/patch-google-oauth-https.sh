#!/bin/bash
# Final Google OAuth fix — HTTPS portal URL + Social Login Key + smoke test.
set -e
ROOT="/opt/health-ecosystem"
SITE="${FRAPPE_SITE:-health.localhost}"
PORTAL_URL="${HEC_PORTAL_URL:-https://www.e-remedium.in}"

if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec /bin/bash "$0" "$@"
fi

cd "$ROOT/docker"

echo "=== 1) Sync OAuth backend ==="
docker compose exec -T backend bash -s "$SITE" "$PORTAL_URL" <<'EOS'
set -e
SITE="$1"
PORTAL_URL="$2"
cd /home/frappe/frappe-bench
CORE=apps/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core
PKG=$(./env/bin/python -c "import health_ecosystem_core.health_ecosystem_core.api as m, os; print(os.path.dirname(m.__file__))")

for pyfile in clinical_phase18b.py clinical_email.py api.py init.py; do
  cp -f "$CORE/$pyfile" "$PKG/$pyfile"
  python3 -m py_compile "$PKG/$pyfile"
done

bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.clinical_phase30_domain.setup_e_remedium_domain --kwargs "{'portal_url': '$PORTAL_URL', 'https': True}"
bench --site "$SITE" set-config host_name "$PORTAL_URL"
bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.init.run_phase18b_setup
bench --site "$SITE" clear-cache
EOS

docker compose restart backend
sleep 8

echo ""
echo "=== 2) OAuth status ==="
docker compose exec -T backend bench --site "$SITE" execute health_ecosystem_core.health_ecosystem_core.clinical_phase18b.oauth_status

echo ""
echo "=== 3) Provider URL check (HTTPS redirect_to) ==="
curl -sS -H "Host: www.e-remedium.in" -H "X-Forwarded-Proto: https" \
  "http://127.0.0.1:8080/api/method/health_ecosystem_core.health_ecosystem_core.clinical_phase18b.get_oauth_providers?redirect_to=https%3A%2F%2Fwww.e-remedium.in%2Foauth%2Fcallback" \
  | head -c 500
echo ""

echo ""
echo "DONE — add this exact URI in Google Cloud Console (OAuth client → Authorized redirect URIs):"
echo "  ${PORTAL_URL}/api/method/frappe.integrations.oauth2_logins.login_via_google"
echo "Then test: ${PORTAL_URL}/login"
