#!/bin/bash
cd /opt/health-ecosystem/docker
echo "=== openai turn result ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony._openai_chat_turn --kwargs "{\"messages\": [{\"role\": \"user\", \"content\": \"Reply with the single word pong\"}]}"' 2>&1 | grep -vE 'version.*obsolete|^time=' | tail -30
echo "=== latest error ==="
bash /opt/health-ecosystem/docker/diag-openai-err2.sh 2>&1 | grep -E 'creation|http_error|HTTP Error|DONE|NO_ERROR|Unauthorized|Error'
echo "=== sms still ok ==="
docker compose exec -T backend bash -lc 'cd /home/frappe/frappe-bench && bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_msg91.sms_configured' 2>&1 | grep -vE 'version.*obsolete|^time=' | tail -3
