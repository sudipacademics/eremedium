#!/bin/bash
set -euo pipefail
# Smoke officer password login against local RFMS API
RESP=$(curl -sS -X POST 'http://127.0.0.1:8090/api/v1/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"login_id":"RFMS-0001","password":"Admin@12345","role_type":"officer"}')
echo "$RESP" | head -c 400; echo
echo "$RESP" | grep -q '"success":true' && echo LOGIN_OK || echo LOGIN_FAIL
# OTP should be disabled
OTP=$(curl -sS -X POST 'http://127.0.0.1:8090/api/v1/auth/otp/request' \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@remediumlab.local","password":"Admin@12345","role_type":"officer"}')
echo "$OTP" | head -c 300; echo
echo "$OTP" | grep -q OTP_DISABLED && echo OTP_DISABLED_OK || echo OTP_DISABLED_MISS
