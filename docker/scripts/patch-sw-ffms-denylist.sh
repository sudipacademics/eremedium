#!/bin/bash
# Hot-patch live SPA service worker so /onboard|/franchise|/ffms hit nginx, not index.html.
set -euo pipefail
SW=/opt/health-ecosystem/health_web_app/dist/sw.js
python3 - "$SW" <<'PY'
import sys, os, re
path = sys.argv[1]
src = open(path, encoding='utf-8').read()
deny_items = (r'/^\/franchise(\/|$)/,/^\/onboard(\/|$)/,/^\/ffms(\/|$)/,'
              r'/^\/rfms-api(\/|$)/,/^\/uploads(\/|$)/,/^\/api(\/|$)/')
changed = False

# Already has a NavigationRoute denylist (baked by vite or prior patch).
if 'createHandlerBoundToURL("/index.html"),{denylist:' in src or 'FFMS_DENYLIST' in src:
    print('sw=navigation_denylist_present')
else:
    needle = 'createHandlerBoundToURL("/index.html")'
    if needle not in src:
        raise SystemExit('sw=needle_missing')
    i = src.index(needle) + len(needle)
    tail = src[i:i + 2]
    if tail.startswith(')'):
        src = src[:i] + ',/*FFMS_DENYLIST*/{denylist:[' + deny_items + ']}' + src[i:]
    elif tail.startswith(',{'):
        j = i + 2
        src = src[:j] + '/*FFMS_DENYLIST*/denylist:[' + deny_items + '],' + src[j:]
    else:
        raise SystemExit('sw=unexpected_shape:' + repr(tail))
    changed = True
    print('sw=navigation_denylist_patched')

# Broad navigate NetworkFirst without pathname guard — remove it.
if 'FFMS_NAV_GUARD' in src or 'url:s})=>"navigate"===e.mode&&!' in src or 'url:s)=>"navigate"===e.mode&&!' in src:
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
print('sw=done changed=' + str(changed))
os.utime(path, None)
print('has_denylist', 'denylist' in open(path, encoding='utf-8').read())
PY
