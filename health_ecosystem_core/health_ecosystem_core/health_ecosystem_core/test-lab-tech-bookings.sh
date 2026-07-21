#!/bin/bash
set -e
SITE="${FRAPPE_SITE:-health.localhost}"
API="${API_BASE:-http://127.0.0.1:8080}"
USER="${LAB_USER:-lab_tech@health.local}"
PASS="${LAB_PASS:-TechChangeMe@123}"

LOGIN=$(curl -s -X POST "$API/api/method/health_ecosystem_core.health_ecosystem_core.api.authenticate_user" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "X-Frappe-Site-Name: $SITE" \
  -d "usr=$USER&pwd=$PASS")
SID=$(echo "$LOGIN" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['message']['data']['sid'])")

echo "=== get_my_bookings as lab_tech ==="
curl -s -X POST "$API/api/method/health_ecosystem_core.health_ecosystem_core.api.get_my_bookings" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "X-Frappe-Site-Name: $SITE" \
  -d "sid=$SID&limit=5" | python3 -c "
import sys, json
d=json.load(sys.stdin)
m=d.get('message',{})
print('status', m.get('status'))
bookings=m.get('data',{}).get('bookings',[])
print('count', len(bookings))
for b in bookings[:5]:
    print(b.get('trf_id'), b.get('patient_name'), b.get('order_status'))
"
