#!/bin/bash
# Serve FFMS (marketing / portal / admin) as paths on the live domain:
#   https://www.e-remedium.in/franchise   marketing
#   https://www.e-remedium.in/onboard     applicant portal (+ /onboard/hec-session)
#   https://www.e-remedium.in/ffms        admin dashboard
#   https://www.e-remedium.in/rfms-api/   RFMS API  (/uploads/ for RFMS files)
# Idempotent. Run after the rfms image is rebuilt with the matching basePath.
set -euo pipefail

CONF=/etc/nginx/sites-available/e-remedium
SW=/opt/health-ecosystem/health_web_app/dist/sw.js

python3 - "$CONF" <<'PY'
import sys

path = sys.argv[1]
text = open(path, encoding='utf-8').read()
MARK = '# --- FFMS path preview'

www_block = """    # --- FFMS path preview (until franchise/onboard/ffms subdomains exist) ---
    location = /franchise { return 301 /franchise/; }
    location = /onboard { return 301 /onboard/; }
    location = /ffms { return 301 /ffms/; }

    location = /onboard/hec-session {
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://rfms_api/hec-session;
    }

    # Legacy QR/cert links used /onboard/api/v1 — route those to the API, not portal static.
    location ^~ /onboard/api/ {
        client_max_body_size 50m;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_pass http://rfms_api/api/;
    }

    location ^~ /franchise/ {
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://rfms_marketing/;
    }

    location ^~ /onboard/ {
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://rfms_portal/;
    }

    location ^~ /ffms/ {
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://rfms_admin/;
    }

    location ^~ /rfms-api/ {
        client_max_body_size 50m;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_pass http://rfms_api/api/;
    }

    location ^~ /uploads/ {
        proxy_set_header Host $host;
        proxy_pass http://rfms_api/uploads/;
    }

"""

if MARK in text:
    print('www_paths=present')
else:
    anchor = ('    location /api/ {\n'
              '        proxy_http_version 1.1;\n'
              '        proxy_set_header Host $host;')
    if anchor not in text:
        raise SystemExit('ERROR: www /api/ anchor not found in nginx conf')
    text = text.replace(anchor, www_block + anchor, 1)
    print('www_paths=added')

# Same prefixes on the FFMS subdomain blocks so switching to A records
# needs no rebuild (assets stay under /franchise, /onboard, /ffms).
subdomains = [
    ('franchise.e-remedium.in', '/franchise/', 'rfms_marketing'),
    ('onboard.e-remedium.in', '/onboard/', 'rfms_portal'),
    ('ffms.e-remedium.in', '/ffms/', 'rfms_admin'),
]
for host, prefix, upstream in subdomains:
    anchor = (f'    server_name {host};\n'
              '    location /.well-known/acme-challenge/ { root /var/www/certbot; }\n')
    if anchor not in text:
        print(f'subdomain_{host}=anchor_missing')
        continue
    add = (f'    location ^~ {prefix} {{ proxy_set_header Host $host; proxy_pass http://{upstream}/; }}\n'
           '    location ^~ /rfms-api/ { proxy_set_header Host $host; proxy_pass http://rfms_api/api/; }\n')
    if add.splitlines()[0] in text:
        print(f'subdomain_{host}=present')
        continue
    text = text.replace(anchor, anchor + add, 1)
    print(f'subdomain_{host}=added')

open(path, 'w', encoding='utf-8').write(text)
PY

# The patient SPA service worker owns scope "/" — stop it serving its shell on FFMS paths.
python3 - "$SW" <<'PY'
import sys, os, re

path = sys.argv[1]
if not os.path.exists(path):
    print('sw=missing')
    raise SystemExit(0)

src = open(path, encoding='utf-8').read()
deny_items = (r'/^\/franchise(\/|$)/,/^\/onboard(\/|$)/,/^\/ffms(\/|$)/,'
              r'/^\/rfms-api(\/|$)/,/^\/uploads(\/|$)/,/^\/api(\/|$)/')
changed = False

if 'createHandlerBoundToURL("/index.html"),{denylist:' in src or 'FFMS_DENYLIST' in src:
    print('sw=navigation_denylist_present')
else:
    needle = 'createHandlerBoundToURL("/index.html")'
    if needle not in src:
        print('sw=needle_missing')
        raise SystemExit(0)
    i = src.index(needle) + len(needle)
    tail = src[i:i + 2]
    if tail.startswith(')'):
        src = src[:i] + ',/*FFMS_DENYLIST*/{denylist:[' + deny_items + ']}' + src[i:]
    elif tail.startswith(',{'):
        j = i + 2
        src = src[:j] + '/*FFMS_DENYLIST*/denylist:[' + deny_items + '],' + src[j:]
    else:
        print('sw=unexpected_shape:' + tail)
        raise SystemExit(0)
    changed = True
    print('sw=navigation_denylist_patched')

if 'FFMS_NAV_GUARD' in src or 'url:s})=>"navigate"===e.mode&&!' in src:
    print('sw=navigate_networkfirst_ok')
elif '({request:e})=>"navigate"===e.mode,new e.NetworkFirst({cacheName:"html-navigations"' in src:
    src2, n = re.subn(
        r'e\.registerRoute\(\(\{request:e\}\)=>"navigate"===e\.mode,new e\.NetworkFirst\(\{cacheName:"html-navigations",networkTimeoutSeconds:5,plugins:\[new e\.ExpirationPlugin\(\{maxEntries:8,maxAgeSeconds:86400\}\)\]\}\),"GET"\),?',
        '/*FFMS_NAV_GUARD*/',
        src,
        count=1,
    )
    if n:
        src = src2
        changed = True
        print('sw=navigate_networkfirst_removed')
    else:
        print('sw=navigate_networkfirst_shape_unmatched')
else:
    print('sw=navigate_networkfirst_ok')

if changed:
    open(path, 'w', encoding='utf-8').write(src)
print('sw=done')
PY

# Sales "Start e-Aadhaar / e-agreement" should open the live path build.
cd /opt/health-ecosystem/docker
docker compose exec -T backend python3 - <<'PY'
import json, pathlib
p = pathlib.Path('/home/frappe/frappe-bench/sites/health.localhost/site_config.json')
cfg = json.loads(p.read_text())
cfg['onboard_base_url'] = 'https://www.e-remedium.in/onboard'
p.write_text(json.dumps(cfg, indent=1) + '\n')
print('onboard_base_url=' + cfg['onboard_base_url'])
PY
docker compose exec -T backend bench --site health.localhost clear-cache >/dev/null 2>&1 || true

nginx -t
systemctl reload nginx
echo "nginx=reloaded"
